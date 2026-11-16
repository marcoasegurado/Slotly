-- Local development seed. Run explicitly with `npm run db:seed:local`.
--
-- This file is intentionally outside `migrations/` so it never runs against a
-- remote database automatically. It mirrors the public parts of the mock seed:
-- business settings and services only. No demo passwords or personal data are
-- inserted because authentication does not exist yet.

INSERT INTO business_settings (
  id,
  business_name,
  business_email,
  business_timezone,
  max_advance_booking_days
)
VALUES (
  1,
  'Slotly Studio',
  'hello@slotly.studio',
  'Asia/Manila',
  60
)
ON CONFLICT (id) DO UPDATE SET
  business_name = excluded.business_name,
  business_email = excluded.business_email,
  business_timezone = excluded.business_timezone,
  max_advance_booking_days = excluded.max_advance_booking_days,
  updated_at = unixepoch();

INSERT INTO services (id, name, description, duration_minutes, is_active)
VALUES
  (
    'svc_consult',
    'Initial consultation',
    'A first visit to talk through what you need and agree on next steps.',
    60,
    1
  ),
  (
    'svc_standard',
    'Standard appointment',
    'A regular appointment for returning clients.',
    45,
    1
  ),
  (
    'svc_extended',
    'Extended session',
    'More time for a detailed visit or two services in one trip.',
    90,
    1
  ),
  (
    'svc_group',
    'Group session',
    'Currently unavailable while the room is being refurbished.',
    60,
    0
  )
ON CONFLICT (id) DO UPDATE SET
  name = excluded.name,
  description = excluded.description,
  duration_minutes = excluded.duration_minutes,
  is_active = excluded.is_active,
  updated_at = unixepoch();
