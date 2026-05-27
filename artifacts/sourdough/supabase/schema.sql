-- Bread Lab — Supabase schema
-- Run this in the Supabase SQL editor (or via psql) after creating your project.
-- The app uses device_id filtering with the anon key (no RLS required for a
-- single-user personal app). RLS can be enabled later if multi-user support is added.

-- ── users ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id           TEXT        PRIMARY KEY,
  first_name   TEXT        NOT NULL,
  starter_name TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── feed_sessions ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS feed_sessions (
  id          TEXT        PRIMARY KEY,
  device_id   TEXT        NOT NULL,
  user_id     TEXT,
  saved_at    BIGINT      NOT NULL,
  started_at  BIGINT,
  data        JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS feed_sessions_device_saved
  ON feed_sessions (device_id, saved_at DESC);
CREATE INDEX IF NOT EXISTS feed_sessions_user_saved
  ON feed_sessions (user_id, saved_at DESC);

-- ── bake_sessions ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bake_sessions (
  id           TEXT        PRIMARY KEY,
  device_id    TEXT        NOT NULL,
  user_id      TEXT,
  recipe_id    TEXT,
  recipe_name  TEXT        NOT NULL,
  saved_at     BIGINT      NOT NULL,
  started_at   BIGINT      NOT NULL,
  phases       JSONB       NOT NULL DEFAULT '[]',
  in_progress  BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bake_sessions_device_saved
  ON bake_sessions (device_id, saved_at DESC);
CREATE INDEX IF NOT EXISTS bake_sessions_device_inprogress
  ON bake_sessions (device_id, in_progress);
CREATE INDEX IF NOT EXISTS bake_sessions_user_saved
  ON bake_sessions (user_id, saved_at DESC);

-- ── recipes ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS recipes (
  id          TEXT        PRIMARY KEY,
  device_id   TEXT        NOT NULL,
  user_id     TEXT,
  name        TEXT        NOT NULL,
  phases      JSONB       NOT NULL DEFAULT '[]',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS recipes_device_created
  ON recipes (device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS recipes_user_created
  ON recipes (user_id, created_at DESC);

-- ── starter_analytics ─────────────────────────────────────────────────────────
-- Pre-computed pH chart curves. One row per device.
-- vitality_points / all_time_points are JSONB arrays of [minutes, pH] pairs.

CREATE TABLE IF NOT EXISTS starter_analytics (
  device_id         TEXT    PRIMARY KEY,
  updated_at        BIGINT  NOT NULL DEFAULT 0,
  vitality_sessions INT     NOT NULL DEFAULT 0,
  vitality_x_max    FLOAT   NOT NULL DEFAULT 120,
  vitality_points   JSONB   NOT NULL DEFAULT '[]',
  all_time_sessions INT     NOT NULL DEFAULT 0,
  all_time_x_max    FLOAT   NOT NULL DEFAULT 120,
  all_time_points   JSONB   NOT NULL DEFAULT '[]'
);

-- ── v1.0.8 migration: stamp tempUnit on existing feed readings ─────────────────
-- Run this once in the Supabase SQL editor.
-- Adds tempUnit:"F" to every reading that has a non-empty temp but no tempUnit.
-- Wrapped in a transaction: the COMMIT is only reached when the verification
-- SELECT returns 0 unpatched rows; otherwise issue ROLLBACK manually.

BEGIN;

UPDATE feed_sessions
SET data = jsonb_set(
  data,
  '{readings}',
  (
    SELECT jsonb_agg(
      CASE
        WHEN (reading->>'temp') IS NOT NULL
          AND (reading->>'temp') <> ''
          AND (reading->>'tempUnit') IS NULL
        THEN reading || '{"tempUnit":"F"}'::jsonb
        ELSE reading
      END
    )
    FROM jsonb_array_elements(data->'readings') AS reading
  )
)
WHERE data ? 'readings'
  AND jsonb_array_length(data->'readings') > 0;

-- Verification: must return 0 rows before committing.
-- If any rows appear here, run ROLLBACK; instead of COMMIT;
SELECT COUNT(*) AS unpatched
FROM feed_sessions,
     jsonb_array_elements(data->'readings') AS reading
WHERE data ? 'readings'
  AND (reading->>'temp') IS NOT NULL
  AND (reading->>'temp') <> ''
  AND (reading->>'tempUnit') IS NULL;

COMMIT;
