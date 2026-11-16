import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { cancelMyBooking } from '../mock/api'
import { errorMessage, useDocumentTitle, useMockDb, useSession } from '../lib/hooks'
import {
  formatDateKey,
  formatDuration,
  formatTimeRange,
  toDateKey,
} from '../lib/time'
import { Button, buttonClassName } from '../components/Button'
import { Card, CardHeader } from '../components/Card'
import { StateBlock } from '../components/StateBlock'
import { StatusTag } from '../components/StatusTag'
import { Dialog } from '../components/Dialog'

export function BookingDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const db = useMockDb()
  const session = useSession()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useDocumentTitle('Booking details')

  const appointment = db.appointments.find((entry) => entry.id === id)
  const owned =
    appointment !== undefined &&
    session?.role === 'customer' &&
    appointment.customerUserId === session.id

  if (!appointment || !owned) {
    return (
      <div className="container main--narrow">
        <Card>
          <StateBlock
            icon="?"
            title="That appointment is not available"
            actions={
              <>
                <Link className={buttonClassName('primary')} to="/appointments">
                  My appointments
                </Link>
                <Link className={buttonClassName('secondary')} to="/book">
                  Book an appointment
                </Link>
              </>
            }
          >
            It may belong to another account, or the link may be out of date.
          </StateBlock>
        </Card>
      </div>
    )
  }

  const businessDateKey = toDateKey(new Date(appointment.startAt), db.business.timezone)
  const canCancel = appointment.status === 'pending' && appointment.customerUserId !== null

  return (
    <div className="container">
      <div className="stack stack--loose" style={{ maxWidth: 760 }}>
        <Link className="text-sm" to="/appointments">
          ← Back to my appointments
        </Link>

        <div className="row row--between row--wrap">
          <div className="stack stack--tight">
            <span className="eyebrow">Appointment</span>
            <h1 style={{ fontSize: '1.9rem' }}>{appointment.serviceNameSnapshot}</h1>
            <p className="lede">
              {formatDateKey(businessDateKey)} ·{' '}
              {formatTimeRange(appointment.startAt, appointment.endAt, db.business.timezone)}
            </p>
          </div>
          <StatusTag status={appointment.status} />
        </div>

        {error ? (
          <div className="notice notice--error" role="alert">
            <div>
              <div className="notice__title">That did not work</div>
              <p>{error}</p>
            </div>
          </div>
        ) : null}

        <Card>
          <CardHeader title="Details" />
          <dl className="definition">
            <dt>Reference</dt>
            <dd className="mono">{appointment.publicReference}</dd>

            <dt>Service</dt>
            <dd>{appointment.serviceNameSnapshot}</dd>

            <dt>Duration</dt>
            <dd className="mono">{formatDuration(appointment.durationMinutesSnapshot)}</dd>

            <dt>Date</dt>
            <dd>{formatDateKey(businessDateKey)}</dd>

            <dt>Time</dt>
            <dd className="mono">
              {formatTimeRange(appointment.startAt, appointment.endAt, db.business.timezone)}
            </dd>

            <dt>Contact</dt>
            <dd>{appointment.guestEmail}</dd>

            <dt>Notes</dt>
            <dd>{appointment.customerNote ?? 'None'}</dd>
          </dl>
        </Card>

        <Card>
          <CardHeader title="Status" />
          <ol className="timeline">
            <li className="timeline__item timeline__item--done">
              <span className="timeline__dot" aria-hidden="true" />
              <div>
                <div className="timeline__label">Requested</div>
                <div className="timeline__note">
                  Sent {new Date(appointment.createdAt).toLocaleDateString()}
                </div>
              </div>
            </li>
            <li
              className={`timeline__item ${
                appointment.status === 'pending' ? 'timeline__item--current' : 'timeline__item--done'
              }`}
            >
              <span className="timeline__dot" aria-hidden="true" />
              <div>
                <div className="timeline__label">Review</div>
                <div className="timeline__note">
                  Availability is checked against confirmed bookings.
                </div>
              </div>
            </li>
            <li className={`timeline__item ${appointment.status === 'confirmed' ? 'timeline__item--done' : ''}`}>
              <span className="timeline__dot" aria-hidden="true" />
              <div>
                <div className="timeline__label">
                  {appointment.status === 'confirmed'
                    ? 'Confirmed'
                    : appointment.status === 'rejected'
                      ? 'Declined'
                      : appointment.status === 'cancelled'
                        ? 'Cancelled'
                        : 'Confirmation email'}
                </div>
                <div className="timeline__note">
                  {appointment.status === 'pending'
                    ? 'You will be emailed either way.'
                    : appointment.resolutionNote ?? 'The status is final.'}
                </div>
              </div>
            </li>
          </ol>
        </Card>

        {appointment.status === 'confirmed' ? (
          <div className="notice notice--info">
            <div>
              <div className="notice__title">Need to change a confirmed appointment?</div>
              <p>
                {db.business.businessEmail
                  ? `Contact the business at ${db.business.businessEmail}.`
                  : 'Contact the business directly.'}{' '}
                Confirmed bookings cannot be cancelled from this page.
              </p>
            </div>
          </div>
        ) : null}

        <div className="row row--wrap">
          {canCancel ? (
            <Button variant="danger" onClick={() => setConfirming(true)}>
              Cancel this request
            </Button>
          ) : null}
          <Link className={buttonClassName('secondary')} to="/book">
            Book another appointment
          </Link>
        </div>
      </div>

      <Dialog
        open={confirming}
        title="Cancel this request?"
        onClose={() => setConfirming(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => {
                setBusy(true)
                void cancelMyBooking(appointment.id)
                  .then(() => {
                    setConfirming(false)
                    navigate('/appointments')
                  })
                  .catch((cause: unknown) => {
                    setError(errorMessage(cause))
                    setConfirming(false)
                  })
                  .finally(() => setBusy(false))
              }}
            >
              {busy ? 'Cancelling…' : 'Cancel request'}
            </Button>
          </>
        }
      >
        The team will be notified. This cannot be undone, but you can send a new
        request afterwards.
      </Dialog>
    </div>
  )
}
