import { useState } from 'react'
import type { FormEvent } from 'react'
import {
  ApiError,
  createService,
  listAdminServices,
  updateService,
  type Service,
} from '../../lib/api'
import { errorMessage, useAsync, useDocumentTitle } from '../../lib/hooks'
import { formatDuration } from '../../lib/time'
import { Button } from '../../components/Button'
import { Card, CardHeader } from '../../components/Card'
import { TextAreaField, TextField } from '../../components/Field'
import { StateBlock } from '../../components/StateBlock'

interface FormErrors {
  name?: string
  durationMinutes?: string
  summary?: string
}

export function AdminServicesPage() {
  useDocumentTitle('Services')

  const services = useAsync(() => listAdminServices(), [])

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [durationMinutes, setDurationMinutes] = useState('60')
  const [errors, setErrors] = useState<FormErrors>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return

    const nextErrors: FormErrors = {}
    if (name.trim().length < 2) nextErrors.name = 'Enter a service name.'
    const duration = Number(durationMinutes)
    if (
      !Number.isInteger(duration) ||
      duration < 5 ||
      duration > 480
    ) {
      nextErrors.durationMinutes = 'Use a whole number between 5 and 480.'
    }
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    setBusy('create')
    setNotice(null)
    try {
      await createService({
        name: name.trim(),
        description: description.trim() ? description.trim() : null,
        durationMinutes: duration,
      })
      setName('')
      setDescription('')
      setDurationMinutes('60')
      setNotice('Service added.')
      services.reload()
    } catch (cause) {
      setErrors({ summary: errorMessage(cause) })
    } finally {
      setBusy(null)
    }
  }

  const toggleActive = async (service: Service) => {
    if (busy) return
    setBusy(service.id)
    setNotice(null)
    try {
      await updateService(service.id, { isActive: !service.isActive })
      setNotice(
        service.isActive
          ? `${service.name} deactivated.`
          : `${service.name} is bookable again.`,
      )
      services.reload()
    } catch (cause) {
      if (
        cause instanceof ApiError &&
        cause.code === 'SERVICE_HAS_FUTURE_BOOKINGS'
      ) {
        setNotice(
          `${service.name} still has future bookings. Resolve or reassign them before deactivating it.`,
        )
      } else {
        setNotice(errorMessage(cause))
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="workspace-page stack stack--loose">
      <div className="stack stack--tight">
        <span className="eyebrow">Catalogue</span>
        <h1 style={{ fontSize: '2rem' }}>Services</h1>
        <p className="lede">
          Every customer booking starts with one of these services. Duration is
          copied onto each appointment, so editing a service never changes the
          length of an existing booking.
        </p>
      </div>

      {notice ? (
        <div className="notice notice--info" role="status">
          <div>
            <p>{notice}</p>
          </div>
        </div>
      ) : null}

      <Card flush>
        <div className="workspace-card-head">
          <CardHeader
            title="All services"
            action={<span className="meta">{services.data?.length ?? 0}</span>}
          />
        </div>

        {services.loading && !services.data ? (
          <div className="workspace-empty">
            <div className="skeleton-row">
              <div className="skeleton" style={{ width: '35%' }} />
              <div className="skeleton" style={{ width: '65%' }} />
            </div>
          </div>
        ) : services.error ? (
          <div className="workspace-empty">
            <StateBlock
              icon="!"
              title="We could not load services"
              actions={
                <Button variant="secondary" size="sm" onClick={services.reload}>
                  Try again
                </Button>
              }
            >
              {services.error.message}
            </StateBlock>
          </div>
        ) : services.data && services.data.length > 0 ? (
          <ul className="staff-list">
            {services.data.map((service) => (
              <li key={service.id} className="staff-row">
                <div className="staff-row__when">
                  <span className="staff-row__time mono">
                    {formatDuration(service.durationMinutes)}
                  </span>
                </div>
                <div className="staff-row__body">
                  <div className="row row--wrap" style={{ gap: 'var(--space-2)' }}>
                    <span className="staff-row__title">{service.name}</span>
                    <span
                      className={`status ${service.isActive ? 'status--confirmed' : 'status--cancelled'}`}
                    >
                      {service.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <span className="staff-row__meta">
                    {service.description ?? 'No description'}
                  </span>
                </div>
                <div className="staff-row__actions">
                  <Button
                    variant={service.isActive ? 'secondary' : 'primary'}
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => void toggleActive(service)}
                  >
                    {busy === service.id
                      ? 'Saving…'
                      : service.isActive
                        ? 'Deactivate'
                        : 'Reactivate'}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="workspace-empty">
            <StateBlock icon="0" title="No services yet">
              Add the first service below. Customers cannot book until at least
              one service is active.
            </StateBlock>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Add a service" />
        <form className="stack" onSubmit={submit} noValidate>
          <TextField
            label="Service name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            error={errors.name}
            maxLength={80}
          />
          <TextAreaField
            label="Description"
            hint="Optional. Shown on the public booking page."
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={400}
          />
          <TextField
            label="Duration (minutes)"
            required
            type="number"
            min={5}
            max={480}
            step={5}
            value={durationMinutes}
            onChange={(event) => setDurationMinutes(event.target.value)}
            error={errors.durationMinutes}
            hint="Whole minutes, 5 to 480."
          />

          {errors.summary ? (
            <div className="notice notice--error" role="alert">
              <div>
                <div className="notice__title">We could not add it</div>
                <p>{errors.summary}</p>
              </div>
            </div>
          ) : null}

          <div>
            <Button type="submit" disabled={busy !== null}>
              {busy === 'create' ? 'Adding…' : 'Add service'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}
