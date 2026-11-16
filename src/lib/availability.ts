import {
  addDaysToDateKey,
  daysBetweenDateKeys,
  minutesOfDay,
  todayDateKey,
  weekdayOfDateKey,
  zonedTimeToUtc,
} from './time'
import type {
  Appointment,
  Business,
  DayAvailability,
  Service,
  Slot,
  StaffMember,
} from '../mock/types'

export const SLOT_STEP_MINUTES = 15

export interface Interval {
  start: number
  end: number
}

export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  // Half-open intervals: a booking ending exactly when the next begins is fine.
  return aStart < bEnd && aEnd > bStart
}

function worksAt(staff: StaffMember, weekday: number, startMinute: number, endMinute: number) {
  return staff.intervals.some(
    (interval) =>
      interval.weekday === weekday &&
      interval.startMinute <= startMinute &&
      interval.endMinute >= endMinute,
  )
}

function hasTimeOff(
  staff: StaffMember,
  start: number,
  end: number,
): boolean {
  return staff.timeOff.some((timeOff) =>
    overlaps(start, end, Date.parse(timeOff.startAt), Date.parse(timeOff.endAt)),
  )
}

function hasConfirmedConflict(
  appointments: Appointment[],
  staffId: string,
  start: number,
  end: number,
): boolean {
  return appointments.some(
    (appointment) =>
      appointment.assignedStaffUserId === staffId &&
      appointment.status === 'confirmed' &&
      overlaps(start, end, Date.parse(appointment.startAt), Date.parse(appointment.endAt)),
  )
}

export interface AvailabilityContext {
  business: Business
  staff: StaffMember[]
  appointments: Appointment[]
}

/** Picks the least-loaded eligible staff member, breaking ties by id. */
function chooseStaff(
  candidateIds: string[],
  appointments: Appointment[],
  dateKey: string,
  business: Business,
): string | null {
  if (candidateIds.length === 0) return null
  if (candidateIds.length === 1) return candidateIds[0]

  const loadFor = (staffId: string) =>
    appointments.filter(
      (appointment) =>
        appointment.assignedStaffUserId === staffId &&
        appointment.status !== 'cancelled' &&
        appointment.status !== 'rejected' &&
        todayDateKeyOfIso(appointment.startAt, business.timezone) === dateKey,
    ).length

  return candidateIds
    .slice()
    .sort((a, b) => loadFor(a) - loadFor(b) || a.localeCompare(b))[0]
}

function todayDateKeyOfIso(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso))
}

/**
 * Computes bookable start times for one service on one business-local date.
 *
 * Rules (docs/DATABASE.md §2, docs/UI_DESIGN.md §5):
 * - the whole service duration must fit inside a single working interval
 * - time off blocks the staff member entirely
 * - only `confirmed` appointments block; pending requests never reserve a slot
 * - the start time must be strictly in the future
 */
export function getDayAvailability(
  context: AvailabilityContext,
  service: Service,
  dateKey: string,
  now: Date = new Date(),
): DayAvailability {
  const { business, staff, appointments } = context
  const activeStaff = staff.filter((member) => member.isActive)
  const weekday = weekdayOfDateKey(dateKey)
  const today = todayDateKey(business.timezone, now)

  const offset = daysBetweenDateKeys(today, dateKey)
  if (offset < 0) {
    return { dateKey, state: 'past', slots: [] }
  }
  if (offset > business.maxAdvanceBookingDays) {
    return { dateKey, state: 'outside-booking-window', slots: [] }
  }

  const scheduledStaff = activeStaff.filter((member) =>
    member.intervals.some((interval) => interval.weekday === weekday),
  )
  if (scheduledStaff.length === 0) {
    return { dateKey, state: 'closed', slots: [] }
  }

  const duration = service.durationMinutes
  const slots: Slot[] = []
  const nowMs = now.getTime()

  for (let startMinute = 0; startMinute + duration <= 1440; startMinute += SLOT_STEP_MINUTES) {
    const endMinute = startMinute + duration

    const eligible = scheduledStaff.filter((member) => {
      if (!worksAt(member, weekday, startMinute, endMinute)) return false

      const start = zonedTimeToUtc(dateKey, startMinute, business.timezone)
      const end = zonedTimeToUtc(dateKey, endMinute, business.timezone)

      if (start.getTime() <= nowMs) return false
      if (hasTimeOff(member, start.getTime(), end.getTime())) return false
      if (hasConfirmedConflict(appointments, member.id, start.getTime(), end.getTime())) {
        return false
      }
      return true
    })

    if (eligible.length === 0) continue

    const staffId = chooseStaff(
      eligible.map((member) => member.id),
      appointments,
      dateKey,
      business,
    )
    if (!staffId) continue

    const start = zonedTimeToUtc(dateKey, startMinute, business.timezone)
    const end = zonedTimeToUtc(dateKey, endMinute, business.timezone)

    slots.push({
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      staffId,
    })
  }

  return {
    dateKey,
    state: slots.length > 0 ? 'open' : 'full',
    slots,
  }
}

/** First few dates with availability, used by the "no availability" state. */
export function findNextAvailableDates(
  context: AvailabilityContext,
  service: Service,
  fromDateKey: string,
  count: number,
  now: Date = new Date(),
): string[] {
  const results: string[] = []
  for (let offset = 0; offset <= context.business.maxAdvanceBookingDays && results.length < count; offset += 1) {
    const dateKey = addDaysToDateKey(fromDateKey, offset)
    const availability = getDayAvailability(context, service, dateKey, now)
    if (availability.state === 'open') {
      results.push(dateKey)
    }
  }
  return results
}

/**
 * Re-validates an exact interval at booking time. Used by the mock API the
 * same way the Worker will re-check on POST /api/public/bookings.
 */
export function validateSlot(
  context: AvailabilityContext,
  service: Service,
  startAtIso: string,
  now: Date = new Date(),
): Slot | null {
  const { business } = context
  const dateKey = todayDateKeyOfIso(startAtIso, business.timezone)
  const startMinute = minutesOfDay(new Date(startAtIso), business.timezone)
  const endMinute = startMinute + service.durationMinutes
  const weekday = weekdayOfDateKey(dateKey)
  const nowMs = now.getTime()

  const candidate = context.staff
    .filter((member) => member.isActive)
    .filter((member) => {
      if (!worksAt(member, weekday, startMinute, endMinute)) return false
      const start = zonedTimeToUtc(dateKey, startMinute, business.timezone)
      const end = zonedTimeToUtc(dateKey, endMinute, business.timezone)
      if (start.getTime() <= nowMs) return false
      if (hasTimeOff(member, start.getTime(), end.getTime())) return false
      return !hasConfirmedConflict(
        context.appointments,
        member.id,
        start.getTime(),
        end.getTime(),
      )
    })

  if (candidate.length === 0) return null

  const start = zonedTimeToUtc(dateKey, startMinute, business.timezone)
  const end = zonedTimeToUtc(dateKey, endMinute, business.timezone)

  const staffId = chooseStaff(
    candidate.map((member) => member.id),
    context.appointments,
    dateKey,
    business,
  )

  if (!staffId) return null

  return { startAt: start.toISOString(), endAt: end.toISOString(), staffId }
}
