import { useState } from 'react'
import { Link } from 'react-router-dom'
import { cancelMyBooking, listMyBookings } from '../mock/api'
import { errorMessage, useAsync, useDocumentTitle, useMockDb, useSession } from '../lib/hooks'
import type { Appointment } from '../mock/types'
import { BookingCard } from '../components/BookingCard'
import { Card, CardHeader } from '../components/Card'
import { StateBlock } from '../components/StateBlock'
import { Button, buttonClassName } from '../components/Button'
import { Dialog } from '../components/Dialog'

export function MyAppointmentsPage() {
  useDocumentTitle('My appointments')
  const db = useMockDb()
  const session = useSession()

  const bookings = useAsync(
    () =>
      session
        ? listMyBookings()
        : Promise.resolve({ upcoming: [] as Appointment[], past: [] as Appointment[] }),
    [session?.id],
  )

  const [pendingCancel, setPendingCancel] = useState<Appointment | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!session) {
    return (
      <div className="container main--narrow">
        <Card>
          <StateBlock
            icon="→"
            title="Sign in to see your appointments"
            actions={
              <>
                <Link className={buttonClassName('primary')} to="/signin">
                  Sign in
                </Link>
                <Link className={buttonClassName('secondary')} to="/book">
                  Book as a guest
                </Link>
              </>
            }
          >
            Guests can book without an account. The cancellation link in the
            request email is all you need to manage that booking.
          </StateBlock>
        </Card>
      </div>
    )
  }

  const data = bookings.data
  const nothingAtAll =
    data !== null && data.upcoming.length === 0 && data.past.length === 0

  return (
    <div className="container">
      <div className="stack stack--loose">
        <div className="row row--between row--wrap">
          <div className="stack stack--tight">
            <span className="eyebrow">Account</span>
            <h1>My appointments</h1>
            <p className="lede">
              {session.name} · {session.email}
            </p>
          </div>
          <Link className={buttonClassName('primary')} to="/book">
            Book another
          </Link>
        </div>

        {actionError ? (
          <div className="notice notice--error" role="alert">
            <div>
              <div className="notice__title">That did not work</div>
              <p>{actionError}</p>
            </div>
          </div>
        ) : null}

        {bookings.loading && !data ? (
          <Card>
            <div className="skeleton-row">
              <div className="skeleton" style={{ width: '35%' }} />
              <div className="skeleton" style={{ width: '85%' }} />
              <div className="skeleton" style={{ width: '65%' }} />
            </div>
          </Card>
        ) : bookings.error ? (
          <Card>
            <StateBlock
              icon="!"
              title="We could not load your appointments"
              actions={
                <Button variant="secondary" size="sm" onClick={bookings.reload}>
                  Try again
                </Button>
              }
            >
              {bookings.error.message}
            </StateBlock>
          </Card>
        ) : nothingAtAll ? (
          <Card>
            <StateBlock
              icon="0"
              title="No appointments yet"
              actions={
                <Link className={buttonClassName('primary')} to="/book">
                  Book your first appointment
                </Link>
              }
            >
              Requests and confirmed bookings will appear here.
            </StateBlock>
          </Card>
        ) : (
          <div className="stack stack--loose">
            <Card flush>
              <div style={{ padding: 'var(--space-5) var(--space-6) 0' }}>
                <CardHeader
                  title="Upcoming"
                  action={<span className="meta">{data?.upcoming.length ?? 0}</span>}
                />
              </div>
              {data && data.upcoming.length > 0 ? (
                <ul className="stack" style={{ padding: '0 var(--space-4) var(--space-4)' }}>
                  {data.upcoming.map((appointment) => (
                    <BookingCard
                      key={appointment.id}
                      appointment={appointment}
                      timezone={db.business.timezone}
                      onCancel={(target) => {
                        setActionError(null)
                        setPendingCancel(target)
                      }}
                    />
                  ))}
                </ul>
              ) : (
                <p className="secondary text-sm" style={{ padding: '0 var(--space-6) var(--space-5)' }}>
                  Nothing coming up.
                </p>
              )}
            </Card>

            <Card flush>
              <div style={{ padding: 'var(--space-5) var(--space-6) 0' }}>
                <CardHeader
                  title="Past"
                  action={<span className="meta">{data?.past.length ?? 0}</span>}
                />
              </div>
              {data && data.past.length > 0 ? (
                <ul className="stack" style={{ padding: '0 var(--space-4) var(--space-4)' }}>
                  {data.past.map((appointment) => (
                    <BookingCard
                      key={appointment.id}
                      appointment={appointment}
                      timezone={db.business.timezone}
                    />
                  ))}
                </ul>
              ) : (
                <p className="secondary text-sm" style={{ padding: '0 var(--space-6) var(--space-5)' }}>
                  No past appointments yet.
                </p>
              )}
            </Card>
          </div>
        )}
      </div>

      <Dialog
        open={pendingCancel !== null}
        title="Cancel this request?"
        onClose={() => setPendingCancel(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingCancel(null)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => {
                if (!pendingCancel) return
                setBusy(true)
                void cancelMyBooking(pendingCancel.id)
                  .then(() => {
                    setPendingCancel(null)
                    bookings.reload()
                  })
                  .catch((cause: unknown) => {
                    setActionError(errorMessage(cause))
                    setPendingCancel(null)
                  })
                  .finally(() => setBusy(false))
              }}
            >
              {busy ? 'Cancelling…' : 'Cancel request'}
            </Button>
          </>
        }
      >
        {pendingCancel ? (
          <span>
            {pendingCancel.serviceNameSnapshot} · {pendingCancel.publicReference}
            <br />
            The team will be notified. This cannot be undone, but you can send a
            new request afterwards.
          </span>
        ) : null}
      </Dialog>
    </div>
  )
}
