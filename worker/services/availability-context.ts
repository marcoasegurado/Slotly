import {
  dateKeyUnixRange,
  weekdayOfDateKey,
} from '../lib/time'
import { SchedulesRepository } from '../repositories/schedules'
import type { AvailabilityContext } from './availability'

/**
 * Loads one business-local day of staff hours, time off and confirmed
 * appointments. Pending/rejected/cancelled appointments are intentionally
 * excluded by the repository query.
 */
export async function loadAvailabilityContext(
  db: D1Database,
  input: {
    timezone: string
    maxAdvanceBookingDays: number
    dateKey: string
  },
): Promise<AvailabilityContext> {
  const range = dateKeyUnixRange(input.dateKey, input.timezone)
  const weekday = weekdayOfDateKey(input.dateKey)
  const day = await new SchedulesRepository(db).loadAvailabilityDay(
    weekday,
    range.start,
    range.end,
  )

  return {
    timezone: input.timezone,
    maxAdvanceBookingDays: input.maxAdvanceBookingDays,
    staff: day.staff,
    confirmedAppointments: day.confirmedAppointments,
  }
}
