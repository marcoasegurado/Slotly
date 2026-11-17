# Slotly

Appointment booking for one small business. The React/Vite UI runs against an in-memory mock repository for booking, customer and staff flows. Phase 3 adds the Cloudflare Worker, Hono API and D1 schema foundation, Phase 4 adds password hashing, D1-backed sessions, role middleware and auth routes, Phase 5 adds service management, staff schedules and the availability engine, Phase 6 adds guest/customer booking creation and cancellation, Phase 7 adds staff approval/rejection/rescheduling plus admin reassignment, Phase 8 adds transactional email through a D1 outbox with inline sends and scheduled retries, Phase 9 adds the admin dashboard, aggregate report summary and CSV export, and Phase 10 begins quality and deployment preparation with strict guest-cancellation-page headers and an approval-gated deployment runbook. The public business/services reads are wired to the Worker; the other client flows remain mock-backed until their API phases.

## Run locally

Install dependencies and prepare the local D1 database:

```bash
npm ci
npm run db:migrate:local
npm run db:seed:local
```

Run the API Worker and the Vite client in separate terminals:

```bash
npm run dev:worker   # Hono API on http://127.0.0.1:8787
npm run dev          # Vite on http://localhost:5173, proxies /api
```

Checks:

```bash
npm run typecheck
npm test
npm run build
```

The mock database resets on every reload. The demo banner in the app can reset it manually. Local D1 state lives in `.wrangler/` and is ignored by Git.

Mutating API requests require an `Origin` header that exactly matches the Worker origin, for example:

```bash
curl -i -X POST http://127.0.0.1:8787/api/auth/login \
  -H "Origin: http://127.0.0.1:8787" \
  -H "Content-Type: application/json" \
  --data "{\"email\":\"maria@example.com\",\"password\":\"slotly-demo\"}"
```

The Vite proxy preserves the browser origin, so requests from `http://localhost:5173` pass the same check.

> **Deployment check:** PBKDF2 currently uses 210,000 iterations. On the development machine `npm run auth:bench` measured roughly 250–300 ms per hash/verify. That exceeds the CPU budget of the Cloudflare Workers Free plan, so the production plan and hashing parameters must be validated before deployment.

## Demo accounts

| Role | Email | Password |
|---|---|---|
| Customer | `maria@example.com` | `slotly-demo` |
| Staff | `ana@slotly.studio` | `slotly-demo` |
| Staff | `ben@slotly.studio` | `slotly-demo` |
| Staff | `ciel@slotly.studio` | `slotly-demo` |
| Admin | `admin@slotly.studio` | `slotly-demo` |

These accounts exist in the local D1 seed with PBKDF2 hashes; the seed never contains plaintext passwords. The seed also gives Ana, Ben and Ciel demo weekly working hours so availability and schedule endpoints have realistic data. Guests can book without an account. A guest cancellation link is shown on the request-received page.

The mock UI still uses its own in-memory demo sign-in. The Worker auth routes are exercised directly or through the API until the client auth flow is wired in a later phase.

## Deployment target

The project owner plans to deploy the production app on Cloudflare:

- React/Vite client served through Cloudflare Workers static assets.
- Hono API running on Cloudflare Workers.
- Cloudflare D1 for persistence.

Deployment is Phase 10 work and has not happened yet. No Cloudflare resources, billing or production data exist for this project. The current mock is not suitable for production deployment because it keeps data in memory and uses plaintext demo credentials.

`DEPLOYMENT.md` is the Phase 10 runbook: preflight checks, the PBKDF2 plan decision, production D1 creation and migrations, business settings and first-Admin bootstrap, secrets, deploy, smoke tests, rollback and known limitations. Every remote command remains blocked until the owner approves that exact step.

## Implemented flows

Backend foundation (Phase 3):

- Ordered D1 migration for users, staff profiles, services, working hours, time off, appointments, guest cancellation tokens, business settings, sessions, notification outbox and audit logs.
- Hono Worker with `GET /api/health`, `GET /api/public/business` and `GET /api/public/services`.
- Typed D1 repositories, a local-only seed and schema/API tests against `node:sqlite`.
- `GET /api/public/business` and `GET /api/public/services` are wired into the React client with runtime validation and a safe fallback to demo data when the Worker is unavailable.

Authentication and sessions (Phase 4, backend):

