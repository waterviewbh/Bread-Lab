-- ============================================================================
-- Bread Lab: Align affiliate_items Schema & Backfill Data (v2.5.4)
-- ============================================================================

-- 1. Add missing columns safely
ALTER TABLE public.affiliate_items
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS affiliate_url TEXT,
  ADD COLUMN IF NOT EXISTS display_weight INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tab_shown TEXT,
  ADD COLUMN IF NOT EXISTS tutorial_milestone TEXT,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

-- 2. Backfill data from legacy columns (title -> name, url -> affiliate_url) preserving existing non-null values
UPDATE public.affiliate_items
SET
  name = COALESCE(name, title),
  affiliate_url = COALESCE(affiliate_url, url),
  is_active = COALESCE(is_active, TRUE)
WHERE name IS NULL OR affiliate_url IS NULL OR is_active IS NULL;
