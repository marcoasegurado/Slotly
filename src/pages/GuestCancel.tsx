import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { cancelGuestBooking, resolveGuestToken } from '../mock/api'
import { useAsync, useDocumentTitle, useMockDb } from '../lib/hooks'
import {
  formatDateKey,
  formatDuration,
  formatTimeRange,
  toDateKey,
} from '../lib/time'
import { Button, buttonClassName } from '../components/Button'
import { Card } from '../components/Card'
import { StateBlock } from '../components/StateBlock'

/**
 * Guest cancellation.
 *
 * This page is reachable with a bearer token in the URL, so it deliberately:
 * - shows no navigation or personal data beyond the booking being cancelled
 * - loads no third-party resources
 * - gives the same generic response for invalid, used, expired or stale links
 * - requires an explicit POST-equivalent action; the review step never mutates
 */
export function GuestCancelPage() {
  const { token = '' } = useParams()
  const db = useMockDb()

  useDocumentTitle('Manage your request')

  useEffect(() => {
    const robots = document.createElement('meta')
    robots.name = 'robots'
    robots.content = 'noindex, nofollow'

    const referrer = document.createElement('meta')
    referrer.name = 'referrer'
    referrer.content = 'no-referrer'

    document.head.append(robots, referrer)
    return () => {
      robots.remove()
      referrer.remove()
    }
  }, [])

  const resolution = useAsync(() => resolveGuestToken(token), [token])
  const [cancelledReference, setCancelledReference] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const appointment = resolution.data?.appointment ?? null
  const businessDateKey =
    appointment !== null
      ? toDateKey(new Date(appointment.startAt), db.business.timezone)
      : null

  return (
    <div className="page">
      <header className="site-header">
        <div className="container site-header__inner">
          <span className="brand">
            {db.business.businessName}
            <span className="brand__meta">Private link</span>
          </span>
        </div>
      </header>

      <main className="main">
        <div className="container main--narrow">
          {resolution.loading && !resolution.data ? (
            <Card>
              <div className="skeleton-row">
                <div className="skeleton" style={{ width: '40%' }} />
                <div className="skeleton" style={{ width: '75%' }} />
              </div>
            </Card>
          ) : cancelledReference ? (
            <Card>
              <StateBlock
                icon="✓"
                tone="success"
                title="Request cancelled"
                actions={
                  <Link className={buttonClassName('primary')} to="/book">
                    Book a new appointment
                  </Link>
                }
              >
                Reference {cancelledReference} has been cancelled. This link no
                longer works, and the time is free for someone else. You will not
                receive further updates about this request.
              </StateBlock>
            </Card>
          ) : resolution.data?.state === 'valid' && appointment && businessDateKey ? (
            <div className="stack stack--loose">
              <div className="stack stack--tight">
                <span className="eyebrow">Cancel a request</span>
                <h1>Cancel this appointment?</h1>
                <p className="lede">
                  This will withdraw your pending request. Nothing else about your
                  booking can be changed from this link.
                </p>
              </div>

              <Card>
                <dl className="summary__list" style={{ margin: 0 }}>
                  <div className="summary__row">
                    <dt>Service</dt>
                    <dd>{appointment.serviceNameSnapshot}</dd>
                  </div>
                  <div className="summary__row">
                    <dt>Duration</dt>
                    <dd className="mono">{formatDuration(appointment.durationMinutesSnapshot)}</dd>
                  </div>
                  <div className="summary__row">
                    <dt>Date</dt>
                    <dd>{formatDateKey(businessDateKey)}</dd>
                  </div>
                  <div className="summary__row">
                    <dt>Time</dt>
                    <dd className="mono">
                      {formatTimeRange(appointment.startAt, appointment.endAt, db.business.timezone)}
                    </dd>
                  </div>
                  <div className="summary__row">
                    <dt>Reference</dt>
                    <dd className="mono">{appointment.publicReference}</dd>
                  </div>
                </dl>
              </Card>

              {error ? (
                <div className="notice notice--error" role="alert">
                  <div>
                    <div className="notice__title">We could not cancel it</div>
                    <p>{error}</p>
                  </div>
                </div>
              ) : null}

              <div className="row row--wrap">
                <Button
                  variant="danger"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true)
                    setError(null)
                    void cancelGuestBooking(token)
                      .then((result) => setCancelledReference(result.reference))
                      .catch(() => {
                        // A failed token is indistinguishable from an unknown one.
                        setError('This link is no longer available.')
                      })
                      .finally(() => setBusy(false))
                  }}
                >
                  {busy ? 'Cancelling…' : 'Cancel this request'}
                </Button>
                <Link className={buttonClassName('secondary')} to="/">
                  Keep my appointment
                </Link>
              </div>

              <p className="meta">
                Changed your mind? Do not use this page — closing it leaves your
                request as it is.
              </p>
            </div>
          ) : (
            <Card>
              <StateBlock
                icon="–"
                title="This link is no longer available"
                actions={
                  <Link className={buttonClassName('secondary')} to="/">
                    Go to the business page
                  </Link>
                }
              >
                The link may have been used already, expired, or the booking may
                have been updated. If you still need to change something, contact
                the business directly.
              </StateBlock>
            </Card>
          )}
        </div>
      </main>

      <footer className="site-footer">
        <div className="container site-footer__inner">
          <span>Private link · do not share</span>
          <span className="mono">{db.business.businessEmail}</span>
        </div>
      </footer>
    </div>
  )
}
