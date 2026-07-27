-- =====================================================================
-- Migration: Escalation Matrix v1 — Phase 3 (the engine)
-- Run in Supabase SQL Editor AFTER migration_escalation_matrix.sql:
--   https://supabase.com/dashboard/project/sldvlxpxdcgzrlyqezsi/sql/new
--
-- What this does:
--   1. sweep_escalations() — walks breached, still-active tickets and, per the
--      department's matrix, fires each due rung ONCE (records an escalations
--      row + notifies that rung's people by email & push). Ownership never
--      changes; people are only looped in.
--   2. Fallback: a ticket whose department has NO configured ladder still gets
--      the legacy one-time breach notice (assignee + region AM), preserving
--      today's behaviour. Replaces the standalone prism_sla_breach_sweep.
--   3. Housekeeping: escalations for tickets that left the active states are
--      marked resolved so the Escalations page stays accurate.
--   4. Reschedules cron: prism_sla_breach_sweep OFF, prism_escalation_sweep ON.
--
-- AFTER RUNNING: redeploy send-email so the new 'escalated' event renders:
--   supabase functions deploy send-email --no-verify-jwt
-- (Email/push are no-ops until their Vault secrets exist — see workflow v3 §7.)
-- =====================================================================


CREATE OR REPLACE FUNCTION public.sweep_escalations()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t          public.tickets%ROWTYPE;
  pol        RECORD;
  targets    UUID[];
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

        targets := public.escalation_policy_people_ids(pol.policy_id);
        IF array_length(targets, 1) IS NOT NULL THEN
          payload := public.ticket_event_payload(t, 'escalated',
            jsonb_build_object('level', pol.level));
          PERFORM public.dispatch_email(payload || jsonb_build_object(
            'recipients', public.recipients_from_ids(targets)));
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


-- ── Reschedule: fold the standalone breach sweep into the escalation sweep ──
DO $$ BEGIN PERFORM cron.unschedule('prism_sla_breach_sweep'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('prism_escalation_sweep'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule('prism_escalation_sweep', '*/5 * * * *', $$SELECT public.sweep_escalations();$$);


SELECT 'escalation engine (Phase 3) migration complete ✅' AS result;
