# Slotly — Agent Instructions

> **Read this file at the start of every Slotly session.** It is the short source of truth for agent behavior, confirmed product decisions, security boundaries, the phase sequence, and current status. Detailed technical references live in `docs/` and must be opened only when relevant.

## 1. Agent rules

You are Slotly's careful implementation assistant and technical mentor. Work in small, verifiable steps; do not act as a one-shot code generator.

1. Inspect the repository and relevant files before editing. Never assume the repository matches these documents.
2. State the immediate task, likely files, and acceptance criteria before making a material change.
3. Make one coherent change at a time. Prefer a working vertical slice over broad rewrites.
4. Treat the confirmed decisions below as requirements. If implementation and documentation conflict, explain the conflict and propose the smallest safe correction.
5. Do not invent features or silently choose unresolved product behavior. Ask only when a decision materially blocks safe progress; otherwise follow the confirmed rules.
6. Run relevant checks and report the exact commands and actual results. Never claim a check passed unless it was run.
7. Update the relevant documentation when a confirmed requirement or implementation contract changes.
8. Do not leave inert buttons, fake production data, placeholder success messages, or unfinished flows presented as working features.

### Design-first workflow

Slotly follows **design first, code second**. Respect the approved Figma direction and `docs/UI_DESIGN.md` when implementing frontend work in Phases 4–9. Reuse tokens and components; do not invent a new visual style per page. Phase 3 is database/backend foundation, not frontend implementation. Do not implement visual screens before the user approves the overall design direction, except for agreed non-visual foundations.

### Work in small steps

- Keep route handlers thin; put business rules in services and database access in repositories.
- Use TypeScript, readable names, explicit types and errors.
- Avoid unnecessary dependencies. Verify Cloudflare Workers compatibility before adding one.
- Never suppress TypeScript errors with broad `any`, `@ts-ignore`, or disabled checks as a shortcut.
- Add or update tests with each feature. See `docs/TESTING.md` when writing or reviewing tests.

## 2. Read-on-demand project docs

Do not re-read every technical document at the start of every session. Read `AGENTS.md` first, then open only the relevant reference:

| Document | Read when working on… |
|---|---|
| `docs/DATABASE.md` | D1 schema, migrations, indexes, constraints, repositories, booking concurrency |
| `docs/API.md` | Hono routes, request/response contracts, status codes, role authorization |
| `docs/TESTING.md` | Unit, integration, concurrency, security, accessibility or end-to-end tests |
| `docs/UI_DESIGN.md` | Figma, frontend routes/components, design tokens, responsive behavior and UI states (Phase 2 and frontend Phases 4–9) |

If a task crosses multiple areas, read each relevant document—not all documents by default. Keep them consistent with code and migrations.

## 3. Confirmed product decisions

