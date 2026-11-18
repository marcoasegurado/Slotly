# Slotly deployment runbook

Phase 10 is deployed to Cloudflare Workers on the Free plan at
`https://slotly.marcoeduardo-asegurado.workers.dev`. This file records the
executed steps and the remaining approval gates. Creating resources, applying
remote schema/data changes or publishing a new version still requires explicit
approval for that exact step.

The project target is one Cloudflare Worker with static assets, one D1 database
and the email integration from Phase 8. There is no multi-tenant setup.

## 1. Decisions

1. **Workers plan and PBKDF2 cost.** workerd rejects PBKDF2 iteration counts
   above 100,000, so the Worker uses the maximum (100,000) and runs the hash
   inside the `PasswordHasher` Durable Object. Durable Objects get 30 s of CPU
   per request on both plans, so the Free plan is sufficient and the request
   Worker stays inside its 10 ms budget. Older hashes are rehashed on successful
   login. The 100k ceiling is below the 600k OWASP recommendation and is a
   documented platform limitation, not a configuration choice.
2. **Production hostname.** The app is live on the workers.dev hostname. A
   custom domain is deferred; attach one before launch and re-verify HTTPS,
   cookie `Secure` behavior and same-origin CSRF checks against it.
3. **Email sender.** No verified Resend domain or key exists. Production runs
   with `EMAIL_TRANSPORT = "none"`; no email is queued for delivery.
4. **Production D1 database.** `slotly`
   (`e3b8b87c-de92-4f31-bff2-89f0e4aabf3f`) exists and has migrations `0001`
   and `0002` applied.
5. **First Admin account.** `admin@slotly.studio` exists. Its stored hash used
   5,000 iterations and is upgraded on the next successful login. The password
   is not recorded in the repository.

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
  secret is committed.
- Confirm the working tree is clean and matches the reviewed commit.
- `ENVIRONMENT = "production"` is set in `wrangler.toml` so session cookies use
  the `Secure` flag.
- Review `[assets] run_worker_first`: `/api/*` and `/cancel/*` are Worker-first.
  The cancel page must keep `Referrer-Policy: no-referrer`,
  `Cache-Control: no-store` and `X-Robots-Tag: noindex, nofollow`
  (`worker/routes/app-shell.ts`).
- Local `wrangler dev`, `db:migrate:local` and `db:seed:local` require workerd,
  which cannot run on macOS below 13.5. Use a supported OS, DevContainer or
  remote D1/deploy through the API.

## 3. Production D1 (already created)

`slotly` (`e3b8b87c-de92-4f31-bff2-89f0e4aabf3f`) exists and already has
migrations `0001` and `0002` applied. Verify without changing anything:

```bash
npx wrangler d1 migrations list DB --remote
```

- Do not create a duplicate database.
- Migrations are forward-only. Never edit an applied migration; add a new one.
- Do **not** run `npm run db:seed:local` against the remote database. The local
  seed contains demo accounts and demo services.
- For a fresh installation only: `npx wrangler d1 create slotly`, put the
  returned UUID in `wrangler.toml`, then run
  `npx wrangler d1 migrations apply DB --remote`.

## 4. Bootstrap production data (already completed)

Production already has one business settings row and one Admin account. These
steps are retained for a fresh install or recovery.

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

There are two ways to create the first Admin. For a fresh install, generate the
INSERT locally so the hash is never typed into SQL:

```bash
SLOTLY_ADMIN_NAME="Business Owner" \
SLOTLY_ADMIN_EMAIL="owner@example.com" \
SLOTLY_ADMIN_PASSWORD="a-long-unique-password" \
npm run auth:hash:admin > bootstrap-admin.sql
```

For an existing account, reset it instead (`npm run admin:reset`). It generates
a random password, writes the `UPDATE` to `.local-secrets/reset-admin.sql` and
the password to `.local-secrets/admin-password.txt` (mode 0600). Neither is
printed to stdout, so the value stays out of shell history and logs. The reset
also revokes every session for that account.

```bash
npm run admin:reset
npx wrangler d1 execute DB --remote --file=.local-secrets/reset-admin.sql
# read the password once, then:
rm -rf .local-secrets
```

`.local-secrets/` is gitignored. Never commit a generated SQL file or a
plaintext password.

### 4.3 Staff accounts

```bash
npm run staff:create
npx wrangler d1 execute DB --remote --file=.local-secrets/create-staff.sql
```

Creates the three Staff accounts with temporary passwords (`must_change_password`,
72-hour expiry), `staff_profiles` rows and weekly working hours. The plaintext
passwords go only to `.local-secrets/staff-credentials.txt`; deliver each one
privately and delete the directory. Staff cannot use staff routes until they set
a new password.

### 4.4 Services

```bash
npm run services:create
npx wrangler d1 execute DB --remote --file=.local-secrets/create-services.sql
```

Idempotent: it inserts or updates the four initial services. Renaming a service
never changes an existing appointment, because each appointment stores a
name/duration snapshot.

## 5. Secrets and email configuration (not configured)

Production currently has no Worker secrets and runs `EMAIL_TRANSPORT = "none"`,
so no notification email is sent or logged.

