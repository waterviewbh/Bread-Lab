-- ============================================================================
-- Bread Lab: Corrective Staging Hardening Migration (Issue #41 v2)
-- ============================================================================

-- 1. Revoke default public/anon write privileges on public catalogs & personal tables
REVOKE ALL ON public.affiliate_items FROM PUBLIC, anon;
GRANT SELECT ON public.affiliate_items TO PUBLIC, anon, authenticated;

REVOKE ALL ON public.science_articles FROM PUBLIC, anon;
GRANT SELECT ON public.science_articles TO PUBLIC, anon, authenticated;

REVOKE ALL ON public.bake_sessions FROM PUBLIC, anon;
REVOKE ALL ON public.feed_sessions FROM PUBLIC, anon;
REVOKE ALL ON public.recipes FROM PUBLIC, anon;
REVOKE ALL ON public.starter_analytics FROM PUBLIC, anon;
REVOKE ALL ON public.users FROM PUBLIC, anon;

-- 2. Grant explicit full access privileges to authenticated role only on personal tables
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bake_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.feed_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recipes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.starter_analytics TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.users TO authenticated;

-- 3. Enable RLS on all tables
ALTER TABLE public.affiliate_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.science_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bake_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.starter_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- 4. Idempotent cleanup of all legacy and existing policies
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
DROP POLICY IF EXISTS "Secure starter analytics by feed ownership" ON public.starter_analytics;
DROP POLICY IF EXISTS "Authenticated access for starter analytics" ON public.starter_analytics;
DROP POLICY IF EXISTS "Allow anon to upsert users" ON public.users;
DROP POLICY IF EXISTS "Allow authenticated users to upsert own row" ON public.users;
DROP POLICY IF EXISTS "Public name lookup" ON public.users;
DROP POLICY IF EXISTS "Self-manage identity" ON public.users;
DROP POLICY IF EXISTS "Strict user row ownership" ON public.users;

-- 5. Create final hardened policies
-- Public Catalogs & Science
CREATE POLICY "affiliate_items publicly readable"
  ON public.affiliate_items
  FOR SELECT
  TO PUBLIC, anon, authenticated
  USING (true);

CREATE POLICY "Allow public read access for all articles"
  ON public.science_articles
  FOR SELECT
  TO PUBLIC, anon, authenticated
  USING (true);

-- Personal Tables (Strict User Isolation)
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

CREATE POLICY "Strict user row ownership"
  ON public.users
  FOR ALL
  TO authenticated
  USING (auth.uid()::text = id)
  WITH CHECK (auth.uid()::text = id);

-- Starter Analytics (Secured via trustworthy feed session ownership join)
CREATE POLICY "Secure starter analytics by feed ownership"
  ON public.starter_analytics
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.feed_sessions fs
      WHERE fs.device_id = starter_analytics.device_id
        AND fs.user_id = auth.uid()::text
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.feed_sessions fs
      WHERE fs.device_id = starter_analytics.device_id
        AND fs.user_id = auth.uid()::text
    )
  );
