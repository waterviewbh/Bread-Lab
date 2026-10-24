-- ============================================================================
-- Bread Lab: Corrective Catalog Privilege Minimization (Issue #41)
-- ============================================================================
-- Revokes all write, update, delete, truncate, and reference privileges from
-- PUBLIC, anon, and authenticated on public read-only catalogs, granting SELECT only.

REVOKE ALL ON public.affiliate_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.affiliate_items TO PUBLIC, anon, authenticated;

REVOKE ALL ON public.science_articles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.science_articles TO PUBLIC, anon, authenticated;
