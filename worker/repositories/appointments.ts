import type { AppointmentStatus } from '../types'

/**
 * Internal management row. `id` and `assignedStaffUserId` stay inside the
 * Worker; services map this record to the public `ManagedAppointment` shape.
 */
export interface ManagedAppointmentRecord {
  id: string
  assignedStaffUserId: string
  publicReference: string
  serviceId: string
  serviceName: string
  durationMinutes: number
  assignedStaff: {
    id: string
    name: string
    email: string
  }
  customer: {
    name: string
    email: string
  } | null
  guestName: string | null
  guestEmail: string | null
  /** Unix seconds. */
  startAt: number
  /** Unix seconds. */
  endAt: number
  status: AppointmentStatus
  customerNote: string | null
  resolutionNote: string | null
  /** Unix seconds. */
  createdAt: number
  /** Unix seconds. */
  updatedAt: number
  /** Unix seconds. */
  approvedAt: number | null
  /** Unix seconds. */
  cancelledAt: number | null
}

interface ManagedAppointmentRow {
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
  approved_at: number | null
  cancelled_at: number | null
  staff_name: string
  staff_email: string
  customer_name: string | null
  customer_email: string | null
}

export interface ManagedListFilters {
  staffUserId?: string
  status?: AppointmentStatus
  serviceId?: string
  /** Inclusive lower bound on `start_at`. */
  startFrom?: number
  /** Exclusive upper bound on `start_at`. */
  startBefore?: number
  /** When set, only pending/confirmed appointments ending after this instant. */
  upcomingAt?: number
  /** Matches reference, customer or guest name/email. */
  search?: string
  limit?: number
}

export interface SlotConditions {
  staffUserId: string
  /** Unix seconds. */
  startAt: number
  /** Unix seconds. */
  endAt: number
  weekday: number
  startMinute: number
  endMinute: number
  /** Unix seconds. */
  now: number
  /** The appointment being changed; it must not conflict with itself. */
  excludeAppointmentId: string
}

const MANAGED_COLUMNS = `
  a.id, a.public_reference, a.customer_user_id, a.guest_name, a.guest_email,
  a.service_id, a.service_name_snapshot, a.duration_minutes_snapshot,
  a.assigned_staff_user_id, a.start_at, a.end_at, a.status, a.customer_note,
  a.resolution_note, a.created_at, a.updated_at, a.approved_at, a.cancelled_at,
  s.name AS staff_name, s.email AS staff_email,
  c.name AS customer_name, c.email AS customer_email
`

const MANAGED_FROM = `
  FROM appointments a
  JOIN users s ON s.id = a.assigned_staff_user_id
  LEFT JOIN users c ON c.id = a.customer_user_id
`

/**
 * SQL recheck for one exact staff interval. It is deliberately expressed as
 * additional WHERE predicates so a concurrent schedule, time-off or booking
 * change cannot silently confirm a conflict.
 */
function slotConditions(alias = 'appointments'): string {
  return `
    AND EXISTS (
      SELECT 1
        FROM users u
        JOIN staff_profiles p ON p.user_id = u.id
       WHERE u.id = ?
         AND u.role = 'staff'
         AND u.is_active = 1
    )
    AND EXISTS (
      SELECT 1
        FROM staff_working_hours h
       WHERE h.staff_user_id = ?
         AND h.weekday = ?
         AND h.start_minute <= ?
         AND h.end_minute >= ?
    )
    AND NOT EXISTS (
      SELECT 1
        FROM staff_time_off t
       WHERE t.staff_user_id = ?
         AND t.start_at < ?
         AND t.end_at > ?
    )
    AND NOT EXISTS (
      SELECT 1
        FROM appointments x
       WHERE x.assigned_staff_user_id = ?
         AND x.status = 'confirmed'
         AND x.id <> ?
         AND x.start_at < ?
         AND x.end_at > ?
    )
    AND ${alias}.start_at > ?
  `
}

function slotBindings(slot: SlotConditions): unknown[] {
  return [
    slot.staffUserId,
    slot.staffUserId,
    slot.weekday,
    slot.startMinute,
    slot.endMinute,
    slot.staffUserId,
    slot.startAt,
    slot.endAt,
    slot.staffUserId,
    slot.excludeAppointmentId,
    slot.endAt,
    slot.startAt,
    slot.now,
  ]
}

