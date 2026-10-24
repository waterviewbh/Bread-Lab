-- ============================================================================
-- Bread Lab: Automatic Profile Provisioning Trigger (Issue #41 - Finalized)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_first_name TEXT;
  v_starter_name TEXT;
BEGIN
  -- Extract and validate required metadata (no silent fallback; aborts transaction if missing)
  v_first_name := NULLIF(TRIM(NEW.raw_user_meta_data->>'first_name'), '');
  v_starter_name := NULLIF(TRIM(NEW.raw_user_meta_data->>'starter_name'), '');

  IF v_first_name IS NULL OR v_starter_name IS NULL THEN
    RAISE EXCEPTION 'Missing required user metadata: first_name and starter_name must be provided.';
  END IF;

  -- Insert profile; if profile already exists for this ID, DO NOTHING to preserve existing profile record
  INSERT INTO public.users (id, first_name, starter_name, created_at)
  VALUES (
    NEW.id,
    v_first_name,
    v_starter_name,
    COALESCE(NEW.created_at, NOW())
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Set explicit owner and privileges for Supabase Auth trigger execution context
ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

-- Revoke default execution, grant strictly to internal auth roles
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin, postgres, service_role;

-- Trigger on auth.users insert
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