```bash
npx wrangler secret put RESEND_API_KEY
```

- `RESEND_API_KEY` is a Worker secret and is never committed or sent to the
  client. Local development uses `.dev.vars` instead.
- `EMAIL_FROM` in `[vars]` must be a verified sender for the deployment domain.
  Optionally set `EMAIL_REPLY_TO` as the fallback reply address.
- After the key and verified sender exist, remove `EMAIL_TRANSPORT = "none"` so
  Resend is selected. `console` is for local development only.
- The `*/15 * * * *` cron trigger is active. It retries `pending`/`failed`
  outbox rows and reclaims abandoned `sending` rows. No reminder emails exist.

## 6. Deploy (executed)

```bash
npm run build
npx wrangler deploy
```

- Deployment publishes the built client, the Hono Worker, static asset rules,
  the D1 binding, the `PasswordHasher` Durable Object and the cron trigger
  together.
- The first deploy of `PasswordHasher` applies the `v1-password-hasher`
  Durable Object migration (`new_sqlite_classes`, required on the Free plan).
- Record the deployed version ID with `npx wrangler deployments list`.
  Re-deploying is not a rollback.
- A custom domain is still deferred. Attach it in Cloudflare, then verify
  HTTPS, cookie `Secure` behavior and same-origin CSRF checks against it.

## 7. Post-deploy smoke tests

Run against `https://slotly.marcoeduardo-asegurado.workers.dev`:

```bash
curl -s https://slotly.marcoeduardo-asegurado.workers.dev/api/health
curl -s https://slotly.marcoeduardo-asegurado.workers.dev/api/public/business
curl -s https://slotly.marcoeduardo-asegurado.workers.dev/api/public/services
curl -sI https://slotly.marcoeduardo-asegurado.workers.dev/cancel/smoke-token
```

Executed checks:

- `/api/health` returns `status: ok` with `environment: production`.
- Public business returns the bootstrapped settings.
- `/cancel/*` returns `200` with `Referrer-Policy: no-referrer`,
  `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow` and
  `X-Content-Type-Options: nosniff`.
- Unauthenticated `/api/admin/dashboard` returns `401`.
- A wrong-password login exercises the Durable Object PBKDF2 path and returns a
  generic `401` rather than `500`/error 1102. `wrangler tail` measured 10 ms CPU
  on the request Worker and 20 ms CPU in `PasswordHasher` for that request; the
  hash is no longer charged to the request budget, but the request path is at
  the Free-plan limit, so watch for error 1102 under repeated logins.
- Public services currently returns `[]` because production has no services.

Still pending until the client is wired and email is configured:

- Admin sign-in, service creation, staff hours and staff account creation.
- Guest booking, `request_received` email, cancellation link and staff
  approval/reject emails.
- Dashboard/report/CSV checks with real appointment data.

## 8. Rollback and recovery

- Worker code: `npx wrangler rollback` (or `wrangler versions` to target a
  specific version). This does not revert D1 schema or data.
- D1: use Time Travel only with explicit approval; it restores data and is not
  a substitute for a forward migration. Do not reset production D1.
- If email delivery fails, the appointment/booking state remains valid; fix the
  provider/key and let the scheduled retry or a manual retry drain the outbox.
- If the PBKDF2 parameters change, existing versioned hashes still verify and
  are rehashed on the next successful login; review `passwordNeedsRehash`
  before changing the baseline.

## 9. Known limitations and deferrals

- PBKDF2 is capped by workerd at 100,000 iterations, below the 600,000 OWASP
  recommendation. The Durable Object only moves the cost; it does not make the
  work factor stronger.
- The React client is API-backed for booking, customer, staff and admin flows and
  is deployed with the Worker. An automated contrast/axe pass is still missing;
  the browser harness in `TESTING.md` §11 covers structure, focus containment,
  overflow and control names only.
- Production has four services, one Admin and three Staff accounts. The Admin
  password is not recorded in the repository; the Staff temporary passwords are
  only in `.local-secrets/` until they are delivered and deleted.
- Transactional email is disabled (`EMAIL_TRANSPORT = "none"`); no verified
  Resend sender or key exists, so outbox rows would not deliver.
- Admin staff management (create staff, reissue a temporary password, deactivate),
  the business settings screen and the reports summary/CSV screen are not
  implemented in the client.
- The app is served from the workers.dev hostname; no custom domain is attached.
- Per-isolate rate limiting is best effort and not a durable, global limiter.
- Worker error logs redact the guest token from the path. Cloudflare's own request
  logs and `wrangler tail` still show the requested URL, so treat tail output as
  sensitive, avoid sharing it, and review Cloudflare log retention before launch.
- There is no automated contrast or axe pass yet. The CDP browser harness covers
  structure, focus containment, overflow and control names; run it with
  `npm run qa:ui:audit|flows|accounts` as described in `TESTING.md` §11.
- Local `wrangler dev` and local D1 commands cannot run on macOS below 13.5
  because workerd does not support it. Remote D1/deploy operations still work.
- No backups beyond D1 Time Travel, no staging environment and no uptime
  monitoring are configured.
