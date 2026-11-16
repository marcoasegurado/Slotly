import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../env'
import { ApiError } from './errors'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Cookie-authenticated state changes must come from the same application
 * origin. Browsers send Origin on cross-origin form/fetch submissions, so a
 * mismatched or foreign origin is rejected. SameSite=Lax on the session
 * cookie provides a second layer.
 */
export const sameOriginGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!SAFE_METHODS.has(c.req.method)) {
    const origin = c.req.header('Origin')
    const expectedOrigin = new URL(c.req.url).origin

    if (!origin || origin !== expectedOrigin) {
      throw new ApiError(
        403,
        'CSRF_REJECTED',
        'This request must come from the application origin.',
      )
    }
  }

  await next()
}
