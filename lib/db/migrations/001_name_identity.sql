-- Migration: Name + Starter identity system
-- Replaces email/password auth with password-free firstName + starterName identity.
--
-- Applied manually via executeSql on 2026-05-16.
-- This project uses drizzle-kit push (not generate+migrate), so migrations
-- are documented here as SQL for auditability. Run this against a fresh DB
-- before starting the server for the first time after this change.

ALTER TABLE users
  DROP COLUMN IF EXISTS email,
  DROP COLUMN IF EXISTS password_hash,
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS starter_name text;

-- Clear legacy email/password users (their tokens are invalidated by the new format).
-- Their device-scoped data remains accessible via deviceId and claim-orphans.
DELETE FROM users WHERE first_name IS NULL OR starter_name IS NULL;

-- Enforce NOT NULL now that legacy rows are gone.
ALTER TABLE users
  ALTER COLUMN first_name SET NOT NULL,
  ALTER COLUMN starter_name SET NOT NULL;

-- Case-insensitive unique index prevents duplicate rows for the same name combo
-- and eliminates race conditions in concurrent identify requests.
CREATE UNIQUE INDEX IF NOT EXISTS users_name_combo_ci_unique
  ON users (lower(first_name), lower(starter_name));
