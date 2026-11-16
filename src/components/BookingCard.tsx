import { Link } from 'react-router-dom'
import type { Appointment } from '../mock/types'
import { formatTime, toDateKey } from '../lib/time'
import { StatusTag } from './StatusTag'
import { Button, buttonClassName } from './Button'

interface BookingCardProps {
  appointment: Appointment
  timezone: string
  onCancel?: (appointment: Appointment) => void
}

export function BookingCard({ appointment, timezone, onCancel }: BookingCardProps) {
  const dateKey = toDateKey(new Date(appointment.startAt), timezone)
  const [, month, day] = dateKey.split('-')
  const monthName = new Date(Date.UTC(2000, Number(month) - 1, 1)).toLocaleString('en-US', {
    month: 'short',
  })

  return (
    <li className="booking-card">
      <div className="booking-card__when">
        {day} {monthName}
        <span>{formatTime(appointment.startAt, timezone)}</span>
      </div>

      <div className="stack stack--tight">
        <div className="row row--wrap" style={{ gap: 'var(--space-2)' }}>
          <span className="booking-card__title">{appointment.serviceNameSnapshot}</span>
          <StatusTag status={appointment.status} />
        </div>
        <div className="row row--wrap" style={{ gap: 'var(--space-3)' }}>
          <span className="booking-card__ref">{appointment.publicReference}</span>
          <span className="meta">{appointment.durationMinutesSnapshot} min</span>
        </div>
        {appointment.status === 'pending' ? (
          <p className="meta" style={{ color: 'var(--status-pending-text)' }}>
            Awaiting review — this time is not held yet.
          </p>
        ) : null}
        {appointment.resolutionNote ? (
          <p className="meta">{appointment.resolutionNote}</p>
        ) : null}
      </div>

      <div className="booking-card__actions">
        <Link
          className={buttonClassName('secondary', 'btn--sm')}
          to={`/appointments/${appointment.id}`}
        >
          View details
        </Link>
        {appointment.status === 'pending' && onCancel ? (
          <Button variant="danger" size="sm" onClick={() => onCancel(appointment)}>
            Cancel request
          </Button>
        ) : null}
      </div>
    </li>
  )
}
