/**
 * Generates the one-time Admin INSERT used to bootstrap a production D1
 * database. Run it locally and redirect the output to a temporary file:
 *
 *   SLOTLY_ADMIN_NAME="Business Owner" \
 *   SLOTLY_ADMIN_EMAIL="owner@example.com" \
 *   SLOTLY_ADMIN_PASSWORD="a-long-unique-password" \
 *   npm run auth:hash:admin > bootstrap-admin.sql
 *
 * The SQL contains only the versioned PBKDF2 hash; the plaintext password is
 * never printed. Keep the generated file out of version control and delete it
 * after the approved production run.
 */
import { hashPassword, passwordPolicyError } from '../worker/auth/password'

function quote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`Set ${name} before running this command.`)
  }
  return value
}

async function main(): Promise<void> {
  const name = requiredEnv('SLOTLY_ADMIN_NAME')
  const email = requiredEnv('SLOTLY_ADMIN_EMAIL').toLowerCase()
  const password = process.env.SLOTLY_ADMIN_PASSWORD ?? ''

  if (name.length < 2) {
    throw new Error('SLOTLY_ADMIN_NAME must be at least 2 characters.')
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('SLOTLY_ADMIN_EMAIL must be a valid email address.')
  }
  const policyError = passwordPolicyError(password)
  if (policyError) {
    throw new Error(`SLOTLY_ADMIN_PASSWORD: ${policyError}`)
  }

  const passwordHash = await hashPassword(password)

  console.log('-- Generated locally. Do not commit this file or the password.')
  console.log('-- Run only against the approved production D1 database.')
  console.log(
    `INSERT INTO users (
  id, name, email, password_hash, role, is_active,
  must_change_password, created_at, updated_at
)
VALUES (
  ${quote('usr_admin')},
  ${quote(name)},
  ${quote(email)},
  ${quote(passwordHash)},
  'admin',
  1,
  0,
  unixepoch(),
  unixepoch()
);`,
  )
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
