-- ============================================================
-- Security P0: Harden SECURITY DEFINER functions
-- Ensure every SECURITY DEFINER function in public schema has
-- an explicit, safe search_path.
--
-- This migration is idempotent and only affects functions that
-- currently miss a search_path setting.
-- ============================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT
      n.nspname AS schema_name,
      p.proname AS function_name,
      oidvectortypes(p.proargtypes) AS arg_types
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND (
        p.proconfig IS NULL
        OR NOT EXISTS (
          SELECT 1
          FROM unnest(p.proconfig) cfg
          WHERE cfg LIKE 'search_path=%'
        )
      )
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %I.%I(%s) SET search_path = pg_catalog, public, auth, extensions',
      r.schema_name,
      r.function_name,
      r.arg_types
    );
  END LOOP;
END
$$;
