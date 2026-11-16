# Slotly

Appointment booking for one small business. This repository currently contains the React/Vite UI running against an in-memory mock repository. It is not connected to Cloudflare Workers, D1 or email delivery yet.

## Run locally

```bash
npm ci
npm run dev
```

Checks:

```bash
npm run typecheck
npm run build
```

The mock database resets on every reload. The demo banner in the app can reset it manually.

## Demo accounts

| Role | Email | Password |
|---|---|---|
| Customer | `maria@example.com` | `slotly-demo` |
| Staff | `ana@slotly.studio` | `slotly-demo` |
| Staff | `ben@slotly.studio` | `slotly-demo` |
| Staff | `ciel@slotly.studio` | `slotly-demo` |

Guests can book without an account. A guest cancellation link is shown on the request-received page.

## Deployment target

The project owner plans to deploy the production app on Cloudflare:

- React/Vite client served through Cloudflare Workers static assets.
- Hono API running on Cloudflare Workers.
- Cloudflare D1 for persistence.

Deployment is Phase 10 work and has not happened yet. No Cloudflare resources, billing or production data exist for this project. The current mock is not suitable for production deployment because it keeps data in memory and uses plaintext demo credentials.

## Implemented flows

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

- `src/mock/` — in-memory repository and seed data with API-shaped functions.
- `src/lib/` — time, availability and React hook helpers.
- `src/components/` — shared UI and layout components.
- `src/pages/` — customer routes and `pages/staff/` workspace routes.
- `src/styles/base.css` — design tokens and component styles.

See `AGENTS (1).md` for product rules and the phase status, plus `API.md`, `DATABASE.md`, `TESTING.md` and `UI_DESIGN (1).md` for detailed references.
