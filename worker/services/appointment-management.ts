import { ApiError } from '../http/errors'
import {
  dateKeyUnixRange,
  daysBetweenDateKeys,
  isValidDateKey,
  minutesOfDay,
  toDateKey,
  todayDateKey,
  unixSeconds,
  weekdayOfDateKey,
  zonedTimeToUtc,
} from '../lib/time'
import {
  AppointmentsRepository,
  type ManagedAppointmentRecord,
} from '../repositories/appointments'
import { AuditRepository } from '../repositories/audit'
import { SchedulesRepository } from '../repositories/schedules'
import { requireBusinessSettings } from './business'
import { validateStaffSlot } from './availability'
import type {
  AppointmentStatus,
  ManagedAppointment,
  PublicBusiness,
  StaffDashboard,
} from '../types'

export const MAX_RESOLUTION_NOTE = 300

export type StaffAppointmentScope = 'all' | 'today' | 'upcoming'

export interface StaffAppointmentFilters {
  status?: AppointmentStatus
  scope: StaffAppointmentScope
}

export interface AdminAppointmentFilters {
  status?: AppointmentStatus
  staffId?: string
  serviceId?: string
  /** Business-local `YYYY-MM-DD`, filtering by appointment start date. */
  date?: string
  search?: string
  limit?: number
}

export interface ReassignAppointmentInput {
  staffId: string
  /** Optional Unix-second start time; keeps the current time when omitted. */
  startAt?: number
}

interface SlotValidationInput {
  business: PublicBusiness
  staffUserId: string
  /** Unix seconds. */
  startAt: number
  durationMinutes: number
  /** The appointment being changed, excluded from overlap checks. */
  excludeAppointmentId: string
  now: Date
  nowUnix: number
}

type SlotValidation =
  | { ok: true; startAt: number; endAt: number }
  | { ok: false; reason: 'outside-window' | 'invalid-time' | 'schedule' }

function normalizeReference(reference: string): string {
  return reference.trim().toUpperCase()
}

function appointmentNotFound(): ApiError {
  return new ApiError(
    404,
    'APPOINTMENT_NOT_FOUND',
    'That appointment was not found.',
  )
}

function bookingConflict(message: string): ApiError {
  return new ApiError(409, 'BOOKING_CONFLICT', message)
}

function toManagedAppointment(
  record: ManagedAppointmentRecord,
): ManagedAppointment {
  return {
    publicReference: record.publicReference,
    serviceId: record.serviceId,
    serviceName: record.serviceName,
    durationMinutes: record.durationMinutes,
    assignedStaff: record.assignedStaff,
    customer: record.customer,
    guestName: record.guestName,
    guestEmail: record.guestEmail,
    startAt: record.startAt,
    endAt: record.endAt,
    status: record.status,
    customerNote: record.customerNote,
    resolutionNote: record.resolutionNote,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    approvedAt: record.approvedAt,
    cancelledAt: record.cancelledAt,
  }
}

function localSlotParts(
  startAt: number,
  timezone: string,
): { dateKey: string; weekday: number; startMinute: number } {
  const instant = new Date(startAt * 1000)
  const dateKey = toDateKey(instant, timezone)
  return {
    dateKey,
    weekday: weekdayOfDateKey(dateKey),
    startMinute: minutesOfDay(instant, timezone),
  }
}

/** Rejects times with seconds or offsets that do not land on a local minute. */
function isLocalMinuteBoundary(startAt: number, timezone: string): boolean {
  const parts = localSlotParts(startAt, timezone)
  const reconstructed = unixSeconds(
    zonedTimeToUtc(parts.dateKey, parts.startMinute, timezone).getTime(),
  )
  return reconstructed === startAt
}

