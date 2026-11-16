import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  getStaffAppointment,
  rescheduleStaffAppointment,
} from '../../mock/api'
import {
  findNextStaffAvailableDates,
  getStaffDayAvailability,
} from '../../lib/availability'
import {
  errorMessage,
  useAsync,
  useDocumentTitle,
  useMockDb,
  useSession,
} from '../../lib/hooks'
import {
  addDaysToDateKey,
  addMonths,
  daysInMonth,
  firstOfMonthDateKey,
  formatDateKey,
  formatDuration,
  formatTime,
  formatTimeRange,
  minutesOfDay,
  parseDateKey,
  todayDateKey,
  toDateKey,
} from '../../lib/time'
import type { DayAvailabilityState, Slot } from '../../mock/types'
import { Calendar } from '../../components/Calendar'
import { Button, buttonClassName } from '../../components/Button'
import { Card, CardHeader } from '../../components/Card'
import { StateBlock } from '../../components/StateBlock'

const PERIODS = [
  { key: 'morning', label: 'Morning', from: 0, to: 12 * 60 },
  { key: 'afternoon', label: 'Afternoon', from: 12 * 60, to: 17 * 60 },
  { key: 'evening', label: 'Evening', from: 17 * 60, to: 24 * 60 },
] as const

export function StaffReschedulePage() {
  useDocumentTitle('Reschedule appointment')
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const db = useMockDb()
  const session = useSession()
  const appointment = useAsync(() => getStaffAppointment(id), [db, id])

  const todayKey = todayDateKey(db.business.timezone)
  const [selectedDateKey, setSelectedDateKey] = useState(todayKey)
  const [monthStart, setMonthStart] = useState(() => firstOfMonthDateKey(todayKey))
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const record = appointment.data
  const staff = db.staff.find((entry) => entry.id === session?.id) ?? null
  const now = useMemo(() => new Date(), [db, selectedDateKey, record?.id])

  const context = useMemo(
    () => ({
      business: db.business,
      staff: db.staff,
      appointments: db.appointments,
    }),
    [db],
  )

  const dayAvailability = useMemo(
    () =>
      staff && record
        ? getStaffDayAvailability(
            context,
            staff,
            record.durationMinutesSnapshot,
            selectedDateKey,
            now,
            record.id,
          )
        : null,
    [context, staff, record, selectedDateKey, now],
  )

  const dayStates = useMemo(() => {
    const states = new Map<string, DayAvailabilityState>()
    if (!staff || !record) return states
    const { year, month } = parseDateKey(monthStart)
    const total = daysInMonth(year, month)
    for (let index = 0; index < total; index += 1) {
      const dateKey = addDaysToDateKey(monthStart, index)
      states.set(
        dateKey,
        getStaffDayAvailability(
          context,
          staff,
          record.durationMinutesSnapshot,
          dateKey,
          now,
          record.id,
        ).state,
      )
    }
    return states
  }, [context, staff, record, monthStart, now])

  const nextDates = useMemo(
    () =>
      staff && record
        ? findNextStaffAvailableDates(
            context,
            staff,
            record.durationMinutesSnapshot,
            selectedDateKey,
            4,
            now,
            record.id,
          )
        : [],
    [context, staff, record, selectedDateKey, now],
  )

  const didAutoAdvance = useRef(false)
  useEffect(() => {
    if (!staff || !record || didAutoAdvance.current) return
    if (dayAvailability && dayAvailability.state !== 'open' && nextDates.length > 0) {
      didAutoAdvance.current = true
      const next = nextDates[0]
      setSelectedDateKey(next)
      setMonthStart(firstOfMonthDateKey(next))
    } else if (dayAvailability && dayAvailability.state === 'open') {
      didAutoAdvance.current = true
    }
  }, [dayAvailability, nextDates, staff, record])

  useEffect(() => {
    setSelectedSlot(null)
  }, [selectedDateKey])

  if (appointment.loading && !record) {
    return (
      <div className="workspace-page">
        <Card>
          <div className="skeleton-row">
            <div className="skeleton" style={{ width: '35%' }} />
            <div className="skeleton" style={{ width: '75%' }} />
            <div className="skeleton" style={{ width: '55%' }} />
          </div>
        </Card>
      </div>
    )
  }

  if (appointment.error || !record) {
    return (
      <div className="workspace-page">
        <Card>
          <StateBlock
            icon="?"
            title="That appointment is not available"
            actions={
              <Link className={buttonClassName('primary')} to="/staff/appointments">
                Back to appointments
              </Link>
            }
          >
            It may belong to another staff member or may no longer exist.
          </StateBlock>
        </Card>
      </div>
    )
  }

  if (record.status !== 'pending' && record.status !== 'confirmed') {
    return (
      <div className="workspace-page">
        <Card>
          <StateBlock
            icon="–"
            title="This appointment cannot be rescheduled"
            actions={
              <Link
                className={buttonClassName('primary')}
                to={`/staff/appointments/${record.id}`}
              >
                Back to appointment
              </Link>
            }
          >
            Only pending and confirmed appointments can be moved. This one is
            already closed.
          </StateBlock>
        </Card>
      </div>
    )
  }

  if (!staff) {
    return (
      <div className="workspace-page">
        <Card>
          <StateBlock icon="!" title="Your staff profile could not be loaded">
            Sign out and sign in again with a staff account.
          </StateBlock>
        </Card>
      </div>
    )
  }

  const currentDateKey = toDateKey(new Date(record.startAt), db.business.timezone)
  const slots = dayAvailability?.slots ?? []
  const selectedDateLabel = formatDateKey(selectedDateKey)
  const firstOfThisMonth = firstOfMonthDateKey(todayKey)
  const lastBookableDateKey = addDaysToDateKey(
    todayKey,
    db.business.maxAdvanceBookingDays,
  )
  const firstOfLastMonth = firstOfMonthDateKey(lastBookableDateKey)
  const canGoPrevious = monthStart > firstOfThisMonth
  const canGoNext = monthStart < firstOfLastMonth

  const goToDate = (dateKey: string) => {
    setMonthStart(firstOfMonthDateKey(dateKey))
    setSelectedDateKey(dateKey)
  }

  return (
    <div className="workspace-page stack stack--loose">
      <Link className="text-sm" to={`/staff/appointments/${record.id}`}>
        ← Back to appointment
      </Link>

      <div className="stack stack--tight">
        <span className="eyebrow">Reschedule</span>
        <h1 style={{ fontSize: '2rem' }}>Choose a new time</h1>
        <p className="lede">
          This keeps the appointment assigned to you. Only times inside your own
          working hours and free of confirmed overlaps can be chosen.
        </p>
      </div>

      <div className="grid-2">
        <div className="stack stack--loose">
          <Card>
            <CardHeader title="Current appointment" />
            <dl className="summary__list" style={{ margin: 0 }}>
              <div className="summary__row">
                <dt>Service</dt>
                <dd>{record.serviceNameSnapshot}</dd>
              </div>
              <div className="summary__row">
                <dt>Duration</dt>
                <dd className="mono">{formatDuration(record.durationMinutesSnapshot)}</dd>
              </div>
              <div className="summary__row">
                <dt>Current date</dt>
                <dd>{formatDateKey(currentDateKey)}</dd>
              </div>
              <div className="summary__row">
                <dt>Current time</dt>
                <dd className="mono">
                  {formatTimeRange(record.startAt, record.endAt, db.business.timezone)}
                </dd>
              </div>
            </dl>
          </Card>

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
              <div className="stack stack--loose">
                {PERIODS.map((period) => {
                  const periodSlots = slots.filter((slot) => {
                    const minute = minutesOfDay(
                      new Date(slot.startAt),
                      db.business.timezone,
                    )
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
                        ? 'You do not work on this day'
                        : dayAvailability?.state === 'outside-booking-window'
                          ? 'Too far ahead to book'
                          : 'No free times on this date'}
                    </p>
                    <p className="secondary text-sm">
                      {dayAvailability?.state === 'closed'
                        ? 'Pick another date inside your working week.'
                        : dayAvailability?.state === 'outside-booking-window'
                          ? `Bookings are limited to ${db.business.maxAdvanceBookingDays} days ahead.`
                          : 'Every remaining time is taken or already in the past.'}
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
                  </p>
                )}
              </div>
            )}
          </Card>
        </div>

        <aside className="summary">
          <Card>
            <CardHeader title="New time" />
            <dl className="summary__list">
              <div className="summary__row">
                <dt>Service</dt>
                <dd>{record.serviceNameSnapshot}</dd>
              </div>
              <div className="summary__row">
                <dt>Duration</dt>
                <dd className="mono">{formatDuration(record.durationMinutesSnapshot)}</dd>
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
                <dd>{session?.name ?? 'You'}</dd>
              </div>
            </dl>

            {actionError ? (
              <div className="notice notice--error" role="alert">
                <div>
                  <div className="notice__title">Could not reschedule</div>
                  <p>{actionError}</p>
                </div>
              </div>
            ) : null}

            <hr className="rule" />

            <div className="stack stack--tight" style={{ marginTop: 'var(--space-4)' }}>
              <Button
                block
                disabled={!selectedSlot || busy}
                onClick={() => {
                  if (!selectedSlot) return
                  setBusy(true)
                  setActionError(null)
                  void rescheduleStaffAppointment(record.id, selectedSlot.startAt)
                    .then(() => {
                      navigate(`/staff/appointments/${record.id}`, {
                        replace: true,
                        state: { notice: 'Appointment rescheduled' },
                      })
                    })
                    .catch((cause: unknown) => {
                      setActionError(errorMessage(cause))
                      setBusy(false)
                    })
                }}
              >
                {busy ? 'Saving…' : 'Confirm new time'}
              </Button>
              <Link
                className={buttonClassName('ghost', 'btn--block')}
                to={`/staff/appointments/${record.id}`}
              >
                Cancel
              </Link>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  )
}
