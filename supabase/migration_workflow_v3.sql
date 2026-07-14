-- =====================================================================
-- Migration: Workflow v3 — scoped visibility, routing, 4-status flow
-- Run in Supabase SQL Editor:
--   https://supabase.com/dashboard/project/sldvlxpxdcgzrlyqezsi/sql/new
--
-- What this does (safe to run once; idempotent where possible):
--   1. Unifies roles: store_team / store_manager / area_manager /
--      dept_owner / auditor / leadership / super_admin
--   2. Normalises severity to P0–P3 (legacy values converted)
--   3. Collapses the 9-step status flow to 4 + blocked flag:
--        open → in_progress → resolved → closed   (+ rejected terminal)
--   4. Creates department_routing (dept + region → owner) and
--      auto-assigns new tickets from it
--   5. Enforces the transition graph + stamps timestamps in a trigger
--   6. Rewrites tickets RLS: each role only sees its own scope
--   7. Retargets push + adds email notifications (dispatch_email)
--   8. Verification sweep: reminders at 24h/48h, auto-close at 7 days
--   9. Storage bucket for photo evidence
--
-- AFTER RUNNING: create the email Vault secrets (see section 7) and
-- deploy the send-email function:
--   supabase functions deploy send-email --no-verify-jwt
-- =====================================================================


-- ─────────────────────────────────────────────────────────────────────
-- 1. ROLE UNIFICATION
-- ─────────────────────────────────────────────────────────────────────

-- Fold legacy/off-model roles into the canonical set
UPDATE public.profiles SET role = 'leadership'    WHERE role = 'admin';
UPDATE public.profiles SET role = 'store_manager' WHERE role = 'manager';
UPDATE public.profiles SET role = 'dept_owner'    WHERE role IN ('department_owner', 'dept');
UPDATE public.profiles SET role = 'store_team'
WHERE role NOT IN ('store_team','store_manager','area_manager','dept_owner','auditor','leadership','super_admin');

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('store_team','store_manager','area_manager','dept_owner','auditor','leadership','super_admin'));

-- Normalise common department spellings so RLS/routing string-matches work
UPDATE public.profiles SET department = CASE
  WHEN lower(department) IN ('ops','operations','operational')            THEN 'Operations'
  WHEN lower(department) IN ('hr','human resources','people')             THEN 'HR'
  WHEN lower(department) IN ('it','tech','technology','systems')          THEN 'IT'
  WHEN lower(department) IN ('scm','supply chain','logistics','warehouse')THEN 'SCM'
  WHEN lower(department) IN ('qa','quality','audit','compliance')         THEN 'QA'
  WHEN lower(department) IN ('finance','accounts')                        THEN 'Finance'
  WHEN lower(department) IN ('maintenance','repair','facilities')         THEN 'Maintenance'
  WHEN lower(department) IN ('l&d','lnd','training','learning')           THEN 'L&D'
  ELSE department
END
WHERE department IS NOT NULL;


-- ─────────────────────────────────────────────────────────────────────
-- 2. SEVERITY NORMALISATION (P0–P3) — idempotent re-run of governance v2
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.tickets DROP CONSTRAINT IF EXISTS tickets_severity_check;

UPDATE public.tickets SET severity = 'P0' WHERE severity = 'critical';
UPDATE public.tickets SET severity = 'P1' WHERE severity = 'high';
UPDATE public.tickets SET severity = 'P2' WHERE severity = 'medium';
UPDATE public.tickets SET severity = 'P3' WHERE severity = 'low';

ALTER TABLE public.tickets ALTER COLUMN severity SET DEFAULT 'P2';
ALTER TABLE public.tickets ADD CONSTRAINT tickets_severity_check
  CHECK (severity IN ('P0','P1','P2','P3'));

