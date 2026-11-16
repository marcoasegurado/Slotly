import { Hono } from 'hono'
import type { Env } from './env'
import { ApiError, apiError } from './http/errors'
import { healthRoutes } from './routes/health'
import { publicRoutes } from './routes/public'

export function createApp() {
  const app = new Hono<{ Bindings: Env }>()

  app.use('*', async (c, next) => {
    await next()
    c.header('Cache-Control', 'no-store')
    c.header('X-Content-Type-Options', 'nosniff')
  })

  app.route('/api', healthRoutes)
  app.route('/api/public', publicRoutes)

  app.notFound((c) =>
    apiError(c, 404, 'NOT_FOUND', 'The requested resource was not found.'),
  )

  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return apiError(c, error.status, error.code, error.message, error.details)
    }

    // Log only the method/path and error name. Messages can contain SQL or
    // bound values, and must not reach client responses or noisy logs.
    console.error('Unhandled API error', {
      method: c.req.method,
      path: c.req.path,
      name: error instanceof Error ? error.name : 'UnknownError',
    })
    return apiError(c, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.')
  })

  return app
}

export const app = createApp()
