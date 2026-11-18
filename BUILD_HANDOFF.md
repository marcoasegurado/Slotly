# Slotly Build Handoff — 18 November 2026

> Use this document when continuing the live API wiring work.

## Current stop point

The build stopped after a full live client/data-layer pass through booking, customer history/cancellation, guest cancellation, staff/admin appointment management, staff availability, and admin services.

This is a commit-ready stopping point: the Worker and client compile, tests pass, the production build passes, and the live deployed app was smoke-tested.

## Verified in this session

- Removed the deleted mock API, mock seed, mock store, mock types, and staff/mock-only components from application imports.
- Added a typed browser API client with `credentials: 'include'`, API error handling, Unix-second types, public/auth/customer/staff/admin endpoints.
- Added real session startup/sign-in/register/logout/password-change state.
- Wired public business/services, availability, booking, request received, guest cancellation, customer history/detail/cancel.
- Added read-only guest-cancellation GET support to the Worker and redacts `/api/public/guest-cancellation/:token` from logs.
- Added a month availability endpoint for the real calendar.
- Added staff and admin shared appointment adapters and screens for list/detail/approve/reject/cancel/reschedule/reassignment.
- Added a real admin dashboard and services management screen.
- Wired staff availability to real schedule/time-off endpoints.
- Added an admin route guard and layout; staff remain isolated by the staff API and guard.
- Added `SelectField` support for staff reassignment.
- Added production CSS for workspace tables.

## Cut off / known incomplete areas

1. **Staff availability and old components**
   - The availability screen now loads real `/api/staff/availability` and `/api/staff/time-off` data.
   - It still needs a manual UI test for add/remove time off and schedule-conflict behavior.

2. **Admin UI**
   - Dashboard, appointment management, reassignment, and service management are wired.
   - Admin reports/CSV UI was not added; the Worker endpoints exist and this phase was deferred.
   - Staff-management and business-settings UI were not added.

3. **Staff UI**
   - The list/detail/availability flows use real APIs.
   - Staff reschedule UI is integrated into the real admin/staff shared appointment detail page rather than the old separate mock route.

4. **Guest cancellation**
   - Worker GET/POST and client GET/POST pages are real.
   - Manual browser verification remains recommended for token link/referrer/privacy behavior.

5. **Email**
   - Transactional delivery remains disabled; configure a verified Resend sender and key later.

6. **Tests/UI**
   - Unit/API tests pass, but browser Playwright-style accessibility/responsive checks were not run.

## Exact acceptance checks run

- `npm run typecheck` — passed.
- `npm test` — 157 tests passed across 16 test files.
- `npm run build` — passed; Vite built `dist` successfully.
- Live deployment — passed with `npx wrangler deploy`.
- Production smoke checks:
  - `/api/health` → `200` and status `ok`.
  - `/api/public/business` returns Slotly Studio / Asia/Manila / 60-day window.
  - `/api/public/services` returns 4 services.
  - `/admin` → `200` SPA fallback.
  - Admin login, `/api/auth/me`, dashboard, services, pending appointments and staff list passed.
  - Real month and day availability passed.
  - A real guest booking was created, assigned to Ana, read through the GET cancellation route, left pending after GET, cancelled with POST, and rejected reuse with `404 CANCELLATION_LINK_UNAVAILABLE`.

## Resume protocol

For the next session, start with:

1. Run `npm run typecheck`, `npm test`, and `npm run build`.
2. Continue with browser QA rather than backend data work:
   - customer public booking and sign-in/history;
   - guest cancellation;
   - staff login/forced password change, dashboard, appointment actions, availability/time-off;
   - admin login/dashboard, pending approval/rejection/cancellation/reschedule/reassignment, services;
   - mobile and narrow desktop layouts;
   - accessibility keyboard/labels/dialog behavior.
3. Do not begin email configuration until a verified Resend sender exists.
4. Do not run or ask for deployment until the next change is specifically ready to publish.

## Deployment state

- Deployed URL: `https://slotly.marcoeduardo-asegurado.workers.dev`
- Deployed version ID: `9b72f3ee-c1a9-4076-8e26-86668af9f8a8`
- Production data was not reset.
- One live verification guest booking was created and then cancelled by its private token.
- `.local-secrets/` remains gitignored and must not be committed or printed.

## Repository safety

- Do not commit `.local-secrets/`, credentials, session data, or generated SQL with passwords.
- Keep remote D1 writes explicit and scoped. This handoff already includes live verification writes, but no further migration or reset is implicit.
