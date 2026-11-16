import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ApiError, createBooking } from '../mock/api'
import { validateSlot, type AvailabilityContext } from '../lib/availability'
import {
  formatDateKey,
  formatDuration,
  formatTime,
  formatTimeRange,
  toDateKey,
} from '../lib/time'
import { errorMessage, useDocumentTitle, useMockDb, useSession } from '../lib/hooks'
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
  const db = useMockDb()
  const session = useSession()

  const service = db.services.find((entry) => entry.id === serviceId) ?? null
  const startAt = searchParams.get('start') ?? ''

  useDocumentTitle('Your details')

  const context: AvailabilityContext = {
    business: db.business,
    staff: db.staff,
    appointments: db.appointments,
  }

  const slotIsValid = service ? validateSlot(context, service, startAt) !== null : false

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<FormErrors>({})
  const [submitting, setSubmitting] = useState(false)

  if (!service || !startAt) {
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

  const businessDateKey = toDateKey(new Date(startAt), db.business.timezone)
  const mode = session ? 'customer' : 'guest'

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
        mode,
        guestName: name,
        guestEmail: email,
        customerNote: note,
      })
      navigate(`/request-received/${result.appointment.publicReference}`, {
        replace: true,
        state: { cancellationToken: result.cancellationToken },
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

          {!slotIsValid ? (
            <Card>
              <StateBlock
                icon="!"
                title="That time is no longer available"
                actions={
                  <>
                    <Link
                      className={buttonClassName('primary')}
                      to={`/book/${service.id}?date=${businessDateKey}`}
                    >
                      Choose another time
                    </Link>
                    <Link className={buttonClassName('secondary')} to="/book">
                      Change service
                    </Link>
                  </>
                }
              >
                Someone else confirmed an overlapping appointment while this page
                was open. Pick a different time to continue.
              </StateBlock>
            </Card>
          ) : (
            <form className="stack stack--loose" onSubmit={handleSubmit} noValidate>
              <Card>
                <CardHeader title="Who is this for?" />

                <div className="stack">
                  {session ? (
                    <div className="notice notice--info">
                      <div>
                        <div className="notice__title">Booking as {session.name}</div>
                        <p>
                          This request will appear in your appointments. Signing
                          in as someone else? Sign out first.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="notice notice--info">
                        <div>
                          <div className="notice__title">Booking as a guest</div>
                          <p>
                            You will get a private link to cancel this request.
                            Have an account?{' '}
                            <Link
                              to={`/signin?next=${encodeURIComponent(`/book/${service.id}/details?start=${encodeURIComponent(startAt)}`)}`}
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
          )}
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
                  {formatTimeRange(startAt, new Date(Date.parse(startAt) + service.durationMinutes * 60_000).toISOString(), db.business.timezone)}
                </dd>
              </div>
            </dl>
            <hr className="rule" />
            <p className="meta" style={{ marginTop: 'var(--space-3)' }}>
              Business time: {db.business.timezone.replace('_', ' ')} ·{' '}
              {formatTime(startAt, db.business.timezone)}
            </p>
          </Card>
        </aside>
      </div>
    </div>
  )
}
