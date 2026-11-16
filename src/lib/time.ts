/**
 * Timezone-safe helpers.
 *
 * All appointment instants are stored as UTC ISO strings. Business wall-clock
 * values (working hours, date selection) are expressed in the configured IANA
 * timezone and converted here. Nothing in the UI assumes the browser timezone
 * matches the business timezone.
 */

const MS_PER_MINUTE = 60_000
const MINUTES_PER_DAY = 1440

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

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
 * Convert a business-local wall clock time into a UTC instant.
 * Handles the DST ambiguity by re-checking the offset once.
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

export function firstOfMonthDateKey(dateKey: string): string {
  const [year, month] = dateKey.split('-').map(Number)
  return `${year}-${pad2(month)}-01`
}

/** Moves a month-start date key by whole months. */
export function addMonths(monthStart: string, months: number): string {
  const { year, month } = parseDateKey(monthStart)
  const index = year * 12 + (month - 1) + months
  const nextYear = Math.floor(index / 12)
  const nextMonth = ((index % 12) + 12) % 12 + 1
  return `${nextYear}-${pad2(nextMonth)}-01`
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function parseDateKey(dateKey: string): {
  year: number
  month: number
  day: number
} {
  const [year, month, day] = dateKey.split('-').map(Number)
  return { year, month, day }
}

/* ---------------- Formatting ---------------- */

const timeFormatters = new Map<string, Intl.DateTimeFormat>()

function timeFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = timeFormatters.get(timeZone)
  if (cached) return cached

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
  timeFormatters.set(timeZone, formatter)
  return formatter
}

export function formatTime(instantIso: string, timeZone: string): string {
  return timeFormatter(timeZone).format(new Date(instantIso))
}

export function formatTimeRange(
  startIso: string,
  endIso: string,
  timeZone: string,
): string {
  return `${formatTime(startIso, timeZone)} – ${formatTime(endIso, timeZone)}`
}

/** Long label for a business-local date key, e.g. "Tue, 18 November 2026". */
export function formatDateKey(dateKey: string, withWeekday = true): string {
  const { year, month, day } = parseDateKey(dateKey)
  const weekday = WEEKDAY_SHORT[weekdayOfDateKey(dateKey)]
  const base = `${day} ${MONTH_NAMES[month - 1]} ${year}`
  return withWeekday ? `${weekday}, ${base}` : base
}

/** Short label used in compact rows, e.g. "18 Nov". */
export function formatDateKeyShort(dateKey: string): string {
  const { month, day } = parseDateKey(dateKey)
  return `${day} ${MONTH_NAMES[month - 1].slice(0, 3)}`
}

export function formatMonthLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1]} ${year}`
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  const hourPart = hours === 1 ? '1 hr' : `${hours} hrs`
  if (remainder === 0) return hourPart
  return `${hourPart} ${remainder} min`
}

export function weekdayLabel(weekday: number): string {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
    weekday
  ]
}

/** `HH:mm`-style label from minutes since midnight, e.g. 9:00 AM. */
export function formatMinutesOfDay(minutes: number): string {
  const hour24 = Math.floor(minutes / 60)
  const minute = minutes % 60
  const suffix = hour24 >= 12 ? 'PM' : 'AM'
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12
  return `${hour12}:${pad2(minute)} ${suffix}`
}

/** Parses an `<input type="time">` value into minutes since midnight. */
export function parseTimeInput(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim())
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

/** Formats minutes since midnight for an `<input type="time">` value. */
export function minutesToTimeInput(minutes: number): string {
  const normalized = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  return `${pad2(Math.floor(normalized / 60))}:${pad2(normalized % 60)}`
}

export function isSameDateKey(a: string, b: string): boolean {
  return a === b
}
