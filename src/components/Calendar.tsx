import {
  addDaysToDateKey,
  daysInMonth,
  formatDateKey,
  formatDateKeyShort,
  formatMonthLabel,
  parseDateKey,
  weekdayOfDateKey,
} from '../lib/time'
import type { DayAvailabilityState } from '../mock/types'

const WEEKDAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const STATE_NOTE: Record<DayAvailabilityState, string> = {
  open: 'available',
  closed: 'closed',
  full: 'fully booked',
  past: 'past date',
  'outside-booking-window': 'outside the booking window',
}

interface CalendarProps {
  /** First day of the displayed month, as a business-local date key. */
  monthStart: string
  selectedDateKey: string
  todayKey: string
  getDayState: (dateKey: string) => DayAvailabilityState
  onChangeMonth: (offset: number) => void
  onSelect: (dateKey: string) => void
  canGoPrevious: boolean
  canGoNext: boolean
}

export function Calendar({
  monthStart,
  selectedDateKey,
  todayKey,
  getDayState,
  onChangeMonth,
  onSelect,
  canGoPrevious,
  canGoNext,
}: CalendarProps) {
  const { year, month } = parseDateKey(monthStart)
  const totalDays = daysInMonth(year, month)
  const leadingBlanks = weekdayOfDateKey(monthStart)

  const cells: Array<string | null> = Array.from({ length: leadingBlanks }, () => null)
  for (let day = 0; day < totalDays; day += 1) {
    cells.push(addDaysToDateKey(monthStart, day))
  }

  return (
    <div className="calendar">
      <div className="calendar__head">
        <div>
          <div className="calendar__month">{formatMonthLabel(year, month)}</div>
          <div className="meta" style={{ marginTop: 2 }}>
            Times shown in business time
          </div>
        </div>
        <div className="calendar__nav">
          <button
            type="button"
            className="icon-btn"
            onClick={() => onChangeMonth(-1)}
            disabled={!canGoPrevious}
            aria-label="Previous month"
          >
            ‹
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => onChangeMonth(1)}
            disabled={!canGoNext}
            aria-label="Next month"
          >
            ›
          </button>
        </div>
      </div>

      <div className="calendar__grid" role="group" aria-label="Choose a date">
        {WEEKDAY_HEADERS.map((label) => (
          <span key={label} className="calendar__weekday" aria-hidden="true">
            {label}
          </span>
        ))}

        {cells.map((dateKey, index) => {
          if (!dateKey) {
            return <span key={`blank-${index}`} aria-hidden="true" />
          }

          const state = getDayState(dateKey)
          const disabled = state !== 'open'
          const isSelected = dateKey === selectedDateKey
          const isToday = dateKey === todayKey

          return (
            <button
              key={dateKey}
              type="button"
              className={`day${isToday ? ' day--today' : ''}${state === 'closed' ? ' day--closed' : ''}`}
              aria-pressed={isSelected}
              disabled={disabled}
              onClick={() => onSelect(dateKey)}
              aria-label={`${formatDateKey(dateKey)} — ${STATE_NOTE[state]}`}
              title={STATE_NOTE[state]}
            >
              {parseDateKey(dateKey).day}
            </button>
          )
        })}
      </div>

      <p className="meta" style={{ marginTop: 'var(--space-3)' }}>
        Selected {formatDateKeyShort(selectedDateKey)}. Unavailable dates are
        disabled, not hidden.
      </p>
    </div>
  )
}