async function validateSlot(
  db: D1Database,
  input: SlotValidationInput,
): Promise<SlotValidation> {
  if (input.startAt <= input.nowUnix) {
    return { ok: false, reason: 'outside-window' }
  }
  if (!isLocalMinuteBoundary(input.startAt, input.business.timezone)) {
    return { ok: false, reason: 'invalid-time' }
  }

  const parts = localSlotParts(input.startAt, input.business.timezone)
  const offset = daysBetweenDateKeys(
    todayDateKey(input.business.timezone, input.now),
    parts.dateKey,
  )
  if (offset < 0 || offset > input.business.maxAdvanceBookingDays) {
    return { ok: false, reason: 'outside-window' }
  }

  const schedules = new SchedulesRepository(db)
  const schedule = await schedules.getSchedule(input.staffUserId)
  if (!schedule) return { ok: false, reason: 'schedule' }

  const proposedEnd = input.startAt + input.durationMinutes * 60
  // The window is intentionally wider than one appointment so DST transitions
  // and the exact zoned end time cannot hide an overlap from the preflight.
  const confirmed = await schedules.listConfirmedBetween(
    input.staffUserId,
    input.startAt - 7200,
    proposedEnd + 7200,
    input.excludeAppointmentId,
  )

  const slot = validateStaffSlot({
    timezone: input.business.timezone,
    maxAdvanceBookingDays: input.business.maxAdvanceBookingDays,
    staff: {
      id: schedule.staff.id,
      workingHours: schedule.workingHours.map((entry) => ({
        weekday: entry.weekday,
        startMinute: entry.startMinute,
        endMinute: entry.endMinute,
      })),
      timeOff: schedule.timeOff.map((entry) => ({
        startAt: entry.startAt,
        endAt: entry.endAt,
      })),
    },
    confirmedAppointments: confirmed,
    durationMinutes: input.durationMinutes,
    startAt: input.startAt,
    now: input.now,
  })

  if (!slot) return { ok: false, reason: 'schedule' }
  return { ok: true, startAt: slot.startAt, endAt: slot.endAt }
}

function throwSlotError(
  validation: SlotValidation,
  fallbackStaffId?: string,
): asserts validation is { ok: true; startAt: number; endAt: number } {
  if (validation.ok) return

  if (validation.reason === 'outside-window') {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'Choose a future time within the booking window.',
    )
  }
  if (validation.reason === 'invalid-time') {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Choose a valid start time.')
  }

  throw bookingConflict(
    fallbackStaffId
      ? 'That time conflicts with the staff member’s working hours, time off or a confirmed appointment.'
      : 'That time conflicts with your working hours, time off or a confirmed appointment.',
  )
}

function normalizeResolutionNote(
  reason: string | undefined,
  fallback: string,
): string {
  const note = reason?.trim() || fallback
  if (note.length > MAX_RESOLUTION_NOTE) {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      `Keep the reason under ${MAX_RESOLUTION_NOTE} characters.`,
    )
  }
  return note
}

interface TransitionAuditInput {
  appointmentId: string
  entityId: string
  actorUserId: string
  action: string
  metadata: Record<string, unknown>
  now: number
  /** Only transitions that leave `pending` invalidate guest cancellation links. */
  invalidateGuestTokens: boolean
}

/**
 * Token invalidation and the audit row are written only after the conditional
 * state change succeeded. Status alone already disables guest token lookups, so
 * this batch is cleanup and traceability, not the primary guard. Reschedule and
 * reassignment keep the appointment pending, so its guest link stays usable.
 */
async function recordTransition(
  db: D1Database,
  input: TransitionAuditInput,
): Promise<void> {
  const statements: D1PreparedStatement[] = []
  if (input.invalidateGuestTokens) {
    statements.push(
      new AppointmentsRepository(db).invalidateGuestTokensStatement(
        input.appointmentId,
        input.now,
      ),
    )
  }
  statements.push(
    new AuditRepository(db).statement({
      actorUserId: input.actorUserId,
      action: input.action,
      entityType: 'appointment',
      entityId: input.entityId,
      metadata: input.metadata,
      now: input.now,
    }),
  )

  await db.batch(statements)
}

async function reloadForStaff(
  db: D1Database,
  staffUserId: string,
  reference: string,
): Promise<ManagedAppointment> {
  const record = await new AppointmentsRepository(db).findForStaff(
    staffUserId,
    reference,
  )
  if (!record) throw appointmentNotFound()
  return toManagedAppointment(record)
}

async function reloadForAdmin(
  db: D1Database,
  reference: string,
): Promise<ManagedAppointment> {
  const record = await new AppointmentsRepository(db).findByReference(reference)
  if (!record) throw appointmentNotFound()
  return toManagedAppointment(record)
}

