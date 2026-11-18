import { describe, expect, it } from 'vitest'
import {
  hashPasswordFor,
  verifyPasswordFor,
} from '../worker/auth/password-service'
import { verifyPassword } from '../worker/auth/password'
import type { Env } from '../worker/env'

describe('password hashing service', () => {
  it('falls back to in-process hashing without a Durable Object binding', async () => {
    const env = {} as Env
    const hash = await hashPasswordFor(env, 'user@example.com', 'correct horse')

    expect(hash).toMatch(/^pbkdf2-sha256\$v1\$100000\$/)
    await expect(verifyPassword('correct horse', hash)).resolves.toBe(true)
    await expect(
      verifyPasswordFor(env, 'user@example.com', 'correct horse', hash),
    ).resolves.toBe(true)
    await expect(
      verifyPasswordFor(env, 'user@example.com', 'wrong horse', hash),
    ).resolves.toBe(false)
  })

  it('routes hashing and verification through the Durable Object', async () => {
    const subjects: string[] = []
    const calls: Array<{ method: string; args: unknown[] }> = []
    const binding = {
      idFromName(name: string) {
        subjects.push(name)
        return 'password-hasher-id'
      },
      get() {
        return {
          async hash(...args: unknown[]) {
            calls.push({ method: 'hash', args })
            return 'hashed-in-durable-object'
          },
          async verify(...args: unknown[]) {
            calls.push({ method: 'verify', args })
            return true
          },
        }
      },
    }
    const env = { PASSWORD_HASHER: binding } as unknown as Env

    await expect(
      hashPasswordFor(env, ' User@Example.com ', 'secret'),
    ).resolves.toBe('hashed-in-durable-object')
    await expect(
      verifyPasswordFor(env, 'user@example.com', 'secret', 'stored-hash'),
    ).resolves.toBe(true)

    expect(subjects).toEqual(['user@example.com', 'user@example.com'])
    expect(calls).toEqual([
      { method: 'hash', args: ['secret'] },
      { method: 'verify', args: ['secret', 'stored-hash'] },
    ])
  })
})
