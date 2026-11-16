/**
 * Bindings available to the Hono Worker. The same names are used by
 * `wrangler dev`, tests and the future production environment.
 */
export interface Env {
  DB: D1Database
  ENVIRONMENT?: string
}
