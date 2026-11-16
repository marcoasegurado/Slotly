import { Hono } from 'hono'
import type { AppEnv } from '../env'
import { ApiError, apiError } from '../http/errors'
import { isValidDateKey } from '../lib/time'
import { BusinessSettingsRepository } from '../repositories/business-settings'
import { ServicesRepository } from '../repositories/services'
import { getDayAvailability } from '../services/availability'
import { loadAvailabilityContext } from '../services/availability-context'

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
