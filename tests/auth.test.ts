import { Hono } from 'hono'
import { beforeEach, describe, expect, it } from 'vitest'
import { app, createApp } from '../worker/app'
import { requireAuth, requireRole } from '../worker/auth/middleware'
import { resetRateLimits } from '../worker/auth/rate-limit'
import { verifyPassword } from '../worker/auth/password'
import type { AppEnv } from '../worker/env'
import { sha256Hex } from '../worker/lib/encoding'
import { unixSeconds } from '../worker/lib/time'
import { createTestDatabase, type TestDatabase } from './helpers/test-d1'

const ORIGIN = 'http://localhost'
const DEMO_PASSWORD = 'slotly-demo'

interface RequestOptions {
  method?: string
  body?: unknown
  origin?: string | null
  cookie?: string
  url?: string
  environment?: string
}

async function request(
  db: TestDatabase,
  path: string,
  options: RequestOptions = {},
): Promise<Response> {
  const headers: Record<string, string> = {}
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (options.origin !== null) headers.Origin = options.origin ?? ORIGIN
  if (options.cookie) headers.Cookie = options.cookie

  return await app.request(
    options.url ?? `${ORIGIN}${path}`,
    {
      method:
        options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    },
    { DB: db.d1, ENVIRONMENT: options.environment ?? 'test' },
  )
}

function setCookieHeader(response: Response): string {
  return response.headers.get('set-cookie') ?? ''
}

function sessionCookie(response: Response): string {
  const match = /(?:^|,\s*)slotly_session=([^;,]+)/.exec(
    setCookieHeader(response),
  )
  if (!match) throw new Error('Expected a slotly_session cookie.')
  return `slotly_session=${match[1]}`
}

function sessionToken(cookie: string): string {
  return cookie.slice('slotly_session='.length)
}

async function login(
  db: TestDatabase,
  email: string,
  password = DEMO_PASSWORD,
  options: Omit<RequestOptions, 'body'> = {},
): Promise<Response> {
  return request(db, '/api/auth/login', {
    ...options,
    body: { email, password },
  })
}

async function expectApiError(
  response: Response,
  status: number,
  code: string,
): Promise<Record<string, unknown>> {
  expect(response.status).toBe(status)
  const body = (await response.json()) as {
    error: { code: string; message: string; details: Record<string, unknown> }
  }
  expect(body.error.code).toBe(code)
  return body.error
}

function userRow(db: TestDatabase, email: string) {
  return db.raw
    .prepare(
      `SELECT id, email, password_hash, role, is_active, must_change_password,
              temporary_password_expires_at
         FROM users WHERE email = ?`,
    )
    .get(email) as
    | {
        id: string
        email: string
        password_hash: string
        role: string
        is_active: number
        must_change_password: number
        temporary_password_expires_at: number | null
      }
    | undefined
}

function sessionRow(db: TestDatabase, token: string) {
  return db.raw
    .prepare(
      `SELECT id, session_token_hash, expires_at, revoked_at
         FROM sessions WHERE session_token_hash = ?`,
    )
    .get(token) as
    | {
        id: string
        session_token_hash: string
        expires_at: number
        revoked_at: number | null
      }
    | undefined
}

let db: TestDatabase

beforeEach(() => {
  db = createTestDatabase()
  resetRateLimits()
})

