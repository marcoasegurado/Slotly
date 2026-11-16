import {
  bytesToHex,
  constantTimeEqual,
  hexToBytes,
  randomBytes,
} from '../lib/encoding'

/**
 * Password hashes are versioned so parameters can be upgraded later:
 * pbkdf2-sha256$v1$<iterations>$<salt-hex>$<hash-hex>
 *
 * 210,000 iterations is the current baseline. Final CPU-cost validation must
 * happen against the actual Workers plan before production deployment.
 */
export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 128
export const PBKDF2_ITERATIONS = 210_000

const ALGORITHM = 'pbkdf2-sha256'
const VERSION = 'v1'
const SALT_BYTES = 16
const HASH_BITS = 256
const MAX_ACCEPTED_ITERATIONS = 2_000_000

export function passwordPolicyError(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Use at least ${PASSWORD_MIN_LENGTH} characters for your password.`
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Keep your password under ${PASSWORD_MAX_LENGTH} characters.`
  }
  return null
}

async function derivePasswordBytes(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations,
    },
    key,
    HASH_BITS,
  )
  return new Uint8Array(bits)
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  const hash = await derivePasswordBytes(password, salt, PBKDF2_ITERATIONS)
  return [
    ALGORITHM,
    VERSION,
    String(PBKDF2_ITERATIONS),
    bytesToHex(salt),
    bytesToHex(hash),
  ].join('$')
}

export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const parts = storedHash.split('$')
  if (parts.length !== 5) return false

  const [algorithm, version, iterationsText, saltHex, hashHex] = parts
  if (algorithm !== ALGORITHM || version !== VERSION) return false

  const iterations = Number(iterationsText)
  if (
    !Number.isInteger(iterations) ||
    iterations < 1 ||
    iterations > MAX_ACCEPTED_ITERATIONS
  ) {
    return false
  }

  const salt = hexToBytes(saltHex)
  const expected = hexToBytes(hashHex)
  if (!salt || !expected || expected.length !== HASH_BITS / 8) return false

  const actual = await derivePasswordBytes(password, salt, iterations)
  return constantTimeEqual(actual, expected)
}

export function passwordNeedsRehash(storedHash: string): boolean {
  const [algorithm, version, iterationsText] = storedHash.split('$')
  return (
    algorithm !== ALGORITHM ||
    version !== VERSION ||
    Number(iterationsText) !== PBKDF2_ITERATIONS
  )
}

let dummyHash: Promise<string> | null = null

/**
 * A real hash used to keep unknown-email login attempts on the same hashing
 * path as known accounts. The value is not a credential.
 */
export function getDummyPasswordHash(): Promise<string> {
  if (!dummyHash) {
    dummyHash = hashPassword('slotly-timing-equalizer-not-a-credential')
  }
  return dummyHash
}
