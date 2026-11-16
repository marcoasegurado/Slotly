import { useState } from 'react'
import { listStaffAppointments } from '../../mock/api'
import type { AppointmentStatus } from '../../mock/types'
import { useAsync, useDocumentTitle, useMockDb } from '../../lib/hooks'
import { Button } from '../../components/Button'
import { Card, CardHeader } from '../../components/Card'
import { StaffAppointmentRow } from '../../components/StaffAppointmentRow'
import { StateBlock } from '../../components/StateBlock'

const STATUS_FILTERS: Array<{ value: AppointmentStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'cancelled', label: 'Cancelled' },
]

const SCOPE_FILTERS = [
  { value: 'today' as const, label: 'Today' },
  { value: 'upcoming' as const, label: 'Upcoming' },
  { value: 'all' as const, label: 'All time' },
]

export function StaffAppointmentsPage() {
  useDocumentTitle('Staff appointments')
  const db = useMockDb()
  const [status, setStatus] = useState<AppointmentStatus | 'all'>('all')
  const [scope, setScope] = useState<'today' | 'upcoming' | 'all'>('upcoming')

  const appointments = useAsync(
    () => listStaffAppointments({ status, scope }),
    [db, status, scope],
  )

  return (
    <div className="workspace-page stack stack--loose">
      <div className="stack stack--tight">
        <span className="eyebrow">Queue</span>
        <h1 style={{ fontSize: '2rem' }}>Appointments</h1>
        <p className="lede">
          Only appointments assigned to you appear here. Pending requests are not
          confirmed until you approve them.
        </p>
      </div>

      <Card flush>
        <div className="workspace-card-head">
          <CardHeader
            title="Assigned appointments"
            action={<span className="meta">{appointments.data?.length ?? 0}</span>}
          />
        </div>

        <div className="filter-bar">
          <div className="filter-group" role="group" aria-label="Filter by status">
            {STATUS_FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                className="filter-chip"
                aria-pressed={status === filter.value}
                onClick={() => setStatus(filter.value)}
              >
                {filter.label}
              </button>
            ))}
          </div>

          <div className="filter-group" role="group" aria-label="Filter by date">
            {SCOPE_FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                className="filter-chip"
                aria-pressed={scope === filter.value}
                onClick={() => setScope(filter.value)}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>

        {appointments.loading && !appointments.data ? (
          <div className="workspace-empty">
            <div className="skeleton-row">
              <div className="skeleton" style={{ width: '30%' }} />
              <div className="skeleton" style={{ width: '70%' }} />
              <div className="skeleton" style={{ width: '45%' }} />
            </div>
          </div>
        ) : appointments.error ? (
          <div className="workspace-empty">
            <StateBlock
              icon="!"
              title="We could not load your appointments"
              actions={
                <Button variant="secondary" size="sm" onClick={appointments.reload}>
                  Try again
                </Button>
              }
            >
              {appointments.error.message}
            </StateBlock>
          </div>
        ) : appointments.data && appointments.data.length > 0 ? (
          <ul className="staff-list">
            {appointments.data.map((appointment) => (
              <StaffAppointmentRow
                key={appointment.id}
                appointment={appointment}
                timezone={db.business.timezone}
              />
            ))}
          </ul>
        ) : (
          <div className="workspace-empty">
            <StateBlock icon="0" title="No appointments match these filters">
              Try a different status or date range. New requests will appear here
              automatically.
            </StateBlock>
          </div>
        )}
      </Card>
    </div>
  )
}
