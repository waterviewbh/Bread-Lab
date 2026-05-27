-- Bread Lab API — full schema DDL
-- Run this against a fresh PostgreSQL database before importing seed data.
-- Drizzle schema source: lib/db/src/schema/
-- Applied via: drizzle-kit push (no FK constraints by design — userId is a plain text reference)

CREATE TABLE IF NOT EXISTS users (
  id          text PRIMARY KEY,
  first_name  text NOT NULL,
  starter_name text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Case-insensitive unique index prevents duplicate identities and race conditions.
CREATE UNIQUE INDEX IF NOT EXISTS users_name_combo_ci_unique
  ON users (lower(first_name), lower(starter_name));

CREATE TABLE IF NOT EXISTS feed_sessions (
  id         text PRIMARY KEY,
  device_id  text NOT NULL,
  user_id    text,
  saved_at   bigint NOT NULL,
  started_at bigint,
  data       jsonb NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS feed_sessions_user_id_idx  ON feed_sessions (user_id);
CREATE INDEX IF NOT EXISTS feed_sessions_device_id_idx ON feed_sessions (device_id);

CREATE TABLE IF NOT EXISTS bake_sessions (
  id          text PRIMARY KEY,
  device_id   text NOT NULL,
  user_id     text,
  recipe_id   text,
  recipe_name text NOT NULL,
  saved_at    bigint NOT NULL,
  started_at  bigint NOT NULL,
  phases      jsonb NOT NULL,
  in_progress boolean NOT NULL DEFAULT false,
  created_at  timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bake_sessions_user_id_idx  ON bake_sessions (user_id);
CREATE INDEX IF NOT EXISTS bake_sessions_device_id_idx ON bake_sessions (device_id);

CREATE TABLE IF NOT EXISTS recipes (
  id         text PRIMARY KEY,
  device_id  text NOT NULL,
  user_id    text,
  name       text NOT NULL,
  phases     jsonb NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recipes_user_id_idx  ON recipes (user_id);
CREATE INDEX IF NOT EXISTS recipes_device_id_idx ON recipes (device_id);
