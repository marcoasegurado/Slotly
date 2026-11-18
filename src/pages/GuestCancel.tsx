import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ApiError,
  cancelGuestBooking,
  resolveGuestCancellation,
} from '../lib/api'
import { useAsync, useDocumentTitle, useBusiness } from '../lib/hooks'
import {
  formatDateKey,
  formatDuration,
  formatTimeRange,
  toDateKey,
} from '../lib/time'
import { Button, buttonClassName } from '../components/Button'
import { Card } from '../components/Card'
import { StateBlock } from '../components/StateBlock'

function isoOf(seconds: number): string {
  return new Date(seconds * 1000).toISOString()
}

/**
 * Guest cancellation.
 *
 * This page is reachable with a bearer token in the URL, so it deliberately:
 * - shows no navigation or personal data beyond the booking being cancelled
 * - loads no third-party resources
 * - gives the same generic response for invalid, used, expired or stale links
 * - requires an explicit POST-equivalent action; loading the page only reads
 */
export function GuestCancelPage() {
  const { token = '' } = useParams()
  const business = useBusiness()

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

  const resolution = useAsync(() => resolveGuestCancellation(token), [token])
  const [cancelledReference, setCancelledReference] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const appointment = resolution.data
  const timezone = business.timezone
  const businessDateKey = appointment
    ? toDateKey(new Date(appointment.startAt * 1000), timezone)
    : null
  const unavailable =
    resolution.error instanceof ApiError &&
    resolution.error.code === 'CANCELLATION_LINK_UNAVAILABLE'

  return (
    <div className="page">
      <header className="site-header">
        <div className="container site-header__inner">
          <span className="brand">
            {business.businessName}
            <span className="brand__meta">Private link</span>
          </span>
        </div>
      </header>

      <main className="main">
        <div className="container main--narrow">
          {resolution.loading && !appointment ? (
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
          ) : appointment && businessDateKey ? (
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
                    <dd>{appointment.serviceName}</dd>
                  </div>
                  <div className="summary__row">
                    <dt>Duration</dt>
                    <dd className="mono">{formatDuration(appointment.durationMinutes)}</dd>
                  </div>
                  <div className="summary__row">
                    <dt>Date</dt>
                    <dd>{formatDateKey(businessDateKey)}</dd>
                  </div>
                  <div className="summary__row">
                    <dt>Time</dt>
                    <dd className="mono">
                      {formatTimeRange(
                        isoOf(appointment.startAt),
                        isoOf(appointment.endAt),
                        timezone,
                      )}
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
                      .then((result) => setCancelledReference(result.publicReference))
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
                {unavailable
                  ? 'The link may have been used already, expired, or the booking may have been updated. If you still need to change something, contact the business directly.'
                  : 'We could not check this link just now. Reload the page or contact the business directly.'}
              </StateBlock>
            </Card>
          )}
        </div>
      </main>

      <footer className="site-footer">
        <div className="container site-footer__inner">
          <span>Private link · do not share</span>
          <span className="mono">
            {business.businessEmail ?? 'Times shown in business time'}
          </span>
        </div>
      </footer>
    </div>
  )
}
