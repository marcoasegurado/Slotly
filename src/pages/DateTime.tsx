import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  findNextAvailableDates,
  getDayAvailability,
} from '../lib/availability'
import {
  addDaysToDateKey,
  addMonths,
  daysInMonth,
  firstOfMonthDateKey,
  formatDateKey,
  formatDuration,
  formatTime,
  minutesOfDay,
  parseDateKey,
  todayDateKey,
} from '../lib/time'
import { useDocumentTitle, useMockDb } from '../lib/hooks'
import type { DayAvailabilityState, Slot } from '../mock/types'
import { Calendar } from '../components/Calendar'
import { Stepper } from '../components/Stepper'
import { Button, buttonClassName } from '../components/Button'
import { Card, CardHeader } from '../components/Card'

const PERIODS = [
  { key: 'morning', label: 'Morning', from: 0, to: 12 * 60 },
  { key: 'afternoon', label: 'Afternoon', from: 12 * 60, to: 17 * 60 },
  { key: 'evening', label: 'Evening', from: 17 * 60, to: 24 * 60 },
] as const

export function DateTimePage() {
  const { serviceId = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const db = useMockDb()

  const service = db.services.find((entry) => entry.id === serviceId && entry.isActive) ?? null

  useDocumentTitle(service ? `${service.name} — choose a time` : 'Choose a time')

  const todayKey = todayDateKey(db.business.timezone)
  const requestedDateKey = searchParams.get('date')
  const selectedDateKey = requestedDateKey ?? todayKey

  const [monthStart, setMonthStart] = useState(() => firstOfMonthDateKey(selectedDateKey))
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null)

  const now = useMemo(() => new Date(), [db, selectedDateKey])

  const context = useMemo(
    () => ({ business: db.business, staff: db.staff, appointments: db.appointments }),
    [db],
  )

  const dayAvailability = useMemo(
    () => (service ? getDayAvailability(context, service, selectedDateKey, now) : null),
    [context, service, selectedDateKey, now],
  )

  const dayStates = useMemo(() => {
    const states = new Map<string, DayAvailabilityState>()
    if (!service) return states
    const { year, month } = parseDateKey(monthStart)
    const total = daysInMonth(year, month)
    for (let index = 0; index < total; index += 1) {
      const dateKey = addDaysToDateKey(monthStart, index)
      states.set(dateKey, getDayAvailability(context, service, dateKey, now).state)
    }
    return states
  }, [context, service, monthStart, now])

  const nextDates = useMemo(
    () => (service ? findNextAvailableDates(context, service, selectedDateKey, 4, now) : []),
    [context, service, selectedDateKey, now],
  )

  // Open on the first date that can actually be booked, so the page never
  // greets a visitor with an empty state on a fully booked day.
  const didAutoAdvance = useRef(false)
  useEffect(() => {
    if (!service || didAutoAdvance.current) return
    if (requestedDateKey) {
      didAutoAdvance.current = true
      return
    }
    if (dayAvailability && dayAvailability.state !== 'open' && nextDates.length > 0) {
      didAutoAdvance.current = true
      setSearchParams({ date: nextDates[0] }, { replace: true })
    } else if (dayAvailability && dayAvailability.state === 'open') {
      didAutoAdvance.current = true
    }
  }, [dayAvailability, nextDates, requestedDateKey, service, setSearchParams])

  useEffect(() => {
    setSelectedSlot(null)
  }, [selectedDateKey])

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
  const lastBookableDateKey = addDaysToDateKey(todayKey, db.business.maxAdvanceBookingDays)
  const firstOfLastMonth = firstOfMonthDateKey(lastBookableDateKey)
  const canGoPrevious = monthStart > firstOfThisMonth
  const canGoNext = monthStart < firstOfLastMonth

  const goToDate = (dateKey: string) => {
    setMonthStart(firstOfMonthDateKey(dateKey))
    setSearchParams({ date: dateKey })
  }

  const slots = dayAvailability?.slots ?? []
  const selectedDateLabel = formatDateKey(selectedDateKey)

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

            {dayAvailability && dayAvailability.state === 'open' ? (
              <div id="slot-groups" className="stack stack--loose">
                {PERIODS.map((period) => {
                  const periodSlots = slots.filter((slot) => {
                    const minute = minutesOfDay(new Date(slot.startAt), db.business.timezone)
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
                              {formatTime(slot.startAt, db.business.timezone)}
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
                    {dayAvailability?.state === 'closed' ? '–' : '0'}
                  </span>
                  <div className="stack stack--tight">
                    <p className="state__title">
                      {dayAvailability?.state === 'closed'
                        ? 'Closed on this day'
                        : dayAvailability?.state === 'outside-booking-window'
                          ? 'Too far ahead to book'
                          : 'No times left on this date'}
                    </p>
                    <p className="secondary text-sm">
                      {dayAvailability?.state === 'closed'
                        ? 'Nobody is scheduled to work on this weekday. Pick another date.'
                        : dayAvailability?.state === 'outside-booking-window'
                          ? `Bookings open ${db.business.maxAdvanceBookingDays} days ahead. Choose a nearer date.`
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
                    There are no bookable dates in the current window.
                    {db.business.businessEmail
                      ? ` Contact the business at ${db.business.businessEmail}.`
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
                    ? formatTime(selectedSlot.startAt, db.business.timezone)
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
                    `/book/${service.id}/details?start=${encodeURIComponent(selectedSlot.startAt)}`,
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