- **Product:** Slotly is a generic appointment-booking application for one small business/organization per installation. It is not a multi-tenant SaaS product.
- **Stack:** React + TypeScript, Vite, Cloudflare Workers with Hono, and Cloudflare D1 (SQLite). Use Cloudflare's current supported React/Vite/Workers layout.
- **Deployment target:** The project owner will deploy the production app on Cloudflare. The intended shape is a Vite client served through Cloudflare Workers static assets, a Hono API on Workers, and Cloudflare D1 for persistence. Deployment is a Phase 10 activity and still requires explicit approval before creating resources or publishing. Do not deploy the in-memory mock as production.
- **Roles:** Customer, Staff and Admin. Customers may book as guests or sign in. Only Admin has business-wide management access.
- **Customer authentication:** Email and password only; no social login. Public registration creates Customer accounts only.
- **Staff accounts:** Admin creates staff accounts. Admin-generated temporary passwords are displayed once for out-of-band delivery; staff must set a new password at first login. If forgotten, only Admin can issue another temporary password. No public staff registration or self-service password reset in the MVP.
- **Booking:** Customers choose an active service, date and time, but never choose staff. The server automatically assigns any eligible active staff member. Every active staff member can perform every active service; do not build per-staff service eligibility.
- **Payment:** No online payments. Payment is handled at the business location.
- **Statuses:** `pending`, `confirmed`, `rejected`, `cancelled`. Do not add `expired`, `completed` or `no_show` to the MVP.
- **Pending requests:** Pending requests never block a time slot. Only overlapping `confirmed` bookings block the assigned staff member.
- **Time validity:** The server rejects newly submitted appointments whose start time is not in the future. Approval also fails if the pending request's start time has passed. Do not add an `expired` status; staff/admin must reject or cancel a stale pending request.
- **Approval:** Recheck current staff hours, time off and confirmed-booking overlaps immediately before approval. A conflict must never be silently confirmed. Approval must use a D1-safe atomic conditional statement or `db.batch()`; see `docs/DATABASE.md`.
- **Assignment and permissions:** Staff can review/manage only appointments assigned to themselves. Staff may reschedule within their own schedule, but **cannot reassign an appointment to another staff member**. Only Admin can reassign staff. Admin can manage every appointment.
- **Schedule changes:** Warn before a staff-hours/time-off/deactivation change that affects future bookings. Do not apply the change until affected appointments are resolved. Admin must reassign affected staff bookings or explicitly reschedule/cancel/reject them. Deactivating a service is blocked while future pending/confirmed bookings depend on it; resolve those bookings first. Never silently change a customer's selected service.
- **Cancellation:** Customers and guests may cancel only their own pending booking. Staff/Admin may reject pending bookings and cancel confirmed bookings within their permissions. After an appointment is confirmed, customer self-cancellation is not available in the MVP.
- **Guest cancellation:** Guest receives a cryptographically random private cancellation link after booking and in the request-received email. Store only a hash. It works only while its associated appointment remains pending. The confirmation page must be a read-only GET; cancellation requires an explicit POST.
- **Notifications:** Exactly three transactional email types: `request_received`, `booking_confirmed`, and `booking_update` (rejection, staff/Admin cancellation, or material appointment change). No appointment reminder emails or reminder notifications. Email delivery failure must not undo a successful booking/status change.
- **Business rules:** Admin configures the maximum advance-booking window and business IANA timezone. Each staff member has weekly working hours, closed days and date/time-based time off. There is no separate business-wide holiday calendar in the MVP.
- **Services:** Each active service has a duration; save the service name/duration snapshot on each appointment. A later service edit must not alter existing booking duration.
- **Reports:** Admin reports filter by date, service, staff and status and include counts/trends plus CSV export. Do not display fake production metrics.
- **Visual direction:** Calm, formal, practical business software. Preserve the approved Slotly design language; avoid generic AI dashboards, gratuitous gradients and excessive rounded cards.

## 4. Security and implementation boundaries

- Validate every untrusted value on the server. Enforce role, ownership and staff-assignment checks on every protected endpoint; hiding a button is not authorization.
- Use D1 prepared statements with bound values. Never concatenate user input into SQL.
- Never store plaintext passwords, raw session tokens, or raw guest-cancellation tokens. Never expose secrets in source, browser bundles, screenshots, logs, analytics or error messages.
- Before selecting password hashing, verify the algorithm/package in the current Workers runtime and benchmark it against the actual plan's CPU limits. WebCrypto PBKDF2 is a candidate, not an untested assumption. Do not use a fast general-purpose digest as a password hash.
- Staff temporary passwords are generated server-side, displayed once, have a short expiry, and require a password change at first login. Store only the hash and reset-required/expiry metadata.
- Use secure, HttpOnly, SameSite cookies and production Secure settings for sessions; protect cookie-authenticated state-changing requests against CSRF.
- Apply reasonable rate limits to login, public booking and guest cancellation. Use generic invalid-link responses to avoid disclosing whether a booking exists.
- Serve the guest cancellation page with `Referrer-Policy: no-referrer` and `Cache-Control: no-store`; also use `X-Robots-Tag: noindex, nofollow`. Do not load third-party analytics/resources on this page. Redact the token from request/access logs.
- Use migrations for schema changes. Do not modify an applied migration; add a new one. Keep local and production D1 environments separate.
- Do not create Cloudflare resources, enable billing, deploy, or change production data without explicit approval. Never run destructive/reset operations without approval for that exact target/action.
- Do not guess credentials, account IDs, database IDs, domains, or production configuration.

## 5. Phase list

Do not skip phases or move to a later major phase until the current phase's acceptance criteria are met or the user explicitly approves proceeding.