export async function getStaffDashboard(
  db: D1Database,
  staffUserId: string,
  now: Date = new Date(),
): Promise<StaffDashboard> {
  const business = await requireBusinessSettings(db)
  const repository = new AppointmentsRepository(db)
  const nowUnix = unixSeconds(now.getTime())
  const today = todayDateKey(business.timezone, now)
  const todayRange = dateKeyUnixRange(today, business.timezone)

  const [pendingRecords, todayRecords, upcomingRecords] = await Promise.all([
    repository.listManaged({
      staffUserId,
      status: 'pending',
      limit: 500,
    }),
    repository.listManaged({
      staffUserId,
      startFrom: todayRange.start,
      startBefore: todayRange.end,
      limit: 500,
    }),
    repository.listManaged({
      staffUserId,
      status: 'confirmed',
      upcomingAt: nowUnix,
      limit: 500,
    }),
  ])

  const todayAppointments = todayRecords.filter(
    (record) => record.status === 'pending' || record.status === 'confirmed',
  )

  return {
    pending: pendingRecords.map(toManagedAppointment),
    today: todayAppointments.map(toManagedAppointment),
    upcoming: upcomingRecords.map(toManagedAppointment),
    counts: {
      pending: pendingRecords.length,
      today: todayAppointments.length,
      confirmedUpcoming: upcomingRecords.length,
    },
  }
}

export async function listStaffAppointments(
  db: D1Database,
  staffUserId: string,
  filters: StaffAppointmentFilters,
  now: Date = new Date(),
): Promise<ManagedAppointment[]> {
  const business = await requireBusinessSettings(db)
  const nowUnix = unixSeconds(now.getTime())

  let startFrom: number | undefined
  let startBefore: number | undefined
  let upcomingAt: number | undefined

  if (filters.scope === 'today') {
    const range = dateKeyUnixRange(
      todayDateKey(business.timezone, now),
      business.timezone,
    )
    startFrom = range.start
    startBefore = range.end
  } else if (filters.scope === 'upcoming') {
    upcomingAt = nowUnix
  }

  const records = await new AppointmentsRepository(db).listManaged({
    staffUserId,
    status: filters.status,
    startFrom,
    startBefore,
    upcomingAt,
    limit: 500,
  })

  return records.map(toManagedAppointment)
}

export async function getStaffAppointment(
  db: D1Database,
  staffUserId: string,
  reference: string,
): Promise<ManagedAppointment> {
  const record = await new AppointmentsRepository(db).findForStaff(
    staffUserId,
    normalizeReference(reference),
  )
  if (!record) throw appointmentNotFound()
  return toManagedAppointment(record)
}

export async function listAdminAppointments(
  db: D1Database,
  filters: AdminAppointmentFilters,
): Promise<ManagedAppointment[]> {
  const business = await requireBusinessSettings(db)

  let startFrom: number | undefined
  let startBefore: number | undefined
  if (filters.date !== undefined) {
    if (!isValidDateKey(filters.date)) {
      throw new ApiError(422, 'VALIDATION_ERROR', 'Choose a valid date.')
    }
    const range = dateKeyUnixRange(filters.date, business.timezone)
    startFrom = range.start
    startBefore = range.end
  }

  const records = await new AppointmentsRepository(db).listManaged({
    staffUserId: filters.staffId,
    serviceId: filters.serviceId,
    status: filters.status,
    startFrom,
    startBefore,
    search: filters.search,
    limit: filters.limit,
  })

  return records.map(toManagedAppointment)
}

export async function getAdminAppointment(
  db: D1Database,
  reference: string,
): Promise<ManagedAppointment> {
  const record = await new AppointmentsRepository(db).findByReference(
    normalizeReference(reference),
  )
  if (!record) throw appointmentNotFound()
  return toManagedAppointment(record)
}

export async function listActiveStaff(
  db: D1Database,
): Promise<Array<{ id: string; name: string; email: string }>> {
  return await new SchedulesRepository(db).listActiveStaff()
}

