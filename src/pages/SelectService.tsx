import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listServices } from '../mock/api'
import { useAsync, useDocumentTitle } from '../lib/hooks'
import { ServiceRow } from '../components/ServiceRow'
import { Stepper } from '../components/Stepper'
import { Button } from '../components/Button'
import { Card, CardHeader } from '../components/Card'
import { StateBlock } from '../components/StateBlock'

export function SelectServicePage() {
  useDocumentTitle('Choose a service')
  const navigate = useNavigate()
  const services = useAsync(() => listServices(), [])
  const [selectedId, setSelectedId] = useState<string | null>(null)

  return (
    <div className="container">
      <Stepper steps={['Service', 'Time', 'Details']} current={0} />

      <div className="grid-2">
        <div className="stack stack--loose">
          <div className="stack stack--tight">
            <span className="eyebrow">Step 1</span>
            <h1>Choose a service</h1>
            <p className="lede">
              Durations are set by the business and included in every booking.
              You can review it again before you send the request.
            </p>
          </div>

          {services.loading && !services.data ? (
            <div className="service-list">
              {[0, 1, 2].map((key) => (
                <div className="card skeleton-row" key={key}>
                  <div className="skeleton" style={{ width: '45%' }} />
                  <div className="skeleton" style={{ width: '80%' }} />
                </div>
              ))}
            </div>
          ) : services.error ? (
            <Card>
              <StateBlock
                icon="!"
                title="We could not load the services"
                actions={
                  <Button variant="secondary" size="sm" onClick={services.reload}>
                    Try again
                  </Button>
                }
              >
                {services.error.message}
              </StateBlock>
            </Card>
          ) : (services.data ?? []).length === 0 ? (
            <Card>
              <StateBlock icon="—" title="No services are bookable right now">
                The business has not published any services. Please check back
                later or contact them directly.
              </StateBlock>
            </Card>
          ) : (
            <div className="service-list" role="group" aria-label="Services">
              {(services.data ?? []).map((service) => (
                <ServiceRow
                  key={service.id}
                  service={service}
                  selected={selectedId === service.id}
                  onSelect={() => setSelectedId(service.id)}
                />
              ))}
            </div>
          )}

          <div className="row row--wrap">
            <Button
              disabled={!selectedId}
              onClick={() => {
                if (selectedId) navigate(`/book/${selectedId}`)
              }}
            >
              Continue to time
            </Button>
            <Button variant="ghost" onClick={() => navigate('/')}>
              Back
            </Button>
          </div>
        </div>

        <aside className="summary">
          <Card>
            <CardHeader title="Good to know" />
            <ul className="stack stack--tight text-sm secondary">
              <li>Times are shown in the business timezone.</li>
              <li>
                Sending a request does not confirm the booking — the team
                reviews it first.
              </li>
              <li>Payment happens at the business location.</li>
              <li>You will not be asked to choose a staff member.</li>
            </ul>
          </Card>
        </aside>
      </div>
    </div>
  )
}
