import { DurableObject } from 'cloudflare:workers'
import { hashPassword, verifyPassword } from '../auth/password'

/**
 * Runs PBKDF2 outside the request Worker's CPU budget.
 *
 * Workers Free allows only 10 ms of CPU per request, while PBKDF2 at the
 * runtime's 100,000-iteration ceiling costs roughly 120 ms. Durable Objects get
 * their own CPU budget (30 s per request on both plans), so the request Worker
 * only pays for the RPC round trip. Each subject (email or user id) maps to its
 * own object, which also keeps concurrent logins from serializing behind one
 * single-threaded instance.
 */
export class PasswordHasher extends DurableObject {
  async hash(password: string): Promise<string> {
    return await hashPassword(password)
  }

  async verify(password: string, storedHash: string): Promise<boolean> {
    return await verifyPassword(password, storedHash)
  }
}