-- Category check — make sure the expanded 8-department set is in place
ALTER TABLE public.tickets DROP CONSTRAINT IF EXISTS tickets_category_check;
ALTER TABLE public.tickets ADD CONSTRAINT tickets_category_check
  CHECK (category IN ('Operations','HR','IT','SCM','QA','Finance','Maintenance','L&D'));


-- ─────────────────────────────────────────────────────────────────────
-- 3. STATUS COLLAPSE: open → in_progress → resolved → closed (+ rejected)
--    Snag/waiting become a "blocked" flag on an in-progress ticket.
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS blocked               BOOLEAN     DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS blocked_reason        TEXT,
  ADD COLUMN IF NOT EXISTS blocked_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verify_reminders_sent INT         DEFAULT 0;

ALTER TABLE public.tickets DROP CONSTRAINT IF EXISTS tickets_status_check;

UPDATE public.tickets SET status = 'in_progress'
  WHERE status IN ('acknowledged','accepted');

UPDATE public.tickets
  SET status = 'in_progress',
      blocked = TRUE,
      blocked_reason = COALESCE(blocked_reason, 'Migrated from legacy SNAG/WAITING status'),
      blocked_at     = COALESCE(blocked_at, updated_at)
  WHERE status IN ('snag','waiting');

UPDATE public.tickets SET status = 'resolved'
  WHERE status = 'verification';

ALTER TABLE public.tickets ADD CONSTRAINT tickets_status_check
  CHECK (status IN ('open','in_progress','resolved','closed','rejected'));

CREATE INDEX IF NOT EXISTS tickets_status_idx      ON public.tickets (status);
CREATE INDEX IF NOT EXISTS tickets_store_idx       ON public.tickets (store_id);
CREATE INDEX IF NOT EXISTS tickets_category_idx    ON public.tickets (category);
CREATE INDEX IF NOT EXISTS tickets_assigned_to_idx ON public.tickets (assigned_to);


-- ─────────────────────────────────────────────────────────────────────
-- 4. DEPARTMENT ROUTING — who owns tickets for a department (per region)
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.department_routing (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  department  TEXT NOT NULL CHECK (department IN ('Operations','HR','IT','SCM','QA','Finance','Maintenance','L&D')),
  region      TEXT,                                   -- NULL = fallback for all regions
  owner_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS department_routing_unique
  ON public.department_routing (department, COALESCE(region, '__all__'));

ALTER TABLE public.department_routing ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS routing_select ON public.department_routing;
CREATE POLICY routing_select ON public.department_routing
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS routing_write ON public.department_routing;
CREATE POLICY routing_write ON public.department_routing
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p
                 WHERE p.id = (SELECT auth.uid()) AND p.role IN ('super_admin','leadership')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p
                      WHERE p.id = (SELECT auth.uid()) AND p.role IN ('super_admin','leadership')));

-- Resolve: exact (dept, region) match first, then (dept, NULL) fallback
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
    AND (region = v_region OR region IS NULL)
  ORDER BY (region IS NULL)   -- exact region match wins over the NULL fallback
  LIMIT 1;

  RETURN v_owner;
END;
$$;

-- Auto-assign + default SLA on insert
CREATE OR REPLACE FUNCTION public.tickets_before_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.assigned_to IS NULL THEN
    NEW.assigned_to := public.resolve_ticket_owner(NEW.category, NEW.store_id);
  END IF;
  IF NEW.sla_deadline IS NULL THEN
    NEW.sla_deadline := NOW() + (CASE NEW.severity
      WHEN 'P0' THEN INTERVAL '4 hours'
      WHEN 'P1' THEN INTERVAL '24 hours'
      WHEN 'P2' THEN INTERVAL '72 hours'
      ELSE           INTERVAL '7 days'
    END);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tickets_auto_assign ON public.tickets;
CREATE TRIGGER tickets_auto_assign
  BEFORE INSERT ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.tickets_before_insert();


