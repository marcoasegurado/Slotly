# Slotly API Contract

**Status:** Proposed route contract for Phase 3+; align it with the actual Hono implementation as routes are built. Keep route handlers thin and enforce all authorization on the server.

## 1. Conventions

- Base path: `/api`.
- JSON request/response unless a route explicitly returns CSV or a page.
- Use consistent success envelopes and one error shape, for example:

```json
{
  "error": {
    "code": "BOOKING_CONFLICT",
    "message": "That time is no longer available. Choose another time.",
    "details": {}
  }
}
```

- Validate bodies, params and query strings server-side. Use prepared statements.
- Status codes: `200` read/update success, `201` created, `204` successful no-content action, `400` malformed request, `401` unauthenticated, `403` forbidden, `404` unavailable/not found, `409` state/availability conflict, `422` validation failure, `429` rate limited, `500` generic internal error.
- Do not expose SQL errors, stack traces, internal IDs unnecessarily, raw tokens, or secrets.
- Do not trust client-supplied role, owner ID, `assigned_staff_user_id`, `is_active`, or appointment status.

## 2. Public booking and guest cancellation

| Method | Route | Purpose / rules |
|---|---|---|
| `GET` | `/api/public/business` | Public business name, timezone and booking-window settings needed by the page; no secrets |
| `GET` | `/api/public/services` | Active services only |
| `GET` | `/api/public/availability` | Return available time slots for service/date. Do not reveal assigned staff identity. Pending bookings do not block availability. |
| `POST` | `/api/public/bookings` | Create a `pending` booking as guest or authenticated customer; server calculates end time and assigns staff; reject start time `<= now` and dates outside booking window |
| `POST` | `/api/public/guest-cancellation` | Body includes private token; cancel only the associated pending guest booking; generic invalid/used/expired response |

The guest link opens a read-only page through a route such as `/cancel/:token`. A GET must never mutate booking state. The page must show a confirmation step and submit an explicit POST to cancel. Set `Referrer-Policy: no-referrer`, `Cache-Control: no-store` and `X-Robots-Tag: noindex, nofollow`; redact the token from access logs and do not load third-party analytics/assets. The raw token must never be put into analytics or ordinary logs.

## 3. Authentication and customer routes

| Method | Route | Purpose / rules |
|---|---|---|
| `POST` | `/api/auth/register` | Create Customer role only; never accept a role from the client |
| `POST` | `/api/auth/login` | Email/password login; rate limited |
| `POST` | `/api/auth/logout` | Revoke/end current session |
| `GET` | `/api/auth/me` | Current user/role and whether a forced password change is required |
| `POST` | `/api/auth/change-password` | Required for staff with `must_change_password=true`; validate current temporary credential/session and clear reset-required flag |
| `GET` | `/api/customer/bookings` | Authenticated customer sees own bookings only |
| `GET` | `/api/customer/bookings/:id` | Own booking details only |
| `POST` | `/api/customer/bookings/:id/cancel` | Cancel own pending booking only; confirmed booking is not self-cancellable in MVP |

Do not build a self-service forgotten-password flow in the MVP. Staff password reset is an Admin action (below).

## 4. Staff routes

| Method | Route | Purpose / rules |
|---|---|---|
| `GET` | `/api/staff/dashboard` | Staff summary for current staff user |
| `GET` | `/api/staff/appointments` | Only appointments assigned to current staff user; support date/status filters |
| `GET` | `/api/staff/appointments/:id` | Assigned appointment details only |
| `POST` | `/api/staff/appointments/:id/approve` | Assigned pending request only; atomic conflict-safe recheck; must fail for past start time |
| `POST` | `/api/staff/appointments/:id/reject` | Reject assigned pending request; create booking-update email intent |
| `POST` | `/api/staff/appointments/:id/cancel` | Cancel an assigned confirmed appointment when permitted; create booking-update email intent |
| `PATCH` | `/api/staff/appointments/:id` | Edit/reschedule only within this staff member's own assignment/schedule; cannot change assigned staff ID |
| `GET` | `/api/staff/availability` | Read own weekly schedule and time off |
| `PUT` | `/api/staff/availability` | Change own schedule only if no future pending/confirmed booking is invalidated; otherwise return `409` with affected booking references |
| `POST` | `/api/staff/time-off` | Add own time-off only if no future booking is invalidated; otherwise return `409` with affected booking references |
| `DELETE` | `/api/staff/time-off/:id` | Remove own time-off block when authorized |

