import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  getAvailability,
  getMonthAvailability,
  listServices,
  type AvailabilitySlot,
  type AvailabilityState,
  type DayAvailability,
  type Service,
} from '../lib/api'
import { useAsync, useDocumentTitle, useBusiness } from '../lib/hooks'
import {
  addDaysToDateKey,
  addMonths,
  firstOfMonthDateKey,
  formatDateKey,
  formatDuration,
  formatTime,
  minutesOfDay,
  todayDateKey,
} from '../lib/time'
import { Calendar } from '../components/Calendar'
import { Stepper } from '../components/Stepper'
import { Button, buttonClassName } from '../components/Button'
import { Card, CardHeader } from '../components/Card'
import { StateBlock } from '../components/StateBlock'

const PERIODS = [
  { key: 'morning', label: 'Morning', from: 0, to: 12 * 60 },
  { key: 'afternoon', label: 'Afternoon', from: 12 * 60, to: 17 * 60 },
  { key: 'evening', label: 'Evening', from: 17 * 60, to: 24 * 60 },
] as const

function isoOf(seconds: number): string {
  return new Date(seconds * 1000).toISOString()
}

const MAX_AUTO_ADVANCE_MONTHS = 3

export function DateTimePage() {
  const { serviceId = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const business = useBusiness()
  const timezone = business.timezone

  const todayKey = todayDateKey(timezone)
  const requestedDateKey = searchParams.get('date')
  const selectedDateKey = requestedDateKey ?? todayKey

  const [monthStart, setMonthStart] = useState(() =>
    firstOfMonthDateKey(selectedDateKey),
  )
  const [selectedSlot, setSelectedSlot] = useState<AvailabilitySlot | null>(null)

  const services = useAsync(() => listServices(), [])
  const service: Service | null =
    (services.data ?? []).find((entry) => entry.id === serviceId && entry.isActive) ??
    null

  useDocumentTitle(service ? `${service.name} — choose a time` : 'Choose a time')

  const monthKey = monthStart.slice(0, 7)
  const month = useAsync(
    () => getMonthAvailability(serviceId, monthKey),
    [serviceId, monthKey],
  )
  const day = useAsync(
    () => getAvailability(serviceId, selectedDateKey),
    [serviceId, selectedDateKey],
  )

  const dayStates = useMemo(() => {
    const states = new Map<string, AvailabilityState>()
    for (const entry of month.data?.days ?? []) {
      states.set(entry.dateKey, entry.state)
    }
    return states
  }, [month.data])

  const nextDates = useMemo(() => {
    return (month.data?.days ?? [])
      .filter((entry) => entry.dateKey > selectedDateKey && entry.state === 'open')
      .slice(0, 4)
      .map((entry) => entry.dateKey)
  }, [month.data, selectedDateKey])

  // Open on the first bookable date instead of an empty "today" when the
  // business is closed today or the day is full.
  const autoAdvance = useRef({ done: false, months: 0 })
  useEffect(() => {
    if (autoAdvance.current.done || requestedDateKey) {
      autoAdvance.current.done = true
      return
    }
    const days = month.data?.days
    if (!days) return

    const open = days.find(
      (entry) => entry.dateKey >= todayKey && entry.state === 'open',
    )
    if (open) {
      autoAdvance.current.done = true
      if (open.dateKey !== selectedDateKey) {
        setSearchParams({ date: open.dateKey }, { replace: true })
      }
      return
    }

    if (autoAdvance.current.months < MAX_AUTO_ADVANCE_MONTHS) {
      autoAdvance.current.months += 1
      setMonthStart((current) => addMonths(current, 1))
    } else {
      autoAdvance.current.done = true
    }
  }, [month.data, requestedDateKey, selectedDateKey, setSearchParams, todayKey])

  useEffect(() => {
    setSelectedSlot(null)
  }, [selectedDateKey])

  if (services.loading && !services.data) {
    return (
      <div className="container main--narrow">
        <p className="meta">Loading times…</p>
      </div>
    )
  }

  if (services.error) {
    return (
      <div className="container main--narrow">
        <Card>
          <StateBlock
            icon="!"
            title="We could not load this service"
            actions={
              <Button variant="secondary" size="sm" onClick={services.reload}>
                Try again
              </Button>
            }
          >
            {services.error.message}
          </StateBlock>
        </Card>
      </div>
    )
  }

  if (!service) {
    return (
      <div className="container main--narrow">
        <Card>
          <div className="stack">
            <h1 style={{ fontSize: '1.5rem' }}>That service is not available</h1>
            <p className="secondary">
              It may have been removed or temporarily deactivated. Choose
              another service to continue.
            </p>
            <div>
              <Link className={buttonClassName('primary')} to="/book">
                Back to services
              </Link>
            </div>
          </div>
        </Card>
      </div>
    )
  }

  const firstOfThisMonth = firstOfMonthDateKey(todayKey)
  const lastBookableDateKey = addDaysToDateKey(
    todayKey,
    business.maxAdvanceBookingDays,
  )
  const firstOfLastMonth = firstOfMonthDateKey(lastBookableDateKey)
  const canGoPrevious = monthStart > firstOfThisMonth
  const canGoNext = monthStart < firstOfLastMonth

  const goToDate = (dateKey: string) => {
    setMonthStart(firstOfMonthDateKey(dateKey))
    setSearchParams({ date: dateKey })
  }

  const availability: DayAvailability | null = day.data
  const slots = availability?.slots ?? []
  const selectedDateLabel = formatDateKey(selectedDateKey)
  const dayError = day.error

  return (
    <div className="container">
      <Stepper steps={['Service', 'Time', 'Details']} current={1} />

      <div className="grid-2">
        <div className="stack stack--loose">
          <div className="stack stack--tight">
            <span className="eyebrow">Step 2 · {service.name}</span>
            <h1>Pick a date and time</h1>
            <p className="lede">
              Available times reflect the team's working hours and confirmed
              bookings. Pending requests do not hold a slot.
            </p>
          </div>

          <Calendar
            monthStart={monthStart}
            selectedDateKey={selectedDateKey}
            todayKey={todayKey}
            getDayState={(dateKey) => dayStates.get(dateKey) ?? 'closed'}
            onChangeMonth={(offset) => setMonthStart((current) => addMonths(current, offset))}
            onSelect={goToDate}
            canGoPrevious={canGoPrevious}
            canGoNext={canGoNext}
          />

          <Card>
            <CardHeader
              title={`Times on ${selectedDateLabel}`}
              action={
                <span className="meta">
                  {slots.length} {slots.length === 1 ? 'slot' : 'slots'}
                </span>
              }
            />

            {day.loading && !availability ? (
              <p className="meta">Checking that date…</p>
            ) : dayError ? (
              <StateBlock
                icon="!"
                title="We could not load those times"
                actions={
                  <Button variant="secondary" size="sm" onClick={day.reload}>
                    Try again
                  </Button>
                }
              >
                {dayError.message}
              </StateBlock>
            ) : availability && availability.state === 'open' ? (
              <div id="slot-groups" className="stack stack--loose">
                {PERIODS.map((period) => {
                  const periodSlots = slots.filter((slot) => {
                    const minute = minutesOfDay(new Date(isoOf(slot.startAt)), timezone)
                    return minute >= period.from && minute < period.to
                  })
                  if (periodSlots.length === 0) return null
                  return (
                    <div key={period.key} className="stack stack--tight">
                      <span className="eyebrow">{period.label}</span>
                      <div className="slot-grid" role="group" aria-label={period.label}>
                        {periodSlots.map((slot) => {
                          const isSelected = selectedSlot?.startAt === slot.startAt
                          return (
                            <button
                              key={slot.startAt}
                              type="button"
                              className="slot"
                              aria-pressed={isSelected}
                              onClick={() => setSelectedSlot(slot)}
                            >
                              {formatTime(isoOf(slot.startAt), timezone)}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="stack">
                <div className="state">
                  <span className="state__icon" aria-hidden="true">
                    {availability?.state === 'closed' ? '–' : '0'}
                  </span>
                  <div className="stack stack--tight">
                    <p className="state__title">
                      {availability?.state === 'closed'
                        ? 'Closed on this day'
                        : availability?.state === 'outside-booking-window'
                          ? 'Too far ahead to book'
                          : 'No times left on this date'}
                    </p>
                    <p className="secondary text-sm">
                      {availability?.state === 'closed'
                        ? 'Nobody is scheduled to work on this weekday. Pick another date.'
                        : availability?.state === 'outside-booking-window'
                          ? `Bookings open ${business.maxAdvanceBookingDays} days ahead. Choose a nearer date.`
                          : 'Every remaining time is either taken or already in the past. The nearest alternatives are below.'}
                    </p>
                  </div>
                </div>

                {nextDates.length > 0 ? (
                  <div className="stack stack--tight">
                    <span className="eyebrow">Next available</span>
                    <div className="row row--wrap">
                      {nextDates.map((dateKey) => (
                        <button
                          key={dateKey}
                          type="button"
                          className="btn btn--secondary btn--sm"
                          onClick={() => goToDate(dateKey)}
                        >
                          {formatDateKey(dateKey)}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm secondary">
                    There are no bookable dates in this month.
                    {business.businessEmail
                      ? ` Contact the business at ${business.businessEmail}.`
                      : ' Contact the business directly.'}
                  </p>
                )}
              </div>
            )}
          </Card>
        </div>

        <aside className="summary">
          <Card>
            <CardHeader title="Your selection" />
            <dl className="summary__list">
              <div className="summary__row">
                <dt>Service</dt>
                <dd>{service.name}</dd>
              </div>
              <div className="summary__row">
                <dt>Duration</dt>
                <dd className="mono">{formatDuration(service.durationMinutes)}</dd>
              </div>
              <div className="summary__row">
                <dt>Date</dt>
                <dd>{selectedDateLabel}</dd>
              </div>
              <div className="summary__row">
                <dt>Time</dt>
                <dd className="mono">
                  {selectedSlot
                    ? formatTime(isoOf(selectedSlot.startAt), timezone)
                    : 'Not chosen'}
                </dd>
              </div>
              <div className="summary__row">
                <dt>Staff</dt>
                <dd className="muted">Assigned by the business</dd>
              </div>
            </dl>

            <hr className="rule" />

            <div className="stack stack--tight" style={{ marginTop: 'var(--space-4)' }}>
              <Button
                block
                disabled={!selectedSlot}
                onClick={() => {
                  if (!selectedSlot) return
                  navigate(
                    `/book/${service.id}/details?start=${selectedSlot.startAt}`,
                  )
                }}
              >
                Continue to details
              </Button>
              <Link className={buttonClassName('ghost', 'btn--block')} to="/book">
                Change service
              </Link>
              <p className="meta" style={{ textAlign: 'center' }}>
                No payment is taken online.
              </p>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  )
}