-- ─────────────────────────────────────────────────────────────────────
-- 5. TRANSITION GUARD — enforce the 4-status graph, stamp timestamps
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.tickets_guard_transition()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role TEXT;
  ok BOOLEAN := FALSE;
BEGIN
  -- Service paths (edge functions, cron sweeps, SQL editor) bypass the graph
  IF current_user IN ('service_role','postgres','supabase_admin') THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    ok := (OLD.status = 'open'        AND NEW.status IN ('in_progress','rejected'))
       OR (OLD.status = 'in_progress' AND NEW.status IN ('resolved'))
       OR (OLD.status = 'resolved'    AND NEW.status IN ('closed','in_progress'));
    IF NOT ok THEN
      RAISE EXCEPTION 'Invalid status transition: % → %', OLD.status, NEW.status;
    END IF;

    SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();

    -- Only verifiers can close
    IF NEW.status = 'closed'
       AND v_role NOT IN ('store_manager','area_manager','auditor','leadership','super_admin') THEN
      RAISE EXCEPTION 'Only a store manager, area manager, auditor or leadership can verify & close a ticket';
    END IF;

    -- Stamp timestamps server-side so clients cannot forget them
    IF NEW.status = 'in_progress' AND OLD.status = 'open' THEN
      NEW.first_response_at := COALESCE(NEW.first_response_at, NOW());
    END IF;
    IF NEW.status = 'resolved' THEN
      NEW.resolved_at := NOW();
      NEW.blocked := FALSE;
    END IF;
    IF NEW.status = 'closed' THEN
      NEW.closed_at := NOW();
      NEW.blocked := FALSE;
    END IF;
    IF OLD.status = 'resolved' AND NEW.status = 'in_progress' THEN
      NEW.reopen_count := COALESCE(OLD.reopen_count, 0) + 1;
      NEW.resolved_at := NULL;
      NEW.verify_reminders_sent := 0;
    END IF;
  END IF;

  IF NEW.blocked AND NOT COALESCE(OLD.blocked, FALSE) THEN
    NEW.blocked_at := NOW();
  END IF;
  IF NOT NEW.blocked THEN
    NEW.blocked_reason := NULL;
    NEW.blocked_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tickets_guard ON public.tickets;
CREATE TRIGGER tickets_guard
  BEFORE UPDATE ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.tickets_guard_transition();


-- ─────────────────────────────────────────────────────────────────────
-- 6. SCOPED VISIBILITY — RLS rewrite
--    store_team / store_manager → their store
--    dept_owner                 → their department
--    area_manager               → their region
--    auditor                    → audit-sourced + own tickets
--    leadership / super_admin   → everything
--    Everyone always sees tickets they raised or are assigned to.
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.can_view_ticket(
  t_store UUID, t_category TEXT, t_raised UUID, t_assigned UUID, t_source TEXT
) RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO me FROM public.profiles WHERE id = auth.uid();
  IF me.id IS NULL THEN RETURN FALSE; END IF;

  IF me.role IN ('super_admin','leadership') THEN RETURN TRUE; END IF;
  IF t_raised = me.id OR t_assigned = me.id THEN RETURN TRUE; END IF;

  IF me.role IN ('store_team','store_manager') THEN
    RETURN me.store_id IS NOT NULL AND t_store = me.store_id;
  ELSIF me.role = 'area_manager' THEN
    RETURN me.region IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.stores s WHERE s.id = t_store AND s.region = me.region);
  ELSIF me.role = 'dept_owner' THEN
    RETURN me.department IS NOT NULL AND t_category = me.department;
  ELSIF me.role = 'auditor' THEN
    RETURN t_source = 'audit';
  END IF;

  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_update_ticket(
  t_store UUID, t_category TEXT, t_raised UUID, t_assigned UUID, t_source TEXT
) RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO me FROM public.profiles WHERE id = auth.uid();
  IF me.id IS NULL THEN RETURN FALSE; END IF;

  IF me.role IN ('super_admin','leadership') THEN RETURN TRUE; END IF;
  IF t_raised = me.id OR t_assigned = me.id THEN RETURN TRUE; END IF;

  -- store_team can raise + comment but not edit others' tickets
  IF me.role = 'store_manager' THEN
    RETURN me.store_id IS NOT NULL AND t_store = me.store_id;
  ELSIF me.role = 'area_manager' THEN
    RETURN me.region IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.stores s WHERE s.id = t_store AND s.region = me.region);
  ELSIF me.role = 'dept_owner' THEN
    RETURN me.department IS NOT NULL AND t_category = me.department;
  ELSIF me.role = 'auditor' THEN
    RETURN t_source = 'audit';
  END IF;

  RETURN FALSE;
