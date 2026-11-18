/**
 * Creates the initial production services.
 *
 *   npm run services:create
 *
 * Idempotent: re-running updates the name, description, duration and active
 * flag for the same ids. Renaming a service never changes an existing
 * appointment, because each appointment stores a name/duration snapshot.
 *
 * Apply the generated file only against the approved production database:
 *
 *   npx wrangler d1 execute DB --remote --file=.local-secrets/create-services.sql
 */
import { quote, SECRETS_DIR, writeSqlFile } from './lib/provision'

interface ServiceSeed {
  id: string
  name: string
  description: string
  durationMinutes: number
}

const SERVICES: ServiceSeed[] = [
  {
    id: 'svc_consultation',
    name: 'Consultation',
    description: 'A short session to scope the work and answer questions.',
    durationMinutes: 30,
  },
  {
    id: 'svc_follow_up',
    name: 'Follow-up',
    description: 'A check-in after a previous appointment.',
    durationMinutes: 45,
  },
  {
    id: 'svc_standard_session',
    name: 'Standard Session',
    description: 'The usual appointment length for most bookings.',
    durationMinutes: 60,
  },
  {
    id: 'svc_extended_session',
    name: 'Extended Session',
    description: 'A longer appointment for work that needs more time.',
    durationMinutes: 90,
  },
]

function main(): void {
  const values = SERVICES.map(
    (service) =>
      `  (${quote(service.id)}, ${quote(service.name)}, ` +
      `${quote(service.description)}, ${service.durationMinutes}, 1)`,
  ).join(',\n')

  const sql = `-- Initial production services.
-- Never commit this file. Delete it after the approved run.
INSERT INTO services (id, name, description, duration_minutes, is_active)
VALUES
${values}
ON CONFLICT (id) DO UPDATE SET
  name = excluded.name,
  description = excluded.description,
  duration_minutes = excluded.duration_minutes,
  is_active = excluded.is_active,
  updated_at = unixepoch();
`

  writeSqlFile(`${SECRETS_DIR}/create-services.sql`, sql)
  console.log(`Wrote ${SECRETS_DIR}/create-services.sql (${SERVICES.length} services).`)
}

main()
