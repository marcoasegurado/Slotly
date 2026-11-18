/**
 * Resets the production Admin password.
 *
 *   npm run admin:reset
 *
 * A random password is generated unless SLOTLY_ADMIN_PASSWORD is set. The SQL
 * is written to `.local-secrets/reset-admin.sql` and the generated password to
 * `.local-secrets/admin-password.txt` (mode 0600). Neither is printed to
 * stdout, so the value never lands in shell history or CI logs.
 *
 * Apply the generated file only against the approved production database:
 *
 *   npx wrangler d1 execute DB --remote --file=.local-secrets/reset-admin.sql
 *
 * Then read the password once, delete both files, and sign in. The reset also
 * revokes every existing session for that account.
 */
import { hashPassword, passwordPolicyError } from '../worker/auth/password'
import {
  generatePassword,
  quote,
  SECRETS_DIR,
  writePrivateFile,
  writeSqlFile,
} from './lib/provision'

const ADMIN_EMAIL = (process.env.SLOTLY_ADMIN_EMAIL ?? 'admin@slotly.studio')
  .trim()
  .toLowerCase()

async function main(): Promise<void> {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ADMIN_EMAIL)) {
    throw new Error('SLOTLY_ADMIN_EMAIL must be a valid email address.')
  }

  const provided = process.env.SLOTLY_ADMIN_PASSWORD
  const password = provided?.length ? provided : generatePassword()
  const policyError = passwordPolicyError(password)
  if (policyError) {
    throw new Error(`SLOTLY_ADMIN_PASSWORD: ${policyError}`)
  }

  const passwordHash = await hashPassword(password)

  const sql = `-- Reset the production Admin password.
-- Never commit this file. Delete it after the approved run.
UPDATE users
   SET password_hash = ${quote(passwordHash)},
       must_change_password = 0,
       temporary_password_expires_at = NULL,
       password_changed_at = unixepoch(),
       updated_at = unixepoch()
 WHERE email = ${quote(ADMIN_EMAIL)};

-- A password reset must not leave old sessions usable.
DELETE FROM sessions
 WHERE user_id = (SELECT id FROM users WHERE email = ${quote(ADMIN_EMAIL)});
`

  writeSqlFile(`${SECRETS_DIR}/reset-admin.sql`, sql)

  if (provided?.length) {
    console.log(`Wrote ${SECRETS_DIR}/reset-admin.sql for ${ADMIN_EMAIL}.`)
    console.log('Password came from SLOTLY_ADMIN_PASSWORD; no file was created.')
  } else {
    writePrivateFile(
      `${SECRETS_DIR}/admin-password.txt`,
      `${ADMIN_EMAIL}\n${password}\n`,
    )
    console.log(`Wrote ${SECRETS_DIR}/reset-admin.sql for ${ADMIN_EMAIL}.`)
    console.log(`Wrote ${SECRETS_DIR}/admin-password.txt (mode 0600).`)
  }

  console.log(
    'Apply it, read the password once, then delete both files: rm -rf ' +
      SECRETS_DIR,
  )
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
