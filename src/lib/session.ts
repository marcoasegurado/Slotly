/**
 * Client session state.
 *
 * The Worker owns the session: an opaque `HttpOnly` cookie backed by a hashed
 * token row in D1. This module keeps the last known user in memory so the UI
 * can render synchronously, and probes `/api/auth/me` once on load.
 *
 */
import { useSyncExternalStore } from 'react'
import {
  ApiError,
  changePassword,
  getSession,
  login,
  logout,
  register,
  type AuthUser,
} from './api'

export type SessionStatus = 'loading' | 'ready'

export interface SessionState {
  status: SessionStatus
  user: AuthUser | null
}

let state: SessionState = { status: 'loading', user: null }
let probe: Promise<void> | null = null
const listeners = new Set<() => void>()

function publish(next: SessionState): void {
  state = next
  for (const listener of listeners) listener()
}

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getSessionState(): SessionState {
  return state
}

/** Resolves once, at startup. Repeated calls share the same request. */
export function startSession(): Promise<void> {
  if (probe) return probe

  probe = getSession()
    .then((user) => {
      publish({ status: 'ready', user })
    })
    .catch(() => {
      // A failed probe means "signed out", not a broken app.
      publish({ status: 'ready', user: null })
    })

  return probe
}

export async function signIn(email: string, password: string): Promise<AuthUser> {
  const user = await login(email, password)
  publish({ status: 'ready', user })
  return user
}

export async function signUp(input: {
  name: string
  email: string
  password: string
}): Promise<AuthUser> {
  const user = await register(input)
  publish({ status: 'ready', user })
  return user
}

export async function signOut(): Promise<void> {
  try {
    await logout()
  } finally {
    publish({ status: 'ready', user: null })
  }
}

export async function updatePassword(input: {
  currentPassword: string
  newPassword: string
}): Promise<AuthUser> {
  const user = await changePassword(input)
  publish({ status: 'ready', user })
  return user
}

export function useSessionState(): SessionState {
  return useSyncExternalStore(subscribeSession, getSessionState, getSessionState)
}

/** Re-reads the session after a change made elsewhere (for example a reset). */
export async function refreshSession(): Promise<void> {
  try {
    const user = await getSession()
    publish({ status: 'ready', user })
  } catch (error) {
    if (error instanceof ApiError) {
      publish({ status: 'ready', user: null })
      return
    }
    throw error
  }
}
