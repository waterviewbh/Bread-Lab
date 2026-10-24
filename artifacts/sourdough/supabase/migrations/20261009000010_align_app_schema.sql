-- ============================================================================
-- Bread Lab: Align Baseline Schema with App Upsert Payloads (v2.5.4)
-- ============================================================================

ALTER TABLE public.recipes
  ADD COLUMN IF NOT EXISTS overview TEXT;

ALTER TABLE public.feed_sessions
  ADD COLUMN IF NOT EXISTS updated_at BIGINT,
  ADD COLUMN IF NOT EXISTS in_progress BOOLEAN NOT NULL DEFAULT FALSE;
