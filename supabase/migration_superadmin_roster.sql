-- =====================================================================
-- Migration: Super Admin + Employee Roster
-- Run in Supabase SQL Editor:
--   https://supabase.com/dashboard/project/sldvlxpxdcgzrlyqezsi/sql/new
-- =====================================================================

-- 1. Add emp_id to profiles (for linking to Prism Platform employees)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS emp_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_emp_id_unique
  ON public.profiles (emp_id)
  WHERE emp_id IS NOT NULL;

-- 2. Employee roster — synced from Convex every 5 days
CREATE TABLE IF NOT EXISTS public.employee_roster (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  emp_id        TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  email         TEXT,
  department    TEXT,
  designation   TEXT,
  store_code    TEXT REFERENCES public.stores(store_code) ON UPDATE CASCADE,
  region        TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  convex_id     TEXT,
  last_synced_at TIMESTAMPTZ DEFAULT NOW(),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.employee_roster ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read the roster
CREATE POLICY "employee_roster_select" ON public.employee_roster
  FOR SELECT TO authenticated USING (true);

-- Only service_role (Convex sync) can write
CREATE POLICY "employee_roster_service_write" ON public.employee_roster
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 3. Allow super_admin to update any profile's role / emp_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'profiles'
      AND policyname = 'profiles_update_by_super_admin'
  ) THEN
    CREATE POLICY "profiles_update_by_super_admin" ON public.profiles
      FOR UPDATE TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.profiles p2
          WHERE p2.id = (SELECT auth.uid()) AND p2.role = 'super_admin'
        )
      )
      WITH CHECK (true);
  END IF;
END $$;

-- 4. Seed super admin
-- Run AFTER amritanshu@thirdwavecoffee.in has signed in at least once
-- (or after running: npx convex run --prod internal.supabaseSync.seedSuperAdmin '{}')
UPDATE public.profiles
SET    role   = 'super_admin',
       emp_id = 'h541'
WHERE  email  = 'amritanshu@thirdwavecoffee.in';
