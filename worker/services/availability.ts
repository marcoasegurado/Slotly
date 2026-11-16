import {
  addDaysToDateKey,
  daysBetweenDateKeys,
  minutesOfDay,
  toDateKey,
  todayDateKey,
  weekdayOfDateKey,
  zonedTimeToUtc,
} from '../lib/time'
import type { AvailabilityState } from '../types'

export const SLOT_STEP_MINUTES = 15

export interface AvailabilityInterval {
  weekday: number
  startMinute: number
  endMinute: number
}

export interface AvailabilityStaff {
  id: string
  workingHours: AvailabilityInterval[]
  timeOff: Array<{ startAt: number; endAt: number }>
}

export interface ConfirmedAppointment {
  staffUserId: string
  /** Unix seconds. */
  startAt: number
  /** Unix seconds. */
  endAt: number
}

export interface AvailabilityContext {
  timezone: string
  maxAdvanceBookingDays: number
  staff: AvailabilityStaff[]
  /** Only confirmed bookings belong here; pending requests never block a slot. */
  confirmedAppointments: ConfirmedAppointment[]
}

export interface InternalSlot {
  /** Unix seconds. */
  startAt: number
  /** Unix seconds. */
  endAt: number
  staffId: string
}

export interface InternalDayAvailability {
  dateKey: string
  state: AvailabilityState
  slots: InternalSlot[]
}

/** Half-open intervals: a booking ending exactly when the next begins is fine. */
export function overlaps(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && aEnd > bStart
}

export function fitsIntervals(
  intervals: AvailabilityInterval[],
  weekday: number,
  startMinute: number,
  endMinute: number,
): boolean {
  return intervals.some(
    (interval) =>
      interval.weekday === weekday &&
      interval.startMinute <= startMinute &&
      interval.endMinute >= endMinute,
  )
}

function hasTimeOff(
  staff: AvailabilityStaff,
  start: number,
  end: number,
): boolean {
  return staff.timeOff.some((entry) =>
    overlaps(start, end, entry.startAt, entry.endAt),
  )
}

function hasConfirmedConflict(
  context: AvailabilityContext,
  staffId: string,
  start: number,
  end: number,
): boolean {
  return context.confirmedAppointments.some(
    (appointment) =>
      appointment.staffUserId === staffId &&
      overlaps(start, end, appointment.startAt, appointment.endAt),
  )
}

/** Picks the least-loaded eligible staff member, breaking ties by id. */
function chooseStaff(
  candidateIds: string[],
  context: AvailabilityContext,
): string | null {
  if (candidateIds.length === 0) return null
  if (candidateIds.length === 1) return candidateIds[0]

  const loadFor = (staffId: string) =>
    context.confirmedAppointments.filter(
      (appointment) => appointment.staffUserId === staffId,
    ).length

  return candidateIds
    .slice()
    .sort((a, b) => loadFor(a) - loadFor(b) || a.localeCompare(b))[0]
}

/**
 * Computes bookable start times for one service on one business-local date.
 *
 * Rules:
 * - the whole service duration must fit inside one working interval
 * - time off blocks the staff member entirely
 * - only confirmed appointments block; pending requests never reserve a slot
 * - a slot start must be strictly in the future
 * - public callers must strip `staffId` before returning slots
 */
export function getDayAvailability(
  context: AvailabilityContext,
  durationMinutes: number,
  dateKey: string,
  now: Date = new Date(),
): InternalDayAvailability {
  const today = todayDateKey(context.timezone, now)
  const offset = daysBetweenDateKeys(today, dateKey)

  if (offset < 0) {
    return { dateKey, state: 'past', slots: [] }
  }
  if (offset > context.maxAdvanceBookingDays) {
    return { dateKey, state: 'outside-booking-window', slots: [] }
  }

  const weekday = weekdayOfDateKey(dateKey)
  const scheduledStaff = context.staff.filter((member) =>
    member.workingHours.some((interval) => interval.weekday === weekday),
  )
  if (scheduledStaff.length === 0) {
    return { dateKey, state: 'closed', slots: [] }
  }

  const slots: InternalSlot[] = []
  const nowMs = now.getTime()

  for (
    let startMinute = 0;
    startMinute + durationMinutes <= 1440;
    startMinute += SLOT_STEP_MINUTES
  ) {
    const endMinute = startMinute + durationMinutes

    const eligible = scheduledStaff.filter((member) => {
      if (
        !fitsIntervals(member.workingHours, weekday, startMinute, endMinute)
      ) {
        return false
      }

      const start = zonedTimeToUtc(dateKey, startMinute, context.timezone)
      const end = zonedTimeToUtc(dateKey, endMinute, context.timezone)
      const startUnix = Math.floor(start.getTime() / 1000)
      const endUnix = Math.floor(end.getTime() / 1000)

      if (start.getTime() <= nowMs) return false
      if (hasTimeOff(member, startUnix, endUnix)) return false
      if (hasConfirmedConflict(context, member.id, startUnix, endUnix)) {
        return false
      }
      return true
    })

    if (eligible.length === 0) continue

    const staffId = chooseStaff(
      eligible.map((member) => member.id),
      context,
    )
    if (!staffId) continue

    const start = zonedTimeToUtc(dateKey, startMinute, context.timezone)
    const end = zonedTimeToUtc(dateKey, endMinute, context.timezone)
    slots.push({
      startAt: Math.floor(start.getTime() / 1000),
      endAt: Math.floor(end.getTime() / 1000),
      staffId,
    })
  }

  return {
    dateKey,
    state: slots.length > 0 ? 'open' : 'full',
    slots,
  }
}

