import { Hono } from 'hono'
import { authenticateRequest } from '../auth/session'
import type { AppEnv } from '../env'
import { ApiError, apiError } from '../http/errors'
import { clientIp, enforceRateLimit } from '../http/rate-limit'
import {
  isValidEmail,
  normalizeEmail,
  optionalNullableString,
  readJsonObject,
  requiredInteger,
  requiredString,
} from '../http/validation'
import { dateKeyUnixRange, isValidDateKey, pad2, unixSeconds } from '../lib/time'
import { BusinessSettingsRepository } from '../repositories/business-settings'
import { SchedulesRepository } from '../repositories/schedules'
import { ServicesRepository } from '../repositories/services'
import { getDayAvailability } from '../services/availability'
import { loadAvailabilityContext } from '../services/availability-context'
import {
  cancelGuestBooking,
  createBooking,
  resolveGuestCancellation,
} from '../services/bookings'
import { dispatchEmailById } from '../services/notifications'

const BOOKING_RATE_LIMIT = 20
const BOOKING_RATE_WINDOW_MS = 60 * 60 * 1000
const GUEST_CANCEL_RATE_LIMIT = 30
const GUEST_CANCEL_RATE_WINDOW_MS = 15 * 60 * 1000
const MAX_UNIX_SECONDS = 4_102_444_800 // 2100-01-01
const MAX_NOTE_LENGTH = 500

export const publicRoutes = new Hono<AppEnv>()

publicRoutes.get('/business', async (c) => {
  const business = await new BusinessSettingsRepository(c.env.DB).getPublic()
  if (!business) {
    return apiError(
      c,
      404,
      'BUSINESS_NOT_CONFIGURED',
      'Business settings have not been configured.',
    )
  }

  return c.json({ data: business })
})

publicRoutes.get('/services', async (c) => {
  const services = await new ServicesRepository(c.env.DB).listActive()
  return c.json({ data: services })
})

publicRoutes.get('/availability', async (c) => {
  const serviceId = c.req.query('serviceId')?.trim() ?? ''
  const dateKey = c.req.query('date')?.trim() ?? ''

  if (!serviceId) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Choose a service.')
  }
  if (!isValidDateKey(dateKey)) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Choose a valid date.')
  }

  const business = await new BusinessSettingsRepository(c.env.DB).getPublic()
  if (!business) {
    return apiError(
      c,
      404,
      'BUSINESS_NOT_CONFIGURED',
      'Business settings have not been configured.',
    )
  }

  const service = await new ServicesRepository(c.env.DB).findActiveById(serviceId)
  if (!service) {
    return apiError(
      c,
      404,
      'SERVICE_NOT_FOUND',
      'That service is not available.',
    )
  }

  const context = await loadAvailabilityContext(c.env.DB, {
    timezone: business.timezone,
    maxAdvanceBookingDays: business.maxAdvanceBookingDays,
    dateKey,
  })
  const availability = getDayAvailability(
    context,
    service.durationMinutes,
    dateKey,
  )

  return c.json({
    data: {
      dateKey: availability.dateKey,
      state: availability.state,
      slots: availability.slots.map((slot) => ({
        startAt: slot.startAt,
        endAt: slot.endAt,
      })),
    },
  })
})

