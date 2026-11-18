-- Local-dev cleanup for accounts created by the browser QA harness.
-- Scope is limited to the explicit QA fixtures (`qa-*@example.com` and the
-- forced-password user); seeded demo accounts are never touched.
--
--   npm run qa:ui:cleanup
DELETE FROM sessions
WHERE user_id IN (
  SELECT id FROM users
  WHERE id = 'usr_qa_forced' OR email LIKE 'qa-%@example.com'
);

DELETE FROM users
WHERE id = 'usr_qa_forced' OR email LIKE 'qa-%@example.com';