/**
 * Returns the first dates with at least one available slot within the booking
 * window. Intended for the empty-calendar state in the client.
 */
export function findNextAvailableDates(
  context: AvailabilityContext,
  durationMinutes: number,
  fromDateKey: string,
  count: number,
  now: Date = new Date(),
): string[] {
  const results: string[] = []
  for (
    let offset = 0;
    offset <= context.maxAdvanceBookingDays && results.length < count;
    offset += 1
  ) {
    const dateKey = addDaysToDateKey(fromDateKey, offset)
    if (getDayAvailability(context, durationMinutes, dateKey, now).state === 'open') {
      results.push(dateKey)
    }
  }
  return results
}

export interface StaffSlotValidationInput {
  timezone: string
  maxAdvanceBookingDays: number
  staff: AvailabilityStaff
  /** Must already exclude the appointment being moved, if any. */
  confirmedAppointments: ConfirmedAppointment[]
  durationMinutes: number
  /** Unix seconds. */
  startAt: number
  now: Date
}

/**
 * Validates an exact interval for one specific staff member. Never selects a
 * different person. Used by staff approval/rescheduling and admin reassignment.
 */
export function validateStaffSlot(
  input: StaffSlotValidationInput,
): { startAt: number; endAt: number } | null {
  if (input.durationMinutes <= 0) return null

  const startInstant = new Date(input.startAt * 1000)
  const dateKey = toDateKey(startInstant, input.timezone)
  const today = todayDateKey(input.timezone, input.now)
  const offset = daysBetweenDateKeys(today, dateKey)
  if (offset < 0 || offset > input.maxAdvanceBookingDays) return null

  const startMinute = minutesOfDay(startInstant, input.timezone)
  const endMinute = startMinute + input.durationMinutes
  if (endMinute > 1440) return null

  const weekday = weekdayOfDateKey(dateKey)
  if (!fitsIntervals(input.staff.workingHours, weekday, startMinute, endMinute)) {
    return null
  }

  const start = zonedTimeToUtc(dateKey, startMinute, input.timezone)
  const end = zonedTimeToUtc(dateKey, endMinute, input.timezone)
  const startUnix = Math.floor(start.getTime() / 1000)
  const endUnix = Math.floor(end.getTime() / 1000)

  // Reject times that do not land exactly on a business-local minute boundary.
  if (startUnix !== Math.floor(input.startAt)) return null
  if (startUnix <= Math.floor(input.now.getTime() / 1000)) return null
  if (hasTimeOff(input.staff, startUnix, endUnix)) return null

  const conflict = input.confirmedAppointments.some(
    (appointment) =>
      appointment.staffUserId === input.staff.id &&
      overlaps(startUnix, endUnix, appointment.startAt, appointment.endAt),
  )
  if (conflict) return null

  return { startAt: startUnix, endAt: endUnix }
}

export interface ScheduleConflictInput {
  timezone: string
  staffId: string
  intervals: AvailabilityInterval[]
  timeOff: Array<{ startAt: number; endAt: number }>
  appointments: Array<{
    publicReference: string
    status: 'pending' | 'confirmed'
    staffUserId: string
    startAt: number
    endAt: number
    durationMinutes: number
  }>
  now: Date
}

export interface ScheduleConflict {
  publicReference: string
  status: 'pending' | 'confirmed'
  startAt: number
}

/**
 * Finds future pending/confirmed appointments that a proposed working-hours or
 * time-off change would invalidate. The caller must not apply the change while
 * this returns any rows.
 */
export function findScheduleConflicts(
  input: ScheduleConflictInput,
): ScheduleConflict[] {
  const nowUnix = Math.floor(input.now.getTime() / 1000)

  return input.appointments
    .filter(
      (appointment) =>
        appointment.staffUserId === input.staffId &&
        appointment.startAt > nowUnix,
    )
    .filter((appointment) => {
      const start = new Date(appointment.startAt * 1000)
      if (appointment.durationMinutes <= 0) return true

      const dateKey = toDateKey(start, input.timezone)
      const startMinute = minutesOfDay(start, input.timezone)
      const endMinute = startMinute + appointment.durationMinutes
      const weekday = weekdayOfDateKey(dateKey)

      if (endMinute > 1440) return true
      if (!fitsIntervals(input.intervals, weekday, startMinute, endMinute)) {
        return true
      }
      return input.timeOff.some((entry) =>
        overlaps(
          appointment.startAt,
          appointment.endAt,
          entry.startAt,
          entry.endAt,
        ),
      )
    })
    .sort((a, b) => a.startAt - b.startAt)
    .map((appointment) => ({
      publicReference: appointment.publicReference,
      status: appointment.status,
      startAt: appointment.startAt,
    }))
}