- PBKDF2-HMAC-SHA-256 password hashes in a versioned format (`pbkdf2-sha256$v1$<iterations>$<salt>$<hash>`), with an 8–128 character policy.
- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` and `POST /api/auth/change-password`.
- Opaque session tokens in an `HttpOnly`, `SameSite=Lax` cookie; D1 stores only the token's SHA-256 hash. Sessions expire after 7 days and are revoked on logout or password change.
- Origin-based CSRF protection for mutating requests, role and forced-password-change middleware, generic login failures and best-effort per-isolate login/registration rate limits.
- Local demo users with hashed passwords. Regenerate them with `npm run auth:hash:demo`; benchmark hashing with `npm run auth:bench`.
- The UI does not yet use the auth routes; the mock sign-in remains in place until the client integration phase.

Services, schedules and availability (Phase 5, backend):

- `GET /api/public/availability` returns 15-minute Unix-second slots for an active service and business-local date. Only `confirmed` appointments block availability; `pending` requests do not. Public slots omit the assigned staff member.
- The availability engine fits the full service duration inside working hours, excludes time off and confirmed overlaps, ignores past starts and selects the least-loaded eligible staff member.
- `GET`/`PUT /api/staff/availability`, `POST /api/staff/time-off` and `DELETE /api/staff/time-off/:id` manage the signed-in staff member's schedule. A change that would invalidate a future `pending` or `confirmed` booking returns `409 SCHEDULE_CHANGE_CONFLICT` with safe affected booking references.
- `GET`/`POST /api/admin/services` and `PATCH /api/admin/services/:id` manage services. Deactivation returns `409 SERVICE_HAS_FUTURE_BOOKINGS` while future bookings remain.
- DST-safe business-timezone conversion, half-open overlap rules and the schedule-conflict rules are covered by unit, repository and API tests.

Guest and customer bookings (Phase 6, backend):

- `POST /api/public/bookings` creates a `pending` request after revalidating the exact start against the availability engine. The server calculates the end time from the service duration and assigns an eligible staff member; clients never choose staff.
- Guest bookings return a one-time cancellation token. D1 stores only its SHA-256 hash, and the token expires at the appointment start or after 72 hours, whichever comes first.
- `POST /api/public/guest-cancellation` cancels only the linked pending guest booking. Unknown, used, expired, confirmed, cancelled and other invalid links all return the same `404 CANCELLATION_LINK_UNAVAILABLE`.
- `GET /api/customer/bookings`, `GET /api/customer/bookings/:id` and `POST /api/customer/bookings/:id/cancel` require a customer session, use the public `SLO-...` reference and allow only pending self-cancellation.
- Booking creation and guest cancellation are rate limited per client IP. The customer booking UI still uses the mock repository until the client integration phase.

Staff and admin appointment management (Phase 7, backend):

- `GET /api/staff/dashboard` returns the signed-in staff member's pending requests, today's pending/confirmed appointments and confirmed upcoming appointments with counts.
- `GET /api/staff/appointments` supports `status` and `scope` (`all`, `today`, `upcoming`) filters; `GET /api/staff/appointments/:id` exposes only appointments assigned to that staff member. Path values are the public `SLO-...` reference.
- Staff can approve a pending request, reject it, cancel a confirmed appointment, or reschedule within their own schedule. Approval rechecks the future start, working hours, time off and confirmed overlaps; a conflict never confirms silently.
- `PATCH /api/staff/appointments/:id` accepts only a new `startAt`. Staff cannot change the assigned staff member.
- Admin can list/filter every appointment, read any appointment, approve/reject/reschedule it, cancel pending or confirmed appointments, and reassign to another active staff member through `POST /api/admin/appointments/:id/reassign`.
- Reassignment validates the target staff member, working hours, time off, booking window and confirmed overlaps, and is audited. `GET /api/admin/staff` returns the read-only active-staff list used by the reassignment control.
- Approval/rejection/cancellation invalidates any guest cancellation token for that appointment. Audit rows are written for approve, reject, cancel, reschedule and reassign.
- The schedule, time-off and confirmed-overlap predicates are repeated inside the conditional `UPDATE`; the preflight checks provide clear errors, while the SQL remains the concurrency backstop.

Transactional email (Phase 8, backend):

- Exactly three customer-facing emails: `request_received`, `booking_confirmed` and `booking_update`. Rejection, staff/admin cancellation, staff/admin reschedule and admin reassignment all send `booking_update`; customer/guest self-cancellation sends nothing.
- Each email intent is written to `notification_outbox` in the same D1 batch as the booking insert or transition audit row, so the message and the database change cannot diverge.
- After the commit the Worker attempts delivery immediately. A provider failure is recorded on the row and never rolls back the booking or appointment change; the scheduled handler retries `pending`/`failed` rows every 15 minutes, up to 5 attempts, and reclaims `sending` rows abandoned for 15 minutes.
- The guest `request_received` email carries the private `/cancel/:token` link. Once sent, the stored payload drops the cancellation URL so the raw token is not kept at rest; the outbox never stores the token hash or other secrets.
- Transport selection: `EMAIL_TRANSPORT` (`console`, `resend`, `none`), otherwise Resend when `RESEND_API_KEY` is set, otherwise the console transport, with a silent no-op in tests. `EMAIL_FROM` defaults to a safe placeholder, and replies fall back to the business email.
- Resend is the production provider. Put `RESEND_API_KEY` in `.dev.vars` locally or set it with `wrangler secret put` at deployment; the key and any real sender domain are not committed. The `*/15` cron trigger in `wrangler.toml` is local configuration until Phase 10.

Admin dashboard and reports (Phase 9, backend):

- `GET /api/admin/dashboard` returns business-wide status totals, today's totals in the business timezone, pending/confirmed upcoming counts and the pending plus confirmed-upcoming workload for each active staff member.
- `GET /api/admin/reports/summary` accepts inclusive `from`/`to` business-local date keys plus `serviceId`, `staffId` and `status` filters. It returns totals and per-service/per-staff status breakdowns from grouped SQL aggregates rather than loading every appointment.
- `GET /api/admin/reports/export.csv` applies exactly the same filters and returns `text/csv` with an attachment filename, `X-Report-Rows` and `X-Report-Truncated`.
- CSV cells are RFC 4180 quoted and formula-like values are prefixed with an apostrophe. A single export is capped at 5000 rows and flags truncation; summary counts still cover every matching appointment.
- All three routes are admin-only. Invalid dates, reversed ranges, unknown statuses or malformed IDs return `422 VALIDATION_ERROR`. No new tables or indexes were required.

Quality and deployment preparation (Phase 10, in progress):

- `/cancel/*` is Worker-first so the guest cancellation page is served with `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow` and `X-Content-Type-Options: nosniff`. Guest tokens are redacted from error-log paths.
- `public/_headers` adds conservative baseline headers (`X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`) to static pages.
- `npm run auth:hash:admin` generates a one-time Admin INSERT with a PBKDF2 hash for production bootstrap; the plaintext password is never printed.
- `DEPLOYMENT.md` documents the approval-gated production runbook. Deployment is still not performed, and the PBKDF2 CPU-limit decision remains unresolved.
- Client integration and the UI accessibility/responsive checks are still deferred because the React flows remain mock-backed.

Mock UI (still in memory):

- Public service/date/time selection, guest booking and customer booking.
- Guest cancellation with a private token that works only while the request is pending.
- Customer sign-in, registration and appointment history.
- Staff sign-in and staff-only workspace:
  - dashboard, assigned queue and filters;
  - appointment review, approve, decline and cancel;
  - reschedule within the signed-in staff member's own schedule;
  - weekly working hours and time off, blocked when a change would invalidate a future booking.
- Pending requests never block customer availability; approval rechecks hours, time off and confirmed overlaps.
- Staff cannot reassign appointments or view another staff member's assignments.

Deferred: admin workspace UI, admin-issued staff passwords/forced password change, staff account management and settings. Admin service, appointment management, dashboard and report/CSV endpoints exist in the backend API but have no UI yet. Client API wiring and the Phase 10 accessibility/responsive verification are deferred while the React flows remain mock-backed.

## Source layout

- `worker/` — Hono app, auth/public/staff/admin routes, middleware, error envelope, availability engine and typed D1 repositories.
- `worker/email/` — email event contract, HTML/text templates and the console/Resend/no-op transports.
- `worker/auth/` — password hashing, session cookies, role middleware and rate limiting.
- `worker/repositories/` — typed D1 access for users, sessions, services, schedules, business settings, bookings, managed appointments, notification outbox, audit logs and report aggregates.
- `worker/services/` — availability calculation, schedule validation, availability-context loading, booking/token lifecycle, staff/admin appointment management, email dispatch/retry and dashboard/report generation.
- `worker/lib/` — timezone/date helpers, reference and token encoding, password hashing, log-path redaction and RFC 4180 CSV escaping.
- `public/` — static files copied into the Vite build, including `_headers` response rules.
- `migrations/` — ordered D1 schema migrations; never edit an applied migration.
- `seed/local.sql` — local-only sample business settings, services, hashed demo accounts and demo working hours.
- `scripts/` — local password-hash generation (demo and Admin bootstrap) and PBKDF2 benchmark commands.
- `tests/` — schema, repository, auth and Worker API tests using an in-memory D1 adapter.
- `src/mock/` — in-memory repository and seed data with API-shaped functions.
- `src/lib/` — time, availability and React hook helpers.
- `src/components/` — shared UI and layout components.
- `src/pages/` — customer routes and `pages/staff/` workspace routes.
- `src/styles/base.css` — design tokens and component styles.

See `AGENTS (1).md` for product rules and the phase status, plus `API.md`, `DATABASE.md`, `TESTING.md` and `UI_DESIGN (1).md` for detailed references.
