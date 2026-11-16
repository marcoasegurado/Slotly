import { Link } from 'react-router-dom'
import { listServices } from '../mock/api'
import { useAsync, useDocumentTitle, useMockDb } from '../lib/hooks'
import { formatDuration } from '../lib/time'
import { buttonClassName } from '../components/Button'

const STEPS = [
  {
    number: '01',
    title: 'Choose a service',
    body: 'Pick what you need. Each service shows its length up front.',
  },
  {
    number: '02',
    title: 'Pick a date and time',
    body: 'Only times the business can actually cover appear in the calendar.',
  },
  {
    number: '03',
    title: 'We review and confirm',
    body: 'Your request is reviewed by the team. You get an email when it is confirmed.',
  },
]

export function LandingPage() {
  useDocumentTitle('Book an appointment')
  const db = useMockDb()
  const services = useAsync(() => listServices(), [])

  return (
    <div className="container">
      <section className="hero">
        <div className="hero__copy">
          <span className="eyebrow">Appointments</span>
          <h1 className="hero__title">
            Book a time that actually holds.
          </h1>
          <p className="lede">
            Choose a service, pick a time that suits you, and send a request.
            The {db.business.businessName} team reviews every booking before it
            is confirmed — no double-bookings, no guessing.
          </p>
          <div className="row row--wrap">
            <Link className={buttonClassName('primary')} to="/book">
              Book an appointment
            </Link>
            <Link className={buttonClassName('secondary')} to="/signin">
              Sign in
            </Link>
          </div>
          <p className="meta">
            Payment is handled at the business location. No card details needed.
          </p>
        </div>

        <aside className="hero__panel" aria-label="How booking works">
          <div className="hero__panel-head">
            <h2 style={{ fontSize: '1.0625rem' }}>How it works</h2>
            <span className="meta">3 steps</span>
          </div>
          <ol className="stack stack--tight">
            {STEPS.map((step) => (
              <li key={step.number} className="preview-row">
                <span className="mono muted" style={{ paddingTop: 2 }}>
                  {step.number}
                </span>
                <span style={{ flex: 1 }}>
                  <span style={{ fontWeight: 500 }}>{step.title}</span>
                  <span className="service-row__desc" style={{ display: 'block' }}>
                    {step.body}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </aside>
      </section>

      <section className="stack stack--loose" aria-labelledby="services-heading">
        <div className="row row--between row--wrap">
          <div className="stack stack--tight">
            <span className="eyebrow">Catalogue</span>
            <h2 id="services-heading">Services</h2>
          </div>
          <Link className={buttonClassName('secondary', 'btn--sm')} to="/book">
            Choose a service
          </Link>
        </div>

        {services.loading && !services.data ? (
          <div className="grid-cards">
            {[0, 1, 2].map((key) => (
              <div className="card skeleton-row" key={key}>
                <div className="skeleton" style={{ width: '60%' }} />
                <div className="skeleton" style={{ width: '90%' }} />
                <div className="skeleton" style={{ width: '30%' }} />
              </div>
            ))}
          </div>
        ) : services.error ? (
          <div className="notice notice--error">
            <div>
              <div className="notice__title">Services could not be loaded</div>
              <p>{services.error.message}</p>
            </div>
          </div>
        ) : (
          <ul className="grid-cards">
            {(services.data ?? []).map((service) => (
              <li className="card stack stack--tight" key={service.id}>
                <span className="mono muted text-sm">
                  {formatDuration(service.durationMinutes)}
                </span>
                <h3>{service.name}</h3>
                <p className="secondary text-sm">{service.description}</p>
                <Link
                  className="text-sm"
                  to={`/book/${service.id}`}
                  style={{ marginTop: 'var(--space-2)' }}
                >
                  Book this service
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="stack" style={{ marginTop: 'var(--space-12)' }}>
        <span className="eyebrow">Before you book</span>
        <div className="grid-cards">
          <div className="card stack stack--tight">
            <h3>Requests are held by review</h3>
            <p className="secondary text-sm">
              A pending request does not block the slot yet. Only a confirmed
              appointment does, so two people can ask for the same time and the
              team resolves it.
            </p>
          </div>
          <div className="card stack stack--tight">
            <h3>Cancel a request yourself</h3>
            <p className="secondary text-sm">
              Pending requests can be cancelled from the link in your email.
              Once confirmed, contact the business so they can help.
            </p>
          </div>
          <div className="card stack stack--tight">
            <h3>You never pick a person</h3>
            <p className="secondary text-sm">
              The team assigns whoever is available. You only choose what you
              need and when.
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}