END;
$$;

DROP POLICY IF EXISTS tickets_select ON public.tickets;
CREATE POLICY tickets_select ON public.tickets
  FOR SELECT TO authenticated
  USING (public.can_view_ticket(store_id, category, raised_by, assigned_to, source_type));

DROP POLICY IF EXISTS tickets_update ON public.tickets;
CREATE POLICY tickets_update ON public.tickets
  FOR UPDATE TO authenticated
  USING (public.can_update_ticket(store_id, category, raised_by, assigned_to, source_type))
  WITH CHECK (public.can_update_ticket(store_id, category, raised_by, assigned_to, source_type));

-- Scope child tables through the ticket they belong to
DROP POLICY IF EXISTS comments_select ON public.comments;
CREATE POLICY comments_select ON public.comments
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = comments.ticket_id));

DROP POLICY IF EXISTS comments_insert ON public.comments;
CREATE POLICY comments_insert ON public.comments
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = author_id
              AND EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = comments.ticket_id));

DROP POLICY IF EXISTS attachments_select ON public.attachments;
CREATE POLICY attachments_select ON public.attachments
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = attachments.ticket_id));

DROP POLICY IF EXISTS attachments_insert ON public.attachments;
CREATE POLICY attachments_insert ON public.attachments
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = uploaded_by
              AND EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = attachments.ticket_id));

DROP POLICY IF EXISTS escalations_select ON public.escalations;
CREATE POLICY escalations_select ON public.escalations
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = escalations.ticket_id));

-- Stores: writes restricted to leadership/super_admin (Convex sync uses service_role)
DROP POLICY IF EXISTS stores_insert ON public.stores;
CREATE POLICY stores_insert ON public.stores
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p
                      WHERE p.id = (SELECT auth.uid()) AND p.role IN ('super_admin','leadership')));


-- ─────────────────────────────────────────────────────────────────────
-- 7. NOTIFICATIONS — email dispatch + unified ticket event fan-out
--    Vault secrets required (run once, replace values):
--      SELECT vault.create_secret('https://sldvlxpxdcgzrlyqezsi.supabase.co', 'project_url');
--      SELECT vault.create_secret('<EMAIL_FN_SECRET>', 'email_fn_secret');
--    (project_url may already exist from the push setup — skip it then.)
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION private_email_config()
RETURNS TABLE (project_url TEXT, fn_secret TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = vault, public AS $$
  SELECT
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url'     LIMIT 1),
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_fn_secret' LIMIT 1);
$$;

CREATE OR REPLACE FUNCTION public.dispatch_email(payload JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  cfg RECORD;
BEGIN
  SELECT * INTO cfg FROM private_email_config();
  IF cfg.project_url IS NULL OR cfg.fn_secret IS NULL THEN
    RETURN; -- email not configured yet; no-op
  END IF;
  IF payload->'recipients' IS NULL OR jsonb_array_length(payload->'recipients') = 0 THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := cfg.project_url || '/functions/v1/send-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-email-secret', cfg.fn_secret
    ),
    body    := payload
  );
END;
$$;

