import { isValidDateKey } from '../lib/time'
import type { ReportFilters } from '../services/reports'
import { parseAppointmentStatus, parseQueryId } from './appointment-query'
import { ApiError } from './errors'

function parseDateKey(
  value: string | undefined,
  label: string,
): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  if (!isValidDateKey(trimmed)) {
    throw new ApiError(422, 'VALIDATION_ERROR', `Choose a valid ${label}.`)
  }
  return trimmed
}

/**
 * Shared query parser for the Admin report summary and CSV export. `from` and
 * `to` are inclusive business-local date keys.
 */
export function parseReportFilters(
  query: (name: string) => string | undefined,
): ReportFilters {
  const from = parseDateKey(query('from'), 'start date')
  const to = parseDateKey(query('to'), 'end date')

  if (from !== undefined && to !== undefined && from > to) {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'Choose a start date on or before the end date.',
    )
  }

  return {
    from,
    to,
    serviceId: parseQueryId(query('serviceId'), 'service'),
    staffId: parseQueryId(query('staffId'), 'staff member'),
    status: parseAppointmentStatus(query('status')),
  }
}
