# Slotly

Appointment booking for one small business. The React/Vite UI runs against an in-memory mock repository for booking, customer and staff flows. Phase 3 adds the Cloudflare Worker, Hono API and D1 schema foundation, and Phase 4 adds password hashing, D1-backed sessions, role middleware and auth routes. The public business/services reads are wired to the Worker; the other client flows remain mock-backed until their API phases.

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

These accounts exist in the local D1 seed with PBKDF2 hashes; the seed never contains plaintext passwords. Guests can book without an account. A guest cancellation link is shown on the request-received page.

The mock UI still uses its own in-memory demo sign-in. The Worker auth routes are exercised directly or through the API until the client auth flow is wired in a later phase.

## Deployment target

The project owner plans to deploy the production app on Cloudflare:

- React/Vite client served through Cloudflare Workers static assets.
- Hono API running on Cloudflare Workers.
- Cloudflare D1 for persistence.

Deployment is Phase 10 work and has not happened yet. No Cloudflare resources, billing or production data exist for this project. The current mock is not suitable for production deployment because it keeps data in memory and uses plaintext demo credentials.

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

Deferred: admin workspace/reassignment, staff account management, service management, settings, reports/CSV and the email outbox.

## Source layout

- `worker/` — Hono app, auth/public routes, middleware, error envelope and typed D1 repositories.
- `worker/auth/` — password hashing, session cookies, role middleware and rate limiting.
- `migrations/` — ordered D1 schema migrations; never edit an applied migration.
- `seed/local.sql` — local-only sample business settings, services and hashed demo accounts.
- `scripts/` — local password-hash generation and PBKDF2 benchmark commands.
- `tests/` — schema, repository, auth and Worker API tests using an in-memory D1 adapter.
- `src/mock/` — in-memory repository and seed data with API-shaped functions.
- `src/lib/` — time, availability and React hook helpers.
- `src/components/` — shared UI and layout components.
- `src/pages/` — customer routes and `pages/staff/` workspace routes.
- `src/styles/base.css` — design tokens and component styles.

See `AGENTS (1).md` for product rules and the phase status, plus `API.md`, `DATABASE.md`, `TESTING.md` and `UI_DESIGN (1).md` for detailed references.