-- Build the common ticket context blob for notification payloads
CREATE OR REPLACE FUNCTION public.ticket_event_payload(t public.tickets, evt TEXT, extra JSONB DEFAULT '{}'::jsonb)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_store  RECORD;
  v_actor  TEXT;
BEGIN
  SELECT store_name, region INTO v_store FROM public.stores WHERE id = t.store_id;
  SELECT name INTO v_actor FROM public.profiles WHERE id = auth.uid();

  RETURN jsonb_build_object(
    'event', evt,
    'ticket', jsonb_build_object(
      'id',        t.id::text,
      'code',      t.ticket_code,
      'title',     t.title,
      'severity',  t.severity,
      'status',    t.status,
      'category',  t.category,
      'store',     COALESCE(v_store.store_name, '—'),
      'region',    COALESCE(v_store.region, ''),
      'path',      '/tickets/view/?id=' || t.id::text
    ),
    'actor', COALESCE(v_actor, 'System')
  ) || extra;
END;
$$;

-- Collect {email,name} recipients from profile ids, excluding the actor
CREATE OR REPLACE FUNCTION public.recipients_from_ids(ids UUID[])
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object('email', p.email, 'name', p.name)), '[]'::jsonb)
  FROM public.profiles p
  WHERE p.id = ANY(ids)
    AND p.id IS DISTINCT FROM auth.uid()
    AND p.email IS NOT NULL
    AND p.status = 'active';
$$;

