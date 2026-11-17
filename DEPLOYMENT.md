# Slotly deployment runbook

Phase 10 prepares the Cloudflare deployment. **Nothing in this file has been
executed against Cloudflare.** Creating resources, enabling billing, applying
remote migrations, bootstrapping production data and deploying all require
explicit approval for that exact step.

The project target is one Cloudflare Worker with static assets, one D1 database
and the email integration from Phase 8. There is no multi-tenant setup.

## 1. Decisions required before any remote command

1. **Workers plan and PBKDF2 cost.** Login and registration hash passwords with
   PBKDF2-HMAC-SHA-256. `npm run auth:bench` measured roughly 250-300 ms per
   hash/verify on the development machine at the current 210,000 iterations.
   That exceeds the Workers Free plan's 10 ms CPU budget per request. Either
   deploy on a plan whose CPU limit fits the chosen work factor, or lower the
   documented iterations and re-evaluate the security trade-off. Do not deploy
   on Free with the current parameters.
2. **Production domain.** Needed for `Origin`/cookie behavior and for a verified
   Resend sender. Do not invent a domain.
3. **Email sender.** A Resend account with a verified domain (SPF/DKIM) and a
   `RESEND_API_KEY`. The repository only contains a placeholder sender.
4. **Production D1 database.** Created by the project owner; the real
   `database_id` replaces the all-zero placeholder in `wrangler.toml` at
   deployment time. Never commit a guessed ID.
5. **First Admin account.** Production is not seeded with demo data. Use the
   bootstrap steps in section 4.

## 2. Preflight (local, no remote changes)

```bash
npm ci
npm run typecheck
npm test
npm run build
npx wrangler whoami
```

- `npm run build` writes the client to `dist/`; confirm `dist/_headers` exists,
  because Vite copies `public/_headers` into the build output.
- Confirm `.dev.vars`, `dist/` and `.wrangler/` are untracked, and that no real
  secret or D1 ID is committed.
- Confirm the working tree is clean and matches the reviewed commit.
- Set `ENVIRONMENT = "production"` in `wrangler.toml` for the deployment commit
  so session cookies use the `Secure` flag. Local development keeps
  `development`.
- Review `[assets] run_worker_first`: `/api/*` and `/cancel/*` are Worker-first.
  The cancel page must keep `Referrer-Policy: no-referrer`,
  `Cache-Control: no-store` and `X-Robots-Tag: noindex, nofollow`
  (`worker/routes/app-shell.ts`).

## 3. Create and migrate production D1 (approval required)

```bash
npx wrangler d1 create slotly
```

Copy the returned UUID into `wrangler.toml` as `[[d1_databases]] database_id`
and choose the final `database_name`. Then apply the ordered migrations:

```bash
npx wrangler d1 migrations apply DB --remote
```

- Migrations are forward-only. Never edit an applied migration; add a new one.
- Do **not** run `npm run db:seed:local` against the remote database. The local
  seed contains demo accounts and demo services.
- Record which migrations were applied and verify with
  `npx wrangler d1 migrations list DB --remote`.

## 4. Bootstrap production data (approval required)

Production needs one business settings row and one Admin account before the API
can serve public pages or anyone can sign in.

### 4.1 Business settings

Run once with the real values (adjust name, email, timezone and advance window):

```bash
npx wrangler d1 execute DB --remote --command "
INSERT INTO business_settings (
  id, business_name, business_email, business_timezone, max_advance_booking_days
) VALUES (
  1, 'Business Name', 'owner@example.com', 'Asia/Manila', 60
);"
```

### 4.2 Admin account

Generate the INSERT locally so the password hash is never typed into SQL:

```bash
SLOTLY_ADMIN_NAME="Business Owner" \
SLOTLY_ADMIN_EMAIL="owner@example.com" \
SLOTLY_ADMIN_PASSWORD="a-long-unique-password" \
npm run auth:hash:admin > bootstrap-admin.sql
```

Review `bootstrap-admin.sql`, run it with explicit approval, then delete the
file:

```bash
npx wrangler d1 execute DB --remote --file=bootstrap-admin.sql
rm bootstrap-admin.sql
```

