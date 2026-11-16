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
  TimeOff,
  WorkingInterval,
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

export function fitsIntervals(
  intervals: WorkingInterval[],
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

function worksAt(staff: StaffMember, weekday: number, startMinute: number, endMinute: number) {
  return fitsIntervals(staff.intervals, weekday, startMinute, endMinute)
}

export function overlapsTimeOff(timeOff: TimeOff[], start: number, end: number): boolean {
  return timeOff.some((entry) =>
    overlaps(start, end, Date.parse(entry.startAt), Date.parse(entry.endAt)),
  )
}

function hasTimeOff(
  staff: StaffMember,
  start: number,
  end: number,
): boolean {
  return overlapsTimeOff(staff.timeOff, start, end)
}

function hasConfirmedConflict(
  appointments: Appointment[],
  staffId: string,
  start: number,
  end: number,
  excludeAppointmentId?: string,
): boolean {
  return appointments.some(
    (appointment) =>
      appointment.id !== excludeAppointmentId &&
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

/**
 * Validates a slot for one specific staff member without ever selecting a
 * different person. Used by staff approval and rescheduling.
 */
export function validateStaffSlotForDuration(
  context: AvailabilityContext,
  staff: StaffMember,
  startAtIso: string,
  durationMinutes: number,
  now: Date = new Date(),
  excludeAppointmentId?: string,
): Slot | null {
  if (!staff.isActive) return null

  const { business } = context
  const parsed = Date.parse(startAtIso)
  if (!Number.isFinite(parsed)) return null

  const dateKey = todayDateKeyOfIso(startAtIso, business.timezone)
  const startMinute = minutesOfDay(new Date(parsed), business.timezone)
  const endMinute = startMinute + durationMinutes
  if (endMinute > 1440) return null

  const weekday = weekdayOfDateKey(dateKey)
  if (!worksAt(staff, weekday, startMinute, endMinute)) return null

  const start = zonedTimeToUtc(dateKey, startMinute, business.timezone)
  const end = zonedTimeToUtc(dateKey, endMinute, business.timezone)

  if (start.getTime() <= now.getTime()) return null
  if (hasTimeOff(staff, start.getTime(), end.getTime())) return null
  if (
    hasConfirmedConflict(
      context.appointments,
      staff.id,
      start.getTime(),
      end.getTime(),
      excludeAppointmentId,
    )
  ) {
    return null
  }

  return { startAt: start.toISOString(), endAt: end.toISOString(), staffId: staff.id }
}

/** Availability for one staff member, used by the staff reschedule screen. */
export function getStaffDayAvailability(
  context: AvailabilityContext,
  staff: StaffMember,
  durationMinutes: number,
  dateKey: string,
  now: Date = new Date(),
  excludeAppointmentId?: string,
): DayAvailability {
  const { business } = context

  if (!staff.isActive) return { dateKey, state: 'closed', slots: [] }

  const today = todayDateKey(business.timezone, now)
  const offset = daysBetweenDateKeys(today, dateKey)
  if (offset < 0) return { dateKey, state: 'past', slots: [] }
  if (offset > business.maxAdvanceBookingDays) {
    return { dateKey, state: 'outside-booking-window', slots: [] }
  }

  const weekday = weekdayOfDateKey(dateKey)
  if (!staff.intervals.some((interval) => interval.weekday === weekday)) {
    return { dateKey, state: 'closed', slots: [] }
  }

  const slots: Slot[] = []
  const nowMs = now.getTime()

  for (
    let startMinute = 0;
    startMinute + durationMinutes <= 1440;
    startMinute += SLOT_STEP_MINUTES
  ) {
    const endMinute = startMinute + durationMinutes
    if (!worksAt(staff, weekday, startMinute, endMinute)) continue

    const start = zonedTimeToUtc(dateKey, startMinute, business.timezone)
    const end = zonedTimeToUtc(dateKey, endMinute, business.timezone)

    if (start.getTime() <= nowMs) continue
    if (hasTimeOff(staff, start.getTime(), end.getTime())) continue
    if (
      hasConfirmedConflict(
        context.appointments,
        staff.id,
        start.getTime(),
        end.getTime(),
        excludeAppointmentId,
      )
    ) {
      continue
    }

    slots.push({
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      staffId: staff.id,
    })
  }

  return {
    dateKey,
    state: slots.length > 0 ? 'open' : 'full',
    slots,
  }
}

export function findNextStaffAvailableDates(
  context: AvailabilityContext,
  staff: StaffMember,
  durationMinutes: number,
  fromDateKey: string,
  count: number,
  now: Date = new Date(),
  excludeAppointmentId?: string,
): string[] {
  const results: string[] = []
  for (
    let offset = 0;
    offset <= context.business.maxAdvanceBookingDays && results.length < count;
    offset += 1
  ) {
    const dateKey = addDaysToDateKey(fromDateKey, offset)
    const availability = getStaffDayAvailability(
      context,
      staff,
      durationMinutes,
      dateKey,
      now,
      excludeAppointmentId,
    )
    if (availability.state === 'open') results.push(dateKey)
  }
  return results
}

export interface ScheduleProposal {
  intervals?: WorkingInterval[]
  timeOff?: TimeOff[]
}

/**
 * Finds future pending/confirmed appointments that a proposed schedule or
 * time-off change would invalidate. The caller must not apply the change while
 * this returns rows.
 */
export function findScheduleConflicts(
  context: AvailabilityContext,
  staff: StaffMember,
  proposal: ScheduleProposal,
  now: Date = new Date(),
): Appointment[] {
  const intervals = proposal.intervals ?? staff.intervals
  const timeOff = proposal.timeOff ?? staff.timeOff
  const { business, appointments } = context
  const nowMs = now.getTime()

  return appointments
    .filter(
      (appointment) =>
        appointment.assignedStaffUserId === staff.id &&
        (appointment.status === 'pending' || appointment.status === 'confirmed') &&
        Date.parse(appointment.startAt) > nowMs,
    )
    .filter((appointment) => {
      const dateKey = todayDateKeyOfIso(appointment.startAt, business.timezone)
      const startMinute = minutesOfDay(new Date(appointment.startAt), business.timezone)
      const endMinute = startMinute + appointment.durationMinutesSnapshot
      const weekday = weekdayOfDateKey(dateKey)

      if (endMinute > 1440) return true
      if (!fitsIntervals(intervals, weekday, startMinute, endMinute)) return true
      if (
        overlapsTimeOff(
          timeOff,
          Date.parse(appointment.startAt),
          Date.parse(appointment.endAt),
        )
      ) {
        return true
      }
      return false
    })
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))
}
