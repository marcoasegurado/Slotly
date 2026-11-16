const MS_PER_MINUTE = 60_000
const MINUTES_PER_DAY = 1440

export function unixSeconds(now: number = Date.now()): number {
  return Math.floor(now / 1000)
}

export interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  /** 0 = Sunday … 6 = Saturday, matching the database weekday encoding. */
  weekday: number
}

const formatterCache = new Map<string, Intl.DateTimeFormat>()

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone)
  if (cached) return cached

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  formatterCache.set(timeZone, formatter)
  return formatter
}

export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = partsFormatter(timeZone).formatToParts(instant)
  const values: Record<string, number> = {}
  for (const part of parts) {
    if (part.type !== 'literal') {
      values[part.type] = Number(part.value)
    }
  }

  const year = values.year
  const month = values.month
  const day = values.day
  const hour = values.hour % 24

  return {
    year,
    month,
    day,
    hour,
    minute: values.minute,
    second: values.second,
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  }
}

/** Offset of `timeZone` from UTC at the given instant, in milliseconds. */
function offsetMs(instant: Date, timeZone: string): number {
  const parts = zonedParts(instant, timeZone)
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  )
  const truncated = Math.floor(instant.getTime() / 1000) * 1000
  return asUtc - truncated
}

/**
 * Convert a business-local wall clock time into a UTC instant. The offset is
 * re-checked once so DST transitions do not shift the intended local time.
 */
export function zonedTimeToUtc(
  dateKey: string,
  minutesFromMidnight: number,
  timeZone: string,
): Date {
  const [year, month, day] = dateKey.split('-').map(Number)
  const naive = Date.UTC(year, month - 1, day) + minutesFromMidnight * MS_PER_MINUTE

  const firstOffset = offsetMs(new Date(naive), timeZone)
  let guess = naive - firstOffset
  const secondOffset = offsetMs(new Date(guess), timeZone)
  if (secondOffset !== firstOffset) {
    guess = naive - secondOffset
  }
  return new Date(guess)
}

export function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

/** `YYYY-MM-DD` for the business-local date of an instant. */
export function toDateKey(instant: Date, timeZone: string): string {
  const parts = zonedParts(instant, timeZone)
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`
}

export function todayDateKey(timeZone: string, now: Date = new Date()): string {
  return toDateKey(now, timeZone)
}

export function minutesOfDay(instant: Date, timeZone: string): number {
  const parts = zonedParts(instant, timeZone)
  return parts.hour * 60 + parts.minute
}

export function weekdayOfDateKey(dateKey: string): number {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

export function addDaysToDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  const next = new Date(Date.UTC(year, month - 1, day + days))
  return `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}`
}

export function daysBetweenDateKeys(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  const a = Date.UTC(fy, fm - 1, fd)
  const b = Date.UTC(ty, tm - 1, td)
  return Math.round((b - a) / (MINUTES_PER_DAY * MS_PER_MINUTE))
}

/** Strict `YYYY-MM-DD` calendar date validation. */
export function isValidDateKey(dateKey: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey)
  if (!match) return false

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

/** Unix-second range [start, end) covering one business-local date. */
export function dateKeyUnixRange(
  dateKey: string,
  timeZone: string,
): { start: number; end: number } {
  const start = zonedTimeToUtc(dateKey, 0, timeZone)
  const end = zonedTimeToUtc(addDaysToDateKey(dateKey, 1), 0, timeZone)
  return {
    start: unixSeconds(start.getTime()),
    end: unixSeconds(end.getTime()),
  }
}
