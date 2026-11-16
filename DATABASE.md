# Slotly Database Design

**Status:** Implemented by `migrations/0001_initial_schema.sql` (16 November 2026). This document is the detailed source for schema, indexes, integrity and concurrency; `AGENTS (1).md` contains the non-negotiable product rules. Never edit an applied migration; add a new ordered migration instead.

## 1. Database conventions

- Cloudflare D1 (SQLite), accessed only through Worker bindings and typed repositories.
- Use UTC timestamps for appointment/time-off instants. Persisted timestamps are integer Unix seconds consistently; do not mix formats. The React mock still uses ISO strings and will be mapped when the UI is wired to the API.
- Store the business timezone as an IANA name (initial display default `Asia/Manila`, editable by Admin). Convert local working hours/date requests using tested timezone utilities.
- Use prepared statements and bound parameters. Enable/verify foreign-key behavior for each environment.
- Add ordered migrations. Never edit an already-applied migration; add a new migration for schema changes.
- Use local D1 for development/tests. Do not run migrations against production without explicit approval.

## 2. Proposed tables

### `users`

| Column | Notes |
|---|---|
| `id` | Primary key; opaque/non-sequential ID |
| `name` | Required display name |
| `email` | Required, normalized, unique |
| `password_hash` | Versioned `pbkdf2-sha256$v1$<iterations>$<salt-hex>$<hash-hex>` value; never plaintext |
| `role` | CHECK: `customer`, `staff`, `admin` |
| `is_active` | Boolean; inactive users cannot authenticate/receive assignments |
| `must_change_password` | Boolean; true after Admin creates/resets a staff temporary password |
| `temporary_password_expires_at` | Nullable UTC timestamp; only set for a temporary credential |
| `password_changed_at` | Nullable UTC timestamp |
| `created_at`, `updated_at` | UTC timestamps |

Customers self-register as `customer`. No public staff/admin registration. Staff accounts are created/reset by Admin. Temporary password is generated server-side, revealed once, passed to staff out of band, expires after a short configured period (default 24 hours), and must be changed at first login. Persist only its hash plus `must_change_password` and expiry metadata. If expired, staff cannot sign in until Admin issues another temporary password.

### `staff_profiles`

- `user_id` primary key and FK to `users.id`.
- Optional display/contact fields only when needed.
- No service-assignment join table: each active staff member can perform every active service.

### `services`

- `id`, `name`, nullable `description`, positive `duration_minutes`, `is_active`, `created_at`, `updated_at`.
- Add a CHECK for a positive and reasonable duration.
- Deactivation is blocked while future `pending` or `confirmed` appointments still reference the service. Resolve each affected booking first (customer-agreed change to another service, reschedule, reject or cancel); never silently swap service IDs or durations.

### `staff_working_hours`

- `id`, `staff_user_id` FK, `weekday`, `start_minute`, `end_minute`.
- Explicitly define weekday encoding (recommend 0=Sunday through 6=Saturday).
- Allow multiple intervals per day. Validate `start_minute < end_minute` and prevent overlaps for the same staff/day in the service layer.
- A closed day has no interval.
- **Phase 5 implementation:** the schema uses `0 = Sunday … 6 = Saturday`, minutes from business-local midnight, and database CHECKs for weekday and minute bounds. Non-overlap is enforced by `parseWorkingHours` because SQLite cannot express it conveniently. `seed/local.sql` seeds demo hours for Ana, Ben and Ciel.

### `staff_time_off`

- `id`, `staff_user_id` FK, `start_at`, `end_at` UTC, optional private `reason`, `created_at`.
- Full-day absence is represented by an interval covering the full local business date after timezone conversion.
- Any overlap makes that staff member ineligible.

### `appointments`

Recommended columns:

- `id` primary key and customer-safe non-sequential `public_reference` (unique).
- `customer_user_id` nullable FK for guest bookings.
- `guest_name` / `guest_email` nullable; enforce that a guest request has the required snapshot fields and a registered booking is linked to its user.
- `service_id` FK, plus `service_name_snapshot` and `duration_minutes_snapshot`.
- `assigned_staff_user_id` FK to a Staff user; assigned on creation and persisted.
- `start_at`, `end_at` UTC; enforce `end_at > start_at`.
- `status` CHECK: `pending`, `confirmed`, `rejected`, `cancelled` only.
- Optional length-limited `customer_note`, `resolution_note`/reason, and `created_at`, `updated_at`, `approved_at`, `approved_by_user_id`, `cancelled_at`, `cancelled_by_user_id`.

