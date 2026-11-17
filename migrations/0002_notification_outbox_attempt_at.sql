-- Records when the current delivery attempt started. The scheduled retry uses
-- it to reclaim `sending` rows abandoned by a crashed invocation without
-- re-sending an email that is still in flight.
ALTER TABLE notification_outbox ADD COLUMN last_attempt_at INTEGER;
