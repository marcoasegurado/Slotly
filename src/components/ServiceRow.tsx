import type { Service } from '../lib/api'
import { formatDuration } from '../lib/time'

interface ServiceRowProps {
  service: Service
  selected: boolean
  onSelect: () => void
}

export function ServiceRow({ service, selected, onSelect }: ServiceRowProps) {
  return (
    <button
      type="button"
      className="service-row"
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="service-row__radio" aria-hidden="true" />
      <span>
        <span className="service-row__name">{service.name}</span>
        {service.description ? (
          <span className="service-row__desc" style={{ display: 'block' }}>
            {service.description}
          </span>
        ) : null}
      </span>
      <span className="service-row__duration">
        {formatDuration(service.durationMinutes)}
      </span>
    </button>
  )
}