Do not add an `expired` status. Reject new requests whose start time is not strictly in the future. Refuse approval when `start_at <= now`. A stale pending request remains `pending` until staff/admin rejects or cancels it; it must be visibly non-approvable in the UI and excluded from actionable future queues.

### `guest_cancellation_tokens`

- `id`, `appointment_id` FK, unique `token_hash`, `created_at`, `expires_at`, nullable `used_at` / `invalidated_at`.
- Generate tokens using a cryptographically secure random source; store only a one-way hash.
- Token is usable only while its appointment is `pending` and the token has not expired/been invalidated. Set its expiry no later than the appointment start time. Invalidate on approval, rejection or cancellation.
- Token grants only the ability to cancel its associated pending booking. It does not authorize browsing or editing other appointment fields.

**Phase 6 implementation note (16 November 2026):** `BookingsRepository.create()` inserts the pending appointment and, for guest bookings, the token row in one `db.batch()`. A guest token is 32 random bytes; only its SHA-256 hash is stored, and `expires_at` is `min(start_at, created_at + 72 hours)`. `cancelPendingGuest()` performs one conditional `UPDATE` that requires `status = 'pending'`, a guest-owned appointment and a live, unexpired, unused token through `EXISTS`, then marks the token used. A zero-row update returns the generic unavailable response, so a concurrent reuse cannot cancel twice. `cancelPendingForCustomer()` likewise requires the owning `customer_user_id` and `status = 'pending'` in the `UPDATE`, and records `cancelled_at` and `cancelled_by_user_id`. Booking creation revalidates the requested slot against the Phase 5 availability engine immediately before inserting; because pending requests never reserve a slot, confirmed-overlap protection remains the approval step's responsibility.

### `business_settings`

Single-row singleton configuration: fixed `id`, `business_name`, optional `business_email`, `business_timezone`, `max_advance_booking_days`, `updated_at`. No business-wide holiday table in the MVP.

### `sessions`

Sessions are D1-backed: `id`, `user_id` FK, unique `session_token_hash`, `expires_at`, `created_at`, nullable `revoked_at`. Never store the raw cookie token. The Worker issues a random 32-byte token in the `slotly_session` cookie and stores only its SHA-256 hex hash; sessions expire after 7 days and are revoked on logout, password change or temporary-password expiry.

### `notification_outbox`

- `id`, `appointment_id`, `event_type`, `recipient_email`, minimum safe payload or `payload_json`, `delivery_status`, `attempt_count`, sanitized `last_error`, `created_at`, nullable `sent_at`.
- Exactly three email types/templates: `request_received`, `booking_confirmed`, `booking_update`. `booking_update` handles rejection, staff/admin cancellation and material admin appointment changes. It is not a reminder.
- Record status change and notification intent together when practical. Delivery failure must not undo the committed booking/status change.

### `audit_logs`

Recommended fields: `id`, `actor_user_id`, `action`, `entity_type`, `entity_id`, sanitized `metadata_json`, `created_at`. Log approvals, rejections, cancellation, admin reassignment/reschedule, staff activation/deactivation, availability changes, service deactivation and settings changes. Do not log passwords, session tokens, guest tokens or unnecessary personal data.

## 3. Indexes and constraints

Add indexes for:

- Appointments by `(assigned_staff_user_id, status, start_at, end_at)`.
- Customer history by `(customer_user_id, start_at)`.
- Guest email/history only if the product needs it; avoid over-indexing personal data.
- Appointment reports by `(status, start_at)`, `(service_id, start_at)`, `(assigned_staff_user_id, start_at)`.
- Guest cancellation token hash (unique) and appointment_id.
- Sessions by `session_token_hash` (unique) and `expires_at`.
- Outbox by `(delivery_status, created_at)`.

Add CHECK constraints for status enums, valid durations and interval ordering. Validate non-overlapping working hours in the service layer; document any database-level constraints that SQLite cannot conveniently express.

