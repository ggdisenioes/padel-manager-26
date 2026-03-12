-- Security P0 Audit (READ-ONLY)
-- Run this in Supabase SQL Editor to detect critical posture gaps
-- without modifying data or permissions.

-- 1) Public tables with RLS disabled (critical if exposed via PostgREST)
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'
  AND n.nspname = 'public'
  AND NOT c.relrowsecurity
ORDER BY 1, 2;

-- 2) Public tables granted to anon/authenticated (exposure inventory)
SELECT
  table_schema,
  table_name,
  grantee,
  STRING_AGG(privilege_type, ', ' ORDER BY privilege_type) AS privileges
FROM information_schema.table_privileges
WHERE table_schema = 'public'
  AND grantee IN ('anon', 'authenticated')
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3;

-- 3) Views in public without explicit SECURITY INVOKER
-- Note: this flags views that do not explicitly set security_invoker=true.
SELECT
  n.nspname AS schema_name,
  c.relname AS view_name,
  COALESCE(array_to_string(c.reloptions, ','), '') AS reloptions
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'v'
  AND n.nspname = 'public'
  AND COALESCE(array_to_string(c.reloptions, ','), '') NOT LIKE '%security_invoker=true%'
ORDER BY 1, 2;

-- 4) SECURITY DEFINER functions without fixed search_path (high risk)
SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  p.prosecdef AS security_definer,
  COALESCE(array_to_string(p.proconfig, ','), '') AS config
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
ORDER BY 1, 2;

-- 5) Policies that allow broad SELECT/ALL with USING true (review required)
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND (
    COALESCE(qual, '') ILIKE '%true%'
    OR COALESCE(with_check, '') ILIKE '%true%'
  )
ORDER BY 1, 2, 3;
