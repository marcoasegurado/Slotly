# Slotly Test Plan

**Status:** Required test matrix. Add these tests incrementally with the feature; do not wait until the end. This file is the detailed source for test coverage. `AGENTS.md` contains the security and workflow rules.

## 1. Test layers

- **Unit:** pure business rules (time overlap, timezone conversion, service duration, schedule validation, eligibility, CSV escaping, password policy).
- **Repository/integration:** D1 migrations, constraints, prepared statements, outbox writes, conditional status changes and error handling.
- **Worker/API integration:** Hono routes, validation, sessions, role/ownership/assignment rules, status codes and rate limits.
- **End-to-end:** public booking, guest cancellation, customer booking history, staff review, admin reassignment, schedule conflict, email preview and responsive UI.
- **Security:** token leakage, session flags, temporary password workflow, referrer policy, CSRF, authorization and log redaction.

Use local D1/test bindings. Never run destructive tests against production.

## 2. Availability and time calculation

**Phase 5 coverage (16 November 2026):** `tests/availability.test.ts` covers DST-safe conversion, strict date keys, half-open overlaps, working-hour fitting, time off, confirmed-only blocking, future-start filtering, least-loaded staff selection and truthful states. `tests/schedules.test.ts` covers the D1 queries for active staff, time off, future appointments and service deactivation checks. `tests/phase5-api.test.ts` covers the public availability route, staff schedule/time-off routes with `409 SCHEDULE_CHANGE_CONFLICT`, and admin service CRUD with `409 SERVICE_HAS_FUTURE_BOOKINGS`.

- Service duration calculates the correct end time.
- Appointment fitting exactly inside one working interval is available.
- Appointment starting before or ending after working hours is unavailable.
- Closed weekdays return no availability.
- Multiple working intervals are supported and must not overlap.
- Full-day day off blocks all times for that local business date.
- Partial time-off overlap blocks the staff member.
- A confirmed overlap blocks the staff member.
- A pending overlap does not block availability.
- Rejected/cancelled bookings do not block availability.
- When all active staff are unavailable, return a truthful no-availability state.
- Booking beyond configured maximum advance window is rejected server-side.
- New booking with start time in the past or exactly now is rejected.
- Timezone conversion does not shift the intended business-local time; test DST behavior for supported timezones.
- Customer-facing availability never exposes or asks the customer to choose staff.

## 3. Booking status and cancellation

**Phase 6 coverage (16 November 2026):** `tests/bookings.test.ts` covers guest and customer creation, server-side end-time calculation and staff assignment, trimmed/normalized guest fields, hash-only token storage with a bounded expiry, validation and conflict responses, pending requests not blocking slots, generic guest-link failures for used/expired/non-pending/unknown tokens, customer ownership and list ordering, and pending-only customer self-cancellation.

**Phase 7 coverage (16 November 2026):** `tests/appointment-management.test.ts` covers staff dashboard partitioning and counts, staff-only list/detail scoping, approval of a guest request with guest-token invalidation and an audit row, refusal of past/working-hours/time-off/confirmed-overlap approvals without state changes, rejection and confirmed-only staff cancellation, staff rescheduling with `422` future/window/valid-minute failures and `409` confirmed-overlap failures while its guest token stays live, admin list filters (status/staff/date/search) and detail, the read-only active-staff list, admin approval/reschedule/cancel with audit ordering, admin pending cancellation, reassignment success plus same-staff/unknown-staff/past/outside-window/confirmed-conflict errors, customer/staff/admin role gates, and a repository-level stale-start reschedule guard. These tests assert the database state directly. Outbox and email assertions are covered by `tests/notifications.test.ts` in Phase 8.

