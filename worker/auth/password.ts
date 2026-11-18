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
 * 100,000 iterations is the maximum the Cloudflare Workers runtime accepts for
 * PBKDF2-HMAC-SHA-256; workerd rejects higher counts at runtime. The hash runs
 * inside the PasswordHasher Durable Object so the cost does not count against
 * the request Worker's CPU budget (10 ms on the Free plan).
 */
export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 128
export const PBKDF2_ITERATIONS = 100_000

const ALGORITHM = 'pbkdf2-sha256'
const VERSION = 'v1'
const SALT_BYTES = 16
const HASH_BITS = 256
const MAX_ACCEPTED_ITERATIONS = 100_000

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

  let actual: Uint8Array
  try {
    actual = await derivePasswordBytes(password, salt, iterations)
  } catch {
    return false
  }
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

/**
 * A real hash used to keep unknown-email login attempts on the same hashing
 * path as known accounts. The value is not a credential, and it is a constant
 * so the request Worker never derives it on the CPU-budgeted path.
 */
export const DUMMY_PASSWORD_HASH =
  'pbkdf2-sha256$v1$100000$9bd0173cbd23e888efdc49562f87e9fd$2bd857aaa0ffac6fe88bf4c9b0a2f794ba0db3f1e734e633bb2b316570833480'

export function getDummyPasswordHash(): Promise<string> {
  return Promise.resolve(DUMMY_PASSWORD_HASH)
}
