# Slotly API Contract

**Status:** Phases 3–9 backend contracts are implemented on the Hono Worker and the React client consumes every implemented endpoint (public reads and availability, auth, guest/customer booking and cancellation, staff and admin appointment management, services, staff schedules, dashboard and reports). The remaining unwired areas are admin staff management, the reports summary/CSV screen and business settings in the client. Align this contract with the actual implementation as routes are built, keep route handlers thin and enforce all authorization on the server.

## 1. Conventions

- Base path: `/api`.
- JSON request/response unless a route explicitly returns CSV or a page.
- Successful responses use a `{ "data": ... }` envelope. Errors use one shape:

```json
{
  "error": {
    "code": "BOOKING_CONFLICT",
    "message": "That time is no longer available. Choose another time.",
    "details": {}
  }
}
```

- Operational check: `GET /api/health` returns `{ "data": { "status": "ok", "service": "slotly-api", "environment": "...", "timestamp": 0 } }`, where `timestamp` is Unix seconds. It returns `503 DATABASE_UNAVAILABLE` when D1 cannot be queried.
- Implemented: `/api/health`, `/api/public/business`, `/api/public/services`, `/api/public/availability`, `/api/public/bookings`, `/api/public/guest-cancellation`, the `/api/auth/*` and `/api/customer/bookings*` routes in section 3, the staff schedule/time-off and appointment-management routes in section 4, and the admin service, appointment-management, dashboard and reports routes in section 5. The remaining routes below are contracts for later phases.
- API instants (`startAt`, `endAt`) are integer Unix seconds. Business-local dates are `YYYY-MM-DD` in the configured IANA timezone.
- Authenticated requests use the opaque `slotly_session` cookie. The cookie is `HttpOnly`, `SameSite=Lax`, `Path=/`, has a 7-day TTL and is `Secure` on HTTPS or in production. D1 stores only the SHA-256 hash of the token.
- Mutating requests (`POST`, `PUT`, `PATCH`, `DELETE`) must send an `Origin` header that exactly matches the request origin; otherwise the API returns `403 CSRF_REJECTED`. Safe reads do not require an `Origin` header.

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

### 2.1 Implemented availability behavior

`GET /api/public/availability?serviceId=...&date=YYYY-MM-DD` requires an active service and a valid business-local date. It returns:

```json
{
  "data": {
    "dateKey": "2026-11-17",
    "state": "open",
    "slots": [{ "startAt": 1794877200, "endAt": 1794880800 }]
  }
}
```

- `state` is one of `past`, `outside-booking-window`, `closed`, `open` or `full`.
- Slot starts advance in 15-minute steps and the full service duration must fit inside one working interval. A slot start must be strictly in the future.
- Slots are integer Unix seconds and intentionally omit the assigned staff member. Least-loaded staff selection happens server-side.
- Only `confirmed` appointments block availability. `pending` requests never reserve a slot.
- Invalid service or date input returns `422 VALIDATION_ERROR`; a missing or inactive service returns `404 SERVICE_NOT_FOUND`. When business settings are missing, the route returns `404 BUSINESS_NOT_CONFIGURED`.

### 2.2 Implemented booking and cancellation behavior

`POST /api/public/bookings` accepts:

```json
{
  "serviceId": "svc_consult",
  "startAt": 1794877200,
  "guestName": "Jamie Guest",
  "guestEmail": "jamie@example.com",
  "customerNote": "First visit"
}
```

- `startAt` is integer Unix seconds and must exactly match one of the slots currently returned by `GET /api/public/availability` for that service and business-local date. The server loads availability again, calculates `endAt` from the service duration and assigns the least-loaded eligible active staff member. Client-supplied staff IDs, end times, statuses or snapshots are ignored.
- A valid `customer` session makes the booking customer-owned: the session user is linked and `guestName`/`guestEmail` are ignored. Without a customer session, `guestName` (2–100 characters) and a valid `guestEmail` are required.
- `customerNote` is optional, trimmed and limited to 500 characters.
- Success returns `201` with:

