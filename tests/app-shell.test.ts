import { describe, expect, it } from 'vitest'
import { app } from '../worker/app'
import { redactPath } from '../worker/lib/redact'
import { createTestDatabase } from './helpers/test-d1'

const ASSET_HTML = '<!doctype html><html><body>Guest cancellation</body></html>'

function assetsStub(calls: string[] = []) {
  return {
    fetch: async (input: RequestInfo | URL) => {
      calls.push(String(input instanceof Request ? input.url : input))
      return new Response(ASSET_HTML, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'public, max-age=0',
          'Referrer-Policy': 'strict-origin-when-cross-origin',
        },
      })
    },
  } as unknown as Fetcher
}

describe('guest cancellation page', () => {
  it('serves the SPA with strict no-referrer, no-store and noindex headers', async () => {
    const db = createTestDatabase({ seed: false })
    const calls: string[] = []
    const response = await app.request(
      'http://localhost/cancel/private-token-value',
      {},
      { DB: db.d1, ENVIRONMENT: 'test', ASSETS: assetsStub(calls) },
    )

    expect(response.status).toBe(200)
    expect(await response.text()).toBe(ASSET_HTML)
    expect(response.headers.get('content-type')).toContain('text/html')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(calls).toEqual(['http://localhost/cancel/private-token-value'])
  })

  it('keeps the token out of logged paths', () => {
    expect(redactPath('/cancel/private-token-value')).toBe('/cancel/[redacted]')
    expect(redactPath('/api/public/guest-cancellation')).toBe(
      '/api/public/guest-cancellation',
    )
  })

  it('does not serve the shell for non-GET cancellation requests', async () => {
    const db = createTestDatabase({ seed: false })
    const calls: string[] = []
    const response = await app.request(
      'http://localhost/cancel/private-token-value',
      { method: 'POST', headers: { Origin: 'http://localhost' } },
      { DB: db.d1, ENVIRONMENT: 'test', ASSETS: assetsStub(calls) },
    )

    expect(response.status).toBe(404)
    expect(calls).toEqual([])
  })
})
