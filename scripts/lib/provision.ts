/**
 * Shared helpers for the one-off production provisioning scripts.
 *
 * These scripts run locally on the operator's machine and emit SQL for
 * `wrangler d1 execute --remote --file=...`. They never print a plaintext
 * password to stdout: generated credentials are written to a mode-0600 file
 * inside a gitignored directory so the operator can read them once.
 */
import { randomInt } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** Ambiguous characters (0/O, 1/I/l) are omitted for out-of-band sharing. */
const PASSWORD_ALPHABET =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'

export const SECRETS_DIR = process.env.SLOTLY_SECRETS_DIR ?? '.local-secrets'

export function quote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

export function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`Set ${name} before running this command.`)
  }
  return value
}

/** 20 characters from a 56-symbol alphabet is roughly 116 bits. */
export function generatePassword(length = 20): string {
  let password = ''
  for (let index = 0; index < length; index += 1) {
    password += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)]
  }
  return password
}

/** Writes a file readable only by the current user. */
export function writePrivateFile(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, contents, { mode: 0o600 })
}

/** Writes SQL that is meant to be reviewed and then applied once. */
export function writeSqlFile(path: string, statements: string): void {
  writePrivateFile(path, `${statements}\n`)
}
