import { randomId } from '../lib/encoding'
import type { AppointmentStatus } from '../types'
import type {
  EmailEventType,
  NotificationPayload,
} from '../email/contract'

export type OutboxDeliveryStatus = 'pending' | 'sending' | 'sent' | 'failed'

export interface NewNotification {
  /** Optional caller-supplied id when the row also needs inline dispatch. */
  id?: string
  appointmentId: string
  eventType: EmailEventType
  recipientEmail: string
  payload: NotificationPayload
  /** Unix seconds. */
  now: number
}

export interface StoredNotification {
  id: string
  appointmentId: string
  eventType: EmailEventType
  recipientEmail: string
  payload: NotificationPayload
  deliveryStatus: OutboxDeliveryStatus
  attemptCount: number
  /** Unix seconds. */
  createdAt: number
}

/** Outbox row joined with the appointment data needed to render the email. */
export interface DeliveryRecord extends StoredNotification {
  publicReference: string
  serviceName: string
  durationMinutes: number
  /** Unix seconds. */
  startAt: number
  /** Unix seconds. */
  endAt: number
  status: AppointmentStatus
  customerName: string | null
  customerEmail: string | null
  guestName: string | null
  guestEmail: string | null
  customerNote: string | null
  resolutionNote: string | null
}

interface NotificationRow {
  id: string
  appointment_id: string
  event_type: EmailEventType
  recipient_email: string
  payload_json: string
  delivery_status: OutboxDeliveryStatus
  attempt_count: number
  created_at: number
}

interface DeliveryRow extends NotificationRow {
  public_reference: string
  service_name_snapshot: string
  duration_minutes_snapshot: number
  start_at: number
  end_at: number
  status: AppointmentStatus
  customer_note: string | null
  resolution_note: string | null
  customer_name: string | null
  customer_email: string | null
  guest_name: string | null
  guest_email: string | null
}

function parsePayload(value: string): NotificationPayload {
  try {
    const parsed = JSON.parse(value) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {}
    }
    return parsed as NotificationPayload
  } catch {
    return {}
  }
}

function toStored(row: NotificationRow): StoredNotification {
  return {
    id: row.id,
    appointmentId: row.appointment_id,
    eventType: row.event_type,
    recipientEmail: row.recipient_email,
    payload: parsePayload(row.payload_json),
    deliveryStatus: row.delivery_status,
    attemptCount: row.attempt_count,
    createdAt: row.created_at,
  }
}

function toDelivery(row: DeliveryRow): DeliveryRecord {
  return {
    ...toStored(row),
    publicReference: row.public_reference,
    serviceName: row.service_name_snapshot,
    durationMinutes: row.duration_minutes_snapshot,
    startAt: row.start_at,
    endAt: row.end_at,
    status: row.status,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    guestName: row.guest_name,
    guestEmail: row.guest_email,
    customerNote: row.customer_note,
    resolutionNote: row.resolution_note,
  }
}

export class NotificationsRepository {
  constructor(private readonly db: D1Database) {}

  /** Prepared insert so booking creation can batch it atomically. */
  statement(input: NewNotification): D1PreparedStatement {
    return this.db
      .prepare(
        `INSERT INTO notification_outbox (
           id, appointment_id, event_type, recipient_email, payload_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.id ?? randomId('ntf'),
        input.appointmentId,
        input.eventType,
        input.recipientEmail,
        JSON.stringify(input.payload),
        input.now,
      )
  }

  async findById(id: string): Promise<StoredNotification | null> {
    const row = await this.db
      .prepare(
        `SELECT id, appointment_id, event_type, recipient_email, payload_json,
                delivery_status, attempt_count, created_at
           FROM notification_outbox
          WHERE id = ?`,
      )
      .bind(id)
      .first<NotificationRow>()

    return row ? toStored(row) : null
  }

  async findForDelivery(id: string): Promise<DeliveryRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT n.id, n.appointment_id, n.event_type, n.recipient_email,
                n.payload_json, n.delivery_status, n.attempt_count, n.created_at,
                a.public_reference, a.service_name_snapshot,
                a.duration_minutes_snapshot, a.start_at, a.end_at, a.status,
                a.customer_note, a.resolution_note, a.guest_name, a.guest_email,
                c.name AS customer_name, c.email AS customer_email
           FROM notification_outbox n
           JOIN appointments a ON a.id = n.appointment_id
           LEFT JOIN users c ON c.id = a.customer_user_id
          WHERE n.id = ?`,
      )
      .bind(id)
      .first<DeliveryRow>()

    return row ? toDelivery(row) : null
  }

  /**
   * Returns rows that still have attempts left. A `sending` row whose attempt
   * started longer than the stale window ago is treated as abandoned by a
   * crashed invocation.
   */
  async listRetryableIds(
    now: number,
    maxAttempts: number,
    limit: number,
    staleSendingSeconds: number,
  ): Promise<string[]> {
    const { results } = await this.db
      .prepare(
        `SELECT id
           FROM notification_outbox
          WHERE attempt_count < ?
            AND (
              delivery_status IN ('pending', 'failed')
              OR (
                delivery_status = 'sending'
                AND (last_attempt_at IS NULL OR last_attempt_at < ?)
              )
            )
          ORDER BY created_at ASC, id ASC
          LIMIT ?`,
      )
      .bind(maxAttempts, now - staleSendingSeconds, limit)
      .all<{ id: string }>()

    return results.map((row) => row.id)
  }

  async listUndeliveredIdsForReference(
    publicReference: string,
    maxAttempts: number,
    limit: number,
  ): Promise<string[]> {
    const { results } = await this.db
      .prepare(
        `SELECT n.id
           FROM notification_outbox n
           JOIN appointments a ON a.id = n.appointment_id
          WHERE a.public_reference = ?
            AND n.attempt_count < ?
            AND n.delivery_status IN ('pending', 'failed', 'sending')
          ORDER BY n.created_at ASC, n.id ASC
          LIMIT ?`,
      )
      .bind(publicReference, maxAttempts, limit)
      .all<{ id: string }>()

    return results.map((row) => row.id)
  }

  /** Conditional claim: two concurrent invocations cannot send the same row. */
  async claim(
    id: string,
    now: number,
    maxAttempts: number,
    staleSendingSeconds: number,
  ): Promise<boolean> {
    const result = await this.db
      .prepare(
        `UPDATE notification_outbox
            SET delivery_status = 'sending',
                attempt_count = attempt_count + 1,
                last_attempt_at = ?
          WHERE id = ?
            AND attempt_count < ?
            AND (
              delivery_status IN ('pending', 'failed')
              OR (
                delivery_status = 'sending'
                AND (last_attempt_at IS NULL OR last_attempt_at < ?)
              )
            )`,
      )
      .bind(now, id, maxAttempts, now - staleSendingSeconds)
      .run()

    return result.meta.changes > 0
  }

  /**
   * On success the payload is replaced with the non-secret extras so the guest
   * cancellation token does not stay at rest after delivery.
   */
  async markSent(id: string, now: number, safePayload: NotificationPayload): Promise<void> {
    await this.db
      .prepare(
        `UPDATE notification_outbox
            SET delivery_status = 'sent',
                sent_at = ?,
                last_error = NULL,
                payload_json = ?
          WHERE id = ?
            AND delivery_status = 'sending'`,
      )
      .bind(now, JSON.stringify(safePayload), id)
      .run()
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.db
      .prepare(
        `UPDATE notification_outbox
            SET delivery_status = 'failed',
                last_error = ?
          WHERE id = ?
            AND delivery_status = 'sending'`,
      )
      .bind(error, id)
      .run()
  }
}
