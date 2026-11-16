import type { Context } from 'hono'
import { consumeRateLimit } from '../auth/rate-limit'
import type { AppEnv } from '../env'
import { ApiError } from './errors'

/** Best available client address behind Cloudflare or a local proxy. */
export function clientIp(c: Context<AppEnv>): string {
  const cloudflareIp = c.req.header('CF-Connecting-IP')
  if (cloudflareIp) return cloudflareIp

  const forwarded = c.req.header('X-Forwarded-For')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }

  return 'local'
}

/**
 * Applies a per-isolate rate limit and sets `Retry-After` when it rejects.
 * Durable cross-isolate limiting remains deployment hardening work.
 */
export function enforceRateLimit(
  c: Context<AppEnv>,
  key: string,
  limit: number,
  windowMs: number,
): void {
  const result = consumeRateLimit(key, limit, windowMs)
  if (result.allowed) return

  c.header('Retry-After', String(result.retryAfterSeconds))
  throw new ApiError(
    429,
    'RATE_LIMITED',
    'Too many attempts. Try again later.',
    { retryAfterSeconds: result.retryAfterSeconds },
  )
}
