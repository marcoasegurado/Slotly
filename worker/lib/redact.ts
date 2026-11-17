/**
 * Removes guest cancellation tokens from paths before they reach logs.
 * The raw token must never be retained in request/access logs.
 */
export function redactPath(path: string): string {
  return path.replace(/^\/cancel\/[^/]+/, '/cancel/[redacted]')
}
