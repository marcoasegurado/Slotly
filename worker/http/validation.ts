import type { Context } from 'hono'
import { ApiError } from './errors'

export async function readJsonObject(
  c: Context,
): Promise<Record<string, unknown>> {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Send a valid JSON body.')
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Send a JSON object.')
  }
  return body as Record<string, unknown>
}

export function requiredString(
  body: Record<string, unknown>,
  field: string,
  label: string,
  minLength: number,
  maxLength: number,
): string {
  const value = body[field]
  if (typeof value !== 'string') {
    throw new ApiError(422, 'VALIDATION_ERROR', `Enter ${label}.`)
  }

  const trimmed = value.trim()
  if (trimmed.length < minLength || trimmed.length > maxLength) {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      `Enter a valid ${label}.`,
    )
  }
  return trimmed
}

/** For passwords and other values where surrounding spaces are meaningful. */
export function requiredRawString(
  body: Record<string, unknown>,
  field: string,
  label: string,
  minLength: number,
  maxLength: number,
): string {
  const value = body[field]
  if (
    typeof value !== 'string' ||
    value.length < minLength ||
    value.length > maxLength
  ) {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      `Enter a valid ${label}.`,
    )
  }
  return value
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function isValidEmail(email: string): boolean {
  return (
    email.length >= 3 &&
    email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  )
}
