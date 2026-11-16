import { afterEach, describe, expect, it, vi } from 'vitest'
import type { D1Database } from '@cloudflare/workers-types'
import { app } from '../worker/app'
import { createTestDatabase } from './helpers/test-d1'

function request(path: string, db: D1Database, environment = 'test') {
  return app.request(
    path,
    {},
    {
      DB: db,
      ENVIRONMENT: environment,
    },
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('/api/health', () => {
  it('reports a working database binding', async () => {
    const database = createTestDatabase()

    const response = await request('/api/health', database.d1)

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')

    const body = (await response.json()) as {
      data: { status: string; service: string; environment: string; timestamp: number }
    }
    expect(body.data.status).toBe('ok')
    expect(body.data.service).toBe('slotly-api')
    expect(body.data.environment).toBe('test')
    expect(Number.isInteger(body.data.timestamp)).toBe(true)
  })

  it('returns a safe 503 when the database cannot be reached', async () => {
    const brokenDb = {
      prepare() {
        throw new Error('SQLITE_ERROR: no such table: business_settings')
      },
    } as unknown as D1Database

    const response = await request('/api/health', brokenDb)

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: {
        code: 'DATABASE_UNAVAILABLE',
        message: 'The database is unavailable.',
        details: {},
      },
    })
  })
})

describe('public read routes', () => {
  it('returns public business settings without secrets', async () => {
    const database = createTestDatabase()

    const response = await request('/api/public/business', database.d1)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: {
        businessName: 'Slotly Studio',
        businessEmail: 'hello@slotly.studio',
        timezone: 'Asia/Manila',
        maxAdvanceBookingDays: 60,
      },
    })
  })

  it('returns active services only', async () => {
    const database = createTestDatabase()

    const response = await request('/api/public/services', database.d1)

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: Array<{ id: string; isActive: boolean }>
    }
    expect(body.data.map((service) => service.id)).toEqual([
      'svc_extended',
      'svc_consult',
      'svc_standard',
    ])
    expect(body.data.every((service) => service.isActive)).toBe(true)
  })

  it('returns 404 when business settings are missing', async () => {
    const database = createTestDatabase({ seed: false })

    const response = await request('/api/public/business', database.d1)

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: {
        code: 'BUSINESS_NOT_CONFIGURED',
        message: 'Business settings have not been configured.',
        details: {},
      },
    })
  })
})

describe('error handling', () => {
  it('uses one error envelope for unknown routes', async () => {
    const database = createTestDatabase()

    const response = await request('/api/does-not-exist', database.d1)

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'The requested resource was not found.',
        details: {},
      },
    })
  })

  it('does not expose database error messages to clients', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const failingDb = {
      prepare() {
        throw new Error('SQLITE_ERROR: no such table: business_settings')
      },
    } as unknown as D1Database

    const response = await request('/api/public/business', failingDb)

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred.',
        details: {},
      },
    })
    expect(console.error).toHaveBeenCalledWith('Unhandled API error', {
      method: 'GET',
      path: '/api/public/business',
      name: 'Error',
    })
  })
})
