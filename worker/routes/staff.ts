import { Hono } from 'hono'
import { requireAuth, requireRole } from '../auth/middleware'
import type { AppEnv } from '../env'
import { ApiError } from '../http/errors'
import {
  parseAppointmentStatus,
  parseReason,
  parseStaffScope,
} from '../http/appointment-query'
import {
  optionalNullableString,
  readJsonObject,
  readOptionalJsonObject,
  requiredArray,
  requiredInteger,
} from '../http/validation'
import { unixSeconds } from '../lib/time'
import { SchedulesRepository } from '../repositories/schedules'
import {
  approveStaffAppointment,
  cancelStaffAppointment,
  getStaffAppointment,
  getStaffDashboard,
  listStaffAppointments,
  rejectStaffAppointment,
  rescheduleStaffAppointment,
} from '../services/appointment-management'
import { findScheduleConflicts } from '../services/availability'
import { requireBusinessSettings } from '../services/business'
import { parseWorkingHours } from '../services/schedule'
import type { StaffSchedule } from '../types'

const MAX_UNIX_SECONDS = 4_102_444_800 // 2100-01-01
const MAX_TIME_OFF_REASON = 200

export const staffRoutes = new Hono<AppEnv>()

staffRoutes.use('*', requireAuth, requireRole('staff'))

async function requireSchedule(
  db: D1Database,
  staffUserId: string,
): Promise<StaffSchedule> {
  const schedule = await new SchedulesRepository(db).getSchedule(staffUserId)
  if (!schedule) {
    throw new ApiError(
      404,
      'STAFF_PROFILE_NOT_FOUND',
      'This staff profile is not available.',
    )
  }
  return schedule
}

staffRoutes.get('/dashboard', async (c) => {
  return c.json({
    data: await getStaffDashboard(c.env.DB, c.get('user').id),
  })
})

staffRoutes.get('/appointments', async (c) => {
  const filters = {
    status: parseAppointmentStatus(c.req.query('status')),
    scope: parseStaffScope(c.req.query('scope')),
  }
  return c.json({
    data: await listStaffAppointments(
      c.env.DB,
      c.get('user').id,
      filters,
    ),
  })
})

staffRoutes.get('/appointments/:id', async (c) => {
  const id = c.req.param('id')
  if (!id) {
    throw new ApiError(
      404,
      'APPOINTMENT_NOT_FOUND',
      'That appointment was not found.',
    )
  }

  return c.json({
    data: await getStaffAppointment(c.env.DB, c.get('user').id, id),
  })
})

staffRoutes.post('/appointments/:id/approve', async (c) => {
  const id = c.req.param('id')
  if (!id) {
    throw new ApiError(
      404,
      'APPOINTMENT_NOT_FOUND',
      'That appointment was not found.',
    )
  }

  return c.json({
    data: await approveStaffAppointment(c.env.DB, c.get('user').id, id),
  })
})

staffRoutes.post('/appointments/:id/reject', async (c) => {
  const id = c.req.param('id')
  if (!id) {
    throw new ApiError(
      404,
      'APPOINTMENT_NOT_FOUND',
      'That appointment was not found.',
    )
  }

  const body = await readOptionalJsonObject(c)
  return c.json({
    data: await rejectStaffAppointment(
      c.env.DB,
      c.get('user').id,
      id,
      parseReason(body),
    ),
  })
})

staffRoutes.post('/appointments/:id/cancel', async (c) => {
  const id = c.req.param('id')
  if (!id) {
    throw new ApiError(
      404,
      'APPOINTMENT_NOT_FOUND',
      'That appointment was not found.',
    )
  }

  const body = await readOptionalJsonObject(c)
  return c.json({
    data: await cancelStaffAppointment(
      c.env.DB,
      c.get('user').id,
      id,
      parseReason(body),
    ),
  })
})

staffRoutes.patch('/appointments/:id', async (c) => {
  const id = c.req.param('id')
  if (!id) {
    throw new ApiError(
      404,
      'APPOINTMENT_NOT_FOUND',
      'That appointment was not found.',
    )
  }

  const body = await readJsonObject(c)
  const startAt = requiredInteger(
    body,
    'startAt',
    'start time',
    1,
    MAX_UNIX_SECONDS,
  )
  return c.json({
    data: await rescheduleStaffAppointment(
      c.env.DB,
      c.get('user').id,
      id,
      startAt,
    ),
  })
})

staffRoutes.get('/availability', async (c) => {
  const schedule = await requireSchedule(c.env.DB, c.get('user').id)
  return c.json({ data: schedule })
})

