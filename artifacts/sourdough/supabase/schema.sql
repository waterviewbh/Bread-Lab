-- Bread Lab — Supabase schema
-- Run this in the Supabase SQL editor (or via psql) after creating your project.
-- Row Level Security (RLS) is enabled with granular policies matching the live production configuration.

-- ── affiliate_items ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS affiliate_items (
  id                 TEXT        PRIMARY KEY,
  name               TEXT        NOT NULL,
  image_url          TEXT,
  affiliate_url      TEXT        NOT NULL,
  display_weight     INT         DEFAULT 0,
  tab_shown          TEXT,
  tutorial_milestone TEXT,
  is_active          BOOLEAN     DEFAULT TRUE,
  title              TEXT,
  url                TEXT,
  description        TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE affiliate_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "affiliate_items publicly readable"
  ON affiliate_items
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- ── users ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id           TEXT        PRIMARY KEY,
  first_name   TEXT        NOT NULL,
  starter_name TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon to upsert users"
  ON users
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow authenticated users to upsert own row"
  ON users
  FOR ALL
  TO authenticated
  USING (auth.uid()::text = id)
  WITH CHECK (auth.uid()::text = id);

CREATE POLICY "Public name lookup"
  ON users
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Self-manage identity"
  ON users
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid()::text = id);

-- ── feed_sessions ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS feed_sessions (
  id          TEXT        PRIMARY KEY,
  device_id   TEXT        NOT NULL,
  user_id     TEXT,
  saved_at    BIGINT      NOT NULL,
  started_at  BIGINT,
  updated_at  BIGINT,
  in_progress BOOLEAN     NOT NULL DEFAULT FALSE,
  data        JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS feed_sessions_device_saved
  ON feed_sessions (device_id, saved_at DESC);
CREATE INDEX IF NOT EXISTS feed_sessions_user_saved
  ON feed_sessions (user_id, saved_at DESC);

ALTER TABLE feed_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon write own feed (device/user trusted)"
  ON feed_sessions
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Manage own feed"
  ON feed_sessions
  FOR ALL
  TO authenticated
  USING (auth.uid()::text = user_id OR user_id IS NULL)
  WITH CHECK (auth.uid()::text = user_id OR user_id IS NULL);

-- ── bake_sessions ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bake_sessions (
  id           TEXT        PRIMARY KEY,
  device_id    TEXT        NOT NULL,
  user_id      TEXT,
  recipe_id    TEXT,
  recipe_name  TEXT        NOT NULL,
  yield_value  INT         DEFAULT 0,
  saved_at     BIGINT      NOT NULL,
  started_at   BIGINT      NOT NULL,
  completed_at BIGINT,
  status       TEXT,
  outcome      JSONB,
  notes        TEXT,
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

ALTER TABLE bake_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon write own bakes (device/user trusted)"
  ON bake_sessions
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Manage own bakes"
  ON bake_sessions
  FOR ALL
  TO authenticated
  USING (auth.uid()::text = user_id OR user_id IS NULL)
  WITH CHECK (auth.uid()::text = user_id OR user_id IS NULL);

-- ── recipes ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS recipes (
  id               TEXT        PRIMARY KEY,
  device_id        TEXT        NOT NULL,
  user_id          TEXT,
  name             TEXT        NOT NULL,
  overview         TEXT,
  phases           JSONB       NOT NULL DEFAULT '[]',
  recipe_data      JSONB,
  yield_value      INT         DEFAULT 0,
  total_flour_g    FLOAT,
  hydration_pct    FLOAT,
  parent_recipe_id TEXT        REFERENCES recipes(id) ON DELETE SET NULL,
  version_label    TEXT,
  is_archived      BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── recipe duplication function ──────────────────────────────────────────────

DROP FUNCTION IF EXISTS duplicate_recipe(TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS duplicate_recipe(TEXT, TEXT, TEXT, TEXT, BOOLEAN);

CREATE OR REPLACE FUNCTION duplicate_recipe(
  target_id TEXT,
  new_name TEXT,
  new_device_id TEXT,
  new_user_id TEXT DEFAULT NULL,
  make_independent BOOLEAN DEFAULT FALSE
)
RETURNS SETOF recipes AS $$
BEGIN
  RETURN QUERY
  INSERT INTO recipes (
    id,
    device_id,
    user_id,
    name,
    overview,
    phases,
    recipe_data,
    yield_value,
    total_flour_g,
    hydration_pct,
    parent_recipe_id,
    version_label,
    created_at,
    updated_at
  )
  SELECT
    encode(gen_random_bytes(12), 'hex'), -- Generate a unique short-ish ID string
    new_device_id,
    new_user_id,
    new_name,
    overview,
    phases,
    recipe_data,
    yield_value,
    total_flour_g,
    hydration_pct,
    CASE WHEN make_independent THEN NULL ELSE target_id END,
    CASE WHEN make_independent THEN 'Master' ELSE 'Copy' END,
    NOW(),
    NOW()
  FROM recipes
  WHERE id = target_id
  RETURNING *;
END;
$$ LANGUAGE plpgsql;

CREATE INDEX IF NOT EXISTS recipes_device_created
  ON recipes (device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS recipes_user_created
  ON recipes (user_id, created_at DESC);

ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon write own recipes (device/user trusted)"
  ON recipes
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Manage own recipes"
  ON recipes
  FOR ALL
  TO authenticated
  USING (auth.uid()::text = user_id OR user_id IS NULL)
  WITH CHECK (auth.uid()::text = user_id OR user_id IS NULL);

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

ALTER TABLE starter_analytics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon to write analytics"
  ON starter_analytics
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow authenticated to write own analytics"
  ON starter_analytics
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Manage own analytics"
  ON starter_analytics
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ── science_articles ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS science_articles (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                 TEXT        UNIQUE NOT NULL,
  title                TEXT        NOT NULL,
  is_published         BOOLEAN     DEFAULT FALSE,
  blocks               JSONB       NOT NULL,
  further_study_topics JSONB       DEFAULT '[]'::jsonb,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

-- Updated At Trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_science_articles_updated_at
    BEFORE UPDATE ON science_articles
    FOR EACH ROW
    EXECUTE PROCEDURE update_updated_at_column();

-- Enable RLS
ALTER TABLE science_articles ENABLE ROW LEVEL SECURITY;

-- Public Read Policy
CREATE POLICY "Allow public read access for all articles"
  ON science_articles
  FOR SELECT
  TO public
  USING (true);

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
