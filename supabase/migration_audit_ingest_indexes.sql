-- =====================================================================
-- Audit-ingest merge-lookup indexes
-- Run in Supabase SQL Editor:
--   https://supabase.com/dashboard/project/sldvlxpxdcgzrlyqezsi/sql/new
--
-- Speeds up the cross-audit "find existing open ticket" lookup performed by
-- the audit-ingest Edge Function. Correctness does not depend on these — they
-- are pure performance indexes. Safe to run multiple times.
-- =====================================================================

-- Individual tickets: matched by store + section.
CREATE INDEX IF NOT EXISTS tickets_intel_merge_section
  ON public.tickets (intelligence_store_code, intelligence_section_id)
  WHERE intelligence_source = TRUE;

-- Roll-up tickets: matched by store + program (section id = '__rollup__').
CREATE INDEX IF NOT EXISTS tickets_intel_merge_program
  ON public.tickets (intelligence_store_code, intelligence_program_id)
  WHERE intelligence_source = TRUE;

SELECT 'audit-ingest indexes ready ✅' AS result;