## 4. Approval concurrency and D1 transaction rules

**D1 does not provide an interactive transaction API.** Do not write application logic that begins a transaction, performs a read, makes a decision in Worker code, then conditionally writes in a later call. There is a race between that read and write.

Use one atomic conditional SQL update for the appointment transition where possible. The `UPDATE` must require:

1. The target appointment is still `pending`.
2. Its start time is still in the future.
3. No other `confirmed` appointment overlaps the requested half-open interval for the same assigned staff member.

Overlap condition:

```sql
other.start_at < requested.end_at
AND other.end_at > requested.start_at
```

The update should return/check affected-row count. If zero rows changed, return a safe conflict/stale-status response; do not send the confirmation email. Use D1 prepared statements with bound parameters.

If approval must also write an outbox/audit row or perform multiple dependent statements, use `env.DB.batch([...])` with prepared statements. D1 `batch()` executes its statements sequentially as a transaction and aborts/rolls back the batch when a statement fails. Check the documented behavior of the current D1 API before implementation. Do not assume interactive `BEGIN`/`COMMIT` support. Keep the critical availability predicate in the conditional statement itself; a preceding SELECT alone is not concurrency protection.

After a successful approval commit, enqueue the confirmation email. The send operation itself should occur after the database status change/outbox insertion, not inside a route-level pseudo-transaction.

## 5. Schedule/service change safety

Before changing a staff member's weekly hours, adding time off, or deactivating a staff account, find all future `pending` and `confirmed` appointments that the change would invalidate. Return an impact summary and block the change until the bookings are resolved. Admin must reassign affected bookings to another eligible active staff member or explicitly reschedule/reject/cancel them. Staff cannot reassign to another staff member.

A staff member may edit their own schedule only when it does not invalidate an existing future appointment. If it does, return a conflict that directs them to ask Admin to resolve the affected bookings first.

Before deactivating a service, find future pending/confirmed bookings using it. Block deactivation until each is resolved. Never silently replace the service, duration snapshot or price/meaning (if later introduced).

**Phase 5 implementation note (16 November 2026):** `SchedulesRepository` loads only active staff, their working hours and overlapping time off, plus overlapping `confirmed` appointments for a business-local day. `ServicesRepository` lists future `pending`/`confirmed` bookings for deactivation checks. `findScheduleConflicts` evaluates a proposed weekly schedule or time-off change against future `pending`/`confirmed` appointments and returns safe `{ publicReference, status, startAt }` entries. Public availability uses half-open intervals, so a booking ending when another starts does not conflict.

## 6. Password hashing feasibility gate

Before choosing the password-hashing implementation:

- Verify the algorithm is supported in the current Cloudflare Workers Web Crypto runtime.
- Prefer a purpose-built password KDF supported by the runtime. WebCrypto PBKDF2 is a candidate; it is not automatically approved until the iteration count, salt, output length, and actual CPU time have been tested.
- Benchmark registration/login/reset under the actual Workers plan. Current Cloudflare documentation lists a 10 ms CPU limit per HTTP request on Workers Free; CPU-intensive password hashing may exceed this. Do not respond by weakening the work factor without a security review.
- Verify whether any proposed bcrypt/Argon2 package works in the deployed Workers runtime and its WASM/CPU characteristics. Do not assume Node-native dependencies will work.
- Record the chosen algorithm/version/parameters with each stored hash so parameters can be upgraded. Never use plain SHA-256/SHA-512 as a password hash.

**Phase 4 implementation note (16 November 2026):** The Worker uses WebCrypto PBKDF2-HMAC-SHA-256 with a 16-byte random salt, a 32-byte derived key and 210,000 iterations in the versioned format above. `npm run auth:bench` measured roughly 250–300 ms per hash/verify on the development machine (Node WebCrypto). That exceeds the Workers Free plan's 10 ms CPU limit, so the production Workers plan and final iteration count must be validated before deployment. The version prefix allows a later parameter upgrade without changing the schema.

Official references (re-check on implementation):
- [D1 Database API and `batch()`](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [Workers Web Crypto supported algorithms](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)
- [Workers platform/CPU limits](https://developers.cloudflare.com/workers/platform/limits/)
