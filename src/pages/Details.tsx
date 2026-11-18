import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ApiError, createBooking, listServices, type Service } from '../lib/api'
import { formatDateKey, formatDuration, formatTime, formatTimeRange, toDateKey } from '../lib/time'
import {
  errorMessage,
  useAsync,
  useBusiness,
  useDocumentTitle,
  useSession,
} from '../lib/hooks'
import { Stepper } from '../components/Stepper'
import { Button, buttonClassName } from '../components/Button'
import { Card, CardHeader } from '../components/Card'
import { TextAreaField, TextField } from '../components/Field'
import { StateBlock } from '../components/StateBlock'

interface FormErrors {
  name?: string
  email?: string
  note?: string
  summary?: string
}

export function DetailsPage() {
  const { serviceId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const business = useBusiness()
  const session = useSession()

  const services = useAsync(() => listServices(), [])
  const service: Service | null =
    (services.data ?? []).find((entry) => entry.id === serviceId) ?? null

  const startParam = searchParams.get('start') ?? ''
  const startAt = Number(startParam)
  const hasStart = Number.isInteger(startAt) && startAt > 0

  useDocumentTitle('Your details')

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<FormErrors>({})
  const [submitting, setSubmitting] = useState(false)

  if (services.loading && !services.data) {
    return (
      <div className="container main--narrow">
        <p className="meta">Loading…</p>
      </div>
    )
  }

  if (!service || !hasStart) {
    return (
      <div className="container main--narrow">
        <Card>
          <StateBlock
            title="That booking link is incomplete"
            actions={
              <Link className={buttonClassName('primary')} to="/book">
                Start again
              </Link>
            }
          >
            Choose a service and a time to continue.
          </StateBlock>
        </Card>
      </div>
    )
  }

  const timezone = business.timezone
  const startIso = new Date(startAt * 1000).toISOString()
  const endIso = new Date(
    startAt * 1000 + service.durationMinutes * 60_000,
  ).toISOString()
  const businessDateKey = toDateKey(new Date(startAt * 1000), timezone)

  const customerSession = session?.role === 'customer' ? session : null
  const mode = customerSession ? 'customer' : 'guest'

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting) return

    const nextErrors: FormErrors = {}
    if (mode === 'guest') {
      if (name.trim().length < 2) nextErrors.name = 'Enter your full name.'
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        nextErrors.email = 'Enter a valid email address.'
      }
    }
    if (note.length > 500) nextErrors.note = 'Keep your note under 500 characters.'

    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    setSubmitting(true)
    try {
      const result = await createBooking({
        serviceId: service.id,
        startAt,
        ...(mode === 'guest'
          ? { guestName: name.trim(), guestEmail: email.trim() }
          : {}),
        ...(note.trim() ? { customerNote: note.trim() } : {}),
      })
      navigate(`/request-received/${result.appointment.publicReference}`, {
        replace: true,
        state: {
          cancellationToken: result.cancellationToken,
          appointment: result.appointment,
        },
      })
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'BOOKING_CONFLICT') {
        setErrors({
          summary:
            'That time was taken while you were filling the form. Choose another time to continue.',
        })
      } else if (cause instanceof ApiError && cause.code === 'VALIDATION_ERROR') {
        if (/name/i.test(cause.message)) setErrors({ name: cause.message })
        else if (/email/i.test(cause.message)) setErrors({ email: cause.message })
        else if (/note/i.test(cause.message)) setErrors({ note: cause.message })
        else setErrors({ summary: cause.message })
      } else {
        setErrors({ summary: errorMessage(cause) })
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="container">
      <Stepper steps={['Service', 'Time', 'Details']} current={2} />

      <div className="grid-2">
        <div className="stack stack--loose">
          <div className="stack stack--tight">
            <span className="eyebrow">Step 3</span>
            <h1>Your details</h1>
            <p className="lede">
              We use these to confirm the booking. Nothing is charged online.
            </p>
          </div>

          <form className="stack stack--loose" onSubmit={handleSubmit} noValidate>
            <Card>
              <CardHeader title="Who is this for?" />

              <div className="stack">
                {customerSession ? (
                  <div className="notice notice--info">
                    <div>
                      <div className="notice__title">Booking as {customerSession.name}</div>
                      <p>
                        This request will appear in your appointments. Signing
                        in as someone else? Sign out first.
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                    {session ? (
                      <div className="notice notice--warning">
                        <div>
                          <div className="notice__title">
                            You are signed in as a {session.role} account
                          </div>
                          <p>
                            Workspace accounts do not create customer
                            appointments. This request will be sent as a guest
                            booking under the name and email below.
                          </p>
                        </div>
                      </div>
                    ) : null}
                    <div className="notice notice--info">
                      <div>
                        <div className="notice__title">Booking as a guest</div>
                        <p>
                          You will get a private link to cancel this request.
                          Have an account?{' '}
                          <Link
                            to={`/signin?next=${encodeURIComponent(`/book/${service.id}/details?start=${startAt}`)}`}
                          >
                            Sign in instead
                          </Link>
                          .
                        </p>
                      </div>
                    </div>

                    <TextField
                      label="Full name"
                      required
                      autoComplete="name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      error={errors.name}
                    />
                    <TextField
                      label="Email"
                      required
                      type="email"
                      autoComplete="email"
                      hint="Used for the confirmation and the cancellation link."
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      error={errors.email}
                    />
                  </>
                )}

                <TextAreaField
                  label="Anything we should know?"
                  hint="Optional. 500 characters maximum."
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  error={errors.note}
                  maxLength={520}
                />
              </div>
            </Card>

            {errors.summary ? (
              <div className="notice notice--error" role="alert">
                <div>
                  <div className="notice__title">We could not send the request</div>
                  <p>{errors.summary}</p>
                  <p>
                    <Link to={`/book/${service.id}?date=${businessDateKey}`}>
                      Choose another time
                    </Link>
                  </p>
                </div>
              </div>
            ) : null}

            <div className="row row--wrap">
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Sending request…' : 'Send request'}
              </Button>
              <Link
                className={buttonClassName('ghost')}
                to={`/book/${service.id}?date=${businessDateKey}`}
              >
                Back to time
              </Link>
            </div>

            <p className="meta">
              Sending this request does not confirm the appointment. The team
              reviews it and emails you when it is confirmed.
            </p>
          </form>
        </div>

        <aside className="summary">
          <Card>
            <CardHeader title="Booking summary" />
            <dl className="summary__list">
              <div className="summary__row">
                <dt>Service</dt>
                <dd>{service.name}</dd>
              </div>
              <div className="summary__row">
                <dt>Duration</dt>
                <dd className="mono">{formatDuration(service.durationMinutes)}</dd>
              </div>
              <div className="summary__row">
                <dt>Date</dt>
                <dd>{formatDateKey(businessDateKey)}</dd>
              </div>
              <div className="summary__row">
                <dt>Time</dt>
                <dd className="mono">
                  {formatTimeRange(startIso, endIso, timezone)}
                </dd>
              </div>
            </dl>
            <hr className="rule" />
            <p className="meta" style={{ marginTop: 'var(--space-3)' }}>
              Business time: {timezone.replace('_', ' ')} ·{' '}
              {formatTime(startIso, timezone)}
            </p>
          </Card>
        </aside>
      </div>
    </div>
  )
}