async function approveRecord(
  db: D1Database,
  business: PublicBusiness,
  record: ManagedAppointmentRecord,
  actorUserId: string,
  now: Date,
): Promise<void> {
  if (record.status !== 'pending') {
    throw bookingConflict('Only a pending request can be approved.')
  }

  const nowUnix = unixSeconds(now.getTime())
  const validation = await validateSlot(db, {
    business,
    staffUserId: record.assignedStaffUserId,
    startAt: record.startAt,
    durationMinutes: record.durationMinutes,
    excludeAppointmentId: record.id,
    now,
    nowUnix,
  })

  if (!validation.ok) {
    throw bookingConflict(
      'This request can no longer be approved. Its start time, the staff schedule or another confirmed booking changed.',
    )
  }

  const parts = localSlotParts(record.startAt, business.timezone)
  const changed = await new AppointmentsRepository(db).approve({
    staffUserId: record.assignedStaffUserId,
    startAt: record.startAt,
    endAt: record.endAt,
    weekday: parts.weekday,
    startMinute: parts.startMinute,
    endMinute: parts.startMinute + record.durationMinutes,
    now: nowUnix,
    excludeAppointmentId: record.id,
    actorUserId,
  })

  if (!changed) {
    throw bookingConflict(
      'This request has already changed. Refresh and try again.',
    )
  }

  await recordTransition(db, {
    appointmentId: record.id,
    entityId: record.publicReference,
    actorUserId,
    action: 'appointment.approved',
    metadata: {
      staffUserId: record.assignedStaffUserId,
      previousStatus: 'pending',
      newStatus: 'confirmed',
      startAt: record.startAt,
    },
    invalidateGuestTokens: true,
    now: nowUnix,
  })
}

export async function approveStaffAppointment(
  db: D1Database,
  staffUserId: string,
  reference: string,
  now: Date = new Date(),
): Promise<ManagedAppointment> {
  const business = await requireBusinessSettings(db)
  const normalized = normalizeReference(reference)
  const record = await new AppointmentsRepository(db).findForStaff(
    staffUserId,
    normalized,
  )
  if (!record) throw appointmentNotFound()

  await approveRecord(db, business, record, staffUserId, now)
  return await reloadForStaff(db, staffUserId, normalized)
}

export async function approveAdminAppointment(
  db: D1Database,
  actorUserId: string,
  reference: string,
  now: Date = new Date(),
): Promise<ManagedAppointment> {
  const business = await requireBusinessSettings(db)
  const normalized = normalizeReference(reference)
  const record = await new AppointmentsRepository(db).findByReference(normalized)
  if (!record) throw appointmentNotFound()

  await approveRecord(db, business, record, actorUserId, now)
  return await reloadForAdmin(db, normalized)
}

async function rejectRecord(
  db: D1Database,
  record: ManagedAppointmentRecord,
  staffUserId: string | undefined,
  reason: string | undefined,
  actorUserId: string,
  now: Date,
): Promise<void> {
  if (record.status !== 'pending') {
    throw bookingConflict('Only a pending request can be declined.')
  }

  const nowUnix = unixSeconds(now.getTime())
  const note = normalizeResolutionNote(reason, 'Declined by the team')
  const changed = await new AppointmentsRepository(db).reject({
    id: record.id,
    staffUserId,
    resolutionNote: note,
    now: nowUnix,
  })

  if (!changed) {
    throw bookingConflict(
      'This request has already changed. Refresh and try again.',
    )
  }

  await recordTransition(db, {
    appointmentId: record.id,
    entityId: record.publicReference,
    actorUserId,
    action: 'appointment.rejected',
    metadata: {
      staffUserId: record.assignedStaffUserId,
      previousStatus: 'pending',
      newStatus: 'rejected',
      resolutionNote: note,
    },
    invalidateGuestTokens: true,
    now: nowUnix,
  })
}

export async function rejectStaffAppointment(
  db: D1Database,
  staffUserId: string,
  reference: string,
  reason: string | undefined,
  now: Date = new Date(),
): Promise<ManagedAppointment> {
  const normalized = normalizeReference(reference)
  const record = await new AppointmentsRepository(db).findForStaff(
    staffUserId,
    normalized,
  )
  if (!record) throw appointmentNotFound()

  await rejectRecord(db, record, staffUserId, reason, staffUserId, now)
  return await reloadForStaff(db, staffUserId, normalized)
}

