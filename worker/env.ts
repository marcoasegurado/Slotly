import type { AuthUser } from './types'

/**
 * Bindings available to the Hono Worker. The same names are used by
 * `wrangler dev`, tests and the future production environment.
 */
export interface Env {
  DB: D1Database
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