- Guest booking and authenticated customer booking both create `pending` appointments.
- Server calculates end time; a client cannot override the service duration or status.
- Server automatically assigns an eligible active staff member; a client-supplied staff ID cannot force assignment.
- Status check constraint allows only `pending`, `confirmed`, `rejected`, `cancelled`.
- No `expired` status is generated.
- Customer cannot read or cancel another customer's appointment.
- Customer cannot self-cancel a confirmed appointment.
- Guest cancellation token cancels only its associated pending booking.
- Guest token cannot read arbitrary appointment details or edit fields.
- Guest token is invalid after approval, rejection, cancellation or expiry.
- Invalid/used/expired token responses do not reveal whether a booking ID exists.
- Guest cancellation GET/page rendering is read-only; cancellation requires explicit POST confirmation.
- Guest cancellation page sends `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, and `X-Robots-Tag: noindex, nofollow`.
- Raw guest tokens are absent from application logs, error logs, analytics and third-party requests.

## 4. Approval, rejection and concurrency

- Assigned staff can approve an assigned pending booking when still available.
- Staff cannot approve or inspect another staff member's booking by guessing its ID.
- Staff can reject only assigned pending requests; staff cannot cancel pending requests as a substitute for rejection.
- Staff can cancel only an assigned confirmed appointment when permitted; the action is audited and queues `booking_update`.
- Admin can approve any pending booking when still available.
- Approval fails with a conflict response if a confirmed overlap exists.
- Approval fails if requested `start_at <= now`, even if it is otherwise unoccupied.
- An old pending request remains pending until explicitly rejected/cancelled; it cannot be approved after its start time.
- Two overlapping pending requests for one staff member cannot both become confirmed under concurrent approval attempts.
- The conditional update/D1 batch rolls back correctly on statement failure.
- An approval conflict does not send a booking-confirmed email.
- A successful approval commits appointment state and notification intent consistently.
- Staff cannot reassign another staff member. Admin reassignment checks target active status, working hours, time off and confirmed conflicts.
- Reschedule rechecks the complete target interval; adjacent half-open intervals do not conflict (`end_at == next.start_at` is allowed).
- Approval/rejection/reassignment/reschedule/cancellation events are audited without tokens or secrets.

## 5. Schedule and service change impact

- Adding time off that conflicts with future pending or confirmed appointments is blocked with an impact response.
- Changing weekly hours that invalidates future bookings is blocked with an impact response.
- Admin cannot deactivate a staff member while future pending/confirmed appointments remain assigned to them.
- Admin can reassign affected bookings to another eligible staff member or explicitly resolve them before deactivation.
- Service deactivation is blocked while future pending/confirmed bookings use it.
- Service edits do not change existing appointment service/duration snapshots.
- A schedule/service change does not silently reschedule, cancel or change a customer's selected service.

## 6. Authentication and authorization

- Incorrect password does not create a session.
- Logout revokes/ends the session; expired/revoked sessions are rejected.
- Production session cookie is Secure, HttpOnly and SameSite-configured; state changes have CSRF protection.
- Customer cannot call staff/admin routes.
- Staff cannot call Admin-only routes or manage another staff member's assigned bookings.
- Public registration cannot create staff/admin roles.
- Staff account creation is Admin-only.
- Temporary staff password is generated server-side, stored only as a hash, displayed once, expires, and forces change at first login.
- A staff member with `must_change_password=true` cannot use protected staff functions before changing the temporary password.
- Only Admin can reset staff password. Old credential/session behavior after reset is explicitly tested and documented.
- Expired temporary credentials cannot create a staff session; Admin must issue a replacement.
- A staff session with `must_change_password=true` cannot enter the staff workspace or call normal staff endpoints before changing the password.
- Password hash algorithm and work factor are benchmarked under the actual Worker plan CPU limit.
- Authentication errors do not reveal whether an email account exists unnecessarily.

## 7. Notification/outbox tests

**Phase 8 coverage (17 November 2026):** `tests/notifications.test.ts` covers the guest `request_received` email with a cancellation link and payload purge after send, the customer variant without a guest link, `booking_confirmed` on staff approval with token invalidation, `booking_update` for rejection and staff reschedule, `booking_update` on admin reassignment, failure recording that leaves the appointment confirmed, inline/scheduled retry success, the attempt limit and the recent-`sending` claim guard, plus template escaping and previous-time rendering. Provider calls are stubbed, so no test sends real mail.

- Successful booking creation queues `request_received` once.
- Successful approval queues `booking_confirmed` only after the status transition commits.
- Rejection queues `booking_update` with a declined status.
- Staff/Admin cancellation queues `booking_update` with cancellation details.
- Material Admin reschedule/change queues `booking_update` when required by the implemented template.
- Customer/guest cancellation initiated by the customer does not falsely send a rejection notice.
- Email provider failure is recorded and does not undo booking/approval/rejection/cancellation.
- Development email adapter logs only safe previews and never sends real mail.
- No appointment reminder is queued or sent.
- A sent row drops the guest cancellation URL from `payload_json`; the raw token is absent from outbox payloads after delivery.
- A concurrent claim cannot send one outbox row twice; rows stop after the attempt limit.
- The scheduled job retries `pending`/`failed` rows and reclaims abandoned `sending` rows.

## 8. Reports and CSV

**Phase 9 coverage (17 November 2026):** `tests/reports.test.ts` covers the admin dashboard totals, today and upcoming counts plus per-staff workload; summary counts for an inclusive date range with per-service and per-staff status breakdowns; combined status/service/staff/date filters; empty ranges returning zero totals and empty groups; invalid dates, reversed ranges and unknown statuses returning `422 VALIDATION_ERROR`; admin-only access on the dashboard, summary and export routes; and CSV headers, business-local date/time rendering, row/truncation headers, formula neutralization, RFC 4180 quoting and filter parity with the summary. `tests/csv.test.ts` unit-tests the escaping helper.

- Filters by date range, service, staff and status combine correctly.
- Counts by service/staff and status breakdown match known fixture data.
- Empty report data produces an empty state, not fake values.
- CSV export is Admin-only and respects exactly the active filters.
- CSV quotes commas, quotes and line breaks correctly.
- CSV formula-injection prefixes are neutralized.
- Exports over 5000 rows report `X-Report-Truncated: true` without changing the summary totals.

## 9. UI/accessibility/responsive tests

- Loading, empty, validation, network/server error, success, pending, confirmed, rejected, cancelled and conflict states are rendered accurately.
- Approval action remains disabled after a conflict response; server remains authoritative even if the client state is manipulated.
- Cancellation requires a distinct confirmation action and success feedback.
- Expired/invalid guest link shows a generic safe state.
- Staff UI does not display another staff member's assignment or reassign action.
- Admin UI owns reassign/deactivate/reset controls.
- Focus indicator is visible on keyboard focus; controls have labels and sensible touch targets.
- Body text and metadata meet the `docs/UI_DESIGN.md` minimum 11px reference. Never hide essential info in color alone.
- Verify mobile layouts for customer, staff and admin; tables adapt to card/list or a usable horizontal-scroll treatment without clipped primary actions.
- Verify contrast for normal text, error text, focus, disabled and status variants.

## 10. Deployment and response-header checks

**Phase 10 coverage (17 November 2026):** `tests/app-shell.test.ts` covers the Worker-proxied guest cancellation page: HTML is served from the assets binding with `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow` and `X-Content-Type-Options: nosniff`; non-GET requests are not served the shell; and `redactPath` removes `/cancel/<token>` from logged paths.

- `npm run typecheck`, `npm test` and `npm run build` pass before any deployment attempt.
- The local build output includes `dist/_headers`.
- `/cancel/<token>` responses carry the strict headers above, and the token never appears in logs.
- `.dev.vars`, real D1 IDs, secrets and bootstrap SQL files are not committed.
- The production smoke checklist in `DEPLOYMENT.md` is completed after the owner approves each remote step.
- Accessibility and responsive checks run against real client flows only after those flows are wired to the API.
