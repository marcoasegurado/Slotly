import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchPublicBusiness,
  fetchPublicServices,
  getPublicDataState,
  hydratePublicData,
  PublicApiError,
} from '../src/lib/public-api'

const business = {
  businessName: 'Worker Studio',
  businessEmail: 'hello@worker.test',
  timezone: 'Asia/Manila',
  maxAdvanceBookingDays: 30,
}

const services = [
  {
    id: 'svc_worker',
    name: 'Worker service',
    description: null,
    durationMinutes: 30,
    isActive: true,
  },
]

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('public API client', () => {
  it('loads and validates business settings from the Worker envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ data: business })),
    )

    await expect(fetchPublicBusiness()).resolves.toEqual(business)
    expect(fetch).toHaveBeenCalledWith('/api/public/business', {
      headers: { Accept: 'application/json' },
    })
  })

  it('loads and validates active services from the Worker envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ data: services })),
    )

    await expect(fetchPublicServices()).resolves.toEqual(services)
  })

  it('surfaces the Worker error code and message safely', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: {
              code: 'BUSINESS_NOT_CONFIGURED',
              message: 'Business settings have not been configured.',
              details: {},
            },
          },
          404,
        ),
      ),
    )

    await expect(fetchPublicBusiness()).rejects.toMatchObject({
      name: 'PublicApiError',
      status: 404,
      code: 'BUSINESS_NOT_CONFIGURED',
      message: 'Business settings have not been configured.',
    } satisfies Partial<PublicApiError>)
  })

  it('rejects malformed success payloads instead of applying them', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ data: { businessName: 7 } })),
    )

    await expect(fetchPublicBusiness()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    })
  })

  it('publishes the loaded settings to the UI store', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: business }))
      .mockResolvedValueOnce(jsonResponse({ data: services }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(hydratePublicData()).resolves.toEqual({
      business: true,
      services: true,
    })

    const state = getPublicDataState()
    expect(state.status).toBe('ready')
    expect(state.business).toEqual(business)
    expect(state.services).toEqual(services)
    expect(state.error).toBeNull()
  })

  it('reports a failure instead of showing sample data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    await expect(hydratePublicData()).resolves.toEqual({
      business: false,
      services: false,
    })

    const state = getPublicDataState()
    expect(state.status).toBe('error')
    expect(state.business).toBeNull()
    expect(state.services).toEqual([])
    expect(state.error).toBe('offline')
  })
})
