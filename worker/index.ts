import { app } from './app'
import type { Env } from './env'
import { deliverPendingEmails } from './services/notifications'

export { PasswordHasher } from './durable-objects/password-hasher'

export default {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx)
  },
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      deliverPendingEmails(env).catch((error) => {
        console.error('[email] scheduled delivery failed', error)
      }),
    )
  },
} satisfies ExportedHandler<Env>
