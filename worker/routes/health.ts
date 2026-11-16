import { Hono } from 'hono'
import type { Env } from '../env'
import { apiError } from '../http/errors'

export const healthRoutes = new Hono<{ Bindings: Env }>()

healthRoutes.get('/health', async (c) => {
  try {
    const row = await c.env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>()
    if (!row || row.ok !== 1) {
      return apiError(c, 503, 'DATABASE_UNAVAILABLE', 'The database is unavailable.')
    }
  } catch {
    return apiError(c, 503, 'DATABASE_UNAVAILABLE', 'The database is unavailable.')
  }

  return c.json({
    data: {
      status: 'ok',
      service: 'slotly-api',
      environment: c.env.ENVIRONMENT ?? 'unknown',
      timestamp: Math.floor(Date.now() / 1000),
    },
  })
})