-- The people who verify for a store: its manager + any store_manager profiles there
CREATE OR REPLACE FUNCTION public.store_verifier_ids(p_store_id UUID)
RETURNS UUID[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ARRAY(
    SELECT DISTINCT x FROM (
      SELECT s.manager_id AS x FROM public.stores s WHERE s.id = p_store_id
      UNION
      SELECT p.id FROM public.profiles p
      WHERE p.store_id = p_store_id AND p.role = 'store_manager'
    ) q WHERE x IS NOT NULL
  );
$$;

-- De-duplicated, NULL-free union of profile-id arrays
CREATE OR REPLACE FUNCTION public.distinct_ids(ids UUID[])
RETURNS UUID[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY(SELECT DISTINCT x FROM unnest(ids) AS x WHERE x IS NOT NULL);
$$;

-- Same, minus the acting user (so people are not notified about their own action)
CREATE OR REPLACE FUNCTION public.ids_minus_actor(ids UUID[])
RETURNS UUID[] LANGUAGE sql STABLE AS $$
  SELECT ARRAY(SELECT DISTINCT x FROM unnest(ids) AS x
               WHERE x IS NOT NULL AND x IS DISTINCT FROM auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.region_am_ids(p_store_id UUID)
RETURNS UUID[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ARRAY(
    SELECT p.id FROM public.profiles p
    JOIN public.stores s ON s.id = p_store_id
    WHERE p.role = 'area_manager' AND p.region = s.region
  );
$$;

-- Unified fan-out: one trigger decides who hears about what
CREATE OR REPLACE FUNCTION public.notify_ticket_event()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  targets   UUID[];
  payload   JSONB;
  recips    JSONB;
  push_body TEXT;
BEGIN
  -- ── created ────────────────────────────────────────────────────────
  IF TG_OP = 'INSERT' THEN
    targets := public.distinct_ids(
      ARRAY[NEW.assigned_to] || public.store_verifier_ids(NEW.store_id));

    payload := public.ticket_event_payload(NEW, 'created');
    recips  := public.recipients_from_ids(targets);
    PERFORM public.dispatch_email(payload || jsonb_build_object('recipients', recips));

    PERFORM public.dispatch_push(jsonb_build_object(
      'user_ids', to_jsonb(public.ids_minus_actor(targets)),
      'title', 'New ' || NEW.severity || ' ticket · ' || NEW.category,
      'body',  NEW.title,
      'data',  jsonb_build_object('ticketId', NEW.id::text, 'path', '/tickets/view/?id=' || NEW.id::text)
    ));
    RETURN NEW;
  END IF;

  -- ── status transitions ────────────────────────────────────────────
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'resolved' THEN
      -- ask the store's verifiers to confirm; tell the raiser too
      targets := public.distinct_ids(
        public.store_verifier_ids(NEW.store_id) || ARRAY[NEW.raised_by]);
      payload := public.ticket_event_payload(NEW, 'resolved');
      push_body := 'Fixed — please verify: ' || NEW.title;

    ELSIF NEW.status = 'in_progress' AND OLD.status = 'resolved' THEN
      targets := public.distinct_ids(ARRAY[NEW.assigned_to]);
      payload := public.ticket_event_payload(NEW, 'reopened');
      push_body := 'Reopened — fix not verified: ' || NEW.title;

    ELSIF NEW.status = 'closed' THEN
      targets := public.distinct_ids(ARRAY[NEW.raised_by, NEW.assigned_to]);
      payload := public.ticket_event_payload(NEW, 'closed');
      push_body := 'Verified & closed: ' || NEW.title;

    ELSIF NEW.status = 'rejected' THEN
      targets := public.distinct_ids(ARRAY[NEW.raised_by]);
      payload := public.ticket_event_payload(NEW, 'rejected');
      push_body := 'Ticket rejected: ' || NEW.title;

    ELSIF NEW.status = 'in_progress' AND OLD.status = 'open' THEN
      -- low-noise: no email, quick push to the raiser only
      PERFORM public.dispatch_push(jsonb_build_object(
        'user_ids', to_jsonb(public.ids_minus_actor(ARRAY[NEW.raised_by])),
        'title', 'Work started · ' || NEW.ticket_code,
        'body',  NEW.title,
        'data',  jsonb_build_object('ticketId', NEW.id::text, 'path', '/tickets/view/?id=' || NEW.id::text)
      ));
      RETURN NEW;
    END IF;

    IF payload IS NOT NULL THEN
      recips := public.recipients_from_ids(targets);
      PERFORM public.dispatch_email(payload || jsonb_build_object('recipients', recips));
      PERFORM public.dispatch_push(jsonb_build_object(
        'user_ids', to_jsonb(public.ids_minus_actor(targets)),
        'title', NEW.ticket_code || ' · ' || initcap(replace(NEW.status, '_', ' ')),
        'body',  push_body,
        'data',  jsonb_build_object('ticketId', NEW.id::text, 'path', '/tickets/view/?id=' || NEW.id::text)
      ));
    END IF;
    RETURN NEW;
  END IF;

  -- ── blocked flag raised ───────────────────────────────────────────
  IF NEW.blocked AND NOT COALESCE(OLD.blocked, FALSE) THEN
    targets := public.distinct_ids(
      ARRAY[NEW.raised_by] || public.store_verifier_ids(NEW.store_id) || public.region_am_ids(NEW.store_id));
    payload := public.ticket_event_payload(NEW, 'blocked',
      jsonb_build_object('reason', COALESCE(NEW.blocked_reason, '—')));
    recips := public.recipients_from_ids(targets);
    PERFORM public.dispatch_email(payload || jsonb_build_object('recipients', recips));
    PERFORM public.dispatch_push(jsonb_build_object(
      'user_ids', to_jsonb(public.ids_minus_actor(targets)),
      'title', 'Blocked · ' || NEW.ticket_code,
      'body',  COALESCE(NEW.blocked_reason, NEW.title),
      'data',  jsonb_build_object('ticketId', NEW.id::text, 'path', '/tickets/view/?id=' || NEW.id::text)
    ));
  END IF;

  RETURN NEW;
END;
$$;

-- Replace the old "notify everyone" trigger with the unified fan-out
DROP TRIGGER IF EXISTS tickets_notify_new ON public.tickets;
DROP TRIGGER IF EXISTS tickets_notify_event ON public.tickets;
CREATE TRIGGER tickets_notify_event
  AFTER INSERT OR UPDATE ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.notify_ticket_event();


-- ─────────────────────────────────────────────────────────────────────
-- 8. SWEEPS — SLA breach (retargeted) + verification reminders/auto-close
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sweep_sla_breaches()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t public.tickets%ROWTYPE;
  targets UUID[];
  payload JSONB;
BEGIN
  FOR t IN
    SELECT * FROM public.tickets
    WHERE sla_deadline IS NOT NULL
      AND sla_deadline < NOW()
      AND COALESCE(sla_breach_notified, FALSE) = FALSE
      AND status IN ('open','in_progress')
    LIMIT 200
  LOOP
    targets := public.distinct_ids(
      ARRAY[t.assigned_to] || public.region_am_ids(t.store_id));

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
  END LOOP;
END;
$$;

-- Verification lifecycle: remind at 24h and 48h, auto-close at 7 days
CREATE OR REPLACE FUNCTION public.sweep_verifications()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t public.tickets%ROWTYPE;
  targets UUID[];
  payload JSONB;
BEGIN
  -- Reminders
  FOR t IN
    SELECT * FROM public.tickets
    WHERE status = 'resolved'
      AND resolved_at IS NOT NULL
      AND (
        (verify_reminders_sent = 0 AND resolved_at < NOW() - INTERVAL '24 hours') OR
        (verify_reminders_sent = 1 AND resolved_at < NOW() - INTERVAL '48 hours')
      )
    LIMIT 200
  LOOP
    targets := public.store_verifier_ids(t.store_id);
    payload := public.ticket_event_payload(t, 'verify_reminder',
      jsonb_build_object('resolvedAgoHours',
        ROUND(EXTRACT(EPOCH FROM (NOW() - t.resolved_at)) / 3600)));
    PERFORM public.dispatch_email(payload || jsonb_build_object(
      'recipients', public.recipients_from_ids(targets)));
    PERFORM public.dispatch_push(jsonb_build_object(
      'user_ids', to_jsonb(targets),
      'title', 'Awaiting your verification · ' || t.ticket_code,
      'body',  t.title,
      'data',  jsonb_build_object('ticketId', t.id::text, 'path', '/tickets/view/?id=' || t.id::text)
    ));
    UPDATE public.tickets
      SET verify_reminders_sent = t.verify_reminders_sent + 1
      WHERE id = t.id;
  END LOOP;

  -- Auto-close after 7 unverified days (notify trigger fires on the update)
  FOR t IN
    SELECT * FROM public.tickets
    WHERE status = 'resolved'
      AND resolved_at IS NOT NULL
      AND resolved_at < NOW() - INTERVAL '7 days'
    LIMIT 200
  LOOP
    UPDATE public.tickets SET status = 'closed', closed_at = NOW() WHERE id = t.id;
    INSERT INTO public.comments (ticket_id, author_id, content, is_status_change, old_status, new_status)
    VALUES (t.id, NULL,
      'Auto-closed: resolved 7 days ago with no verification. Reopen if the issue persists.',
      TRUE, 'resolved', 'closed');
  END LOOP;
END;
$$;

DO $$
BEGIN
  PERFORM cron.unschedule('prism_verification_sweep');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule('prism_verification_sweep', '30 * * * *', $$SELECT public.sweep_verifications();$$);


-- ─────────────────────────────────────────────────────────────────────
-- 9. STORAGE — photo evidence bucket
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public)
VALUES ('ticket-attachments', 'ticket-attachments', TRUE)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "ticket_attachments_insert" ON storage.objects;
CREATE POLICY "ticket_attachments_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'ticket-attachments');

DROP POLICY IF EXISTS "ticket_attachments_select" ON storage.objects;
CREATE POLICY "ticket_attachments_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'ticket-attachments');


SELECT 'workflow v3 migration complete ✅' AS result;
