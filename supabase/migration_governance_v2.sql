-- =====================================================================
-- Migration: Governance Framework v2
-- Run in Supabase SQL Editor:
--   https://supabase.com/dashboard/project/sldvlxpxdcgzrlyqezsi/sql/new
--
-- Changes:
--   1. Expand category to include Finance, Maintenance, L&D
--   2. Convert severity from critical/high/medium/low to P0/P1/P2/P3
--   3. Add secondary_departments TEXT[] column
--   4. Add root_cause_category TEXT column
-- =====================================================================

-- ── 1. Category: drop old check, add expanded one ─────────────────────
ALTER TABLE public.tickets
  DROP CONSTRAINT IF EXISTS tickets_category_check;

ALTER TABLE public.tickets
  ADD CONSTRAINT tickets_category_check
  CHECK (category IN (
    'Operations', 'HR', 'IT', 'SCM', 'QA',
    'Finance', 'Maintenance', 'L&D'
  ));

-- ── 2. Severity: convert existing data, update default + constraint ────

-- Convert legacy values → P-notation
UPDATE public.tickets SET severity = 'P0' WHERE severity = 'critical';
UPDATE public.tickets SET severity = 'P1' WHERE severity = 'high';
UPDATE public.tickets SET severity = 'P2' WHERE severity = 'medium';
UPDATE public.tickets SET severity = 'P3' WHERE severity = 'low';

ALTER TABLE public.tickets
  DROP CONSTRAINT IF EXISTS tickets_severity_check;

ALTER TABLE public.tickets
  ALTER COLUMN severity SET DEFAULT 'P2';

ALTER TABLE public.tickets
  ADD CONSTRAINT tickets_severity_check
  CHECK (severity IN ('P0', 'P1', 'P2', 'P3'));

-- ── 3. Secondary departments ───────────────────────────────────────────
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS secondary_departments TEXT[] DEFAULT '{}';

-- ── 4. Root cause category ─────────────────────────────────────────────
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS root_cause_category TEXT;

CREATE INDEX IF NOT EXISTS tickets_root_cause_idx
  ON public.tickets (root_cause_category);
