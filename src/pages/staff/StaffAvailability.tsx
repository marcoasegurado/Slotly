import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  addMyTimeOff,
  ApiError,
  getMySchedule,
  removeMyTimeOff,
  updateMySchedule,
  type AffectedBooking,
  type TimeOff,
} from '../../lib/api'
import { errorMessage, useAsync, useDocumentTitle, useBusiness } from '../../lib/hooks'
import {
  addDaysToDateKey,
  formatDateKey,
  formatMinutesOfDay,
  formatTime,
  formatTimeRange,
  minutesToTimeInput,
  parseTimeInput,
  toDateKey,
  todayDateKey,
  weekdayLabel,
  zonedTimeToUtc,
} from '../../lib/time'
import { Button } from '../../components/Button'
import { Card, CardHeader } from '../../components/Card'
import { TextField } from '../../components/Field'
import { StateBlock } from '../../components/StateBlock'

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0] as const

interface WorkingInterval {
  weekday: number
  startMinute: number
  endMinute: number
}

function sortIntervals(intervals: WorkingInterval[]): WorkingInterval[] {
  return intervals
    .slice()
    .sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute)
}

export function StaffAvailabilityPage() {
  useDocumentTitle('My availability')
  const business = useBusiness()
  const timezone = business.timezone
  const schedule = useAsync(() => getMySchedule(), [])

  const [intervals, setIntervals] = useState<WorkingInterval[]>([])
  const [timeOff, setTimeOff] = useState<TimeOff[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [conflicts, setConflicts] = useState<AffectedBooking[]>([])

  const today = todayDateKey(timezone)
  const [timeOffDate, setTimeOffDate] = useState(addDaysToDateKey(today, 1))
  const [timeOffStart, setTimeOffStart] = useState('09:00')
  const [timeOffEnd, setTimeOffEnd] = useState('10:00')
  const [timeOffReason, setTimeOffReason] = useState('')

  useEffect(() => {
    if (!schedule.data || loaded) return
    setIntervals(
      schedule.data.workingHours.map((entry) => ({
        weekday: entry.weekday,
        startMinute: entry.startMinute,
        endMinute: entry.endMinute,
      })),
    )
    setTimeOff(schedule.data.timeOff)
    setLoaded(true)
  }, [schedule.data, loaded])

  if (schedule.loading && !loaded) {
    return (
      <div className="workspace-page">
        <Card>
          <div className="skeleton-row">
            <div className="skeleton" style={{ width: '35%' }} />
            <div className="skeleton" style={{ width: '70%' }} />
          </div>
        </Card>
      </div>
    )
  }

  if (schedule.error || !schedule.data) {
    return (
      <div className="workspace-page">
        <Card>
          <StateBlock
            icon="!"
            title="Your staff profile could not be loaded"
            actions={
              <Button variant="secondary" size="sm" onClick={schedule.reload}>
                Try again
              </Button>
            }
          >
            {schedule.error?.message ??
              'Sign out and sign in again with a staff account.'}
          </StateBlock>
        </Card>
      </div>
    )
  }

  const updateInterval = (index: number, patch: Partial<WorkingInterval>) => {
    setIntervals((current) =>
      current.map((interval, currentIndex) =>
        currentIndex === index ? { ...interval, ...patch } : interval,
      ),
    )
  }

  const removeInterval = (index: number) => {
    setIntervals((current) => current.filter((_, currentIndex) => currentIndex !== index))
  }

  const addInterval = (weekday: number) => {
    const dayIntervals = intervals.filter((interval) => interval.weekday === weekday)
    const lastEnd = dayIntervals.reduce(
      (max, interval) => Math.max(max, interval.endMinute),
      0,
    )
    if (lastEnd >= 1440) return
    const start = lastEnd > 0 ? lastEnd : 9 * 60
    const end = Math.min(start + 60, 1440)
    setIntervals((current) => [
      ...current,
      { weekday, startMinute: start, endMinute: end },
    ])
  }

  const handleSaveHours = async () => {
    if (busy) return
    setBusy(true)
    setNotice(null)
    setActionError(null)
    setConflicts([])
    try {
      const result = await updateMySchedule(sortIntervals(intervals))
      setIntervals(
        result.workingHours.map((entry) => ({
          weekday: entry.weekday,
          startMinute: entry.startMinute,
          endMinute: entry.endMinute,
        })),
      )
      setTimeOff(result.timeOff)
      setNotice('Weekly hours saved.')
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'SCHEDULE_CHANGE_CONFLICT') {
        setConflicts(
          (cause.details.affectedBookings as AffectedBooking[] | undefined) ?? [],
        )
      }
      setActionError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const handleAddTimeOff = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return

    const startMinute = parseTimeInput(timeOffStart)
    const endMinute = parseTimeInput(timeOffEnd)
    if (!timeOffDate || startMinute === null || endMinute === null) {
      setActionError('Choose a valid date and time range.')
      return
    }
    if (endMinute <= startMinute) {
      setActionError('The end time must be after the start time.')
      return
    }

    const startAt = Math.floor(
      zonedTimeToUtc(timeOffDate, startMinute, timezone).getTime() / 1000,
    )
    const endAt = Math.floor(
      zonedTimeToUtc(timeOffDate, endMinute, timezone).getTime() / 1000,
    )

    if (endAt * 1000 <= Date.now()) {
      setActionError('Choose a time off period that has not already ended.')
      return
    }

    setBusy(true)
    setNotice(null)
    setActionError(null)
    setConflicts([])
    try {
      const entry = await addMyTimeOff({
        startAt,
        endAt,
        reason: timeOffReason.trim() || null,
      })
      setTimeOff((current) => [...current, entry])
      setTimeOffReason('')
      setNotice('Time off added.')
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'SCHEDULE_CHANGE_CONFLICT') {
        setConflicts(
          (cause.details.affectedBookings as AffectedBooking[] | undefined) ?? [],
        )
      }
      setActionError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const handleRemoveTimeOff = async (id: string) => {
    if (busy) return
    setBusy(true)
    setNotice(null)
    setActionError(null)
    setConflicts([])
    try {
      await removeMyTimeOff(id)
      setTimeOff((current) => current.filter((entry) => entry.id !== id))
      setNotice('Time off removed.')
    } catch (cause) {
      setActionError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const handleReset = () => {
    if (busy) return
    setBusy(true)
    setActionError(null)
    setConflicts([])
    setLoaded(false)
    setNotice(null)
    setBusy(false)
    schedule.reload()
  }

  const sortedTimeOff = timeOff
    .slice()
    .sort((a, b) => a.startAt - b.startAt)

  return (
    <div className="workspace-page stack stack--loose">
      <div className="stack stack--tight">
        <span className="eyebrow">Availability</span>
        <h1 style={{ fontSize: '2rem' }}>My working hours</h1>
        <p className="lede">
          These hours and time-off blocks are used when your assigned appointments
          are approved or moved. A change that would invalidate a future booking is
          blocked until the booking is resolved.
        </p>
      </div>

      {actionError ? (
        <div className="notice notice--error" role="alert">
          <div>
            <div className="notice__title">That change was not saved</div>
            <p>{actionError}</p>
          </div>
        </div>
      ) : null}

      {notice ? (
        <div className="notice notice--success" role="status">
          <div>
            <div className="notice__title">{notice}</div>
            <p>The availability used by the booking system is updated.</p>
          </div>
        </div>
      ) : null}

      {conflicts.length > 0 ? (
        <div className="notice notice--warning">
          <div className="stack stack--tight">
            <div>
              <div className="notice__title">Existing appointments block this change</div>
              <p>
                Resolve these future bookings first. If another staff member needs
                to take them, an admin must reassign them.
              </p>
            </div>
            <ul className="impact-list">
              {conflicts.map((appointment) => (
                <li key={appointment.publicReference}>
                  <Link to={`/staff/appointments/${appointment.publicReference}`}>
                    <span className="mono">{appointment.publicReference}</span>
                  </Link>{' '}
                  · {appointment.status} ·{' '}
                  {formatDateKey(
                    toDateKey(new Date(appointment.startAt * 1000), timezone),
                  )}{' '}
                  <span className="mono">
                    {formatTime(
                      new Date(appointment.startAt * 1000).toISOString(),
                      timezone,
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      <Card flush>
        <div className="workspace-card-head">
          <CardHeader
            title="Weekly hours"
            action={<span className="meta">Closed days have no intervals</span>}
          />
        </div>

        <div className="availability-list">
          {WEEKDAYS.map((weekday) => {
            const dayIntervals = intervals.filter(
              (interval) => interval.weekday === weekday,
            )
            return (
              <div className="availability-day" key={weekday}>
                <div className="availability-day__label">
                  <span className="availability-day__name">{weekdayLabel(weekday)}</span>
                  <span className="meta">
                    {dayIntervals.length === 0
                      ? 'Closed'
                      : dayIntervals
                          .map(
                            (interval) =>
                              `${formatMinutesOfDay(interval.startMinute)}–${formatMinutesOfDay(interval.endMinute)}`,
                          )
                          .join(', ')}
                  </span>
                </div>

                <div className="stack stack--tight">
                  {dayIntervals.map((interval) => {
                    const index = intervals.indexOf(interval)
                    return (
                      <div className="interval-row" key={`${weekday}-${index}`}>
                        <TextField
                          label="Start"
                          type="time"
                          value={minutesToTimeInput(interval.startMinute)}
                          onChange={(event) => {
                            const minutes = parseTimeInput(event.target.value)
                            if (minutes !== null) {
                              updateInterval(index, { startMinute: minutes })
                            }
                          }}
                        />
                        <TextField
                          label="End"
                          type="time"
                          value={minutesToTimeInput(interval.endMinute)}
                          onChange={(event) => {
                            const minutes = parseTimeInput(event.target.value)
                            if (minutes !== null) {
                              updateInterval(index, { endMinute: minutes })
                            }
                          }}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeInterval(index)}
                          disabled={busy}
                        >
                          Remove
                        </Button>
                      </div>
                    )
                  })}

                  <div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => addInterval(weekday)}
                      disabled={busy}
                    >
                      Add interval
                    </Button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <div className="availability-actions">
          <Button onClick={() => void handleSaveHours()} disabled={busy}>
            {busy ? 'Saving…' : 'Save weekly hours'}
          </Button>
          <Button variant="ghost" onClick={handleReset} disabled={busy}>
            Reset changes
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader title="Time off" />
        <p className="secondary text-sm">
          Any overlap makes you unavailable. Adding time off that overlaps a future
          pending or confirmed appointment is blocked.
        </p>

        <form className="timeoff-form" onSubmit={handleAddTimeOff}>
          <TextField
            label="Date"
            type="date"
            value={timeOffDate}
            onChange={(event) => setTimeOffDate(event.target.value)}
            required
          />
          <TextField
            label="Start"
            type="time"
            value={timeOffStart}
            onChange={(event) => setTimeOffStart(event.target.value)}
            required
          />
          <TextField
            label="End"
            type="time"
            value={timeOffEnd}
            onChange={(event) => setTimeOffEnd(event.target.value)}
            required
          />
          <TextField
            label="Reason (optional)"
            value={timeOffReason}
            onChange={(event) => setTimeOffReason(event.target.value)}
            maxLength={200}
          />
          <div className="timeoff-form__action">
            <Button type="submit" disabled={busy}>
              Add time off
            </Button>
          </div>
        </form>

        {sortedTimeOff.length > 0 ? (
          <ul className="timeoff-list">
            {sortedTimeOff.map((entry) => (
              <li key={entry.id} className="timeoff-row">
                <div>
                  <div className="timeoff-row__date">
                    {formatDateKey(
                      toDateKey(new Date(entry.startAt * 1000), timezone),
                    )}
                  </div>
                  <div className="meta mono">
                    {formatTimeRange(
                      new Date(entry.startAt * 1000).toISOString(),
                      new Date(entry.endAt * 1000).toISOString(),
                      timezone,
                    )}
                  </div>
                  {entry.reason ? (
                    <div className="timeoff-row__reason">{entry.reason}</div>
                  ) : null}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => void handleRemoveTimeOff(entry.id)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="secondary text-sm">No time off has been added.</p>
        )}
      </Card>
    </div>
  )
}
