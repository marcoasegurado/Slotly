import { ApiError } from '../http/errors'
import type { AvailabilityInterval } from './availability'

const MAX_WORKING_INTERVALS = 50

function invalid(message: string): never {
  throw new ApiError(422, 'VALIDATION_ERROR', message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredMinute(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    invalid(label)
  }
  return value as number
}

/**
 * Validates a full weekly schedule. Intervals are sorted and may not overlap on
 * the same weekday. Adjacent intervals (one ending when the next starts) are
 * allowed.
 */
export function parseWorkingHours(value: unknown): AvailabilityInterval[] {
  if (!Array.isArray(value) || value.length > MAX_WORKING_INTERVALS) {
    invalid('Enter a valid weekly schedule.')
  }

  const intervals = value.map((entry) => {
    if (!isRecord(entry)) invalid('Enter a valid weekly schedule.')

    return {
      weekday: requiredMinute(
        entry.weekday,
        'Choose a weekday between Sunday and Saturday.',
        0,
        6,
      ),
      startMinute: requiredMinute(
        entry.startMinute,
        'Enter a valid working-hours start time.',
        0,
        1440,
      ),
      endMinute: requiredMinute(
        entry.endMinute,
        'Enter a valid working-hours end time.',
        0,
        1440,
      ),
    }
  })

  for (const interval of intervals) {
    if (interval.startMinute >= interval.endMinute) {
      invalid('A working interval must end after it starts.')
    }
  }

  intervals.sort(
    (a, b) =>
      a.weekday - b.weekday ||
      a.startMinute - b.startMinute ||
      a.endMinute - b.endMinute,
  )

  for (let index = 1; index < intervals.length; index += 1) {
    const previous = intervals[index - 1]
    const current = intervals[index]
    if (
      previous.weekday === current.weekday &&
      current.startMinute < previous.endMinute
    ) {
      invalid('Working intervals cannot overlap on the same day.')
    }
  }

  return intervals
}
