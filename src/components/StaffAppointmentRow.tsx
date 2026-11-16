import { Link } from 'react-router-dom'
import type { Appointment } from '../mock/types'
import { formatDateKeyShort, formatTime, toDateKey } from '../lib/time'
import { StatusTag } from './StatusTag'
import { buttonClassName } from './Button'

interface StaffAppointmentRowProps {
  appointment: Appointment
  timezone: string
  showDate?: boolean
}

export function StaffAppointmentRow({
  appointment,
  timezone,
  showDate = true,
}: StaffAppointmentRowProps) {
  const dateKey = toDateKey(new Date(appointment.startAt), timezone)
  const pastPending =
    appointment.status === 'pending' && Date.parse(appointment.startAt) <= Date.now()
  const customerName = appointment.guestName ?? appointment.guestEmail ?? 'Customer'

  return (
    <li className="staff-row">
      <div className="staff-row__when">
        {showDate ? (
          <span className="staff-row__day">{formatDateKeyShort(dateKey)}</span>
        ) : null}
        <span className="staff-row__time mono">
          {formatTime(appointment.startAt, timezone)}
        </span>
      </div>

      <div className="staff-row__body">
        <div className="row row--wrap" style={{ gap: 'var(--space-2)' }}>
          <span className="staff-row__title">{appointment.serviceNameSnapshot}</span>
          <StatusTag status={appointment.status} />
        </div>
        <span className="staff-row__meta">
          {customerName} · {appointment.durationMinutesSnapshot} min ·{' '}
          <span className="mono">{appointment.publicReference}</span>
        </span>
        {pastPending ? (
          <span className="staff-row__flag">
            Start time passed — this request cannot be approved.
          </span>
        ) : null}
      </div>

      <div className="staff-row__actions">
        <Link
          className={buttonClassName('secondary', 'btn--sm')}
          to={`/staff/appointments/${appointment.id}`}
        >
          Review
        </Link>
      </div>
    </li>
  )
}