Staff cannot reassign to another staff member. Staff may reject an assigned pending request, cancel an assigned confirmed appointment when permitted, or reschedule within their own schedule. In an approval conflict, staff may choose another available time for their own schedule or reject the request. A different staff assignment is an Admin-only operation.

## 5. Admin routes

| Method | Route | Purpose / rules |
|---|---|---|
| `GET` | `/api/admin/dashboard` | Business-wide operational summary |
| `GET` | `/api/admin/appointments` | Search/filter all bookings by date, status, service, staff and customer/reference |
| `GET` | `/api/admin/appointments/:id` | Business-wide booking detail |
| `PATCH` | `/api/admin/appointments/:id` | Edit/reschedule with full server-side validation and audit log |
| `POST` | `/api/admin/appointments/:id/approve` | Approve any pending request using the same atomic conflict-safe check; block past starts |
| `POST` | `/api/admin/appointments/:id/reject` | Reject pending appointment and send booking-update email |
| `POST` | `/api/admin/appointments/:id/cancel` | Cancel pending or confirmed booking under Admin authority and send booking-update email |
| `POST` | `/api/admin/appointments/:id/reassign` | Reassign to another active eligible staff member; optionally update time; revalidate working hours, time off and confirmed conflicts; audit |
| `GET` / `POST` / `PATCH` | `/api/admin/services` and `/api/admin/services/:id` | List/create/update services; deactivation blocked while affected future pending/confirmed bookings remain unresolved |
| `GET` / `POST` / `PATCH` | `/api/admin/staff` and `/api/admin/staff/:id` | List/create/update/activate/deactivate staff; deactivation blocked until affected future appointments are resolved |
| `POST` | `/api/admin/staff/:id/password-reset` | Generate one-time temporary password, persist only hash/reset metadata, return secret once to the authenticated Admin; staff must change it at first login |
| `GET` / `PUT` | `/api/admin/settings` | Read/update business profile, timezone and max advance booking window |
| `GET` | `/api/admin/reports/summary` | Aggregated data using current report filters |
| `GET` | `/api/admin/reports/export.csv` | Admin-only CSV with same filters as report; protect against formula injection |

## 6. Schedule and service change conflicts

- A staff schedule/time-off update that invalidates future appointments returns `409 SCHEDULE_CHANGE_CONFLICT` and identifies affected safe public references/statuses. Do not apply the schedule change.
- Admin resolves affected appointments by reassigning to another eligible staff member or explicitly rescheduling/rejecting/cancelling them, then retries the schedule change.
- Deactivating staff follows the same rule. Do not leave a future pending/confirmed booking assigned to an inactive staff account.
- Service deactivation returns `409 SERVICE_HAS_FUTURE_BOOKINGS` until future pending/confirmed bookings are resolved. Do not silently substitute another service.
- Reassignment and rescheduling operations are audited.

## 7. Notification contract

Exactly three customer-facing transactional email types exist:

1. `request_received` — after successful booking creation; includes pending status and guest cancellation link where relevant.
2. `booking_confirmed` — only after approval has committed successfully.
3. `booking_update` — rejection, staff/admin cancellation, or material Admin appointment change (such as a time change).

There are no reminder endpoints, scheduled reminders or reminder email templates. Email-send failure is recorded in the outbox and must not revert a valid appointment state change.

## 8. CSV export rules

- Apply the same date/service/staff/status filters used by the visible report.
- Enforce Admin authorization server-side.
- Use aggregate queries where possible; do not fetch every row only to calculate summary counts.
- Quote/escape CSV fields correctly and neutralize spreadsheet formula injection (for example values beginning with `=`, `+`, `-`, `@`, tab or carriage-return where relevant).
- Use a clear filename and `text/csv` response content type.
