import { Hono } from 'hono'
import { requireAuth, requireRole } from '../auth/middleware'
import type { AppEnv } from '../env'
import { ApiError } from '../http/errors'
import {
  cancelCustomerBooking,
  getCustomerBooking,
  listCustomerBookings,
} from '../services/bookings'

export const customerRoutes = new Hono<AppEnv>()

customerRoutes.use('*', requireAuth, requireRole('customer'))

customerRoutes.get('/bookings', async (c) => {
  return c.json({
    data: await listCustomerBookings(c.env.DB, c.get('user').id),
  })
})

customerRoutes.get('/bookings/:id', async (c) => {
  const id = c.req.param('id')
  if (!id) {
    throw new ApiError(404, 'BOOKING_NOT_FOUND', 'That booking was not found.')
  }

  return c.json({
    data: await getCustomerBooking(c.env.DB, c.get('user').id, id),
  })
})

customerRoutes.post('/bookings/:id/cancel', async (c) => {
  const id = c.req.param('id')
  if (!id) {
    throw new ApiError(404, 'BOOKING_NOT_FOUND', 'That booking was not found.')
  }

  return c.json({
    data: await cancelCustomerBooking(c.env.DB, c.get('user').id, id),
  })
})