describe('POST /api/auth/register', () => {
  it('creates a customer, normalizes the email and stores only hashes', async () => {
    const response = await request(db, '/api/auth/register', {
      body: {
        name: '  New Customer  ',
        email: '  New.Customer@Example.com ',
        password: 'correct horse',
      },
    })

    expect(response.status).toBe(201)
    const body = (await response.json()) as {
      data: {
        id: string
        name: string
        email: string
        role: string
        mustChangePassword: boolean
      }
    }
    expect(body.data).toMatchObject({
      name: 'New Customer',
      email: 'new.customer@example.com',
      role: 'customer',
      mustChangePassword: false,
    })

    const cookieHeader = setCookieHeader(response)
    expect(cookieHeader).toContain('HttpOnly')
    expect(cookieHeader).toContain('SameSite=Lax')
    expect(cookieHeader).toContain('Path=/')
    expect(cookieHeader).toContain('Max-Age=604800')
    expect(cookieHeader).not.toContain('Secure')

    const cookie = sessionCookie(response)
    const token = sessionToken(cookie)
    expect(token).toMatch(/^[0-9a-f]{64}$/)

    const user = userRow(db, 'new.customer@example.com')
    expect(user?.role).toBe('customer')
    expect(user?.password_hash).not.toContain('correct horse')
    await expect(
      verifyPassword('correct horse', user?.password_hash ?? ''),
    ).resolves.toBe(true)

    const session = sessionRow(db, await sha256Hex(token))
    expect(session?.session_token_hash).toBe(await sha256Hex(token))
    expect(session?.session_token_hash).not.toBe(token)
    expect(session?.revoked_at).toBeNull()

    const me = await request(db, '/api/auth/me', { cookie })
    expect(me.status).toBe(200)
    expect(await me.json()).toEqual({ data: body.data })
  })

  it('rejects a duplicate email regardless of case or surrounding spaces', async () => {
    const response = await request(db, '/api/auth/register', {
      body: {
        name: 'Someone Else',
        email: '  MARIA@example.com ',
        password: 'correct horse',
      },
    })

    const error = await expectApiError(response, 409, 'EMAIL_IN_USE')
    expect(error.message).toMatch(/already exists/i)
  })

  it('validates the name, email and password', async () => {
    await expectApiError(
      await request(db, '/api/auth/register', {
        body: { name: 'A', email: 'valid@example.com', password: 'long enough' },
      }),
      422,
      'VALIDATION_ERROR',
    )
    await expectApiError(
      await request(db, '/api/auth/register', {
        body: { name: 'Valid Name', email: 'not-an-email', password: 'long enough' },
      }),
      422,
      'VALIDATION_ERROR',
    )
    await expectApiError(
      await request(db, '/api/auth/register', {
        body: { name: 'Valid Name', email: 'valid@example.com', password: 'short' },
      }),
      422,
      'VALIDATION_ERROR',
    )
  })
})

describe('POST /api/auth/login', () => {
  it('signs in a seeded customer and sets a session cookie', async () => {
    const response = await login(db, 'MARIA@example.com')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: {
        id: 'usr_maria',
        name: 'Maria Santos',
        email: 'maria@example.com',
        role: 'customer',
        mustChangePassword: false,
      },
    })
    expect(setCookieHeader(response)).toContain('HttpOnly')
  })

  it('marks the cookie Secure on HTTPS requests', async () => {
    const response = await login(db, 'maria@example.com', DEMO_PASSWORD, {
      url: 'https://app.slotly.test/api/auth/login',
      origin: 'https://app.slotly.test',
    })

    expect(response.status).toBe(200)
    expect(setCookieHeader(response)).toContain('Secure')
  })

  it('gives one generic response for a wrong password or unknown email', async () => {
    const wrongPassword = await login(db, 'maria@example.com', 'not-the-password')
    const unknownEmail = await login(db, 'nobody@example.com', 'not-the-password')

    const wrongBody = await expectApiError(
      wrongPassword,
      401,
      'INVALID_CREDENTIALS',
    )
    const unknownBody = await expectApiError(
      unknownEmail,
      401,
      'INVALID_CREDENTIALS',
    )
    expect(wrongBody.message).toBe(unknownBody.message)
  })

  it('rejects inactive accounts without revealing the reason', async () => {
    db.raw
      .prepare('UPDATE users SET is_active = 0 WHERE email = ?')
      .run('maria@example.com')

    const response = await login(db, 'maria@example.com')

    await expectApiError(response, 401, 'INVALID_CREDENTIALS')
    expect(setCookieHeader(response)).toBe('')
  })

  it('allows a valid temporary password but flags the forced change', async () => {
    db.raw
      .prepare(
        `UPDATE users
            SET must_change_password = 1, temporary_password_expires_at = ?
          WHERE email = ?`,
      )
      .run(unixSeconds() + 3600, 'ana@slotly.studio')

    const response = await login(db, 'ana@slotly.studio')

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: { role: string; mustChangePassword: boolean }
    }
    expect(body.data).toMatchObject({
      role: 'staff',
      mustChangePassword: true,
    })
  })

  it('rejects an expired temporary password', async () => {
    db.raw
      .prepare(
        `UPDATE users
            SET must_change_password = 1, temporary_password_expires_at = ?
          WHERE email = ?`,
      )
      .run(unixSeconds() - 1, 'ana@slotly.studio')

    const response = await login(db, 'ana@slotly.studio')

    await expectApiError(response, 401, 'INVALID_CREDENTIALS')
  })

  it('rate limits repeated failures for one account', async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await login(db, 'maria@example.com', 'wrong-password')
      expect(response.status).toBe(401)
    }

    const limited = await login(db, 'maria@example.com', 'wrong-password')

    const error = await expectApiError(limited, 429, 'RATE_LIMITED')
    expect(error.details).toMatchObject({ retryAfterSeconds: expect.any(Number) })
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0)
  }, 20_000)
})

