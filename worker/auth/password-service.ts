import type { Env } from '../env'
import { hashPassword, verifyPassword } from './password'

/**
 * The Durable Object stub surface used by password hashing. Kept structural so
 * the request Worker does not import the Durable Object class at runtime.
 */
interface PasswordHasherStub {
  hash(password: string): Promise<string>
  verify(password: string, storedHash: string): Promise<boolean>
}

function passwordHasher(env: Env, subject: string): PasswordHasherStub | null {
  if (!env.PASSWORD_HASHER) return null
  const id = env.PASSWORD_HASHER.idFromName(subject.trim().toLowerCase())
  return env.PASSWORD_HASHER.get(id) as unknown as PasswordHasherStub
}

/**
 * Hashes through the PasswordHasher Durable Object when the binding exists.
 * Unit tests and local scripts have no binding, so they fall back to the same
 * implementation in-process. The fallback is never a weaker algorithm.
 */
export async function hashPasswordFor(
  env: Env,
  subject: string,
  password: string,
): Promise<string> {
  const hasher = passwordHasher(env, subject)
  return hasher ? await hasher.hash(password) : await hashPassword(password)
}

export async function verifyPasswordFor(
  env: Env,
  subject: string,
  password: string,
  storedHash: string,
): Promise<boolean> {
  const hasher = passwordHasher(env, subject)
  return hasher
    ? await hasher.verify(password, storedHash)
    : await verifyPassword(password, storedHash)
}
