import { Link } from 'react-router-dom'
import type { ManagedAppointment } from '../lib/api'
import { formatDateKeyShort, formatTime, toDateKey } from '../lib/time'
import { StatusTag } from './StatusTag'
import { buttonClassName } from './Button'

interface ManagedAppointmentRowProps {
  appointment: ManagedAppointment
  timezone: string
  /** Workspace route that hosts the review screen, e.g. `/admin/appointments`. */
  basePath: string
  showDate?: boolean
  showStaff?: boolean
}

export function ManagedAppointmentRow({
  appointment,
  timezone,
  basePath,
  showDate = true,
  showStaff = false,
}: ManagedAppointmentRowProps) {
  const dateKey = toDateKey(new Date(appointment.startAt * 1000), timezone)
  const pastPending =
    appointment.status === 'pending' && appointment.startAt * 1000 <= Date.now()
  const customerName =
    appointment.customer?.name ??
    appointment.guestName ??
    appointment.guestEmail ??
    'Customer'

  return (
    <li className="staff-row">
      <div className="staff-row__when">
        {showDate ? (
          <span className="staff-row__day">{formatDateKeyShort(dateKey)}</span>
        ) : null}
        <span className="staff-row__time mono">
          {formatTime(new Date(appointment.startAt * 1000).toISOString(), timezone)}
        </span>
      </div>

      <div className="staff-row__body">
        <div className="row row--wrap" style={{ gap: 'var(--space-2)' }}>
          <span className="staff-row__title">{appointment.serviceName}</span>
          <StatusTag status={appointment.status} />
        </div>
        <span className="staff-row__meta">
          {customerName} · {appointment.durationMinutes} min ·{' '}
          <span className="mono">{appointment.publicReference}</span>
          {showStaff ? ` · ${appointment.assignedStaff.name}` : ''}
        </span>
        {pastPending ? (
          <span className="staff-row__flag">
            Start time passed — approve is blocked. Reschedule or decline it.
          </span>
        ) : null}
      </div>

      <div className="staff-row__actions">
        <Link
          className={buttonClassName('secondary', 'btn--sm')}
          to={`${basePath}/${appointment.publicReference}`}
        >
          Review
        </Link>
      </div>
    </li>
  )
}
