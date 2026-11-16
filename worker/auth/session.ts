import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { AppEnv } from '../env'
import { randomHex, randomId, sha256Hex } from '../lib/encoding'
import { unixSeconds } from '../lib/time'
import { SessionsRepository } from '../repositories/sessions'
import type { UserRecord } from '../repositories/users'
import type { AuthUser } from '../types'

export const SESSION_COOKIE_NAME = 'slotly_session'
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60

function secureCookie(c: Context<AppEnv>): boolean {
  return (
    c.env.ENVIRONMENT === 'production' ||
    new URL(c.req.url).protocol === 'https:'
  )
}

export function toAuthUser(user: UserRecord): AuthUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    mustChangePassword: user.must_change_password === 1,
  }
}

export async function issueSession(
  c: Context<AppEnv>,
  userId: string,
  now: number = unixSeconds(),
): Promise<void> {
  const token = randomHex(32)
  const tokenHash = await sha256Hex(token)

  await new SessionsRepository(c.env.DB).create({
    id: randomId('ses'),
    userId,
    tokenHash,
    createdAt: now,
    expiresAt: now + SESSION_TTL_SECONDS,
  })

  setCookie(c, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: secureCookie(c),
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  })
}

export function clearSessionCookie(c: Context<AppEnv>): void {
  deleteCookie(c, SESSION_COOKIE_NAME, {
    path: '/',
    secure: secureCookie(c),
  })
}

export async function destroySession(
  c: Context<AppEnv>,
  now: number = unixSeconds(),
): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE_NAME)
  if (token) {
    await new SessionsRepository(c.env.DB).revokeByTokenHash(
      await sha256Hex(token),
      now,
    )
  }
  clearSessionCookie(c)
}

export async function authenticateRequest(
  c: Context<AppEnv>,
  now: number = unixSeconds(),
): Promise<{ sessionId: string; user: UserRecord } | null> {
  const token = getCookie(c, SESSION_COOKIE_NAME)
  if (!token) return null

  const session = await new SessionsRepository(c.env.DB).findValidByTokenHash(
    await sha256Hex(token),
    now,
  )
  if (!session) {
    clearSessionCookie(c)
    return null
  }

  return session
}
