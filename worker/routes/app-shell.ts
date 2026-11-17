import { Hono } from 'hono'
import type { AppEnv } from '../env'

/**
 * Pages served by the SPA that need stricter response headers than the
 * generic static assets. The Worker proxies the asset request so the headers
 * are guaranteed regardless of `_headers` fallback behavior.
 */
export const appShellRoutes = new Hono<AppEnv>()

appShellRoutes.on(['GET', 'HEAD'], '/cancel/*', async (c) => {
  const assets = c.env.ASSETS
  if (!assets) {
    // Only unit tests without an assets binding reach this branch.
    return c.text('Not found', 404)
  }

  const response = await assets.fetch(c.req.raw)
  const headers = new Headers(response.headers)
  headers.set('Referrer-Policy', 'no-referrer')
  headers.set('Cache-Control', 'no-store')
  headers.set('X-Robots-Tag', 'noindex, nofollow')
  headers.set('X-Content-Type-Options', 'nosniff')

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
})
