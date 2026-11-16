interface Bucket {
  count: number
  resetAt: number
}

export interface RateLimitResult {
  allowed: boolean
  retryAfterSeconds: number
}

const buckets = new Map<string, Bucket>()
const MAX_BUCKETS = 10_000

/**
 * Best-effort per-isolate limiter for authentication endpoints. It slows down
 * brute force within one Worker isolate; durable cross-isolate rate limiting
 * remains deployment hardening work.
 */
export function consumeRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  if (buckets.size >= MAX_BUCKETS) {
    for (const [bucketKey, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(bucketKey)
    }
    if (buckets.size >= MAX_BUCKETS) buckets.clear()
  }

  const bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, retryAfterSeconds: 0 }
  }

  if (bucket.count >= limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    }
  }

  bucket.count += 1
  return { allowed: true, retryAfterSeconds: 0 }
}

export function clearRateLimit(key: string): void {
  buckets.delete(key)
}

/** Test-only helper; not exposed through a route. */
export function resetRateLimits(): void {
  buckets.clear()
}
