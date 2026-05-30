-- =====================================================================
-- Migration: Store Staff Mapping (Area Manager / Trainer / HR)
-- Run in Supabase SQL Editor:
--   https://supabase.com/dashboard/project/sldvlxpxdcgzrlyqezsi/sql/new
--
-- Source of truth: Convex `stores` table (Prism Intelligence — effervescent-gopher)
--   amName              -> am_name
--   regionalTrainerName -> trainer_name (falls back to trainer1Name)
--   regionalHrName      -> hr_name      (falls back to hrbp1Name / hrHeadName)
-- Populated by the Convex supabaseSync action on every roster sync.
-- =====================================================================

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS am_name      TEXT,
  ADD COLUMN IF NOT EXISTS trainer_name TEXT,
  ADD COLUMN IF NOT EXISTS hr_name      TEXT;

CREATE INDEX IF NOT EXISTS stores_am_name_idx      ON public.stores (am_name);
CREATE INDEX IF NOT EXISTS stores_trainer_name_idx ON public.stores (trainer_name);
CREATE INDEX IF NOT EXISTS stores_hr_name_idx      ON public.stores (hr_name);