export async function rejectAdminAppointment(
  db: D1Database,
  actorUserId: string,
  reference: string,
  reason: string | undefined,
  now: Date = new Date(),
): Promise<ManagedAppointment> {
  const normalized = normalizeReference(reference)
  const record = await new AppointmentsRepository(db).findByReference(normalized)
  if (!record) throw appointmentNotFound()

  await rejectRecord(db, record, undefined, reason, actorUserId, now)
  return await reloadForAdmin(db, normalized)
}

async function cancelRecord(
  db: D1Database,
  record: ManagedAppointmentRecord,
  staffUserId: string | undefined,
  allowPending: boolean,
  reason: string | undefined,
  actorUserId: string,
  now: Date,
): Promise<void> {
  const allowed =
    record.status === 'confirmed' ||
    (allowPending && record.status === 'pending')
  if (!allowed) {
    throw bookingConflict(
      allowPending
        ? 'Only a pending or confirmed appointment can be cancelled.'
        : 'Only a confirmed appointment can be cancelled.',
    )
  }

  const nowUnix = unixSeconds(now.getTime())
  const note = normalizeResolutionNote(reason, 'Cancelled by the team')
  const changed = await new AppointmentsRepository(db).cancel({
    id: record.id,
    staffUserId,
    allowPending,
    resolutionNote: note,
    actorUserId,
    now: nowUnix,
  })

  if (!changed) {
    throw bookingConflict(
      'This appointment has already changed. Refresh and try again.',
    )
  }

  await recordTransition(db, {
    appointmentId: record.id,
    entityId: record.publicReference,
    actorUserId,
    action: 'appointment.cancelled',
    metadata: {
      staffUserId: record.assignedStaffUserId,
      previousStatus: record.status,
      newStatus: 'cancelled',
      resolutionNote: note,
    },
    invalidateGuestTokens: true,
    now: nowUnix,
  })
}

export async function cancelStaffAppointment(
  db: D1Database,
  staffUserId: string,
  reference: string,
  reason: string | undefined,
  now: Date = new Date(),
): Promise<ManagedAppointment> {
  const normalized = normalizeReference(reference)
  const record = await new AppointmentsRepository(db).findForStaff(
    staffUserId,
    normalized,
  )
  if (!record) throw appointmentNotFound()

  await cancelRecord(db, record, staffUserId, false, reason, staffUserId, now)
  return await reloadForStaff(db, staffUserId, normalized)
}

export async function cancelAdminAppointment(
  db: D1Database,
  actorUserId: string,
  reference: string,
  reason: string | undefined,
  now: Date = new Date(),
): Promise<ManagedAppointment> {
  const normalized = normalizeReference(reference)
  const record = await new AppointmentsRepository(db).findByReference(normalized)
  if (!record) throw appointmentNotFound()

  await cancelRecord(db, record, undefined, true, reason, actorUserId, now)
  return await reloadForAdmin(db, normalized)
}

async function rescheduleRecord(
  db: D1Database,
  business: PublicBusiness,
  record: ManagedAppointmentRecord,
  startAt: number,
  actorUserId: string,
  now: Date,
): Promise<void> {
  if (record.status !== 'pending' && record.status !== 'confirmed') {
    throw bookingConflict(
      'Only a pending or confirmed appointment can be rescheduled.',
    )
  }

  const nowUnix = unixSeconds(now.getTime())
  const validation = await validateSlot(db, {
    business,
    staffUserId: record.assignedStaffUserId,
    startAt,
    durationMinutes: record.durationMinutes,
    excludeAppointmentId: record.id,
    now,
    nowUnix,
  })
  if (!validation.ok) throwSlotError(validation)

  const parts = localSlotParts(validation.startAt, business.timezone)
  const changed = await new AppointmentsRepository(db).reschedule({
    staffUserId: record.assignedStaffUserId,
    startAt: validation.startAt,
    endAt: validation.endAt,
    currentStartAt: record.startAt,
    currentEndAt: record.endAt,
    weekday: parts.weekday,
    startMinute: parts.startMinute,
    endMinute: parts.startMinute + record.durationMinutes,
    now: nowUnix,
    excludeAppointmentId: record.id,
  })

  if (!changed) {
    throw bookingConflict(
      'This appointment has already changed. Refresh and try again.',
    )
  }

  await recordTransition(db, {
    appointmentId: record.id,
    entityId: record.publicReference,
    actorUserId,
    action: 'appointment.rescheduled',
    metadata: {
      staffUserId: record.assignedStaffUserId,
      previousStartAt: record.startAt,
      previousEndAt: record.endAt,
      newStartAt: validation.startAt,
      newEndAt: validation.endAt,
    },
    invalidateGuestTokens: false,
    now: nowUnix,
  })
}

