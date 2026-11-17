import type { AppointmentStatus, StatusCounts } from '../types'

export interface ReportFilters {
  serviceId?: string
  staffId?: string
  status?: AppointmentStatus
  /** Inclusive lower bound on `start_at` (Unix seconds). */
  startFrom?: number
  /** Exclusive upper bound on `start_at` (Unix seconds). */
  startBefore?: number
}

export interface ServiceCount {
  serviceId: string
  serviceName: string
  total: number
  counts: StatusCounts
}

export interface StaffCount {
  staffId: string
  name: string
  total: number
  counts: StatusCounts
}

export interface StaffWorkload {
  id: string
  name: string
  pending: number
  confirmedUpcoming: number
}

export interface ReportExportRow {
  publicReference: string
  startAt: number
  endAt: number
  durationMinutes: number
  serviceName: string
  staffName: string
  status: AppointmentStatus
  createdAt: number
  isCustomerBooking: boolean
  customerName: string | null
  customerEmail: string | null
  guestName: string | null
  guestEmail: string | null
}

export interface ExportPage {
  rows: ReportExportRow[]
  truncated: boolean
}

interface CountColumns {
  pending: number
  confirmed: number
  rejected: number
  cancelled: number
}

interface ServiceCountRow extends CountColumns {
  service_id: string
  service_name_snapshot: string
  total: number
}

interface StaffCountRow extends CountColumns {
  staff_id: string
  staff_name: string
  total: number
}

interface ExportRow {
  public_reference: string
  start_at: number
  end_at: number
  duration_minutes_snapshot: number
  service_name_snapshot: string
  staff_name: string
  status: AppointmentStatus
  created_at: number
  customer_user_id: string | null
  customer_name: string | null
  customer_email: string | null
  guest_name: string | null
  guest_email: string | null
}

const COUNT_COLUMNS = `
  COUNT(CASE WHEN a.status = 'pending' THEN 1 END) AS pending,
  COUNT(CASE WHEN a.status = 'confirmed' THEN 1 END) AS confirmed,
  COUNT(CASE WHEN a.status = 'rejected' THEN 1 END) AS rejected,
  COUNT(CASE WHEN a.status = 'cancelled' THEN 1 END) AS cancelled
`

function countsFrom(row: CountColumns): StatusCounts {
  return {
    pending: row.pending,
    confirmed: row.confirmed,
    rejected: row.rejected,
    cancelled: row.cancelled,
  }
}

export function emptyStatusCounts(): StatusCounts {
  return { pending: 0, confirmed: 0, rejected: 0, cancelled: 0 }
}

function buildWhere(filters: ReportFilters): {
  where: string
  params: unknown[]
} {
  const clauses: string[] = []
  const params: unknown[] = []

  if (filters.status !== undefined) {
    clauses.push('a.status = ?')
    params.push(filters.status)
  }
  if (filters.serviceId !== undefined) {
    clauses.push('a.service_id = ?')
    params.push(filters.serviceId)
  }
  if (filters.staffId !== undefined) {
    clauses.push('a.assigned_staff_user_id = ?')
    params.push(filters.staffId)
  }
  if (filters.startFrom !== undefined) {
    clauses.push('a.start_at >= ?')
    params.push(filters.startFrom)
  }
  if (filters.startBefore !== undefined) {
    clauses.push('a.start_at < ?')
    params.push(filters.startBefore)
  }

  return {
    where: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  }
}

/** Read-only aggregates behind the Admin dashboard and reports. */
export class ReportsRepository {
  constructor(private readonly db: D1Database) {}

  async counts(filters: ReportFilters = {}): Promise<StatusCounts> {
    const { where, params } = buildWhere(filters)
    const row = await this.db
      .prepare(
        `SELECT ${COUNT_COLUMNS}
           FROM appointments a
           ${where}`,
      )
      .bind(...params)
      .first<CountColumns>()

    return row ? countsFrom(row) : emptyStatusCounts()
  }

  async upcomingCounts(
    now: number,
  ): Promise<{ pending: number; confirmed: number }> {
    const row = await this.db
      .prepare(
        `SELECT
           COUNT(CASE WHEN a.status = 'pending' THEN 1 END) AS pending,
           COUNT(CASE WHEN a.status = 'confirmed' THEN 1 END) AS confirmed
         FROM appointments a
        WHERE a.status IN ('pending', 'confirmed')
          AND a.end_at > ?`,
      )
      .bind(now)
      .first<{ pending: number; confirmed: number }>()

    return { pending: row?.pending ?? 0, confirmed: row?.confirmed ?? 0 }
  }

