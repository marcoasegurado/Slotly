import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { AuthUser, Business } from './api'
import {
  getPublicDataState,
  subscribePublicData,
  type PublicDataState,
} from './public-api'
import { useSessionState } from './session'

/** Business settings and active services, loaded once at startup. */
export function usePublicData(): PublicDataState {
  return useSyncExternalStore(
    subscribePublicData,
    getPublicDataState,
    getPublicDataState,
  )
}

/**
 * The business settings. `App` blocks rendering until they are loaded, so any
 * page rendered below it can rely on this being present.
 */
export function useBusiness(): Business {
  const data = usePublicData()
  if (!data.business) {
    throw new Error('Business settings were used before they finished loading.')
  }
  return data.business
}

/** The signed-in user, or null. Never a demo account. */
export function useSession(): AuthUser | null {
  return useSessionState().user
}

export function useSessionLoading(): boolean {
  return useSessionState().status === 'loading'
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
