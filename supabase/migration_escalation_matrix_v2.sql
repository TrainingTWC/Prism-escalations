-- =====================================================================
-- Migration: Escalation Matrix v2 — roster people + CSV bulk import
-- Run in Supabase SQL Editor AFTER migration_escalation_matrix.sql and
-- migration_escalation_engine.sql:
--   https://supabase.com/dashboard/project/sldvlxpxdcgzrlyqezsi/sql/new
--
-- Why: escalation_policy_people could only point at a `profiles` row, i.e.
-- someone with a dashboard login. In practice almost nobody outside IT has
-- one — the real people who need to be looped in live in `employee_roster`
-- (synced daily from Prism Platform/Convex, ~2000 rows, see
-- supabaseRosterSync.ts). This migration lets a rung point at EITHER a
-- profile OR a roster employee, and teaches the notify path to email both.
-- Push notifications stay profile-only (a roster employee has no device
-- token to push to — only profiles get those on login).
--
-- Idempotent; safe to re-run.
-- =====================================================================


-- ─────────────────────────────────────────────────────────────────────
-- 1. Let a row point at a roster employee instead of a profile
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.escalation_policy_people
  ADD COLUMN IF NOT EXISTS employee_roster_id UUID
    REFERENCES public.employee_roster(id) ON DELETE CASCADE;

-- Swap the old (policy_id, profile_id) primary key for a surrogate id —
-- a row can now carry a roster id instead of a profile id, so profile_id
-- alone can no longer be part of the key. The old PK must go BEFORE
-- profile_id's NOT NULL can be dropped (Postgres won't relax a PK column
-- while it's still part of the key).
ALTER TABLE public.escalation_policy_people DROP CONSTRAINT IF EXISTS escalation_policy_people_pkey;
ALTER TABLE public.escalation_policy_people ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
UPDATE public.escalation_policy_people SET id = uuid_generate_v4() WHERE id IS NULL;
ALTER TABLE public.escalation_policy_people ALTER COLUMN id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.escalation_policy_people'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE public.escalation_policy_people ADD PRIMARY KEY (id);
  END IF;
END $$;

ALTER TABLE public.escalation_policy_people
  ALTER COLUMN profile_id DROP NOT NULL;

ALTER TABLE public.escalation_policy_people DROP CONSTRAINT IF EXISTS escalation_policy_people_one_target;
ALTER TABLE public.escalation_policy_people ADD CONSTRAINT escalation_policy_people_one_target CHECK (
  (profile_id IS NOT NULL AND employee_roster_id IS NULL) OR
  (profile_id IS NULL AND employee_roster_id IS NOT NULL)
);

-- Same person can't be added twice to the same rung, for either source.
CREATE UNIQUE INDEX IF NOT EXISTS escalation_policy_people_profile_uniq
  ON public.escalation_policy_people (policy_id, profile_id) WHERE profile_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS escalation_policy_people_roster_uniq
  ON public.escalation_policy_people (policy_id, employee_roster_id) WHERE employee_roster_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS escalation_policy_people_roster_idx
  ON public.escalation_policy_people (employee_roster_id);


-- ─────────────────────────────────────────────────────────────────────
-- 2. Email recipients for a rung — union of active profiles + active
--    roster employees, de-duplicated by email (a dashboard user who's
--    also on the roster only gets one email).
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.escalation_policy_recipients(p_policy_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('email', dedup.email, 'name', dedup.name)), '[]'::jsonb)
  FROM (
    SELECT DISTINCT ON (lower(x.email)) x.email, x.name
    FROM (
      SELECT p.email, p.name
      FROM public.escalation_policy_people epp
      JOIN public.profiles p ON p.id = epp.profile_id AND p.status = 'active'
      WHERE epp.policy_id = p_policy_id AND p.email IS NOT NULL
      UNION ALL
      SELECT er.email, er.name
      FROM public.escalation_policy_people epp
      JOIN public.employee_roster er ON er.id = epp.employee_roster_id AND er.is_active
      WHERE epp.policy_id = p_policy_id AND er.email IS NOT NULL
    ) x
  ) dedup;
$$;