function toRecord(row: ManagedAppointmentRow): ManagedAppointmentRecord {
  return {
    id: row.id,
    assignedStaffUserId: row.assigned_staff_user_id,
    publicReference: row.public_reference,
    serviceId: row.service_id,
    serviceName: row.service_name_snapshot,
    durationMinutes: row.duration_minutes_snapshot,
    assignedStaff: {
      id: row.assigned_staff_user_id,
      name: row.staff_name,
      email: row.staff_email,
    },
    customer:
      row.customer_user_id !== null &&
      row.customer_name !== null &&
      row.customer_email !== null
        ? { name: row.customer_name, email: row.customer_email }
        : null,
    guestName: row.guest_name,
    guestEmail: row.guest_email,
    startAt: row.start_at,
    endAt: row.end_at,
    status: row.status,
    customerNote: row.customer_note,
    resolutionNote: row.resolution_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    approvedAt: row.approved_at,
    cancelledAt: row.cancelled_at,
  }
}

function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, '\\$&')}%`
}

export class AppointmentsRepository {
  constructor(private readonly db: D1Database) {}

  async listManaged(
    filters: ManagedListFilters = {},
  ): Promise<ManagedAppointmentRecord[]> {
    const clauses: string[] = []
    const params: unknown[] = []

    if (filters.staffUserId !== undefined) {
      clauses.push('a.assigned_staff_user_id = ?')
      params.push(filters.staffUserId)
    }
    if (filters.status !== undefined) {
      clauses.push('a.status = ?')
      params.push(filters.status)
    }
    if (filters.serviceId !== undefined) {
      clauses.push('a.service_id = ?')
      params.push(filters.serviceId)
    }
    if (filters.startFrom !== undefined) {
      clauses.push('a.start_at >= ?')
      params.push(filters.startFrom)
    }
    if (filters.startBefore !== undefined) {
      clauses.push('a.start_at < ?')
      params.push(filters.startBefore)
    }
    if (filters.upcomingAt !== undefined) {
      clauses.push(`a.status IN ('pending', 'confirmed')`)
      clauses.push('a.end_at > ?')
      params.push(filters.upcomingAt)
    }
    if (filters.search) {
      const pattern = likePattern(filters.search)
      clauses.push(`(
        a.public_reference LIKE ? ESCAPE '\\'
        OR c.name LIKE ? ESCAPE '\\'
        OR c.email LIKE ? ESCAPE '\\'
        OR a.guest_name LIKE ? ESCAPE '\\'
        OR a.guest_email LIKE ? ESCAPE '\\'
      )`)
      params.push(pattern, pattern, pattern, pattern, pattern)
    }

    const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500)
    params.push(limit)

    const { results } = await this.db
      .prepare(
        `SELECT ${MANAGED_COLUMNS}
         ${MANAGED_FROM}
         WHERE ${clauses.length > 0 ? clauses.join(' AND ') : '1 = 1'}
         ORDER BY a.start_at ASC, a.id ASC
         LIMIT ?`,
      )
      .bind(...params)
      .all<ManagedAppointmentRow>()

    return results.map(toRecord)
  }

  async findForStaff(
    staffUserId: string,
    publicReference: string,
  ): Promise<ManagedAppointmentRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT ${MANAGED_COLUMNS}
         ${MANAGED_FROM}
         WHERE a.assigned_staff_user_id = ?
           AND a.public_reference = ?`,
      )
      .bind(staffUserId, publicReference)
      .first<ManagedAppointmentRow>()

    return row ? toRecord(row) : null
  }

  async findByReference(
    publicReference: string,
  ): Promise<ManagedAppointmentRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT ${MANAGED_COLUMNS}
         ${MANAGED_FROM}
         WHERE a.public_reference = ?`,
      )
      .bind(publicReference)
      .first<ManagedAppointmentRow>()

    return row ? toRecord(row) : null
  }

  /**
   * Confirms a pending request only while every approval precondition still
   * holds. The caller must still perform a full preflight so users get a clear
   * conflict message; this statement is the concurrency backstop.
   */
  async approve(input: SlotConditions & { actorUserId: string }): Promise<boolean> {
    const result = await this.db
      .prepare(
        `UPDATE appointments
            SET status = 'confirmed',
                resolution_note = 'Approved',
                approved_at = ?,
                approved_by_user_id = ?,
                updated_at = ?
          WHERE id = ?
            AND assigned_staff_user_id = ?
            AND status = 'pending'
            AND start_at = ?
            AND end_at = ?
            ${slotConditions()}`,
      )
      .bind(
        input.now,
        input.actorUserId,
        input.now,
        input.excludeAppointmentId,
        input.staffUserId,
        input.startAt,
        input.endAt,
        ...slotBindings(input),
      )
      .run()

    return result.meta.changes > 0
  }

  async reject(input: {
    id: string
    staffUserId?: string
    resolutionNote: string
    now: number
  }): Promise<boolean> {
    const staffClause =
      input.staffUserId === undefined ? '' : 'AND assigned_staff_user_id = ?'
    const params = [
      input.resolutionNote,
      input.now,
      input.id,
      ...(input.staffUserId === undefined ? [] : [input.staffUserId]),
    ]

    const result = await this.db
      .prepare(
        `UPDATE appointments
            SET status = 'rejected',
                resolution_note = ?,
                updated_at = ?
          WHERE id = ?
            AND status = 'pending'
            ${staffClause}`,
      )
      .bind(...params)
      .run()

    return result.meta.changes > 0
  }

  async cancel(input: {
    id: string
    staffUserId?: string
    /** Staff may cancel confirmed appointments; Admin may also cancel pending. */
    allowPending: boolean
    resolutionNote: string
    actorUserId: string
    now: number
  }): Promise<boolean> {
    const staffClause =
      input.staffUserId === undefined ? '' : 'AND assigned_staff_user_id = ?'
    const statusClause = input.allowPending
      ? `AND status IN ('pending', 'confirmed')`
      : `AND status = 'confirmed'`

    const params = [
      input.resolutionNote,
      input.now,
      input.actorUserId,
      input.now,
      input.id,
      ...(input.staffUserId === undefined ? [] : [input.staffUserId]),
    ]

    const result = await this.db
      .prepare(
        `UPDATE appointments
            SET status = 'cancelled',
                resolution_note = ?,
                cancelled_at = ?,
                cancelled_by_user_id = ?,
                updated_at = ?
          WHERE id = ?
            ${statusClause}
            ${staffClause}`,
      )
      .bind(...params)
      .run()

    return result.meta.changes > 0
  }

  async reschedule(
    input: SlotConditions & {
      currentStartAt: number
      currentEndAt: number
    },
  ): Promise<boolean> {
    const result = await this.db
      .prepare(
        `UPDATE appointments
            SET start_at = ?,
                end_at = ?,
                updated_at = ?
          WHERE id = ?
            AND assigned_staff_user_id = ?
            AND status IN ('pending', 'confirmed')
            AND start_at = ?
            AND end_at = ?
            ${slotConditions()}`,
      )
      .bind(
        input.startAt,
        input.endAt,
        input.now,
        input.excludeAppointmentId,
        input.staffUserId,
        input.currentStartAt,
        input.currentEndAt,
        ...slotBindings(input),
      )
      .run()

    return result.meta.changes > 0
  }

  async reassign(
    input: SlotConditions & {
      id: string
      currentStaffUserId: string
      currentStartAt: number
      currentEndAt: number
    },
  ): Promise<boolean> {
    const result = await this.db
      .prepare(
        `UPDATE appointments
            SET assigned_staff_user_id = ?,
                start_at = ?,
                end_at = ?,
                updated_at = ?
          WHERE id = ?
            AND assigned_staff_user_id = ?
            AND status IN ('pending', 'confirmed')
            AND start_at = ?
            AND end_at = ?
            ${slotConditions()}`,
      )
      .bind(
        input.staffUserId,
        input.startAt,
        input.endAt,
        input.now,
        input.id,
        input.currentStaffUserId,
        input.currentStartAt,
        input.currentEndAt,
        ...slotBindings(input),
      )
      .run()

    return result.meta.changes > 0
  }

  /**
   * Once an appointment leaves `pending`, every guest cancellation token for it
   * must stop working. Token lookups also require `pending`, so this is the
   * durable cleanup rather than the only guard.
   */
  invalidateGuestTokensStatement(
    appointmentId: string,
    now: number,
  ): D1PreparedStatement {
    return this.db
      .prepare(
        `UPDATE guest_cancellation_tokens
            SET invalidated_at = ?
          WHERE appointment_id = ?
            AND used_at IS NULL
            AND invalidated_at IS NULL`,
      )
      .bind(now, appointmentId)
  }
}