staffRoutes.put('/availability', async (c) => {
  const body = await readJsonObject(c)
  const intervals = parseWorkingHours(
    requiredArray(body, 'workingHours', 'weekly schedule'),
  )

  const schedule = await requireSchedule(c.env.DB, c.get('user').id)
  const business = await requireBusinessSettings(c.env.DB)
  const repository = new SchedulesRepository(c.env.DB)
  const now = new Date()
  const nowUnix = unixSeconds(now.getTime())
  const futureAppointments = await repository.listFutureAppointments(
    c.get('user').id,
    nowUnix,
  )
  const conflicts = findScheduleConflicts({
    timezone: business.timezone,
    staffId: c.get('user').id,
    intervals,
    timeOff: schedule.timeOff.map((entry) => ({
      startAt: entry.startAt,
      endAt: entry.endAt,
    })),
    appointments: futureAppointments.map((appointment) => ({
      publicReference: appointment.publicReference,
      status: appointment.status,
      staffUserId: c.get('user').id,
      startAt: appointment.startAt,
      endAt: appointment.endAt,
      durationMinutes: appointment.durationMinutes,
    })),
    now,
  })

  if (conflicts.length > 0) {
    throw new ApiError(
      409,
      'SCHEDULE_CHANGE_CONFLICT',
      'Resolve the affected bookings before changing your schedule.',
      { affectedBookings: conflicts },
    )
  }

  await repository.replaceWorkingHours(c.get('user').id, intervals)
  return c.json({ data: await requireSchedule(c.env.DB, c.get('user').id) })
})

staffRoutes.post('/time-off', async (c) => {
  const body = await readJsonObject(c)
  const startAt = requiredInteger(
    body,
    'startAt',
    'time-off start',
    1,
    MAX_UNIX_SECONDS,
  )
  const endAt = requiredInteger(
    body,
    'endAt',
    'time-off end',
    1,
    MAX_UNIX_SECONDS,
  )
  const reason = optionalNullableString(
    body,
    'reason',
    'time-off reason',
    MAX_TIME_OFF_REASON,
  )

  if (endAt <= startAt) {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'The time-off end must be after its start.',
    )
  }

  const now = new Date()
  const nowUnix = unixSeconds(now.getTime())
  if (endAt <= nowUnix) {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'Choose time off that has not already ended.',
    )
  }

  const schedule = await requireSchedule(c.env.DB, c.get('user').id)
  const business = await requireBusinessSettings(c.env.DB)
  const repository = new SchedulesRepository(c.env.DB)
  const futureAppointments = await repository.listFutureAppointments(
    c.get('user').id,
    nowUnix,
  )
  const proposedTimeOff = [
    ...schedule.timeOff.map((entry) => ({
      startAt: entry.startAt,
      endAt: entry.endAt,
    })),
    { startAt, endAt },
  ]
  const conflicts = findScheduleConflicts({
    timezone: business.timezone,
    staffId: c.get('user').id,
    intervals: schedule.workingHours.map((entry) => ({
      weekday: entry.weekday,
      startMinute: entry.startMinute,
      endMinute: entry.endMinute,
    })),
    timeOff: proposedTimeOff,
    appointments: futureAppointments.map((appointment) => ({
      publicReference: appointment.publicReference,
      status: appointment.status,
      staffUserId: c.get('user').id,
      startAt: appointment.startAt,
      endAt: appointment.endAt,
      durationMinutes: appointment.durationMinutes,
    })),
    now,
  })

  if (conflicts.length > 0) {
    throw new ApiError(
      409,
      'SCHEDULE_CHANGE_CONFLICT',
      'Resolve the affected bookings before adding this time off.',
      { affectedBookings: conflicts },
    )
  }

  const created = await repository.addTimeOff({
    staffUserId: c.get('user').id,
    startAt,
    endAt,
    reason: reason ?? null,
    now: nowUnix,
  })

  return c.json({ data: created }, 201)
})

staffRoutes.delete('/time-off/:id', async (c) => {
  const id = c.req.param('id')
  if (!id) {
    throw new ApiError(404, 'TIME_OFF_NOT_FOUND', 'That time off was not found.')
  }

  const deleted = await new SchedulesRepository(c.env.DB).deleteTimeOff(
    id,
    c.get('user').id,
  )
  if (!deleted) {
    throw new ApiError(404, 'TIME_OFF_NOT_FOUND', 'That time off was not found.')
  }

  return c.body(null, 204)
})
