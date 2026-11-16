import { Hono } from 'hono'
import type { AppEnv } from '../env'
import { apiError } from '../http/errors'
import { BusinessSettingsRepository } from '../repositories/business-settings'
import { ServicesRepository } from '../repositories/services'

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
