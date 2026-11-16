import { ApiError } from './errors'
import { optionalString } from './validation'
import type { AppointmentStatus } from '../types'
import type { StaffAppointmentScope } from '../services/appointment-management'

const STATUSES: AppointmentStatus[] = [
  'pending',
  'confirmed',
  'rejected',
  'cancelled',
]

export const MAX_APPOINTMENT_LIMIT = 200
export const MAX_SEARCH_LENGTH = 100
export const MAX_REASON_LENGTH = 300

/** Omitted, empty or `all` means no status filter. */
export function parseAppointmentStatus(
  value: string | undefined,
): AppointmentStatus | undefined {
  const trimmed = value?.trim()
  if (!trimmed || trimmed === 'all') return undefined
  if (!STATUSES.includes(trimmed as AppointmentStatus)) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Choose a valid status.')
  }
  return trimmed as AppointmentStatus
}

export function parseStaffScope(
  value: string | undefined,
): StaffAppointmentScope {
  const trimmed = value?.trim()
  if (!trimmed || trimmed === 'all') return 'all'
  if (trimmed === 'today' || trimmed === 'upcoming') return trimmed
  throw new ApiError(422, 'VALIDATION_ERROR', 'Choose a valid appointment scope.')
}

export function parseAppointmentLimit(
  value: string | undefined,
): number | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  if (!/^\d+$/.test(trimmed)) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Choose a valid result limit.')
  }

  const limit = Number(trimmed)
  if (limit < 1 || limit > MAX_APPOINTMENT_LIMIT) {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      `Choose a result limit between 1 and ${MAX_APPOINTMENT_LIMIT}.`,
    )
  }
  return limit
}

export function parseSearchQuery(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  if (trimmed.length > MAX_SEARCH_LENGTH) {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      `Keep the search under ${MAX_SEARCH_LENGTH} characters.`,
    )
  }
  return trimmed
}

export function parseQueryId(
  value: string | undefined,
  label: string,
): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  if (trimmed.length > MAX_SEARCH_LENGTH) {
    throw new ApiError(422, 'VALIDATION_ERROR', `Choose a valid ${label}.`)
  }
  return trimmed
}

/** Optional `{ reason }` body used by reject/cancel actions. */
export function parseReason(
  body: Record<string, unknown>,
): string | undefined {
  const reason = optionalString(
    body,
    'reason',
    'reason',
    0,
    MAX_REASON_LENGTH,
  )
  return reason?.trim() || undefined
}
