import { Link } from 'react-router-dom'
import { getAdminDashboard, listAdminAppointments } from '../../lib/api'
import { useAsync, useDocumentTitle, useBusiness, useSession } from '../../lib/hooks'
import { formatDateKey, todayDateKey } from '../../lib/time'
import { buttonClassName } from '../../components/Button'
import { Card, CardHeader } from '../../components/Card'
import { ManagedAppointmentRow } from '../../components/ManagedAppointmentRow'
import { StateBlock } from '../../components/StateBlock'

export function AdminDashboardPage() {
  useDocumentTitle('Admin dashboard')
  const business = useBusiness()
  const session = useSession()
  const timezone = business.timezone

  const dashboard = useAsync(() => getAdminDashboard(), [])
  const pending = useAsync(
    () => listAdminAppointments({ status: 'pending', limit: 25 }),
    [],
  )

  const data = dashboard.data
  const reloadAll = () => {
    dashboard.reload()
    pending.reload()
  }

  return (
    <div className="workspace-page stack stack--loose">
      <div className="row row--between row--wrap">
        <div className="stack stack--tight">
          <span className="eyebrow">Overview</span>
          <h1 style={{ fontSize: '2rem' }}>Dashboard</h1>
          <p className="lede">
            {session ? `Signed in as ${session.name}. ` : ''}
            {formatDateKey(todayDateKey(timezone))}
          </p>
        </div>
        <div className="row row--wrap" style={{ gap: 'var(--space-2)' }}>
          <Link className={buttonClassName('secondary')} to="/admin/appointments">
            All appointments
          </Link>
          <Link className={buttonClassName('primary')} to="/admin/appointments?status=pending">
            Review requests
          </Link>
        </div>
      </div>

      {dashboard.loading && !data ? (
        <div className="stat-grid">
          {[0, 1, 2].map((key) => (
            <div className="stat" key={key}>
              <div className="skeleton" style={{ width: '55%' }} />
              <div className="skeleton" style={{ width: '30%', height: 28 }} />
            </div>
          ))}
        </div>
      ) : dashboard.error ? (
        <Card>
          <StateBlock
            icon="!"
            title="We could not load the dashboard"
            actions={
              <button
                type="button"
                className={buttonClassName('secondary')}
                onClick={reloadAll}
              >
                Try again
              </button>
            }
          >
            {dashboard.error.message}
          </StateBlock>
        </Card>
      ) : data ? (
        <>
          <div className="stat-grid">
            <div className="stat">
              <span className="stat__label">Pending requests</span>
              <span className="stat__value mono">{data.totals.pending}</span>
              <span className="stat__detail">
                {data.upcoming.pending} with a future start time
              </span>
            </div>
            <div className="stat">
              <span className="stat__label">Today</span>
              <span className="stat__value mono">
                {data.today.pending + data.today.confirmed}
              </span>
              <span className="stat__detail">
                {data.today.confirmed} confirmed · {data.today.pending} pending
              </span>
            </div>
            <div className="stat">
              <span className="stat__label">Upcoming confirmed</span>
              <span className="stat__value mono">{data.upcoming.confirmed}</span>
              <span className="stat__detail">Future bookings holding a slot</span>
            </div>
          </div>

          <Card flush>
            <div className="workspace-card-head">
              <CardHeader
                title="Pending requests"
                action={
                  <Link className="text-sm" to="/admin/appointments?status=pending">
                    View all
                  </Link>
                }
              />
            </div>
            {pending.loading && !pending.data ? (
              <div className="workspace-empty">
                <div className="skeleton-row">
                  <div className="skeleton" style={{ width: '30%' }} />
                  <div className="skeleton" style={{ width: '70%' }} />
                </div>
              </div>
            ) : pending.error ? (
              <div className="workspace-empty">
                <StateBlock
                  icon="!"
                  title="We could not load pending requests"
                  actions={
                    <button
                      type="button"
                      className={buttonClassName('secondary', 'btn--sm')}
                      onClick={pending.reload}
                    >
                      Try again
                    </button>
                  }
                >
                  {pending.error.message}
                </StateBlock>
              </div>
            ) : pending.data && pending.data.length > 0 ? (
              <ul className="staff-list">
                {pending.data.map((appointment) => (
                  <ManagedAppointmentRow
                    key={appointment.publicReference}
                    appointment={appointment}
                    timezone={timezone}
                    basePath="/admin/appointments"
                    showStaff
                  />
                ))}
              </ul>
            ) : (
              <div className="workspace-empty">
                <StateBlock icon="✓" title="No requests waiting">
                  New customer requests will appear here for review.
                </StateBlock>
              </div>
            )}
          </Card>

          <Card flush>
            <div className="workspace-card-head">
              <CardHeader title="Staff workload" />
            </div>
            {data.staff.length > 0 ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Staff member</th>
                      <th scope="col">Pending</th>
                      <th scope="col">Confirmed upcoming</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.staff.map((member) => (
                      <tr key={member.id}>
                        <th scope="row">{member.name}</th>
                        <td className="mono">{member.pending}</td>
                        <td className="mono">{member.confirmedUpcoming}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="workspace-empty">
                <StateBlock icon="0" title="No active staff members">
                  Add staff accounts before appointments can be assigned.
                </StateBlock>
              </div>
            )}
          </Card>
        </>
      ) : null}
    </div>
  )
}