The output contains only the versioned PBKDF2 hash. Do not keep the plaintext
password in shell history, tickets or the repository. Staff accounts are
created later by the Admin through the staff-management flow.

## 5. Secrets and email configuration

```bash
npx wrangler secret put RESEND_API_KEY
```

- `RESEND_API_KEY` is a Worker secret and is never committed or sent to the
  client. Local development uses `.dev.vars` instead.
- `EMAIL_FROM` in `[vars]` must be a verified sender for the deployment domain.
  Optionally set `EMAIL_REPLY_TO` as the fallback reply address.
- Leave `EMAIL_TRANSPORT` unset in production so Resend is selected when the key
  exists. `console` and `none` are for local development and tests.
- The `*/15 * * * *` cron trigger in `wrangler.toml` becomes active on deploy.
  It retries `pending`/`failed` outbox rows and reclaims abandoned `sending`
  rows. No reminder emails exist.

## 6. Deploy (approval required)

```bash
npm run build
npx wrangler deploy
```

- Deployment publishes the built client, the Hono Worker, static asset rules,
  D1 binding and cron trigger together.
- Attach the production domain in Cloudflare after the first deploy and verify
  HTTPS, cookie `Secure` behavior and same-origin CSRF checks against that
  domain.
- Record the deployed version ID. Re-deploying is not a rollback.

## 7. Post-deploy smoke tests

Run with the real domain and real bootstrap credentials:

```bash
curl -s https://<domain>/api/health
curl -s https://<domain>/api/public/business
curl -s https://<domain>/api/public/services
curl -sI https://<domain>/cancel/smoke-token
```

Checks:

- `/api/health` returns `status: ok` with the production environment.
- Public business/services return the bootstrapped settings and services.
- `/cancel/*` returns HTML with `Referrer-Policy: no-referrer`,
  `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow` and
  `X-Content-Type-Options: nosniff`; the token is absent from Worker logs.
- Admin can sign in, create a service, set staff hours and create a staff
  account (or bootstrap staff data with approval if that UI is not wired yet).
- A guest booking returns `SLO-...`, writes one `request_received` outbox row,
  sends one email from the verified sender and provides a working cancellation
  link while pending.
- Staff approval sends `booking_confirmed`; reject/cancel/reschedule/reassign
  send `booking_update`.
- `/api/admin/dashboard`, `/api/admin/reports/summary` and
  `/api/admin/reports/export.csv` return data and CSV headers, and
  `/api/admin/reports/export.csv` is `text/csv`.
- Unauthenticated admin routes return `401`; staff/customer sessions return
  `403`.
- `npx wrangler tail` shows no passwords, session cookies, guest tokens or
  cancellation URLs.

## 8. Rollback and recovery

- Worker code: `npx wrangler rollback` (or `wrangler versions` to target a
  specific version). This does not revert D1 schema or data.
- D1: use Time Travel only with explicit approval; it restores data and is not
  a substitute for a forward migration. Do not reset production D1.
- If email delivery fails, the appointment/booking state remains valid; fix the
  provider/key and let the scheduled retry or a manual retry drain the outbox.
- If the PBKDF2 parameters change, existing versioned hashes still verify and
  are rehashed on the next successful password change; review
  `passwordNeedsRehash` before changing the baseline.

## 9. Known limitations and deferrals

- The React client still uses the in-memory mock repository for booking,
  customer and staff flows. Those flows are not production-ready until the
  client is wired to the Phase 3-9 APIs; deployment preparation does not make
  the mock suitable for production.
- Admin workspace UI, admin-issued staff passwords, staff management, service
  management UI and business settings UI are not implemented. Bootstrap and
  service/schedule setup currently require the documented SQL or the API.
- Per-isolate rate limiting is best effort and not a durable, global limiter.
- Worker error logs redact the guest token from the path. Cloudflare's own request
  logs and `wrangler tail` still show the requested URL, so treat tail output as
  sensitive, avoid sharing it, and review Cloudflare log retention before launch.
- There is no automated accessibility or end-to-end browser suite yet; Phase 10
  accessibility checks in `TESTING.md` apply once the client flows use the real
  APIs.
- No backups beyond D1 Time Travel, no staging environment and no uptime
  monitoring are configured.