-- Push targets for a rung — profile ids only (roster employees have no
-- device token). Signature unchanged so existing callers keep working.
CREATE OR REPLACE FUNCTION public.escalation_policy_people_ids(p_policy_id UUID)
RETURNS UUID[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ARRAY(
    SELECT epp.profile_id
    FROM public.escalation_policy_people epp
    JOIN public.profiles p ON p.id = epp.profile_id AND p.status = 'active'
    WHERE epp.policy_id = p_policy_id AND epp.profile_id IS NOT NULL
  );
$$;


-- ─────────────────────────────────────────────────────────────────────
-- 3. Patch sweep_escalations() to email the combined recipient set
--    (push is unaffected — still profile-only via escalation_policy_people_ids)
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sweep_escalations()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t          public.tickets%ROWTYPE;
  pol        RECORD;
  targets    UUID[];
  recips     JSONB;
  payload    JSONB;
  has_policy BOOLEAN;
BEGIN
  -- ── Housekeeping: resolve escalations whose ticket is no longer active ──
  UPDATE public.escalations e SET resolved = TRUE
  WHERE e.resolved = FALSE
    AND EXISTS (
      SELECT 1 FROM public.tickets t2
      WHERE t2.id = e.ticket_id AND t2.status IN ('resolved','closed','rejected')
    );

  -- ── Walk breached, still-active tickets ────────────────────────────────
  FOR t IN
    SELECT * FROM public.tickets
    WHERE status IN ('open','in_progress')
      AND sla_deadline IS NOT NULL
      AND sla_deadline < NOW()
    ORDER BY sla_deadline
    LIMIT 500
  LOOP
    has_policy := EXISTS (
      SELECT 1 FROM public.applicable_escalation_policies(t.category, t.store_id, t.severity)
    );

    -- ── No ladder for this department → legacy one-time breach notice ────
    IF NOT has_policy THEN
      IF NOT COALESCE(t.sla_breach_notified, FALSE) THEN
        targets := public.distinct_ids(ARRAY[t.assigned_to] || public.region_am_ids(t.store_id));
        payload := public.ticket_event_payload(t, 'sla_breach');
        PERFORM public.dispatch_email(payload || jsonb_build_object(
          'recipients', public.recipients_from_ids(targets)));
        PERFORM public.dispatch_push(jsonb_build_object(
          'user_ids', to_jsonb(targets),
          'title', 'SLA breached · ' || t.ticket_code,
          'body',  t.title,
          'data',  jsonb_build_object('ticketId', t.id::text, 'path', '/tickets/view/?id=' || t.id::text)
        ));
        UPDATE public.tickets SET sla_breach_notified = TRUE WHERE id = t.id;
      END IF;
      CONTINUE;
    END IF;

    -- ── Fire each due rung exactly once ─────────────────────────────────
    FOR pol IN
      SELECT * FROM public.applicable_escalation_policies(t.category, t.store_id, t.severity)
    LOOP
      IF NOW() >= t.sla_deadline + make_interval(mins => pol.after_minutes)
         AND NOT EXISTS (
           SELECT 1 FROM public.escalations e
           WHERE e.ticket_id = t.id AND e.level = pol.level AND e.reason = 'sla_escalation'
         )
      THEN
        -- The row is the "already fired" marker; the partial unique index
        -- (ticket_id, level) WHERE reason='sla_escalation' guards races.
        INSERT INTO public.escalations (ticket_id, level, reason, policy_id, triggered_by)
        VALUES (t.id, pol.level, 'sla_escalation', pol.policy_id, NULL)
        ON CONFLICT (ticket_id, level) WHERE reason = 'sla_escalation' DO NOTHING;

        recips  := public.escalation_policy_recipients(pol.policy_id);
        targets := public.escalation_policy_people_ids(pol.policy_id);

        IF jsonb_array_length(recips) > 0 THEN
          payload := public.ticket_event_payload(t, 'escalated',
            jsonb_build_object('level', pol.level));
          PERFORM public.dispatch_email(payload || jsonb_build_object('recipients', recips));
        END IF;
        IF array_length(targets, 1) IS NOT NULL THEN
          PERFORM public.dispatch_push(jsonb_build_object(
            'user_ids', to_jsonb(targets),
            'title', 'Escalation L' || pol.level || ' · ' || t.ticket_code,
            'body',  t.title,
            'data',  jsonb_build_object('ticketId', t.id::text, 'path', '/tickets/view/?id=' || t.id::text)
          ));
        END IF;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;


SELECT 'escalation matrix v2 (roster people) migration complete ✅' AS result;