```json
{
  "data": {
    "appointment": {
      "publicReference": "SLO-7K4M2QXP",
      "serviceId": "svc_consult",
      "serviceName": "Initial consultation",
      "durationMinutes": 60,
      "startAt": 1794877200,
      "endAt": 1794880800,
      "status": "pending",
      "customerNote": "First visit",
      "guestName": "Jamie Guest",
      "guestEmail": "jamie@example.com",
      "createdAt": 1794837600,
      "updatedAt": 1794837600
    },
    "cancellationToken": "64-character hex token"
  }
}
```

- The booking shape never includes internal appointment IDs, user IDs or the assigned staff member. `publicReference` is the customer-facing identifier.
- `cancellationToken` is returned exactly once for guest bookings and is `null` for customer bookings. D1 stores only its SHA-256 hash. The token expires at `min(appointment start, creation time + 72 hours)`.
- A missing or inactive service returns `404 SERVICE_NOT_FOUND`; missing business settings return `404 BUSINESS_NOT_CONFIGURED`.
- A start in the past or outside the booking window returns `422 VALIDATION_ERROR`. A closed day, a full day or a time that is not one of the current slots returns `409 BOOKING_CONFLICT`.
- Requests are limited to 20 per client IP per hour. `429 RATE_LIMITED` includes `Retry-After` and `details.retryAfterSeconds`; the limiter is per Worker isolate and best-effort.
- A `request_received` email intent is written to `notification_outbox` in the same batch as the appointment. Guest emails include the private `/cancel/:token` link; customer emails go to the signed-in account address and contain no guest link.

`POST /api/public/guest-cancellation` accepts `{ "token": "..." }` and returns `200` with `{ "data": { "publicReference": "SLO-..." } }` after cancelling the linked pending guest booking. Unchanged, used, expired, confirmed, rejected, cancelled, customer-owned or unknown tokens all return the same `404 CANCELLATION_LINK_UNAVAILABLE`. Cancellation marks the token used and records `Cancelled by guest`. Requests are limited to 30 per client IP per 15 minutes. Guest self-cancellation sends no email and never exposes the token in the response.

## 3. Authentication and customer routes

| Method | Route | Purpose / rules |
|---|---|---|
| `POST` | `/api/auth/register` | Create Customer role only; never accept a role from the client |
| `POST` | `/api/auth/login` | Email/password login; rate limited |
| `POST` | `/api/auth/logout` | Revoke/end current session |
| `GET` | `/api/auth/me` | Current user/role and whether a forced password change is required |
| `POST` | `/api/auth/change-password` | Required for staff with `must_change_password=true`; validate current temporary credential/session and clear reset-required flag |
| `GET` | `/api/customer/bookings` | Authenticated customer sees own bookings only |
| `GET` | `/api/customer/bookings/:id` | Own booking details only; `:id` is the public `SLO-...` reference |
| `POST` | `/api/customer/bookings/:id/cancel` | Cancel own pending booking only; confirmed booking is not self-cancellable in MVP |

Do not build a self-service forgotten-password flow in the MVP. Staff password reset is an Admin action (below).

### 3.1 Implemented auth behavior

`POST /api/auth/register` accepts `{ "name", "email", "password" }`. It always creates a `customer`, normalizes the email to lower case, requires a password of 8–128 characters and returns `201` with the `AuthUser` shape. Duplicate emails return `409 EMAIL_IN_USE`.

`POST /api/auth/login` accepts `{ "email", "password" }` and returns `200` with:

```json
{
  "data": {
    "id": "usr_...",
    "name": "Maria Santos",
    "email": "maria@example.com",
    "role": "customer",
    "mustChangePassword": false
  }
}
```

