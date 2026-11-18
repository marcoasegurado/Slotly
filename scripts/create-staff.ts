/**
 * Creates the production Staff accounts.
 *
 *   npm run staff:create
 *
 * Generates one temporary password per staff member, stored only as a PBKDF2
 * hash. The plaintext values are written to
 * `.local-secrets/staff-credentials.txt` (mode 0600) so they can be delivered
 * out of band, and never printed to stdout.
 *
 * Each account must change its password at first sign-in and the temporary
 * password expires after 72 hours. Weekly working hours match the local demo
 * data, so availability is non-empty the day after the run.
 *
 * Apply the generated file only against the approved production database:
 *
 *   npx wrangler d1 execute DB --remote --file=.local-secrets/create-staff.sql
 *
 * Then hand each password over privately, delete `.local-secrets`, and let the
 * staff member set their own password.
 */
import { hashPassword } from '../worker/auth/password'
import {
  generatePassword,
  quote,
  SECRETS_DIR,
  writePrivateFile,
  writeSqlFile,
} from './lib/provision'

interface WorkingHours {
  /** Singular suffix used in the row id. */
  key: string
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number
  startMinute: number
  endMinute: number
}

interface StaffSeed {
  id: string
  name: string
  email: string
  hours: WorkingHours[]
}

const TEMPORARY_PASSWORD_TTL_SECONDS = 72 * 60 * 60

const STAFF: StaffSeed[] = [
  {
    id: 'usr_ana',
    name: 'Ana Reyes',
    email: 'ana@slotly.studio',
    hours: [
      { key: 'mon', weekday: 1, startMinute: 540, endMinute: 1020 },
      { key: 'tue', weekday: 2, startMinute: 540, endMinute: 1020 },
      { key: 'wed', weekday: 3, startMinute: 540, endMinute: 1020 },
      { key: 'thu', weekday: 4, startMinute: 540, endMinute: 1020 },
      { key: 'fri', weekday: 5, startMinute: 540, endMinute: 1020 },
    ],
  },
  {
    id: 'usr_ben',
    name: 'Ben Cruz',
    email: 'ben@slotly.studio',
    hours: [
      { key: 'tue', weekday: 2, startMinute: 600, endMinute: 1080 },
      { key: 'wed', weekday: 3, startMinute: 600, endMinute: 1080 },
      { key: 'thu', weekday: 4, startMinute: 600, endMinute: 1080 },
      { key: 'fri', weekday: 5, startMinute: 600, endMinute: 1080 },
      { key: 'sat', weekday: 6, startMinute: 600, endMinute: 1080 },
    ],
  },
  {
    id: 'usr_ciel',
    name: 'Ciel Santos',
    email: 'ciel@slotly.studio',
    hours: [
      { key: 'mon_am', weekday: 1, startMinute: 480, endMinute: 720 },
      { key: 'mon_pm', weekday: 1, startMinute: 780, endMinute: 1020 },
      { key: 'wed_am', weekday: 3, startMinute: 480, endMinute: 720 },
      { key: 'wed_pm', weekday: 3, startMinute: 780, endMinute: 1020 },
      { key: 'fri_am', weekday: 5, startMinute: 480, endMinute: 720 },
      { key: 'fri_pm', weekday: 5, startMinute: 780, endMinute: 1020 },
    ],
  },
]

async function main(): Promise<void> {
  const statements: string[] = [
    '-- Production Staff accounts with one-time temporary passwords.',
    '-- Never commit this file. Delete it after the approved run.',
    '',
  ]

  const credentials: string[] = []
  const expiresAt = new Date(
    (Math.floor(Date.now() / 1000) + TEMPORARY_PASSWORD_TTL_SECONDS) * 1000,
  ).toISOString()

  for (const staff of STAFF) {
    const password = generatePassword()
    const passwordHash = await hashPassword(password)

    statements.push(
      `INSERT INTO users (
  id, name, email, password_hash, role, is_active,
  must_change_password, temporary_password_expires_at, created_at, updated_at
)
VALUES (
  ${quote(staff.id)},
  ${quote(staff.name)},
  ${quote(staff.email)},
  ${quote(passwordHash)},
  'staff',
  1,
  1,
  unixepoch() + ${TEMPORARY_PASSWORD_TTL_SECONDS},
  unixepoch(),
  unixepoch()
)
ON CONFLICT (id) DO UPDATE SET
  name = excluded.name,
  email = excluded.email,
  password_hash = excluded.password_hash,
  role = excluded.role,
  is_active = excluded.is_active,
  must_change_password = excluded.must_change_password,
  temporary_password_expires_at = excluded.temporary_password_expires_at,
  updated_at = unixepoch();
`,
    )

    statements.push(
      `INSERT INTO staff_profiles (user_id) VALUES (${quote(staff.id)})
ON CONFLICT (user_id) DO NOTHING;
`,
    )

    const values = staff.hours
      .map(
        (hours) =>
          `  (${quote(`hrs_${staff.id.replace(/^usr_/, '')}_${hours.key}`)}, ` +
          `${quote(staff.id)}, ${hours.weekday}, ${hours.startMinute}, ${hours.endMinute})`,
      )
      .join(',\n')

    statements.push(
      `INSERT INTO staff_working_hours (
  id, staff_user_id, weekday, start_minute, end_minute
)
VALUES
${values}
ON CONFLICT (id) DO UPDATE SET
  staff_user_id = excluded.staff_user_id,
  weekday = excluded.weekday,
  start_minute = excluded.start_minute,
  end_minute = excluded.end_minute;
`,
    )

    credentials.push(
      `${staff.name} <${staff.email}>\n` +
        `Temporary password: ${password}\n` +
        `Must change at first sign-in; expires ${expiresAt}.\n`,
    )
  }

  writeSqlFile(`${SECRETS_DIR}/create-staff.sql`, statements.join('\n'))
  writePrivateFile(
    `${SECRETS_DIR}/staff-credentials.txt`,
    `${credentials.join('\n')}`,
  )

  console.log(`Wrote ${SECRETS_DIR}/create-staff.sql (${STAFF.length} accounts).`)
  console.log(`Wrote ${SECRETS_DIR}/staff-credentials.txt (mode 0600).`)
  console.log('Deliver each password privately, then delete the directory.')
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
