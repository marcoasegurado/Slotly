import type { AuthUser } from './types'

/**
 * Bindings available to the Hono Worker. The same names are used by
 * `wrangler dev`, tests and the future production environment.
 */
export interface Env {
  DB: D1Database
  /**
   * Static asset binding provided by Workers when `[assets]` is configured.
   * Optional so unit tests can construct a minimal environment; the Worker
   * always receives it in local development and production.
   */
  ASSETS?: Fetcher
  /**
   * Durable Object namespace that runs PBKDF2 outside the request Worker's
   * CPU budget. Optional so unit tests can construct a minimal environment.
   */
  PASSWORD_HASHER?: DurableObjectNamespace
  ENVIRONMENT?: string
  /** Verified sender for transactional email, for example `Slotly <hello@example.com>`. */
  EMAIL_FROM?: string
  EMAIL_REPLY_TO?: string
  /** `console`, `resend` or `none`. Defaults by environment and key presence. */
  EMAIL_TRANSPORT?: string
  RESEND_API_KEY?: string
}

export type AppEnv = {
  Bindings: Env
  Variables: {
    user: AuthUser
    sessionId: string
  }
}