Wrong passwords, unknown emails, inactive accounts and expired temporary passwords all return the same `401 INVALID_CREDENTIALS` response. Repeated login failures are limited per email and per client IP; the response is `429 RATE_LIMITED` with `Retry-After` and `details.retryAfterSeconds`. This limiter is currently per Worker isolate and is best-effort until durable cross-isolate limiting is added.

`POST /api/auth/logout` revokes the current session and clears the cookie. It returns `204` even without a valid session.

`GET /api/auth/me` requires a session and returns the same `AuthUser` shape.

`POST /api/auth/change-password` accepts `{ "currentPassword", "newPassword" }`, requires the current password, applies the same length policy, rejects reuse of the current password and revokes the user's other sessions. It returns `204`. If a temporary password has expired, the route revokes all of the user's sessions and returns `401 UNAUTHENTICATED`.

Role middleware additionally returns `403 FORBIDDEN` when the authenticated role is not allowed and `403 PASSWORD_CHANGE_REQUIRED` when a staff/admin account still has `mustChangePassword = true`.

### 3.2 Implemented customer booking behavior

`GET /api/customer/bookings` requires a `customer` session and returns only that customer's appointments, split into `upcoming` and `past`. Upcoming bookings are `pending`, or `confirmed` with `endAt` in the future; everything else is past. Both lists are newest-first by start time. `GET /api/customer/bookings/:id` returns the same `Booking` shape, and `POST /api/customer/bookings/:id/cancel` cancels a pending booking and returns the updated booking.

The `:id` path value is the public reference (`SLO-...`) and is matched case-insensitively. Internal IDs are never accepted or returned. Reading or cancelling another customer's booking, or an unknown reference, returns `404 BOOKING_NOT_FOUND`. Cancelling a non-pending booking returns `409 BOOKING_CONFLICT`. Unauthenticated requests return `401 UNAUTHENTICATED`; staff and admin sessions return `403 FORBIDDEN`. Customer cancellation records the acting user and `Cancelled by customer`.

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

### 4.1 Implemented schedule behavior

`GET /api/staff/availability` returns the signed-in staff member's schedule:

```json
{
  "data": {
    "staff": { "id": "usr_ana", "name": "Ana Reyes", "email": "ana@slotly.studio" },
    "workingHours": [
      { "id": "hrs_x", "weekday": 1, "startMinute": 540, "endMinute": 1020 }
    ],
    "timeOff": [
      { "id": "tof_x", "startAt": 1794877200, "endAt": 1794880800, "reason": "Training" }
    ]
  }
}
```

- `weekday` is `0` (Sunday) through `6` (Saturday); minutes are from midnight in the business timezone.
- `PUT /api/staff/availability` accepts `{ "workingHours": [{ "weekday", "startMinute", "endMinute" }] }`, replaces the whole weekly schedule and returns the updated schedule. Intervals may not overlap on the same weekday; adjacent intervals are allowed.
- Working-hours and time-off changes return `409 SCHEDULE_CHANGE_CONFLICT` with `details.affectedBookings` when the change would invalidate a future `pending` or `confirmed` appointment for that staff member. The change is not applied.
- `POST /api/staff/time-off` accepts Unix-second `{ "startAt", "endAt", "reason"? }`; the end must be after the start and not already in the past. It returns `201` with the created time off.
- `DELETE /api/staff/time-off/:id` returns `204` for the owner and `404 TIME_OFF_NOT_FOUND` otherwise.
- These routes are staff-only; customer and admin sessions receive `403 FORBIDDEN`.

### 4.2 Implemented staff appointment management

`GET /api/staff/dashboard` returns the signed-in staff member's workload:

```json
{
  "data": {
    "pending": [],
    "today": [],
    "upcoming": [],
    "counts": { "pending": 0, "today": 0, "confirmedUpcoming": 0 }
  }
}
```

