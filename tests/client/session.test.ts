import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthUser } from '../../src/lib/api'
import { getSessionState, updatePassword } from '../../src/lib/session'

const UPDATED_USER: AuthUser = {
  id: 'usr_maria',
  name: 'Maria Santos',
  email: 'maria@example.com',
  role: 'customer',
  mustChangePassword: false,
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('client password change', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('refreshes the session after the 204 change-password response', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input)
      if (url.endsWith('/api/auth/change-password')) {
        return new Response(null, { status: 204 })
      }
      if (url.endsWith('/api/auth/me')) {
        return jsonResponse({ data: UPDATED_USER })
      }
      throw new Error(`unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const user = await updatePassword({
      currentPassword: 'old-password',
      newPassword: 'new-password',
    })

    expect(user).toEqual(UPDATED_USER)
    expect(getSessionState()).toEqual({ status: 'ready', user: UPDATED_USER })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/change-password',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('does not report a changed session when the change request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          { error: { code: 'INVALID_CREDENTIALS', message: 'Wrong password.' } },
          401,
        ),
      ),
    )

    await expect(
      updatePassword({ currentPassword: 'wrong', newPassword: 'new-password' }),
    ).rejects.toThrow('Wrong password.')
    expect(getSessionState().status).toBe('ready')
  })
})
