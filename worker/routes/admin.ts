import { Hono } from 'hono'
import { requireAuth, requireRole } from '../auth/middleware'
import type { AppEnv } from '../env'
import { ApiError } from '../http/errors'
import {
  optionalBoolean,
  optionalInteger,
  optionalNullableString,
  optionalString,
  readJsonObject,
  requiredInteger,
  requiredString,
} from '../http/validation'
import { randomId } from '../lib/encoding'
import { unixSeconds } from '../lib/time'
import { ServicesRepository } from '../repositories/services'

export const adminRoutes = new Hono<AppEnv>()

adminRoutes.use('*', requireAuth, requireRole('admin'))

adminRoutes.get('/services', async (c) => {
  return c.json({ data: await new ServicesRepository(c.env.DB).listAll() })
})

adminRoutes.post('/services', async (c) => {
  const body = await readJsonObject(c)
  const name = requiredString(body, 'name', 'service name', 2, 100)
  const description = optionalNullableString(
    body,
    'description',
    'service description',
    500,
  )
  const durationMinutes = requiredInteger(
    body,
    'durationMinutes',
    'service duration',
    1,
    1440,
  )
  const isActive = optionalBoolean(body, 'isActive', 'active setting') ?? true
  const now = unixSeconds()

  const service = await new ServicesRepository(c.env.DB).create({
    id: randomId('svc'),
    name,
    description: description ?? null,
    durationMinutes,
    isActive,
    now,
  })

  return c.json({ data: service }, 201)
})

adminRoutes.patch('/services/:id', async (c) => {
  const id = c.req.param('id')
  const repository = new ServicesRepository(c.env.DB)
  const existing = await repository.findById(id)

  if (!existing) {
    throw new ApiError(404, 'SERVICE_NOT_FOUND', 'That service was not found.')
  }

  const body = await readJsonObject(c)
  const name = optionalString(body, 'name', 'service name', 2, 100)
  const description = optionalNullableString(
    body,
    'description',
    'service description',
    500,
  )
  const durationMinutes = optionalInteger(
    body,
    'durationMinutes',
    'service duration',
    1,
    1440,
  )
  const isActive = optionalBoolean(body, 'isActive', 'active setting')

  if (
    name === undefined &&
    description === undefined &&
    durationMinutes === undefined &&
    isActive === undefined
  ) {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'Choose at least one service field to update.',
    )
  }

  if (isActive === false) {
    const futureBookings = await repository.listFutureBookings(
      id,
      unixSeconds(),
    )
    if (futureBookings.length > 0) {
      throw new ApiError(
        409,
        'SERVICE_HAS_FUTURE_BOOKINGS',
        'Resolve the affected bookings before deactivating this service.',
        { affectedBookings: futureBookings },
      )
    }
  }

  const updated = await repository.update(
    id,
    {
      name,
      description,
      durationMinutes,
      isActive,
    },
    unixSeconds(),
  )

  if (!updated) {
    throw new ApiError(404, 'SERVICE_NOT_FOUND', 'That service was not found.')
  }
  return c.json({ data: updated })
})