`pending` contains every pending request assigned to that staff member, `today` contains today's pending/confirmed appointments in the business timezone, and `upcoming` contains only confirmed appointments whose end time is in the future. All lists are ordered by start time.

`GET /api/staff/appointments` accepts optional `status` (`pending`, `confirmed`, `rejected`, `cancelled`, `all`) and `scope` (`all`, `today`, `upcoming`) query parameters. `GET /api/staff/appointments/:id` returns one assigned appointment. The `:id` value is the case-insensitive public `SLO-...` reference. An unknown reference or another staff member's appointment returns `404 APPOINTMENT_NOT_FOUND`.

Staff management responses use the `ManagedAppointment` shape:

```json
{
  "publicReference": "SLO-7K4M2QXP",
  "serviceId": "svc_consult",
  "serviceName": "Initial consultation",
  "durationMinutes": 60,
  "assignedStaff": { "id": "usr_ana", "name": "Ana Reyes", "email": "ana@slotly.studio" },
  "customer": { "name": "Maria Santos", "email": "maria@example.com" },
  "guestName": null,
  "guestEmail": null,
  "startAt": 1794880800,
  "endAt": 1794884400,
  "status": "pending",
  "customerNote": "First visit",
  "resolutionNote": null,
  "createdAt": 1794794400,
  "updatedAt": 1794794400,
  "approvedAt": null,
  "cancelledAt": null
}
```

Guest appointments set `customer` to `null` and populate `guestName`/`guestEmail`. Internal appointment IDs and internal user IDs are not returned.

- `POST /api/staff/appointments/:id/approve` approves only an assigned `pending` request whose start time is still in the future. It rechecks working hours, time off, the assigned staff member's active status and confirmed overlaps, then repeats those predicates inside the conditional `UPDATE`. Any failure returns `409 BOOKING_CONFLICT` and leaves the request pending. On success the appointment becomes `confirmed`, the approval timestamp and acting user are stored, and guest cancellation tokens are invalidated.
- `POST /api/staff/appointments/:id/reject` accepts an optional `{ "reason" }` (trimmed, maximum 300 characters) and rejects only an assigned pending request. The default resolution note is `Declined by the team`. A non-pending appointment returns `409 BOOKING_CONFLICT`.
- `POST /api/staff/appointments/:id/cancel` accepts an optional `{ "reason" }` and cancels only an assigned `confirmed` appointment. The default resolution note is `Cancelled by the team`. Pending requests must be rejected instead and return `409 BOOKING_CONFLICT`.
- `PATCH /api/staff/appointments/:id` accepts `{ "startAt" }` (Unix seconds) and reschedules a pending or confirmed appointment within the staff member's own schedule. The assigned staff member cannot be changed. Past or outside-booking-window times return `422 VALIDATION_ERROR`; working-hours, time-off or confirmed-overlap failures return `409 BOOKING_CONFLICT`.
- Every successful approve, reject, cancel and reschedule writes an `audit_logs` row. A reschedule keeps a pending appointment's guest cancellation link usable; only leaving `pending` invalidates it. Approve writes a `booking_confirmed` outbox row; reject, cancel and reschedule write `booking_update` rows in the same batch. The response is returned even if the inline email attempt fails.


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

### 5.1 Implemented service management

- `GET /api/admin/services` lists active and inactive services.
- `POST /api/admin/services` accepts `{ "name", "description"?, "durationMinutes", "isActive"? }` and returns `201` with the created service. Duration must be 1–1440 minutes.
- `PATCH /api/admin/services/:id` updates any supplied subset of `name`, `description`, `durationMinutes` and `isActive`. An empty patch returns `422 VALIDATION_ERROR`.
- Setting `isActive: false` returns `409 SERVICE_HAS_FUTURE_BOOKINGS` with `details.affectedBookings` while future `pending` or `confirmed` bookings reference the service. The service remains active.
- These routes are admin-only; staff and customer sessions receive `403 FORBIDDEN`.

