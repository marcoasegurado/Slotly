import type { AppointmentStatus, Booking } from '../types'

interface AppointmentRow {
  id: string
  public_reference: string
  customer_user_id: string | null
  guest_name: string | null
  guest_email: string | null
  service_id: string
  service_name_snapshot: string
  duration_minutes_snapshot: number
  assigned_staff_user_id: string
  start_at: number
  end_at: number
  status: AppointmentStatus
  customer_note: string | null
  resolution_note: string | null
  created_at: number
  updated_at: number
}

interface GuestTokenRow {
  token_id: string
  appointment_id: string
  public_reference: string
}

const BOOKING_COLUMNS = `
  id, public_reference, customer_user_id, guest_name, guest_email,
  service_id, service_name_snapshot, duration_minutes_snapshot,
  assigned_staff_user_id, start_at, end_at, status, customer_note,
  resolution_note, created_at, updated_at
`

export interface NewBooking {
  id: string
  publicReference: string
  customerUserId: string | null
  guestName: string | null
  guestEmail: string | null
  serviceId: string
  serviceName: string
  durationMinutes: number
  assignedStaffUserId: string
  startAt: number
  endAt: number
  customerNote: string | null
  now: number
}

export interface NewGuestToken {
  id: string
  appointmentId: string
  tokenHash: string
  expiresAt: number
  now: number
}

export interface GuestTokenLookup {
  tokenId: string
  appointmentId: string
  publicReference: string
}

function toBooking(row: AppointmentRow): Booking {
  return {
    publicReference: row.public_reference,
    serviceId: row.service_id,
    serviceName: row.service_name_snapshot,
    durationMinutes: row.duration_minutes_snapshot,
    startAt: row.start_at,
    endAt: row.end_at,
    status: row.status,
    customerNote: row.customer_note,
    guestName: row.guest_name,
    guestEmail: row.guest_email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class BookingsRepository {
  constructor(private readonly db: D1Database) {}

  /**
   * Inserts the pending appointment, its optional guest token and the
   * `request_received` outbox row in one D1 batch so a failed insert cannot
   * leave a partial booking or a missing email intent.
   */
  async create(
    booking: NewBooking,
    token: NewGuestToken | null,
    notification: D1PreparedStatement | null = null,
  ): Promise<void> {
    const statements = [
      this.db
        .prepare(
          `INSERT INTO appointments (
             id, public_reference, customer_user_id, guest_name, guest_email,
             service_id, service_name_snapshot, duration_minutes_snapshot,
             assigned_staff_user_id, start_at, end_at, status, customer_note,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
        )
        .bind(
          booking.id,
          booking.publicReference,
          booking.customerUserId,
          booking.guestName,
          booking.guestEmail,
          booking.serviceId,
          booking.serviceName,
          booking.durationMinutes,
          booking.assignedStaffUserId,
          booking.startAt,
          booking.endAt,
          booking.customerNote,
          booking.now,
          booking.now,
        ),
    ]

    if (token) {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO guest_cancellation_tokens (
               id, appointment_id, token_hash, created_at, expires_at
             ) VALUES (?, ?, ?, ?, ?)`,
          )
          .bind(
            token.id,
            token.appointmentId,
            token.tokenHash,
            token.now,
            token.expiresAt,
          ),
      )
    }

    if (notification) {
      statements.push(notification)
    }

    await this.db.batch(statements)
  }

  async listForCustomer(customerUserId: string): Promise<Booking[]> {
    const { results } = await this.db
      .prepare(
        `SELECT ${BOOKING_COLUMNS}
           FROM appointments
          WHERE customer_user_id = ?
          ORDER BY start_at ASC, id ASC`,
      )
      .bind(customerUserId)
      .all<AppointmentRow>()

    return results.map(toBooking)
  }

  async findForCustomer(
    customerUserId: string,
    publicReference: string,
  ): Promise<Booking | null> {
    const row = await this.db
      .prepare(
        `SELECT ${BOOKING_COLUMNS}
           FROM appointments
          WHERE customer_user_id = ? AND public_reference = ?`,
      )
      .bind(customerUserId, publicReference)
      .first<AppointmentRow>()

    return row ? toBooking(row) : null
  }

  async cancelPendingForCustomer(
    customerUserId: string,
    publicReference: string,
    now: number,
  ): Promise<boolean> {
    const result = await this.db
      .prepare(
        `UPDATE appointments
            SET status = 'cancelled',
                resolution_note = 'Cancelled by customer',
                cancelled_at = ?,
                cancelled_by_user_id = ?,
                updated_at = ?
          WHERE customer_user_id = ?
            AND public_reference = ?
            AND status = 'pending'`,
      )
      .bind(now, customerUserId, now, customerUserId, publicReference)
      .run()

    return result.meta.changes > 0
  }

  /**
   * Resolves only a live token whose appointment is still pending. Any other
   * state must be indistinguishable from an unknown token.
   */
  async findGuestToken(
    tokenHash: string,
    now: number,
  ): Promise<GuestTokenLookup | null> {
    const row = await this.db
      .prepare(
        `SELECT t.id AS token_id, t.appointment_id, a.public_reference
           FROM guest_cancellation_tokens t
           JOIN appointments a ON a.id = t.appointment_id
          WHERE t.token_hash = ?
            AND t.used_at IS NULL
            AND t.invalidated_at IS NULL
            AND t.expires_at > ?
            AND a.status = 'pending'
            AND a.customer_user_id IS NULL`,
      )
      .bind(tokenHash, now)
      .first<GuestTokenRow>()

    if (!row) return null

    return {
      tokenId: row.token_id,
      appointmentId: row.appointment_id,
      publicReference: row.public_reference,
    }
  }

  /**
   * Cancels the appointment only while the token is still live and the booking
   * is still pending. The token check is part of the same statement so a
   * concurrent use cannot cancel twice.
   */
  async cancelPendingGuest(
    tokenId: string,
    appointmentId: string,
    now: number,
  ): Promise<boolean> {
    const result = await this.db
      .prepare(
        `UPDATE appointments
            SET status = 'cancelled',
                resolution_note = 'Cancelled by guest',
                cancelled_at = ?,
                updated_at = ?
          WHERE id = ?
            AND status = 'pending'
            AND customer_user_id IS NULL
            AND EXISTS (
              SELECT 1
                FROM guest_cancellation_tokens t
               WHERE t.id = ?
                 AND t.appointment_id = appointments.id
                 AND t.used_at IS NULL
                 AND t.invalidated_at IS NULL
                 AND t.expires_at > ?
            )`,
      )
      .bind(now, now, appointmentId, tokenId, now)
      .run()

    return result.meta.changes > 0
  }

  async markGuestTokenUsed(tokenId: string, now: number): Promise<void> {
    await this.db
      .prepare(
        `UPDATE guest_cancellation_tokens
            SET used_at = ?
          WHERE id = ? AND used_at IS NULL`,
      )
      .bind(now, tokenId)
      .run()
  }
}
