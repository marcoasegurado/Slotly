-- Slotly initial D1 schema.
--
-- Timestamps are integer Unix seconds in UTC. Business-local date/time values
-- are converted in the Worker before persistence. Migrations are ordered and
-- must never be edited after being applied; add a new migration instead.
--
-- D1 enables foreign-key enforcement by default. Tests enable it explicitly
-- because standalone SQLite connections default to enforcement off.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) >= 2),
  email TEXT NOT NULL UNIQUE CHECK (email = lower(trim(email))),
  password_hash TEXT NOT NULL CHECK (length(password_hash) > 0),
  role TEXT NOT NULL CHECK (role IN ('customer', 'staff', 'admin')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
  temporary_password_expires_at INTEGER,
  password_changed_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE staff_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) >= 2),
  description TEXT,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 1 AND 1440),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE staff_working_hours (
  id TEXT PRIMARY KEY,
  staff_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_minute INTEGER NOT NULL CHECK (start_minute >= 0 AND start_minute < 1440),
  end_minute INTEGER NOT NULL CHECK (end_minute > start_minute AND end_minute <= 1440)
);

CREATE INDEX idx_staff_working_hours_staff_weekday
  ON staff_working_hours (staff_user_id, weekday, start_minute);

CREATE TABLE staff_time_off (
  id TEXT PRIMARY KEY,
  staff_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_at INTEGER NOT NULL,
  end_at INTEGER NOT NULL CHECK (end_at > start_at),
  reason TEXT CHECK (reason IS NULL OR length(reason) <= 200),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_staff_time_off_staff_start
  ON staff_time_off (staff_user_id, start_at, end_at);

CREATE TABLE appointments (
  id TEXT PRIMARY KEY,
  public_reference TEXT NOT NULL UNIQUE,
  customer_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  guest_name TEXT,
  guest_email TEXT,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  service_name_snapshot TEXT NOT NULL CHECK (length(trim(service_name_snapshot)) >= 2),
  duration_minutes_snapshot INTEGER NOT NULL
    CHECK (duration_minutes_snapshot BETWEEN 1 AND 1440),
  assigned_staff_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  start_at INTEGER NOT NULL,
  end_at INTEGER NOT NULL CHECK (end_at > start_at),
  status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'rejected', 'cancelled')),
  customer_note TEXT CHECK (customer_note IS NULL OR length(customer_note) <= 500),
  resolution_note TEXT CHECK (resolution_note IS NULL OR length(resolution_note) <= 300),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  approved_at INTEGER,
  approved_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  cancelled_at INTEGER,
  cancelled_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  CHECK (
    (
      customer_user_id IS NOT NULL
      AND guest_name IS NULL
      AND guest_email IS NULL
    )
    OR (
      customer_user_id IS NULL
      AND guest_name IS NOT NULL
      AND length(trim(guest_name)) >= 2
      AND guest_email IS NOT NULL
      AND length(trim(guest_email)) >= 3
    )
  )
);

CREATE INDEX idx_appointments_staff_status_start
  ON appointments (assigned_staff_user_id, status, start_at, end_at);
CREATE INDEX idx_appointments_customer_start
  ON appointments (customer_user_id, start_at);
CREATE INDEX idx_appointments_status_start
  ON appointments (status, start_at);
CREATE INDEX idx_appointments_service_start
  ON appointments (service_id, start_at);
CREATE INDEX idx_appointments_staff_start
  ON appointments (assigned_staff_user_id, start_at);

CREATE TABLE guest_cancellation_tokens (
  id TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) > 0),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  invalidated_at INTEGER
);

CREATE INDEX idx_guest_cancellation_tokens_appointment
  ON guest_cancellation_tokens (appointment_id);

CREATE TABLE business_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  business_name TEXT NOT NULL CHECK (length(trim(business_name)) >= 2),
  business_email TEXT,
  business_timezone TEXT NOT NULL CHECK (length(trim(business_timezone)) >= 1),
  max_advance_booking_days INTEGER NOT NULL
    CHECK (max_advance_booking_days BETWEEN 0 AND 365),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_token_hash TEXT NOT NULL UNIQUE CHECK (length(session_token_hash) > 0),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  revoked_at INTEGER
);

CREATE INDEX idx_sessions_expires ON sessions (expires_at);

CREATE TABLE notification_outbox (
  id TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('request_received', 'booking_confirmed', 'booking_update')),
  recipient_email TEXT NOT NULL CHECK (length(trim(recipient_email)) >= 3),
  payload_json TEXT NOT NULL DEFAULT '{}',
  delivery_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (delivery_status IN ('pending', 'sending', 'sent', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  sent_at INTEGER
);

CREATE INDEX idx_notification_outbox_status_created
  ON notification_outbox (delivery_status, created_at);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (length(trim(action)) >= 1),
  entity_type TEXT NOT NULL CHECK (length(trim(entity_type)) >= 1),
  entity_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_audit_logs_entity
  ON audit_logs (entity_type, entity_id, created_at);