| Phase | Scope |
|---|---|
| 0 | Repository inspection and project setup |
| 1 | Product specification and user flows |
| 2 | UI/UX design and approval |
| 3 | D1 database design and backend foundation |
| 4 | Authentication, sessions and permissions |
| 5 | Services, staff schedules and availability engine |
| 6 | Guest/customer booking and cancellation |
| 7 | Staff approval, rejection, rescheduling and admin reassignment |
| 8 | Transactional email notifications |
| 9 | Admin dashboard, reports and CSV export |
| 10 | Quality, accessibility and Cloudflare deployment preparation |

Detailed schema, endpoint contracts and test cases are in the on-demand docs—not in this roadmap.

## 6. Current status — 16 November 2026

- **Phase 0:** Repository/scaffold state has not been verified in this handoff. Inspect the actual repository before marking complete.
- **Phase 1:** Product requirements and role journeys are recorded here; separate `PRODUCT_SPEC.md` and `USER_FLOWS.md` deliverables still need verification/creation if the project uses them.
- **Phase 2:** Broad Figma design pass exists across Customer Booking, Staff & Admin and UI States. This revision adds the missing cancellation, decline, reschedule/reassignment, token/security, responsive and design-token references. **Awaiting user review/approval.**
- **Mock UI vertical slice (verified 16 November 2026):** The React/Vite app runs against an in-memory mock repository. Customer booking, guest cancellation, customer sign-in/history and a staff workspace are implemented. The staff workspace includes role-aware sign-in, dashboard, assigned queue, appointment review, approve/reject/cancel, reschedule within the staff member's own schedule, and weekly hours/time-off editing with conflict blocking. `npm run typecheck` and `npm run build` pass; headless mock-API integration checks passed for ownership, approval revalidation, schedule conflicts, rescheduling, customer booking and guest cancellation. The UI is still a contract slice and is not wired to the real API; secure sessions, password hashing and email delivery do not exist yet.
- **Phase 3 (verified 16 November 2026):** Backend foundation is in place. `migrations/0001_initial_schema.sql` creates all proposed D1 tables, constraints and indexes with integer Unix-second timestamps. A Hono Worker provides `GET /api/health`, `GET /api/public/business` and `GET /api/public/services`, with typed D1 repositories and one error envelope. Local Wrangler config uses a clearly local-only D1 placeholder; `npm run db:migrate:local` and `npm run db:seed:local` were applied to local D1 only. `npm run typecheck`, `npm test` (23 tests) and `npm run build` pass, and `wrangler dev` smoke tests returned the expected JSON, 404 envelope and SPA fallback. Authentication, booking writes, availability, outbox delivery and the rest of the API contract remain later-phase work.
- **Phases 4–10:** Not started in the production stack.
- **Deferred in the mock UI:** Admin workspace and reassignment, admin-issued temporary staff passwords/forced password change, service/staff management, settings, reports/CSV and the email outbox.
- **Next task:** Begin Phase 4 authentication and sessions (server-side password hashing, session cookies, role authorization), or wire the public read endpoints into the UI if prioritized first.
- **Deployment:** The production target is confirmed as Cloudflare (Workers + D1). No Cloudflare resources have been created, no billing has been enabled and no deployment has been performed. Deployment remains Phase 10 work after the backend and quality phases, with explicit approval.
- **Implementation boundary:** The Worker and D1 foundation are local-only and not deployed. The mock UI still uses plaintext demo credentials and in-memory data that resets on reload. No real D1 database ID, email provider or production secret has been configured.

Update this section whenever a phase changes. Record only work that was inspected and verified; include the next task and any blockers.

## 7. OpenCode / DeepSeek task protocol

At the start of a new session, use this prompt:

```text
Read AGENTS.md first. Do not re-read every document automatically. Inspect the repository and Current status. Then read only the docs relevant to the requested task (DATABASE.md, API.md, TESTING.md, UI_DESIGN.md). Do not edit until you have identified the current phase, the smallest safe change, and its acceptance criteria. Preserve confirmed decisions and security rules. Make one coherent change, run the relevant checks, and report exact results. Do not deploy, modify remote Cloudflare resources, or run destructive database commands without my explicit approval.
```

For a specific task, state: `Current phase`, `Task`, `Acceptance criteria`, and `Relevant docs`. The source of truth is **`AGENTS.md`**, never the old `SLOTLY_AGENT_AND_PLAN.md` filename.
