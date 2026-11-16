import { Hono } from 'hono'
import type { AppEnv } from '../env'
import { ApiError } from '../http/errors'
import {
  isValidEmail,
  normalizeEmail,
  readJsonObject,
  requiredRawString,
  requiredString,
} from '../http/validation'
import { requireAuth } from '../auth/middleware'
import {
  getDummyPasswordHash,
  hashPassword,
  passwordPolicyError,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  verifyPassword,
} from '../auth/password'
import { clearRateLimit } from '../auth/rate-limit'
import { clientIp, enforceRateLimit } from '../http/rate-limit'
import {
  clearSessionCookie,
  destroySession,
  issueSession,
  toAuthUser,
} from '../auth/session'
import { randomId } from '../lib/encoding'
import { unixSeconds } from '../lib/time'
import { SessionsRepository } from '../repositories/sessions'
import {
  isUniqueConstraintError,
  UsersRepository,
} from '../repositories/users'

const LOGIN_WINDOW_MS = 15 * 60 * 1000
const LOGIN_ACCOUNT_LIMIT = 10
const LOGIN_IP_LIMIT = 30
const REGISTER_WINDOW_MS = 60 * 60 * 1000
const REGISTER_IP_LIMIT = 10

export const authRoutes = new Hono<AppEnv>()

authRoutes.post('/register', async (c) => {
  enforceRateLimit(
    c,
    `register-ip:${clientIp(c)}`,
    REGISTER_IP_LIMIT,
    REGISTER_WINDOW_MS,
  )

  const body = await readJsonObject(c)
  const name = requiredString(body, 'name', 'your full name', 2, 100)
  const email = normalizeEmail(
    requiredString(body, 'email', 'your email', 3, 254),
  )
  if (!isValidEmail(email)) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Enter a valid email address.')
  }

  const password = requiredRawString(
    body,
    'password',
    'your password',
    PASSWORD_MIN_LENGTH,
    PASSWORD_MAX_LENGTH,
  )
  const policyError = passwordPolicyError(password)
  if (policyError) {
    throw new ApiError(422, 'VALIDATION_ERROR', policyError)
  }

  const users = new UsersRepository(c.env.DB)
  if (await users.findByEmail(email)) {
    throw new ApiError(
      409,
      'EMAIL_IN_USE',
      'An account with that email already exists.',
    )
  }

  const now = unixSeconds()
  const passwordHash = await hashPassword(password)

  let user
  try {
    user = await users.createCustomer({
      id: randomId('usr'),
      name,
      email,
      passwordHash,
      now,
    })
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new ApiError(
        409,
        'EMAIL_IN_USE',
        'An account with that email already exists.',
      )
    }
    throw error
  }

  await issueSession(c, user.id, now)
  return c.json({ data: toAuthUser(user) }, 201)
})

authRoutes.post('/login', async (c) => {
  const body = await readJsonObject(c)
  const email = normalizeEmail(
    requiredString(body, 'email', 'your email', 3, 254),
  )
  if (!isValidEmail(email)) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Enter a valid email address.')
  }

  const password = requiredRawString(
    body,
    'password',
    'your password',
    1,
    PASSWORD_MAX_LENGTH,
  )

  const accountKey = `login-account:${email}`
  enforceRateLimit(
    c,
    `login-ip:${clientIp(c)}`,
    LOGIN_IP_LIMIT,
    LOGIN_WINDOW_MS,
  )
  enforceRateLimit(c, accountKey, LOGIN_ACCOUNT_LIMIT, LOGIN_WINDOW_MS)

  const now = unixSeconds()
  const user = await new UsersRepository(c.env.DB).findByEmail(email)
  const storedHash = user?.password_hash ?? (await getDummyPasswordHash())
  const passwordMatches = await verifyPassword(password, storedHash)
  const temporaryPasswordExpired =
    user !== null &&
    user.must_change_password === 1 &&
    (user.temporary_password_expires_at === null ||
      user.temporary_password_expires_at <= now)

  if (
    !user ||
    !passwordMatches ||
    user.is_active !== 1 ||
    temporaryPasswordExpired
  ) {
    // One generic response: do not reveal whether the email exists, is
    // inactive, or has an expired temporary credential.
    throw new ApiError(
      401,
      'INVALID_CREDENTIALS',
      'That email and password do not match.',
    )
  }

  clearRateLimit(accountKey)
  await issueSession(c, user.id, now)
  return c.json({ data: toAuthUser(user) })
})

authRoutes.post('/logout', async (c) => {
  await destroySession(c, unixSeconds())
  return c.body(null, 204)
})

authRoutes.get('/me', requireAuth, (c) => {
  return c.json({ data: c.get('user') })
})

authRoutes.post('/change-password', requireAuth, async (c) => {
  const body = await readJsonObject(c)
  const currentPassword = requiredRawString(
    body,
    'currentPassword',
    'current password',
    1,
    PASSWORD_MAX_LENGTH,
  )
  const newPassword = requiredRawString(
    body,
    'newPassword',
    'new password',
    PASSWORD_MIN_LENGTH,
    PASSWORD_MAX_LENGTH,
  )

  const policyError = passwordPolicyError(newPassword)
  if (policyError) {
    throw new ApiError(422, 'VALIDATION_ERROR', policyError)
  }
  if (currentPassword === newPassword) {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'Choose a password different from the current one.',
    )
  }

  const users = new UsersRepository(c.env.DB)
  const user = await users.findById(c.get('user').id)
  if (!user || user.is_active !== 1) {
    throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
  }

  const now = unixSeconds()
  const temporaryPasswordExpired =
    user.must_change_password === 1 &&
    (user.temporary_password_expires_at === null ||
      user.temporary_password_expires_at <= now)

  if (temporaryPasswordExpired) {
    await new SessionsRepository(c.env.DB).revokeAllForUser(user.id, now)
    clearSessionCookie(c)
    throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in again to continue.')
  }

  if (!(await verifyPassword(currentPassword, user.password_hash))) {
    throw new ApiError(
      401,
      'INVALID_CREDENTIALS',
      'Your current password is not correct.',
    )
  }

  await users.completePasswordChange(
    user.id,
    await hashPassword(newPassword),
    now,
  )
  await new SessionsRepository(c.env.DB).revokeAllForUserExcept(
    user.id,
    c.get('sessionId'),
    now,
  )

  return c.body(null, 204)
})