describe('GET /api/auth/me and sessions', () => {
  it('requires a session', async () => {
    const response = await request(db, '/api/auth/me')

    await expectApiError(response, 401, 'UNAUTHENTICATED')
  })

  it('rejects expired sessions and clears the cookie', async () => {
    const loginResponse = await login(db, 'maria@example.com')
    const cookie = sessionCookie(loginResponse)

    db.raw
      .prepare('UPDATE sessions SET expires_at = ? WHERE session_token_hash = ?')
      .run(
        unixSeconds() - 1,
        await sha256Hex(sessionToken(cookie)),
      )

    const response = await request(db, '/api/auth/me', { cookie })

    await expectApiError(response, 401, 'UNAUTHENTICATED')
    expect(setCookieHeader(response)).toContain('Max-Age=0')
  })

  it('rejects revoked sessions', async () => {
    const loginResponse = await login(db, 'maria@example.com')
    const cookie = sessionCookie(loginResponse)

    db.raw
      .prepare('UPDATE sessions SET revoked_at = ? WHERE session_token_hash = ?')
      .run(
        unixSeconds(),
        await sha256Hex(sessionToken(cookie)),
      )

    const response = await request(db, '/api/auth/me', { cookie })

    await expectApiError(response, 401, 'UNAUTHENTICATED')
  })
})

describe('POST /api/auth/logout', () => {
  it('revokes the stored session and clears the cookie', async () => {
    const loginResponse = await login(db, 'maria@example.com')
    const cookie = sessionCookie(loginResponse)
    const tokenHash = await sha256Hex(sessionToken(cookie))

    expect(sessionRow(db, tokenHash)?.revoked_at).toBeNull()

    const response = await request(db, '/api/auth/logout', {
      method: 'POST',
      cookie,
    })

    expect(response.status).toBe(204)
    expect(setCookieHeader(response)).toContain('Max-Age=0')
    expect(sessionRow(db, tokenHash)?.revoked_at).toEqual(expect.any(Number))

    const me = await request(db, '/api/auth/me', { cookie })
    await expectApiError(me, 401, 'UNAUTHENTICATED')
  })
})

describe('POST /api/auth/change-password', () => {
  it('rehashes the password and revokes the user’s other sessions', async () => {
    const firstCookie = sessionCookie(await login(db, 'maria@example.com'))
    const secondCookie = sessionCookie(await login(db, 'maria@example.com'))

    const response = await request(db, '/api/auth/change-password', {
      body: {
        currentPassword: DEMO_PASSWORD,
        newPassword: 'a-brand-new-password',
      },
      cookie: firstCookie,
    })

    expect(response.status).toBe(204)

    const user = userRow(db, 'maria@example.com')
    await expect(
      verifyPassword('a-brand-new-password', user?.password_hash ?? ''),
    ).resolves.toBe(true)
    await expect(
      verifyPassword(DEMO_PASSWORD, user?.password_hash ?? ''),
    ).resolves.toBe(false)
    expect(user?.must_change_password).toBe(0)

    expect(
      (await request(db, '/api/auth/me', { cookie: firstCookie })).status,
    ).toBe(200)
    await expectApiError(
      await request(db, '/api/auth/me', { cookie: secondCookie }),
      401,
      'UNAUTHENTICATED',
    )

    await expectApiError(
      await login(db, 'maria@example.com', DEMO_PASSWORD),
      401,
      'INVALID_CREDENTIALS',
    )
    expect((await login(db, 'maria@example.com', 'a-brand-new-password')).status).toBe(
      200,
    )
  })

  it('rejects a wrong current password', async () => {
    const cookie = sessionCookie(await login(db, 'maria@example.com'))

    const response = await request(db, '/api/auth/change-password', {
      body: {
        currentPassword: 'not-the-password',
        newPassword: 'a-brand-new-password',
      },
      cookie,
    })

    await expectApiError(response, 401, 'INVALID_CREDENTIALS')
  })

  it('rejects reusing the current password and weak new passwords', async () => {
    const cookie = sessionCookie(await login(db, 'maria@example.com'))

    await expectApiError(
      await request(db, '/api/auth/change-password', {
        body: {
          currentPassword: DEMO_PASSWORD,
          newPassword: DEMO_PASSWORD,
        },
        cookie,
      }),
      422,
      'VALIDATION_ERROR',
    )

    await expectApiError(
      await request(db, '/api/auth/change-password', {
        body: {
          currentPassword: DEMO_PASSWORD,
          newPassword: 'short',
        },
        cookie,
      }),
      422,
      'VALIDATION_ERROR',
    )
  })

  it('revokes the session when a temporary password expires first', async () => {
    db.raw
      .prepare(
        `UPDATE users
            SET must_change_password = 1, temporary_password_expires_at = ?
          WHERE email = ?`,
      )
      .run(unixSeconds() + 3600, 'ana@slotly.studio')

    const cookie = sessionCookie(await login(db, 'ana@slotly.studio'))
    const tokenHash = await sha256Hex(sessionToken(cookie))

    db.raw
      .prepare('UPDATE users SET temporary_password_expires_at = ? WHERE email = ?')
      .run(unixSeconds() - 1, 'ana@slotly.studio')

    const response = await request(db, '/api/auth/change-password', {
      body: {
        currentPassword: DEMO_PASSWORD,
        newPassword: 'a-brand-new-password',
      },
      cookie,
    })

    await expectApiError(response, 401, 'UNAUTHENTICATED')
    expect(sessionRow(db, tokenHash)?.revoked_at).toEqual(expect.any(Number))
    expect(setCookieHeader(response)).toContain('Max-Age=0')
  })
})

