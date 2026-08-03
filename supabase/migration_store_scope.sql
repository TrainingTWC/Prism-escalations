-- =====================================================================
-- Migration: Store-scoped routing & escalation policies
-- Run in Supabase SQL Editor AFTER migration_workflow_v3.sql,
-- migration_escalation_matrix.sql, migration_escalation_engine.sql,
-- and migration_escalation_matrix_v2.sql:
--   https://supabase.com/dashboard/project/sldvlxpxdcgzrlyqezsi/sql/new
--
-- Why: department_routing and escalation_policies could only scope a rule
-- to a whole region (or all regions) — never to one specific store. This
-- adds an optional store_id to both. Precedence when resolving a ticket's
-- owner / applicable rungs: exact store match > exact region match >
-- all-regions/all-stores fallback.
--
-- Idempotent; safe to re-run.
-- =====================================================================


-- ─────────────────────────────────────────────────────────────────────
-- 1. department_routing — add store scope
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.department_routing
  ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES public.stores(id) ON DELETE CASCADE;

DROP INDEX IF EXISTS public.department_routing_unique;
CREATE UNIQUE INDEX IF NOT EXISTS department_routing_store_uniq
  ON public.department_routing (department, store_id) WHERE store_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS department_routing_region_uniq
  ON public.department_routing (department, COALESCE(region, '__all__')) WHERE store_id IS NULL;

CREATE INDEX IF NOT EXISTS department_routing_store_idx ON public.department_routing (store_id);

-- Resolve: exact store match first, then exact region, then the NULL fallback.
CREATE OR REPLACE FUNCTION public.resolve_ticket_owner(p_category TEXT, p_store_id UUID)
RETURNS UUID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_region TEXT;
  v_owner  UUID;
BEGIN
  SELECT region INTO v_region FROM public.stores WHERE id = p_store_id;

  SELECT owner_id INTO v_owner
  FROM public.department_routing
  WHERE department = p_category AND is_active
    AND (store_id = p_store_id OR (store_id IS NULL AND (region = v_region OR region IS NULL)))
  ORDER BY (store_id IS NULL),   -- exact store wins over region/fallback
           (region   IS NULL)    -- exact region wins over the NULL fallback
  LIMIT 1;

  RETURN v_owner;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────
-- 2. escalation_policies — add store scope
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.escalation_policies
  ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES public.stores(id) ON DELETE CASCADE;

DROP INDEX IF EXISTS public.escalation_policies_unique;
CREATE UNIQUE INDEX IF NOT EXISTS escalation_policies_store_uniq
  ON public.escalation_policies (department, store_id, COALESCE(severity, '__all__'), level)
  WHERE store_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS escalation_policies_region_uniq
  ON public.escalation_policies (department, COALESCE(region, '__all__'), COALESCE(severity, '__all__'), level)
  WHERE store_id IS NULL;

CREATE INDEX IF NOT EXISTS escalation_policies_store_idx ON public.escalation_policies (store_id);

-- Resolver: per level, the most specific active policy — store beats
-- region beats fallback; within that, exact severity beats fallback.
CREATE OR REPLACE FUNCTION public.applicable_escalation_policies(
  p_category TEXT, p_store_id UUID, p_severity TEXT
)
RETURNS TABLE (level INT, after_minutes INT, policy_id UUID)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_region TEXT;
BEGIN
  SELECT region INTO v_region FROM public.stores WHERE id = p_store_id;

  RETURN QUERY
  SELECT DISTINCT ON (ep.level)
         ep.level, ep.after_minutes, ep.id
  FROM public.escalation_policies ep
  WHERE ep.is_active
    AND ep.department = p_category
    AND (ep.store_id = p_store_id OR (ep.store_id IS NULL AND (ep.region = v_region OR ep.region IS NULL)))
    AND (ep.severity = p_severity OR ep.severity IS NULL)
  ORDER BY ep.level,
           (ep.store_id IS NULL),   -- exact store beats region/fallback
           (ep.severity IS NULL),   -- exact severity beats fallback
           (ep.region   IS NULL);   -- exact region beats fallback (moot once store_id matches)
END;
$$;


SELECT 'store-scoped routing & escalations migration complete ✅' AS result;
