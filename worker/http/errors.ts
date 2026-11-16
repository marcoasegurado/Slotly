import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

export interface ApiErrorBody {
  error: {
    code: string
    message: string
    details: Record<string, unknown>
  }
}

/** An expected API failure that is safe to return to the caller. */
export class ApiError extends Error {
  readonly status: ContentfulStatusCode
  readonly code: string
  readonly details: Record<string, unknown>

  constructor(
    status: ContentfulStatusCode,
    code: string,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

/**
 * Builds the single error shape described in API.md. Callers must pass only
 * safe, user-facing messages; SQL errors and stack traces never belong here.
 */
export function apiError(
  c: Context,
  status: ContentfulStatusCode,
  code: string,
  message: string,
  details: Record<string, unknown> = {},
) {
  const body: ApiErrorBody = { error: { code, message, details } }
  return c.json(body, status)
}
