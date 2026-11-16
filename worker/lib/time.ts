export function unixSeconds(now: number = Date.now()): number {
  return Math.floor(now / 1000)
}