  async staffWorkload(now: number): Promise<StaffWorkload[]> {
    const { results } = await this.db
      .prepare(
        `SELECT s.id AS id,
                s.name AS name,
                COUNT(CASE WHEN a.status = 'pending' THEN 1 END) AS pending,
                COUNT(
                  CASE WHEN a.status = 'confirmed' AND a.end_at > ? THEN 1 END
                ) AS confirmed_upcoming
           FROM users s
           JOIN staff_profiles p ON p.user_id = s.id
           LEFT JOIN appointments a ON a.assigned_staff_user_id = s.id
          WHERE s.role = 'staff'
            AND s.is_active = 1
          GROUP BY s.id, s.name
          ORDER BY lower(s.name) ASC, s.id ASC`,
      )
      .bind(now)
      .all<{
        id: string
        name: string
        pending: number
        confirmed_upcoming: number
      }>()

    return results.map((row) => ({
      id: row.id,
      name: row.name,
      pending: row.pending,
      confirmedUpcoming: row.confirmed_upcoming,
    }))
  }

  async summarizeByService(filters: ReportFilters = {}): Promise<ServiceCount[]> {
    const { where, params } = buildWhere(filters)
    const { results } = await this.db
      .prepare(
        `SELECT a.service_id AS service_id,
                a.service_name_snapshot AS service_name_snapshot,
                ${COUNT_COLUMNS},
                COUNT(*) AS total
           FROM appointments a
           ${where}
          GROUP BY a.service_id, a.service_name_snapshot
          ORDER BY lower(a.service_name_snapshot) ASC, a.service_id ASC`,
      )
      .bind(...params)
      .all<ServiceCountRow>()

    return results.map((row) => ({
      serviceId: row.service_id,
      serviceName: row.service_name_snapshot,
      total: row.total,
      counts: countsFrom(row),
    }))
  }

  async summarizeByStaff(filters: ReportFilters = {}): Promise<StaffCount[]> {
    const { where, params } = buildWhere(filters)
    const { results } = await this.db
      .prepare(
        `SELECT s.id AS staff_id,
                s.name AS staff_name,
                ${COUNT_COLUMNS},
                COUNT(*) AS total
           FROM appointments a
           JOIN users s ON s.id = a.assigned_staff_user_id
           ${where}
          GROUP BY s.id, s.name
          ORDER BY lower(s.name) ASC, s.id ASC`,
      )
      .bind(...params)
      .all<StaffCountRow>()

    return results.map((row) => ({
      staffId: row.staff_id,
      name: row.staff_name,
      total: row.total,
      counts: countsFrom(row),
    }))
  }

  /** Fetches one extra row so the caller can report a truncated export. */
  async listForExport(
    filters: ReportFilters,
    limit: number,
  ): Promise<ExportPage> {
    const { where, params } = buildWhere(filters)
    params.push(limit + 1)

    const { results } = await this.db
      .prepare(
        `SELECT a.public_reference AS public_reference,
                a.start_at AS start_at,
                a.end_at AS end_at,
                a.duration_minutes_snapshot AS duration_minutes_snapshot,
                a.service_name_snapshot AS service_name_snapshot,
                a.status AS status,
                a.created_at AS created_at,
                a.customer_user_id AS customer_user_id,
                a.guest_name AS guest_name,
                a.guest_email AS guest_email,
                s.name AS staff_name,
                c.name AS customer_name,
                c.email AS customer_email
           FROM appointments a
           JOIN users s ON s.id = a.assigned_staff_user_id
           LEFT JOIN users c ON c.id = a.customer_user_id
           ${where}
          ORDER BY a.start_at ASC, a.id ASC
          LIMIT ?`,
      )
      .bind(...params)
      .all<ExportRow>()

    return {
      rows: results.slice(0, limit).map((row) => ({
        publicReference: row.public_reference,
        startAt: row.start_at,
        endAt: row.end_at,
        durationMinutes: row.duration_minutes_snapshot,
        serviceName: row.service_name_snapshot,
        staffName: row.staff_name,
        status: row.status,
        createdAt: row.created_at,
        isCustomerBooking: row.customer_user_id !== null,
        customerName: row.customer_name,
        customerEmail: row.customer_email,
        guestName: row.guest_name,
        guestEmail: row.guest_email,
      })),
      truncated: results.length > limit,
    }
  }
}