publicRoutes.get('/availability/month', async (c) => {
  const serviceId = c.req.query('serviceId')?.trim() ?? ''
  const month = c.req.query('month')?.trim() ?? ''

  if (!serviceId) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Choose a service.')
  }
  if (!/^(\d{4})-(0[1-9]|1[0-2])$/.test(month)) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Choose a valid month.')
  }

  const year = Number(month.slice(0, 4))
  if (year < 2000 || year > 2100) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Choose a valid month.')
  }

  const business = await new BusinessSettingsRepository(c.env.DB).getPublic()
  if (!business) {
    return apiError(
      c,
      404,
      'BUSINESS_NOT_CONFIGURED',
      'Business settings have not been configured.',
    )
  }

  const service = await new ServicesRepository(c.env.DB).findActiveById(serviceId)
  if (!service) {
    return apiError(
      c,
      404,
      'SERVICE_NOT_FOUND',
      'That service is not available.',
    )
  }

  const monthIndex = Number(month.slice(5, 7))
  const lastDay = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate()
  const firstDateKey = `${month}-01`
  const lastDateKey = `${month}-${pad2(lastDay)}`

  // One span covers the whole month, so the calendar costs two queries instead
  // of one per day.
  const span = await new SchedulesRepository(c.env.DB).loadAvailabilitySpan(
    dateKeyUnixRange(firstDateKey, business.timezone).start,
    dateKeyUnixRange(lastDateKey, business.timezone).end,
  )

  const context = {
    timezone: business.timezone,
    maxAdvanceBookingDays: business.maxAdvanceBookingDays,
    staff: span.staff,
    confirmedAppointments: span.confirmedAppointments,
  }

  const days = []
  for (let day = 1; day <= lastDay; day += 1) {
    const dateKey = `${month}-${pad2(day)}`
    days.push({
      dateKey,
      state: getDayAvailability(context, service.durationMinutes, dateKey).state,
    })
  }

  return c.json({ data: { month, days } })
})

publicRoutes.post('/bookings', async (c) => {
  enforceRateLimit(
    c,
    `booking-ip:${clientIp(c)}`,
    BOOKING_RATE_LIMIT,
    BOOKING_RATE_WINDOW_MS,
  )

  const body = await readJsonObject(c)
  const serviceId = requiredString(body, 'serviceId', 'service', 1, 100)
  const startAt = requiredInteger(
    body,
    'startAt',
    'start time',
    1,
    MAX_UNIX_SECONDS,
  )
  const noteValue = optionalNullableString(
    body,
    'customerNote',
    'note',
    MAX_NOTE_LENGTH,
  )
  const customerNote = noteValue?.trim() || null

  const now = new Date()
  const session = await authenticateRequest(
    c,
    unixSeconds(now.getTime()),
  )

  let customerUserId: string | null = null
  let customerEmail: string | null = null
  let guestName: string | null = null
  let guestEmail: string | null = null

  if (session?.user.role === 'customer') {
    customerUserId = session.user.id
    customerEmail = session.user.email
  } else {
    guestName = requiredString(body, 'guestName', 'your full name', 2, 100)
    guestEmail = normalizeEmail(
      requiredString(body, 'guestEmail', 'your email', 3, 254),
    )
    if (!isValidEmail(guestEmail)) {
      throw new ApiError(422, 'VALIDATION_ERROR', 'Enter a valid email address.')
    }
  }

  const outcome = await createBooking(
    c.env.DB,
    {
      serviceId,
      startAt,
      customerUserId,
      customerEmail,
      guestName,
      guestEmail,
      customerNote,
      requestOrigin: new URL(c.req.url).origin,
    },
    now,
  )

  if (outcome.notificationId) {
    await dispatchEmailById(c.env, outcome.notificationId)
  }

  return c.json({ data: outcome.result }, 201)
})

publicRoutes.get('/guest-cancellation/:token', async (c) => {
  enforceRateLimit(
    c,
    `guest-cancel-lookup-ip:${clientIp(c)}`,
    GUEST_CANCEL_RATE_LIMIT,
    GUEST_CANCEL_RATE_WINDOW_MS,
  )

  const token = c.req.param('token') ?? ''
  if (!token || token.length > 128) {
    throw new ApiError(
      404,
      'CANCELLATION_LINK_UNAVAILABLE',
      'This cancellation link is no longer available.',
    )
  }

  return c.json({ data: await resolveGuestCancellation(c.env.DB, token) })
})

publicRoutes.post('/guest-cancellation', async (c) => {
  enforceRateLimit(
    c,
    `guest-cancel-ip:${clientIp(c)}`,
    GUEST_CANCEL_RATE_LIMIT,
    GUEST_CANCEL_RATE_WINDOW_MS,
  )

  const body = await readJsonObject(c)
  const token = requiredString(
    body,
    'token',
    'cancellation token',
    1,
    128,
  )

  return c.json({ data: await cancelGuestBooking(c.env.DB, token) })
})
