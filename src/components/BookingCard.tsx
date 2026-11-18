import { Link } from 'react-router-dom'
import type { Booking } from '../lib/api'
import { formatTime, toDateKey } from '../lib/time'
import { StatusTag } from './StatusTag'
import { Button, buttonClassName } from './Button'

interface BookingCardProps {
  appointment: Booking
  timezone: string
  onCancel?: (appointment: Booking) => void
}

export function BookingCard({ appointment, timezone, onCancel }: BookingCardProps) {
  const dateKey = toDateKey(new Date(appointment.startAt * 1000), timezone)
  const [, month, day] = dateKey.split('-')
  const monthName = new Date(Date.UTC(2000, Number(month) - 1, 1)).toLocaleString('en-US', {
    month: 'short',
  })

  return (
    <li className="booking-card">
      <div className="booking-card__when">
        {day} {monthName}
        <span>{formatTime(new Date(appointment.startAt * 1000).toISOString(), timezone)}</span>
      </div>

      <div className="stack stack--tight">
        <div className="row row--wrap" style={{ gap: 'var(--space-2)' }}>
          <span className="booking-card__title">{appointment.serviceName}</span>
          <StatusTag status={appointment.status} />
        </div>
        <div className="row row--wrap" style={{ gap: 'var(--space-3)' }}>
          <span className="booking-card__ref">{appointment.publicReference}</span>
          <span className="meta">{appointment.durationMinutes} min</span>
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
          to={`/appointments/${appointment.publicReference}`}
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
