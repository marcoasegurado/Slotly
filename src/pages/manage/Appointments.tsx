import { useState } from 'react'
import type { AppointmentStatus } from '../../lib/api'
import { type ManagementArea, managementFor } from '../../lib/manage'
import { useAsync, useDocumentTitle, useBusiness } from '../../lib/hooks'
import { Button } from '../../components/Button'
import { Card, CardHeader } from '../../components/Card'
import { TextField } from '../../components/Field'
import { ManagedAppointmentRow } from '../../components/ManagedAppointmentRow'
import { StateBlock } from '../../components/StateBlock'

const STATUS_FILTERS: Array<{ value: AppointmentStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'cancelled', label: 'Cancelled' },
]

const STAFF_SCOPE_FILTERS = [
  { value: 'today' as const, label: 'Today' },
  { value: 'upcoming' as const, label: 'Upcoming' },
  { value: 'all' as const, label: 'All time' },
]

interface AppointmentsPageProps {
  area: ManagementArea
}

export function AppointmentsPage({ area }: AppointmentsPageProps) {
  const manage = managementFor(area)
  useDocumentTitle(area === 'admin' ? 'All appointments' : 'Staff appointments')
  const business = useBusiness()

  const [status, setStatus] = useState<AppointmentStatus | 'all'>('all')
  const [scope, setScope] = useState<'today' | 'upcoming' | 'all'>('upcoming')
  const [search, setSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')

  const appointments = useAsync(
    () =>
      manage.list({
        status,
        ...(area === 'staff' ? { scope } : {}),
        search: area === 'admin' ? appliedSearch : undefined,
      }),
    [area, status, scope, appliedSearch],
  )

  return (
    <div className="workspace-page stack stack--loose">
      <div className="stack stack--tight">
        <span className="eyebrow">Queue</span>
        <h1 style={{ fontSize: '2rem' }}>
          {area === 'admin' ? 'Appointments' : 'My appointments'}
        </h1>
        <p className="lede">
          {area === 'admin'
            ? 'Every appointment in the business. Pending requests are not confirmed until someone approves them.'
            : 'Only appointments assigned to you appear here. Pending requests are not confirmed until you approve them.'}
        </p>
      </div>

      <Card flush>
        <div className="workspace-card-head">
          <CardHeader
            title="Appointments"
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

          {area === 'staff' ? (
            <div className="filter-group" role="group" aria-label="Filter by date">
              {STAFF_SCOPE_FILTERS.map((filter) => (
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
          ) : (
            <form
              className="row"
              style={{ gap: 'var(--space-2)', alignItems: 'flex-end' }}
              onSubmit={(event) => {
                event.preventDefault()
                setAppliedSearch(search)
              }}
            >
              <TextField
                label="Search"
                placeholder="Reference, name or email"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <Button type="submit" variant="secondary" size="sm">
                Search
              </Button>
            </form>
          )}
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
              title="We could not load appointments"
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
              <ManagedAppointmentRow
                key={appointment.publicReference}
                appointment={appointment}
                timezone={business.timezone}
                basePath={manage.basePath}
                showStaff={area === 'admin'}
              />
            ))}
          </ul>
        ) : (
          <div className="workspace-empty">
            <StateBlock icon="0" title="No appointments match these filters">
              Try a different status or search. New requests appear here
              automatically.
            </StateBlock>
          </div>
        )}
      </Card>
    </div>
  )
}
