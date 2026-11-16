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

/**
 * Accepts an empty body, which is useful for action endpoints that take only
 * optional fields such as a rejection reason.
 */
export async function readOptionalJsonObject(
  c: Context,
): Promise<Record<string, unknown>> {
  const raw = await c.req.raw.text()
  if (raw.trim() === '') return {}

  let body: unknown
  try {
    body = JSON.parse(raw)
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

export function requiredInteger(
  body: Record<string, unknown>,
  field: string,
  label: string,
  min: number,
  max: number,
): number {
  const value = body[field]
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new ApiError(422, 'VALIDATION_ERROR', `Enter a valid ${label}.`)
  }
  return value as number
}

export function optionalInteger(
  body: Record<string, unknown>,
  field: string,
  label: string,
  min: number,
  max: number,
): number | undefined {
  if (body[field] === undefined) return undefined
  return requiredInteger(body, field, label, min, max)
}

export function optionalString(
  body: Record<string, unknown>,
  field: string,
  label: string,
  minLength: number,
  maxLength: number,
): string | undefined {
  if (body[field] === undefined) return undefined
  return requiredString(body, field, label, minLength, maxLength)
}

/** Returns `null` for an explicit null, `undefined` when the field is absent. */
export function optionalNullableString(
  body: Record<string, unknown>,
  field: string,
  label: string,
  maxLength: number,
): string | null | undefined {
  if (body[field] === undefined) return undefined
  if (body[field] === null) return null
  return requiredString(body, field, label, 0, maxLength)
}

export function optionalBoolean(
  body: Record<string, unknown>,
  field: string,
  label: string,
): boolean | undefined {
  if (body[field] === undefined) return undefined
  const value = body[field]
  if (typeof value !== 'boolean') {
    throw new ApiError(422, 'VALIDATION_ERROR', `Enter a valid ${label}.`)
  }
  return value
}

export function requiredArray(
  body: Record<string, unknown>,
  field: string,
  label: string,
): unknown[] {
  const value = body[field]
  if (!Array.isArray(value)) {
    throw new ApiError(422, 'VALIDATION_ERROR', `Enter a valid ${label}.`)
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
