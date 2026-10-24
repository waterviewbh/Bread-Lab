-- ============================================================================
-- Bread Lab: True Rerun-Safe Secure Production Hardening Migration
-- ============================================================================

-- 1. Revoke default public privileges on personal tables
REVOKE ALL ON public.bake_sessions FROM PUBLIC, anon;
REVOKE ALL ON public.feed_sessions FROM PUBLIC, anon;
REVOKE ALL ON public.recipes FROM PUBLIC, anon;
REVOKE ALL ON public.starter_analytics FROM PUBLIC, anon;
REVOKE ALL ON public.users FROM PUBLIC, anon;

-- 2. Grant explicit privileges to authenticated role only
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bake_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.feed_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recipes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.starter_analytics TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.users TO authenticated;

-- 3. Enable RLS on all personal tables
ALTER TABLE public.bake_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.starter_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- 4. True idempotent cleanup of all legacy and replacement policies
DROP POLICY IF EXISTS "affiliate_items publicly readable" ON public.affiliate_items;
DROP POLICY IF EXISTS "Allow anon write own bakes (device/user trusted)" ON public.bake_sessions;
DROP POLICY IF EXISTS "Manage own bakes" ON public.bake_sessions;
DROP POLICY IF EXISTS "Strict user isolation for bakes" ON public.bake_sessions;
DROP POLICY IF EXISTS "Allow anon write own feed (device/user trusted)" ON public.feed_sessions;
DROP POLICY IF EXISTS "Manage own feed" ON public.feed_sessions;
DROP POLICY IF EXISTS "Strict user isolation for feed sessions" ON public.feed_sessions;
DROP POLICY IF EXISTS "Allow anon write own recipes (device/user trusted)" ON public.recipes;
DROP POLICY IF EXISTS "Manage own recipes" ON public.recipes;
DROP POLICY IF EXISTS "Strict user isolation for recipes" ON public.recipes;
DROP POLICY IF EXISTS "Allow public read access for all articles" ON public.science_articles;
DROP POLICY IF EXISTS "Allow anon to write analytics" ON public.starter_analytics;
DROP POLICY IF EXISTS "Allow authenticated to write own analytics" ON public.starter_analytics;
DROP POLICY IF EXISTS "Manage own analytics" ON public.starter_analytics;
DROP POLICY IF EXISTS "Strict user isolation for starter analytics" ON public.starter_analytics;
DROP POLICY IF EXISTS "Allow anon to upsert users" ON public.users;
DROP POLICY IF EXISTS "Allow authenticated users to upsert own row" ON public.users;
DROP POLICY IF EXISTS "Public name lookup" ON public.users;
DROP POLICY IF EXISTS "Self-manage identity" ON public.users;
DROP POLICY IF EXISTS "Strict user row ownership" ON public.users;

-- 5. Create strict ownership policies for authenticated users
CREATE POLICY "Strict user isolation for bakes"
  ON public.bake_sessions
  FOR ALL
  TO authenticated
  USING (auth.uid()::text = user_id)
  WITH CHECK (auth.uid()::text = user_id);

CREATE POLICY "Strict user isolation for feed sessions"
  ON public.feed_sessions
  FOR ALL
  TO authenticated
  USING (auth.uid()::text = user_id)
  WITH CHECK (auth.uid()::text = user_id);

CREATE POLICY "Strict user isolation for recipes"
  ON public.recipes
  FOR ALL
  TO authenticated
  USING (auth.uid()::text = user_id)
  WITH CHECK (auth.uid()::text = user_id);

CREATE POLICY "Allow anon to write analytics"
  ON public.starter_analytics
  FOR ALL
  TO anon
  USING (true)
  With CHECK (true);

CREATE POLICY "Manage own analytics"
  ON public.starter_analytics
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Strict user row ownership"
  ON public.users
  FOR ALL
  TO authenticated
  USING (auth.uid()::text = id)
  WITH CHECK (auth.uid()::text = id);

-- 6. Preserve public read access for catalogs and science articles
GRANT SELECT ON public.affiliate_items TO PUBLIC, anon, authenticated;
CREATE POLICY "affiliate_items publicly readable"
  ON public.affiliate_items
  FOR SELECT
  TO PUBLIC, anon, authenticated
  USING (true);

GRANT SELECT ON public.science_articles TO PUBLIC, anon, authenticated;
CREATE POLICY "Allow public read access for all articles"
  ON public.science_articles
  FOR SELECT
  TO PUBLIC, anon, authenticated
  USING (true);