export async function rescheduleStaffAppointment(
  db: D1Database,
  staffUserId: string,
  reference: string,
  startAt: number,
  now: Date = new Date(),
): Promise<ManagedAppointment> {
  const business = await requireBusinessSettings(db)
  const normalized = normalizeReference(reference)
  const record = await new AppointmentsRepository(db).findForStaff(
    staffUserId,
    normalized,
  )
  if (!record) throw appointmentNotFound()

  await rescheduleRecord(db, business, record, startAt, staffUserId, now)
  return await reloadForStaff(db, staffUserId, normalized)
}

export async function rescheduleAdminAppointment(
  db: D1Database,
  actorUserId: string,
  reference: string,
  startAt: number,
  now: Date = new Date(),
): Promise<ManagedAppointment> {
  const business = await requireBusinessSettings(db)
  const normalized = normalizeReference(reference)
  const record = await new AppointmentsRepository(db).findByReference(normalized)
  if (!record) throw appointmentNotFound()

  await rescheduleRecord(db, business, record, startAt, actorUserId, now)
  return await reloadForAdmin(db, normalized)
}

export async function reassignAdminAppointment(
  db: D1Database,
  actorUserId: string,
  reference: string,
  input: ReassignAppointmentInput,
  now: Date = new Date(),
): Promise<ManagedAppointment> {
  const business = await requireBusinessSettings(db)
  const normalized = normalizeReference(reference)
  const repository = new AppointmentsRepository(db)
  const record = await repository.findByReference(normalized)
  if (!record) throw appointmentNotFound()

  if (record.status !== 'pending' && record.status !== 'confirmed') {
    throw bookingConflict(
      'Only a pending or confirmed appointment can be reassigned.',
    )
  }

  const schedules = new SchedulesRepository(db)
  const target = await schedules.findStaffMember(input.staffId)
  if (!target) {
    throw new ApiError(
      404,
      'STAFF_NOT_FOUND',
      'That staff member was not found or is not active.',
    )
  }
  if (target.id === record.assignedStaffUserId) {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'This appointment is already assigned to that staff member.',
    )
  }

  const startAt = input.startAt ?? record.startAt
  const nowUnix = unixSeconds(now.getTime())
  const validation = await validateSlot(db, {
    business,
    staffUserId: target.id,
    startAt,
    durationMinutes: record.durationMinutes,
    excludeAppointmentId: record.id,
    now,
    nowUnix,
  })
  if (!validation.ok) throwSlotError(validation, target.id)

  const parts = localSlotParts(validation.startAt, business.timezone)
  const changed = await repository.reassign({
    id: record.id,
    currentStaffUserId: record.assignedStaffUserId,
    currentStartAt: record.startAt,
    currentEndAt: record.endAt,
    staffUserId: target.id,
    startAt: validation.startAt,
    endAt: validation.endAt,
    weekday: parts.weekday,
    startMinute: parts.startMinute,
    endMinute: parts.startMinute + record.durationMinutes,
    now: nowUnix,
    excludeAppointmentId: record.id,
  })

  if (!changed) {
    throw bookingConflict(
      'This appointment has already changed. Refresh and try again.',
    )
  }

  await recordTransition(db, {
    appointmentId: record.id,
    entityId: record.publicReference,
    actorUserId,
    action: 'appointment.reassigned',
    metadata: {
      fromStaffUserId: record.assignedStaffUserId,
      toStaffUserId: target.id,
      previousStartAt: record.startAt,
      previousEndAt: record.endAt,
      newStartAt: validation.startAt,
      newEndAt: validation.endAt,
    },
    invalidateGuestTokens: false,
    now: nowUnix,
  })

  return await reloadForAdmin(db, normalized)
}
