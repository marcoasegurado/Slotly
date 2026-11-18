-- Local-dev browser-QA fixture: a customer account that must change its
-- temporary password on first use. The hash is copied from the seeded demo
-- customer, so the local demo password (`slotly-demo`) applies.
--
--   npm run qa:ui:fixture
--   npm run qa:ui:cleanup   (removes this and other QA accounts afterwards)
--
-- Never apply this file to production.
INSERT INTO users (
  id, name, email, password_hash, role, is_active,
  must_change_password, temporary_password_expires_at, created_at, updated_at
)
VALUES (
  'usr_qa_forced',
  'QA Forced Password',
  'qa-forced@example.com',
  (SELECT password_hash FROM users WHERE email = 'maria@example.com'),
  'customer',
  1,
  1,
  4102444800,
  1794900000,
  1794900000
)
ON CONFLICT (id) DO UPDATE SET
  must_change_password = 1,
  temporary_password_expires_at = 4102444800,
  is_active = 1,
  password_hash = excluded.password_hash;
