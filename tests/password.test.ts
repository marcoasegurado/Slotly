import { beforeAll, describe, expect, it } from 'vitest'
import {
  getDummyPasswordHash,
  hashPassword,
  passwordNeedsRehash,
  passwordPolicyError,
  PBKDF2_ITERATIONS,
  verifyPassword,
} from '../worker/auth/password'

describe('password policy', () => {
  it('enforces the documented length bounds', () => {
    expect(passwordPolicyError('short')).toMatch(/at least 8/i)
    expect(passwordPolicyError('a'.repeat(8))).toBeNull()
    expect(passwordPolicyError('a'.repeat(128))).toBeNull()
    expect(passwordPolicyError('a'.repeat(129))).toMatch(/under 128/i)
  })
})

describe('PBKDF2 password hashing', () => {
  let storedHash: string

  beforeAll(async () => {
    storedHash = await hashPassword('correct horse battery staple')
  })

  it('stores a versioned hash and never the plaintext password', () => {
    expect(storedHash).toMatch(
      /^pbkdf2-sha256\$v1\$100000\$[0-9a-f]{32}\$[0-9a-f]{64}$/,
    )
    expect(storedHash).not.toContain('correct horse battery staple')
    expect(storedHash.split('$')[2]).toBe(String(PBKDF2_ITERATIONS))
  })

  it('verifies the correct password and rejects a wrong one', async () => {
    await expect(
      verifyPassword('correct horse battery staple', storedHash),
    ).resolves.toBe(true)
    await expect(verifyPassword('wrong password', storedHash)).resolves.toBe(
      false,
    )
    await expect(verifyPassword('', storedHash)).resolves.toBe(false)
  })

  it('rejects malformed or unsupported stored hashes without throwing', async () => {
    const malformed = [
      '',
      'not-a-hash',
      'pbkdf2-sha256$v1$210000$salthex',
      'pbkdf2-sha256$v2$210000$84f27f6fcc5eb9d2a27ff451f2d324c6$ac6f14a5f94534c36f2ce1f59fee94ed116d46bea1c043ba7b608d05812bb774',
      'scrypt$v1$210000$84f27f6fcc5eb9d2a27ff451f2d324c6$ac6f14a5f94534c36f2ce1f59fee94ed116d46bea1c043ba7b608d05812bb774',
      'pbkdf2-sha256$v1$0$84f27f6fcc5eb9d2a27ff451f2d324c6$ac6f14a5f94534c36f2ce1f59fee94ed116d46bea1c043ba7b608d05812bb774',
      'pbkdf2-sha256$v1$999999999$84f27f6fcc5eb9d2a27ff451f2d324c6$ac6f14a5f94534c36f2ce1f59fee94ed116d46bea1c043ba7b608d05812bb774',
      'pbkdf2-sha256$v1$210000$zzzz$ac6f14a5f94534c36f2ce1f59fee94ed116d46bea1c043ba7b608d05812bb774',
      'pbkdf2-sha256$v1$210000$84f27f6fcc5eb9d2a27ff451f2d324c6$abcd',
    ]

    for (const hash of malformed) {
      await expect(verifyPassword('anything', hash)).resolves.toBe(false)
    }
  })

  it('flags only hashes that need upgrading', () => {
    expect(passwordNeedsRehash(storedHash)).toBe(false)
    expect(
      passwordNeedsRehash(
        storedHash.replace(`$v1$${PBKDF2_ITERATIONS}$`, '$v1$50000$'),
      ),
    ).toBe(true)
    expect(passwordNeedsRehash(storedHash.replace('$v1$', '$v2$'))).toBe(true)
    expect(passwordNeedsRehash('garbage')).toBe(true)
  })

  it('provides a valid dummy hash for timing-equalized login failures', async () => {
    const dummy = await getDummyPasswordHash()
    expect(dummy).toMatch(/^pbkdf2-sha256\$v1\$/)
    await expect(verifyPassword('not-the-dummy-password', dummy)).resolves.toBe(
      false,
    )
  })
})
