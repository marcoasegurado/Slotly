import { Link } from 'react-router-dom'
import { getStaffDashboard } from '../../lib/api'
import {
  useAsync,
  useDocumentTitle,
  useBusiness,
  useSession,
} from '../../lib/hooks'
import { formatDateKey, todayDateKey } from '../../lib/time'
import { buttonClassName } from '../../components/Button'
import { Card, CardHeader } from '../../components/Card'
import { ManagedAppointmentRow } from '../../components/ManagedAppointmentRow'
import { StateBlock } from '../../components/StateBlock'

export function StaffDashboardPage() {
  useDocumentTitle('Staff dashboard')
  const business = useBusiness()
  const session = useSession()
  const timezone = business.timezone
  const dashboard = useAsync(() => getStaffDashboard(), [])

  const data = dashboard.data

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
        <Link className={buttonClassName('primary')} to="/staff/appointments">
          Open appointment queue
        </Link>
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
            title="We could not load your dashboard"
            actions={
              <button
                type="button"
                className={buttonClassName('secondary')}
                onClick={dashboard.reload}
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
              <span className="stat__value mono">{data.counts.pending}</span>
              <span className="stat__detail">Awaiting your review</span>
            </div>
            <div className="stat">
              <span className="stat__label">Today</span>
              <span className="stat__value mono">{data.counts.today}</span>
              <span className="stat__detail">Appointments on your schedule</span>
            </div>
            <div className="stat">
              <span className="stat__label">Upcoming confirmed</span>
              <span className="stat__value mono">{data.counts.confirmedUpcoming}</span>
              <span className="stat__detail">Future bookings assigned to you</span>
            </div>
          </div>

          <div className="grid-2">
            <Card flush>
              <div className="workspace-card-head">
                <CardHeader
                  title="Today's schedule"
                  action={<span className="meta">{data.today.length}</span>}
                />
              </div>
              {data.today.length > 0 ? (
                <ul className="staff-list">
                  {data.today.map((appointment) => (
                    <ManagedAppointmentRow
                      key={appointment.publicReference}
                      appointment={appointment}
                      timezone={timezone}
                      basePath="/staff/appointments"
                      showDate={false}
                    />
                  ))}
                </ul>
              ) : (
                <div className="workspace-empty">
                  <StateBlock icon="–" title="Nothing scheduled today">
                    Confirmed and pending appointments for today will appear here.
                  </StateBlock>
                </div>
              )}
            </Card>

            <Card flush>
              <div className="workspace-card-head">
                <CardHeader
                  title="Pending requests"
                  action={
                    <Link className="text-sm" to="/staff/appointments">
                      View all
                    </Link>
                  }
                />
              </div>
              {data.pending.length > 0 ? (
                <ul className="staff-list">
                  {data.pending.slice(0, 6).map((appointment) => (
                    <ManagedAppointmentRow
                      key={appointment.publicReference}
                      appointment={appointment}
                      timezone={timezone}
                      basePath="/staff/appointments"
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
          </div>

          <Card flush>
            <div className="workspace-card-head">
              <CardHeader
                title="Upcoming confirmed"
                action={<span className="meta">{data.upcoming.length}</span>}
              />
            </div>
            {data.upcoming.length > 0 ? (
              <ul className="staff-list">
                {data.upcoming.slice(0, 8).map((appointment) => (
                  <ManagedAppointmentRow
                    key={appointment.publicReference}
                    appointment={appointment}
                    timezone={timezone}
                    basePath="/staff/appointments"
                  />
                ))}
              </ul>
            ) : (
              <div className="workspace-empty">
                <StateBlock icon="0" title="No confirmed appointments ahead">
                  Approved requests will appear here once they are confirmed.
                </StateBlock>
              </div>
            )}
          </Card>
        </>
      ) : null}
    </div>
  )
}
