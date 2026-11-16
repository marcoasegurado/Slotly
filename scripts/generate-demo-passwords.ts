/**
 * Generates local-only demo password hashes for `seed/local.sql`.
 *
 * Usage:
 *   npm run auth:hash:demo
 *
 * The demo password defaults to `slotly-demo`. Override it for a one-off local
 * database with `SLOTLY_DEMO_PASSWORD=... npm run auth:hash:demo`. The output
 * contains only versioned PBKDF2 hashes, never the plaintext password.
 */
import { hashPassword, PBKDF2_ITERATIONS } from '../worker/auth/password'

const DEMO_PASSWORD = process.env.SLOTLY_DEMO_PASSWORD ?? 'slotly-demo'

const DEMO_USERS = [
  {
    id: 'usr_maria',
    name: 'Maria Santos',
    email: 'maria@example.com',
    role: 'customer',
  },
  {
    id: 'usr_ana',
    name: 'Ana Reyes',
    email: 'ana@slotly.studio',
    role: 'staff',
  },
  {
    id: 'usr_ben',
    name: 'Ben Cruz',
    email: 'ben@slotly.studio',
    role: 'staff',
  },
  {
    id: 'usr_ciel',
    name: 'Ciel Santos',
    email: 'ciel@slotly.studio',
    role: 'staff',
  },
  {
    id: 'usr_admin',
    name: 'Slotly Admin',
    email: 'admin@slotly.studio',
    role: 'admin',
  },
] as const

function quote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

async function main(): Promise<void> {
  if (DEMO_PASSWORD.length < 8) {
    throw new Error('SLOTLY_DEMO_PASSWORD must be at least 8 characters.')
  }

  console.log(
    `-- Generated locally with PBKDF2-HMAC-SHA-256 at ${PBKDF2_ITERATIONS} iterations.`,
  )
  console.log('-- Do not commit a plaintext password. Demo sign-in is documented in README.md.')
  console.log('')

  for (const user of DEMO_USERS) {
    const passwordHash = await hashPassword(DEMO_PASSWORD)
    console.log(
      `INSERT INTO users (
  id, name, email, password_hash, role, is_active,
  must_change_password, created_at, updated_at
)
VALUES (
  ${quote(user.id)},
  ${quote(user.name)},
  ${quote(user.email)},
  ${quote(passwordHash)},
  ${quote(user.role)},
  1,
  0,
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
  temporary_password_expires_at = NULL,
  updated_at = unixepoch();`,
    )
    console.log('')
  }

  console.log('INSERT INTO staff_profiles (user_id) VALUES')
  console.log(
    DEMO_USERS.filter((user) => user.role === 'staff')
      .map((user) => `  (${quote(user.id)})`)
      .join(',\n'),
  )
  console.log('ON CONFLICT (user_id) DO NOTHING;')
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
