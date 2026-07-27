-- =====================================================================
-- Migration: Escalation Matrix v1 — department-specific, admin-configurable
-- Run in Supabase SQL Editor:
--   https://supabase.com/dashboard/project/sldvlxpxdcgzrlyqezsi/sql/new
--
-- What this does (Phase 1 — schema only; the sweep engine lands in Phase 3):
--   1. escalation_policies      — one row per rung of a department's ladder
--   2. escalation_policy_people — the specific people looped in at each rung
--   3. Loosens the escalations CHECK constraints so the engine can write
--      time-based SLA escalations at any level (was hardcoded to 1..4)
--   4. A dedup index so a rung fires at most once per ticket
--   5. applicable_escalation_policies() — resolves the winning policy per
--      level for a ticket's (department, region, severity), with fallback
--
-- Model (locked with product):
--   * Rungs are ANCHORED ON SLA BREACH. after_minutes is measured from the
--     ticket's sla_deadline, so L1 (after_minutes=0) fires at the breach and
--     each later rung fires at sla_deadline + after_minutes.
--   * Escalation NOTIFIES the rung's people; it never changes assigned_to.
--
-- Idempotent where possible; safe to re-run.
-- =====================================================================


-- ─────────────────────────────────────────────────────────────────────
-- 1. ESCALATION POLICIES — the ladder (dept + optional region/severity)
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.escalation_policies (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  department    TEXT NOT NULL CHECK (department IN
                  ('Operations','HR','IT','SCM','QA','Finance','Maintenance','L&D')),
  region        TEXT,                                    -- NULL = fallback for all regions
  severity      TEXT CHECK (severity IN ('P0','P1','P2','P3')),  -- NULL = all severities
  level         INT  NOT NULL CHECK (level >= 1),
  -- minutes AFTER the ticket's sla_deadline; 0 = fire at the breach itself
  after_minutes INT  NOT NULL DEFAULT 0 CHECK (after_minutes >= 0),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- One rung per (department, region-scope, severity-scope, level).
-- COALESCE sentinels let a NULL region/severity coexist with specific ones.
CREATE UNIQUE INDEX IF NOT EXISTS escalation_policies_unique
  ON public.escalation_policies
     (department, COALESCE(region, '__all__'), COALESCE(severity, '__all__'), level);

CREATE INDEX IF NOT EXISTS escalation_policies_dept_idx
  ON public.escalation_policies (department) WHERE is_active;

ALTER TABLE public.escalation_policies ENABLE ROW LEVEL SECURITY;

-- Everyone authenticated can read the matrix; only admins/leadership edit it.
DROP POLICY IF EXISTS escalation_policies_select ON public.escalation_policies;
CREATE POLICY escalation_policies_select ON public.escalation_policies
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS escalation_policies_write ON public.escalation_policies;
CREATE POLICY escalation_policies_write ON public.escalation_policies
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p
                 WHERE p.id = (SELECT auth.uid()) AND p.role IN ('super_admin','leadership')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p
                      WHERE p.id = (SELECT auth.uid()) AND p.role IN ('super_admin','leadership')));

-- Keep updated_at fresh (reuses the trigger fn from the base schema).
DROP TRIGGER IF EXISTS escalation_policies_updated_at ON public.escalation_policies;
CREATE TRIGGER escalation_policies_updated_at
  BEFORE UPDATE ON public.escalation_policies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


-- ─────────────────────────────────────────────────────────────────────
-- 2. ESCALATION POLICY PEOPLE — the "respective people" for each rung
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.escalation_policy_people (
  policy_id  UUID NOT NULL REFERENCES public.escalation_policies(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.profiles(id)            ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (policy_id, profile_id)
);

CREATE INDEX IF NOT EXISTS escalation_policy_people_profile_idx
  ON public.escalation_policy_people (profile_id);

ALTER TABLE public.escalation_policy_people ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS escalation_policy_people_select ON public.escalation_policy_people;
CREATE POLICY escalation_policy_people_select ON public.escalation_policy_people
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS escalation_policy_people_write ON public.escalation_policy_people;
CREATE POLICY escalation_policy_people_write ON public.escalation_policy_people
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p
                 WHERE p.id = (SELECT auth.uid()) AND p.role IN ('super_admin','leadership')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p
                      WHERE p.id = (SELECT auth.uid()) AND p.role IN ('super_admin','leadership')));


-- ─────────────────────────────────────────────────────────────────────
-- 3. LOOSEN escalations CONSTRAINTS
--    The base table hardcoded level 1..4 and a fixed reason set. The matrix
--    can define any number of rungs, and the engine writes a new reason.
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.escalations DROP CONSTRAINT IF EXISTS escalations_level_check;
ALTER TABLE public.escalations ADD  CONSTRAINT escalations_level_check
  CHECK (level >= 1);

ALTER TABLE public.escalations DROP CONSTRAINT IF EXISTS escalations_reason_check;
ALTER TABLE public.escalations ADD  CONSTRAINT escalations_reason_check
  CHECK (reason IN ('no_ack','sla_breach','repeated_issue','critical_severity','sla_escalation'));

-- Link an escalation row back to the policy rung that produced it (nullable:
-- manual/legacy escalations have no policy). SET NULL so deleting a policy
-- doesn't wipe the historical escalation record.
ALTER TABLE public.escalations
  ADD COLUMN IF NOT EXISTS policy_id UUID
    REFERENCES public.escalation_policies(id) ON DELETE SET NULL;

-- 4. A rung fires at most once per ticket: the engine checks for an existing
--    (ticket_id, level) sla_escalation row before inserting.
CREATE UNIQUE INDEX IF NOT EXISTS escalations_sla_dedup
  ON public.escalations (ticket_id, level)
  WHERE reason = 'sla_escalation';


-- ─────────────────────────────────────────────────────────────────────
-- 5. RESOLVER — winning policy per level for a ticket's context
--    Precedence mirrors resolve_ticket_owner: an exact severity match beats
--    the NULL-severity fallback, and an exact region match beats NULL region.
--    Returns one row per level (the most specific active policy for it).
-- ─────────────────────────────────────────────────────────────────────

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
    AND (ep.region   = v_region   OR ep.region   IS NULL)
    AND (ep.severity = p_severity OR ep.severity IS NULL)
  ORDER BY ep.level,
           (ep.severity IS NULL),   -- FALSE (exact) sorts before TRUE (fallback)
           (ep.region   IS NULL);
END;
$$;

-- Convenience: the profile ids looped in for a policy rung.
CREATE OR REPLACE FUNCTION public.escalation_policy_people_ids(p_policy_id UUID)
RETURNS UUID[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ARRAY(
    SELECT epp.profile_id
    FROM public.escalation_policy_people epp
    JOIN public.profiles p ON p.id = epp.profile_id AND p.status = 'active'
    WHERE epp.policy_id = p_policy_id
  );
$$;


SELECT 'escalation matrix v1 (schema) migration complete ✅' AS result;