### 5.2 Implemented appointment management

- `GET /api/admin/appointments` lists every appointment in ascending start order. Optional query parameters: `status`, `staffId`, `serviceId`, `date` (business-local `YYYY-MM-DD`), `q` (reference, customer/guest name or email) and `limit` (1–200, default 100).
- `GET /api/admin/appointments/:id` returns any appointment by its case-insensitive public `SLO-...` reference. Unknown references return `404 APPOINTMENT_NOT_FOUND`.
- `POST /api/admin/appointments/:id/approve`, `POST /api/admin/appointments/:id/reject` and `PATCH /api/admin/appointments/:id` use the same validation and audit rules as the staff routes, but Admin can act on any staff member's appointment.
- `POST /api/admin/appointments/:id/cancel` accepts an optional `{ "reason" }` and can cancel either a pending or a confirmed appointment. The default resolution note is `Cancelled by the team`.
- `POST /api/admin/appointments/:id/reassign` accepts `{ "staffId", "startAt"? }`. The target must be an active staff member, so unknown or inactive staff return `404 STAFF_NOT_FOUND`; reassigning to the current staff member returns `422 VALIDATION_ERROR`. When `startAt` is omitted the current time is kept. The effective time must be in the future and inside the booking window (`422 VALIDATION_ERROR` otherwise), and the target's working hours, time off and confirmed appointments are revalidated (`409 BOOKING_CONFLICT`). The appointment keeps its pending/confirmed status.
- `GET /api/admin/staff` returns only active staff `{ "id", "name", "email" }` entries for the reassignment control. Full staff account management remains a later phase.
- Approve, reject, cancel, reschedule and reassign actions write an `audit_logs` row with the public appointment reference, actor, previous/new status and relevant staff/time changes. Guest cancellation tokens are invalidated when an appointment leaves `pending`. Reject, cancel, admin reschedule and admin reassignment also enqueue a `booking_update` email in the same batch.
- These routes are admin-only; staff and customer sessions receive `403 FORBIDDEN`.

### 5.3 Implemented dashboard and reports

`GET /api/admin/dashboard` returns a business-wide snapshot:

```json
{
  "data": {
    "asOf": 1794878148,
    "dateKey": "2026-11-17",
    "timezone": "Asia/Manila",
    "totals": { "pending": 4, "confirmed": 12, "rejected": 3, "cancelled": 2 },
    "today": { "pending": 2, "confirmed": 4, "rejected": 0, "cancelled": 1 },
    "upcoming": { "pending": 4, "confirmed": 10 },
    "staff": [
      {
        "id": "usr_ana",
        "name": "Ana Reyes",
        "pending": 2,
        "confirmedUpcoming": 5
      }
    ]
  }
}
```

- `today` covers appointments starting inside the current business-local date. `upcoming` requires `endAt > asOf` and a `pending` or `confirmed` status. `staff` lists active staff members only and counts every pending appointment plus confirmed appointments ending after `asOf`.

`GET /api/admin/reports/summary?from=YYYY-MM-DD&to=YYYY-MM-DD&serviceId=&staffId=&status=` returns aggregated counts:

```json
{
  "data": {
    "range": { "from": "2026-11-01", "to": "2026-11-30", "timezone": "Asia/Manila" },
    "filters": { "serviceId": null, "staffId": null, "status": null },
    "totals": { "appointments": 24, "pending": 3, "confirmed": 17, "rejected": 1, "cancelled": 3 },
    "byService": [
      {
        "serviceId": "svc_consult",
        "serviceName": "Initial consultation",
        "total": 15,
        "counts": { "pending": 2, "confirmed": 11, "rejected": 0, "cancelled": 2 }
      }
    ],
    "byStaff": [
      {
        "staffId": "usr_ana",
        "name": "Ana Reyes",
        "total": 9,
        "counts": { "pending": 1, "confirmed": 7, "rejected": 0, "cancelled": 1 }
      }
    ]
  }
}
```

