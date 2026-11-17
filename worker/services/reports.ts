import { ApiError } from '../http/errors'
import { toCsv } from '../lib/csv'
import {
  dateKeyUnixRange,
  isValidDateKey,
  pad2,
  toDateKey,
  todayDateKey,
  unixSeconds,
  zonedParts,
} from '../lib/time'
import { ReportsRepository } from '../repositories/reports'
import type {
  AdminDashboard,
  AppointmentStatus,
  ReportSummary,
  StatusCounts,
} from '../types'
import { requireBusinessSettings } from './business'

/** Hard cap for one export; the response reports whether rows were cut off. */
export const MAX_REPORT_ROWS = 5000

export interface ReportFilters {
  /** Business-local date key, inclusive. */
  from?: string
  /** Business-local date key, inclusive. */
  to?: string
  serviceId?: string
  staffId?: string
  status?: AppointmentStatus
}

export interface ReportCsv {
  filename: string
  content: string
  rowCount: number
  truncated: boolean
}

function validateDateKey(value: string | undefined, label: string): string | undefined {
  if (value === undefined) return undefined
  if (!isValidDateKey(value)) {
    throw new ApiError(422, 'VALIDATION_ERROR', `Choose a valid ${label}.`)
  }
  return value
}

function resolveRange(
  filters: ReportFilters,
  timezone: string,
): { startFrom?: number; startBefore?: number } {
  const from = validateDateKey(filters.from, 'start date')
  const to = validateDateKey(filters.to, 'end date')
  if (from !== undefined && to !== undefined && from > to) {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'Choose a start date on or before the end date.',
    )
  }

  return {
    startFrom:
      from === undefined ? undefined : dateKeyUnixRange(from, timezone).start,
    startBefore:
      to === undefined ? undefined : dateKeyUnixRange(to, timezone).end,
  }
}

function localDate(instant: number, timezone: string): string {
  return toDateKey(new Date(instant * 1000), timezone)
}

function localTime(instant: number, timezone: string): string {
  const parts = zonedParts(new Date(instant * 1000), timezone)
  return `${pad2(parts.hour)}:${pad2(parts.minute)}`
}

function localDateTime(instant: number, timezone: string): string {
  return `${localDate(instant, timezone)} ${localTime(instant, timezone)}`
}

function addCounts(target: StatusCounts, source: StatusCounts): void {
  target.pending += source.pending
  target.confirmed += source.confirmed
  target.rejected += source.rejected
  target.cancelled += source.cancelled
}

/** Business-wide operational summary for the Admin dashboard. */
export async function getAdminDashboard(
  db: D1Database,
  now: Date = new Date(),
): Promise<AdminDashboard> {
  const business = await requireBusinessSettings(db)
  const repository = new ReportsRepository(db)
  const asOf = unixSeconds(now.getTime())
  const dateKey = todayDateKey(business.timezone, now)
  const todayRange = dateKeyUnixRange(dateKey, business.timezone)

  const [totals, today, upcoming, staff] = await Promise.all([
    repository.counts(),
    repository.counts({
      startFrom: todayRange.start,
      startBefore: todayRange.end,
    }),
    repository.upcomingCounts(asOf),
    repository.staffWorkload(asOf),
  ])

  return {
    asOf,
    dateKey,
    timezone: business.timezone,
    totals,
    today,
    upcoming,
    staff,
  }
}

/** Aggregated report data for the active filters. */
export async function getReportSummary(
  db: D1Database,
  filters: ReportFilters,
): Promise<ReportSummary> {
  const business = await requireBusinessSettings(db)
  const range = resolveRange(filters, business.timezone)
  const repository = new ReportsRepository(db)
  const query = {
    ...range,
    serviceId: filters.serviceId,
    staffId: filters.staffId,
    status: filters.status,
  }

  const [byService, byStaff] = await Promise.all([
    repository.summarizeByService(query),
    repository.summarizeByStaff(query),
  ])

  const totals: StatusCounts = {
    pending: 0,
    confirmed: 0,
    rejected: 0,
    cancelled: 0,
  }
  let appointments = 0
  for (const service of byService) {
    addCounts(totals, service.counts)
    appointments += service.total
  }

  return {
    range: {
      from: filters.from ?? null,
      to: filters.to ?? null,
      timezone: business.timezone,
    },
    filters: {
      serviceId: filters.serviceId ?? null,
      staffId: filters.staffId ?? null,
      status: filters.status ?? null,
    },
    totals: { appointments, ...totals },
    byService,
    byStaff,
  }
}

/**
 * Filtered appointment CSV. Summary counts always use SQL aggregates; this
 * export materializes at most {@link MAX_REPORT_ROWS} rows and flags
 * truncation instead of silently dropping data.
 */
export async function buildAppointmentCsv(
  db: D1Database,
  filters: ReportFilters,
  now: Date = new Date(),
): Promise<ReportCsv> {
  const business = await requireBusinessSettings(db)
  const range = resolveRange(filters, business.timezone)
  const page = await new ReportsRepository(db).listForExport(
    {
      ...range,
      serviceId: filters.serviceId,
      staffId: filters.staffId,
      status: filters.status,
    },
    MAX_REPORT_ROWS,
  )

  const rows: string[][] = [
    [
      'Reference',
      'Date',
      'Start',
      'End',
      'Duration minutes',
      'Service',
      'Staff',
      'Status',
      'Booking type',
      'Customer name',
      'Customer email',
      'Created',
    ],
    ...page.rows.map((row) => [
      row.publicReference,
      localDate(row.startAt, business.timezone),
      localTime(row.startAt, business.timezone),
      localTime(row.endAt, business.timezone),
      String(row.durationMinutes),
      row.serviceName,
      row.staffName,
      row.status,
      row.isCustomerBooking ? 'customer' : 'guest',
      row.customerName ?? row.guestName ?? '',
      row.customerEmail ?? row.guestEmail ?? '',
      localDateTime(row.createdAt, business.timezone),
    ]),
  ]

  return {
    filename: `slotly-appointments-${todayDateKey(business.timezone, now)}.csv`,
    content: toCsv(rows),
    rowCount: page.rows.length,
    truncated: page.truncated,
  }
}