describe('same-origin CSRF guard', () => {
  it('rejects mutating requests without a matching Origin', async () => {
    await expectApiError(
      await request(db, '/api/auth/login', {
        body: { email: 'maria@example.com', password: DEMO_PASSWORD },
        origin: null,
      }),
      403,
      'CSRF_REJECTED',
    )

    await expectApiError(
      await request(db, '/api/auth/login', {
        body: { email: 'maria@example.com', password: DEMO_PASSWORD },
        origin: 'https://attacker.example',
      }),
      403,
      'CSRF_REJECTED',
    )
  })

  it('does not require an Origin for safe reads', async () => {
    const response = await request(db, '/api/public/business', {
      origin: null,
    })

    expect(response.status).toBe(200)
  })
})

describe('role middleware', () => {
  // Build a full app so middleware errors use the production error envelope.
  const roleApp = createApp()
  const roleRoutes = new Hono<AppEnv>()
  roleRoutes.get(
    '/staff-only',
    requireAuth,
    requireRole('staff', 'admin'),
    (c) => c.json({ data: { userId: c.get('user').id } }),
  )
  roleApp.route('/test', roleRoutes)

  async function roleRequest(cookie?: string): Promise<Response> {
    return await roleApp.request(
      `${ORIGIN}/test/staff-only`,
      { headers: cookie ? { Cookie: cookie } : {} },
      { DB: db.d1, ENVIRONMENT: 'test' },
    )
  }

  it('requires authentication and enforces the allowed roles', async () => {
    await expectApiError(await roleRequest(), 401, 'UNAUTHENTICATED')

    const customerCookie = sessionCookie(await login(db, 'maria@example.com'))
    await expectApiError(
      await roleRequest(customerCookie),
      403,
      'FORBIDDEN',
    )

    const staffCookie = sessionCookie(await login(db, 'ana@slotly.studio'))
    const staffResponse = await roleRequest(staffCookie)
    expect(staffResponse.status).toBe(200)
    expect(await staffResponse.json()).toEqual({ data: { userId: 'usr_ana' } })

    const adminCookie = sessionCookie(await login(db, 'admin@slotly.studio'))
    const adminResponse = await roleRequest(adminCookie)
    expect(adminResponse.status).toBe(200)
    expect(await adminResponse.json()).toEqual({
      data: { userId: 'usr_admin' },
    })
  })

  it('blocks roles until a temporary password is changed', async () => {
    db.raw
      .prepare(
        `UPDATE users
            SET must_change_password = 1, temporary_password_expires_at = ?
          WHERE email = ?`,
      )
      .run(unixSeconds() + 3600, 'ana@slotly.studio')

    const cookie = sessionCookie(await login(db, 'ana@slotly.studio'))

    await expectApiError(
      await roleRequest(cookie),
      403,
      'PASSWORD_CHANGE_REQUIRED',
    )
  })
})