- `from`/`to` are inclusive business-local date keys. Omit either bound for an open range. A reversed range, invalid date, unknown status or malformed ID returns `422 VALIDATION_ERROR`.
- `serviceId`, `staffId` and `status` narrow the set, and the same filters apply to the CSV export. `totals` is the status breakdown plus `appointments`; `byService` and `byStaff` group by the appointment snapshot service and assigned staff. Counts come from SQL aggregates rather than loaded rows.

`GET /api/admin/reports/export.csv`

- Returns the filtered appointments as `text/csv; charset=utf-8` with `Content-Disposition: attachment; filename="slotly-appointments-YYYY-MM-DD.csv"` and `Cache-Control: no-store`. The header is `Reference,Date,Start,End,Duration minutes,Service,Staff,Status,Booking type,Customer name,Customer email,Created`.
- Date, start, end and created values use the business timezone. Customer-owned bookings use the account name and email; guest bookings use the guest fields and `Booking type` is `guest`.
- Cells are RFC 4180 quoted. Values beginning with `=`, `+`, `-`, `@`, tab or carriage return are prefixed with an apostrophe to neutralize spreadsheet formulas.
- At most 5000 rows are exported. `X-Report-Rows` reports the row count and `X-Report-Truncated: true` warns when more rows matched; the summary still counts every matching appointment.
- These routes are admin-only; staff and customer sessions receive `403 FORBIDDEN`.


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
3. `booking_update` — rejection, staff/admin cancellation, staff/admin reschedule or admin reassignment (any material change to time or staff).

There are no reminder endpoints, scheduled reminders or reminder email templates. Email-send failure is recorded in the outbox and must not revert a valid appointment state change.

### 7.1 Implemented email delivery

- Emails go to the customer account address, or the guest email for guest bookings. Customer and guest self-cancellations send no email.
- The outbox insert is batched with the booking insert or the transition's audit row. The API commits the booking/state change first and then makes a best-effort inline send; a failed send only updates the outbox row.
- `notification_outbox.delivery_status` moves through `pending` → `sending` → `sent` or `failed`. Each claim records `last_attempt_at`. The scheduled handler runs every 15 minutes, retries at most 5 times, and treats a `sending` row whose current attempt started more than 15 minutes ago as abandoned by a crashed invocation. Successful sends store `sent_at` and clear `last_error`.
- A successful send replaces the payload with the non-secret extras (action, previous times, resolution note), removing the guest cancellation URL so the raw token does not stay at rest.
- Transport: `EMAIL_TRANSPORT` accepts `console`, `resend` or `none`; without it, a configured `RESEND_API_KEY` selects Resend, production/development falls back to the console transport, and `ENVIRONMENT=test` uses a silent no-op. `EMAIL_FROM` supplies the verified sender and `EMAIL_REPLY_TO` is a fallback reply address.
- The Resend API key is a secret: use `.dev.vars` locally or `wrangler secret put RESEND_API_KEY` at deployment. Never commit it. Resend also needs a verified sending domain before production delivery works.

## 8. CSV export rules

- Apply the same date/service/staff/status filters used by the visible report.
- Enforce Admin authorization server-side.
- Use aggregate queries where possible; do not fetch every row only to calculate summary counts.
- Quote/escape CSV fields correctly and neutralize spreadsheet formula injection (for example values beginning with `=`, `+`, `-`, `@`, tab or carriage-return where relevant).
- Use a clear filename and `text/csv` response content type.

**Phase 9 implementation note (17 November 2026):** `GET /api/admin/reports/export.csv` implements these rules through `worker/lib/csv.ts` and `worker/services/reports.ts`. Summary counts use grouped SQL aggregates, while the export materializes at most 5000 appointment rows, flags truncation in `X-Report-Truncated`, and reuses the exact filters from the summary endpoint.
