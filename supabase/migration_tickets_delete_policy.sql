-- =====================================================================
-- Migration: Allow super_admin to delete tickets
-- Run in Supabase SQL Editor:
--   https://supabase.com/dashboard/project/sldvlxpxdcgzrlyqezsi/sql/new
-- =====================================================================

-- Without this, DELETE calls from the client silently return 0 rows
-- (RLS blocks them) while the app's optimistic update hides the failure.
CREATE POLICY "tickets_delete_by_super_admin" ON public.tickets
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.role = 'super_admin'
    )
  );
