import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../env'
import { ApiError } from '../http/errors'
import { unixSeconds } from '../lib/time'
import type { UserRole } from '../types'
import { authenticateRequest, toAuthUser } from './session'

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const session = await authenticateRequest(c, unixSeconds())
  if (!session) {
    throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
  }

  c.set('sessionId', session.sessionId)
  c.set('user', toAuthUser(session.user))
  await next()
}

/**
 * Use after `requireAuth`. Staff/admin routes must reject a temporary password
 * session until the user completes the forced password change.
 */
export function requireRole(...roles: UserRole[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get('user')
    if (!user) {
      throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
    }
    if (!roles.includes(user.role)) {
      throw new ApiError(
        403,
        'FORBIDDEN',
        'This area is not available for that account.',
      )
    }
    if (user.mustChangePassword) {
      throw new ApiError(
        403,
        'PASSWORD_CHANGE_REQUIRED',
        'Change your temporary password before continuing.',
      )
    }

    await next()
  }
}
