import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { getAppointment } from '../mock/api'
import { useAsync, useDocumentTitle, useMockDb, useSession } from '../lib/hooks'
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

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2200)
    return () => window.clearTimeout(timer)
  }, [copied])

  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => {
        void navigator.clipboard
          ?.writeText(value)
          .then(() => setCopied(true))
          .catch(() => setCopied(false))
      }}
    >
      {copied ? 'Copied' : label}
    </Button>
  )
}

export function RequestReceivedPage() {
  useDocumentTitle('Request received')
  const { reference = '' } = useParams()
  const location = useLocation()
  const db = useMockDb()
  const session = useSession()

  const cancellationToken =
    (location.state as { cancellationToken?: string | null } | null)?.cancellationToken ?? null

  const appointment = useAsync(() => getAppointment(reference), [reference])

  if (appointment.loading && !appointment.data) {
    return (
      <div className="container main--narrow">
        <Card>
          <div className="skeleton-row">
            <div className="skeleton" style={{ width: '40%' }} />
            <div className="skeleton" style={{ width: '70%' }} />
            <div className="skeleton" style={{ width: '55%' }} />
          </div>
        </Card>
      </div>
    )
  }

  if (appointment.error || !appointment.data) {
    return (
      <div className="container main--narrow">
        <Card>
          <StateBlock
            icon="?"
            title="We could not find that request"
            actions={
              <Link className={buttonClassName('primary')} to="/book">
                Book an appointment
              </Link>
            }
          >
            This page shows a request made in the current demo session. Reloading
            the demo clears it. Check your email for the confirmation details.
          </StateBlock>
        </Card>
      </div>
    )
  }

  const record = appointment.data
  const businessDateKey = toDateKey(new Date(record.startAt), db.business.timezone)
  const cancellationPath = cancellationToken ? `/cancel/${cancellationToken}` : null
  const cancellationUrl = cancellationPath
    ? `${window.location.origin}${cancellationPath}`
    : null

  return (
    <div className="container main--narrow">
      <div className="stack stack--loose">
        <div className="stack stack--tight">
          <span className="state__icon state__icon--success" aria-hidden="true">
            ✓
          </span>
          <h1 style={{ fontSize: '2rem' }}>Request received</h1>
          <p className="lede">
            Your request is with {db.business.businessName}. Nothing is confirmed
            yet — the team will review it and email you at the address you gave.
          </p>
        </div>

        <Card>
          <CardHeader
            title="Your request"
            action={<StatusTag status={record.status} />}
          />

          <div className="reference" style={{ marginBottom: 'var(--space-4)' }}>
            <div>
              <div className="meta">Reference</div>
              <div className="reference__value">{record.publicReference}</div>
            </div>
            <CopyButton value={record.publicReference} label="Copy reference" />
          </div>

          <dl className="summary__list" style={{ margin: 0 }}>
            <div className="summary__row">
              <dt>Service</dt>
              <dd>{record.serviceNameSnapshot}</dd>
            </div>
            <div className="summary__row">
              <dt>Duration</dt>
              <dd className="mono">{formatDuration(record.durationMinutesSnapshot)}</dd>
            </div>
            <div className="summary__row">
              <dt>Date</dt>
              <dd>{formatDateKey(businessDateKey)}</dd>
            </div>
            <div className="summary__row">
              <dt>Time</dt>
              <dd className="mono">
                {formatTimeRange(record.startAt, record.endAt, db.business.timezone)}
              </dd>
            </div>
            <div className="summary__row">
              <dt>Name</dt>
              <dd>
                {record.customerUserId
                  ? session?.role === 'customer'
                    ? session.name
                    : 'Account holder'
                  : record.guestName}
              </dd>
            </div>
            <div className="summary__row">
              <dt>Email</dt>
              <dd>{record.guestEmail}</dd>
            </div>
            {record.customerNote ? (
              <div className="summary__row">
                <dt>Your note</dt>
                <dd style={{ fontWeight: 400, textAlign: 'right' }}>{record.customerNote}</dd>
              </div>
            ) : null}
          </dl>
        </Card>

        {cancellationUrl ? (
          <Card>
            <CardHeader title="Private cancellation link" />
            <div className="stack stack--tight">
              <p className="text-sm secondary">
                Keep this link to yourself. It can cancel this pending request
                and nothing else. It stops working once the booking is confirmed
                or the appointment time passes.
              </p>
              <code className="token-link">{cancellationUrl}</code>
              <div className="row row--wrap">
                <CopyButton value={cancellationUrl} label="Copy link" />
                <Link className={buttonClassName('secondary', 'btn--sm')} to={cancellationPath ?? '/'}>
                  Open cancellation page
                </Link>
              </div>
            </div>
          </Card>
        ) : (
          <div className="notice notice--info">
            <div>
              <div className="notice__title">This link is shown once</div>
              <p>
                The private cancellation link was included in the request email
                and is not stored on this page. {session?.role === 'customer' ? 'You can also cancel a pending request from your appointments.' : 'Keep the email if you may need to cancel.'}
              </p>
            </div>
          </div>
        )}

        <Card>
          <CardHeader title="What happens next" />
          <ol className="timeline">
            <li className="timeline__item timeline__item--done">
              <span className="timeline__dot" aria-hidden="true" />
              <div>
                <div className="timeline__label">Request sent</div>
                <div className="timeline__note">Pending — the slot is not held yet.</div>
              </div>
            </li>
            <li className="timeline__item timeline__item--current">
              <span className="timeline__dot" aria-hidden="true" />
              <div>
                <div className="timeline__label">Team review</div>
                <div className="timeline__note">
                  Availability is rechecked against confirmed bookings.
                </div>
              </div>
            </li>
            <li className="timeline__item">
              <span className="timeline__dot" aria-hidden="true" />
              <div>
                <div className="timeline__label">Confirmation email</div>
                <div className="timeline__note">
                  You will hear back either way — confirmed or declined.
                </div>
              </div>
            </li>
          </ol>
        </Card>

        <div className="row row--wrap">
          {session?.role === 'customer' ? (
            <Link className={buttonClassName('primary')} to="/appointments">
              View my appointments
            </Link>
          ) : session?.role === 'staff' ? (
            <Link className={buttonClassName('primary')} to="/staff/appointments">
              Open the staff queue
            </Link>
          ) : (
            <Link className={buttonClassName('primary')} to="/signin">
              Create an account
            </Link>
          )}
          <Link className={buttonClassName('secondary')} to="/">
            Back to start
          </Link>
        </div>
      </div>
    </div>
  )
}
