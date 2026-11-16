import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { getDb, subscribe } from '../mock/store'
import type { MockDatabase } from '../mock/seed'
import type { SessionUser } from '../mock/api'
import type { StaffMember } from '../mock/types'

export function useMockDb(): MockDatabase {
  return useSyncExternalStore(subscribe, getDb, getDb)
}

export function useSession(): SessionUser | null {
  const db = useMockDb()
  if (!db.session) return null

  if (db.session.role === 'customer') {
    const customer = db.customers.find((entry) => entry.id === db.session?.id)
    if (!customer) return null
    return {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      role: 'customer',
    }
  }

  const staff = db.staff.find((entry) => entry.id === db.session?.id)
  if (!staff || !staff.isActive) return null
  return {
    id: staff.id,
    name: staff.name,
    email: staff.email,
    role: db.session.role,
  }
}

export function useStaff(): StaffMember | null {
  const db = useMockDb()
  const session = useSession()
  if (!session || session.role !== 'staff') return null
  return db.staff.find((entry) => entry.id === session.id) ?? null
}

export interface AsyncState<T> {
  data: T | null
  error: Error | null
  loading: boolean
  reload: () => void
}

/**
 * Small async loader. Keeps the previous value visible while refetching so
 * the layout does not jump between steps.
 */
export function useAsync<T>(
  loader: () => Promise<T>,
  deps: readonly unknown[],
): AsyncState<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [loading, setLoading] = useState(true)
  const [version, setVersion] = useState(0)

  const reload = useCallback(() => {
    setVersion((current) => current + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    loader()
      .then((value) => {
        if (cancelled) return
        setData(value)
        setError(null)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setError(cause instanceof Error ? cause : new Error('Something went wrong.'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version])

  return { data, error, loading, reload }
}

export function useDocumentTitle(title: string): void {
  useEffect(() => {
    const previous = document.title
    document.title = `${title} — Slotly`
    return () => {
      document.title = previous
    }
  }, [title])
}

export function errorMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message) return cause.message
  return 'Something went wrong. Please try again.'
}
