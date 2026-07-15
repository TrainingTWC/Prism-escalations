-- =====================================================================
-- Migration: Prism Assets v2 — preventive maintenance, coverage alerts,
--            AMC vendor dispatch
-- Run in Supabase SQL Editor:
--   https://supabase.com/dashboard/project/sldvlxpxdcgzrlyqezsi/sql/new
--
-- Depends on: migration_assets_v1.sql (assets, vendors, categories, RLS
-- helpers can_view_asset / can_manage_asset) and migration_workflow_v3.sql
-- (dispatch_email, recipients_from_ids, store_verifier_ids, region_am_ids,
-- distinct_ids, pg_cron/pg_net).
--
-- Adds:
--   1. asset_pm_tasks + asset_pm_log   — preventive maintenance schedule
--   2. pm_mark_done()                  — atomic "mark done" RPC
--   3. warranty/amc alert-stage cols   — so expiry emails fire once per stage
--   4. sweep_asset_coverage()          — daily warranty/AMC expiry alerts
--   5. sweep_pm_due()                  — daily PM-due alerts
--   6. notify_asset_ticket()           — AMC vendor dispatch on new tickets
--   7. crons for the two sweeps
--
-- AFTER RUNNING: redeploy send-email (new asset templates):
--   supabase functions deploy send-email --no-verify-jwt
-- =====================================================================


-- ─────────────────────────────────────────────────────────────────────
-- 0. Recipient helpers not already defined in workflow v3
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.leadership_ids()
RETURNS UUID[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ARRAY(SELECT id FROM public.profiles
               WHERE role IN ('leadership','super_admin') AND status = 'active');
$$;

CREATE OR REPLACE FUNCTION public.store_staff_ids(p_store_id UUID)
RETURNS UUID[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ARRAY(SELECT id FROM public.profiles
               WHERE store_id = p_store_id AND status = 'active');
$$;


-- ─────────────────────────────────────────────────────────────────────
-- 1. PREVENTIVE MAINTENANCE TASKS + LOG
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.asset_pm_tasks (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  asset_id      UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,                 -- "Backwash group head"
  daypart       TEXT NOT NULL DEFAULT 'anytime'
                CHECK (daypart IN ('opening','closing','anytime','weekly','monthly')),
  interval_days INT,                           -- NULL = one-off task
  last_done_at  TIMESTAMPTZ,
  next_due_at   TIMESTAMPTZ,
  last_alert_at TIMESTAMPTZ,                   -- throttles the PM-due sweep
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_by    UUID REFERENCES public.profiles(id),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pm_tasks_asset_idx ON public.asset_pm_tasks (asset_id);
CREATE INDEX IF NOT EXISTS pm_tasks_due_idx   ON public.asset_pm_tasks (next_due_at)
  WHERE is_active;

CREATE TABLE IF NOT EXISTS public.asset_pm_log (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id    UUID REFERENCES public.asset_pm_tasks(id) ON DELETE SET NULL,
  asset_id   UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  done_by    UUID REFERENCES public.profiles(id),
  done_at    TIMESTAMPTZ DEFAULT NOW(),
  note       TEXT
);

CREATE INDEX IF NOT EXISTS pm_log_asset_idx ON public.asset_pm_log (asset_id);

ALTER TABLE public.asset_pm_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_pm_log   ENABLE ROW LEVEL SECURITY;

-- View a task if you can view its asset
DROP POLICY IF EXISTS pm_tasks_select ON public.asset_pm_tasks;
CREATE POLICY pm_tasks_select ON public.asset_pm_tasks
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.assets a
                 WHERE a.id = asset_pm_tasks.asset_id
                   AND public.can_view_asset(a.store_id, a.category_id)));

-- Manage tasks if you can manage the asset (managers / AMs / leadership)
DROP POLICY IF EXISTS pm_tasks_write ON public.asset_pm_tasks;
CREATE POLICY pm_tasks_write ON public.asset_pm_tasks
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.assets a
                 WHERE a.id = asset_pm_tasks.asset_id AND public.can_manage_asset(a.store_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.assets a
                      WHERE a.id = asset_pm_tasks.asset_id AND public.can_manage_asset(a.store_id)));

DROP POLICY IF EXISTS pm_log_select ON public.asset_pm_log;
CREATE POLICY pm_log_select ON public.asset_pm_log
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.assets a
                 WHERE a.id = asset_pm_log.asset_id
                   AND public.can_view_asset(a.store_id, a.category_id)));

-- Anyone who can VIEW the asset (incl. store team) may log a completion
DROP POLICY IF EXISTS pm_log_insert ON public.asset_pm_log;
CREATE POLICY pm_log_insert ON public.asset_pm_log
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = done_by
    AND EXISTS (SELECT 1 FROM public.assets a
                WHERE a.id = asset_pm_log.asset_id
                  AND public.can_view_asset(a.store_id, a.category_id)));


-- ─────────────────────────────────────────────────────────────────────
-- 2. pm_mark_done — atomic "done": log it + roll the schedule forward
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.pm_mark_done(p_task_id UUID, p_note TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t public.asset_pm_tasks%ROWTYPE;
  a public.assets%ROWTYPE;
BEGIN
  SELECT * INTO t FROM public.asset_pm_tasks WHERE id = p_task_id;
  IF t.id IS NULL THEN RAISE EXCEPTION 'PM task not found'; END IF;

  SELECT * INTO a FROM public.assets WHERE id = t.asset_id;
  IF NOT public.can_view_asset(a.store_id, a.category_id) THEN
    RAISE EXCEPTION 'Not allowed to update this asset';
  END IF;

  INSERT INTO public.asset_pm_log (task_id, asset_id, done_by, note)
  VALUES (t.id, t.asset_id, auth.uid(), NULLIF(p_note, ''));

  UPDATE public.asset_pm_tasks
  SET last_done_at  = NOW(),
      next_due_at   = CASE WHEN t.interval_days IS NOT NULL
                           THEN NOW() + (t.interval_days || ' days')::interval
                           ELSE NULL END,
      last_alert_at = NULL
  WHERE id = t.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.pm_mark_done(UUID, TEXT) TO authenticated;


-- ─────────────────────────────────────────────────────────────────────
-- 3. Auto default PM task from the category's default_pm_interval_days
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.assets_after_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_interval INT;
BEGIN
  SELECT default_pm_interval_days INTO v_interval
  FROM public.asset_categories WHERE id = NEW.category_id;

  IF v_interval IS NOT NULL THEN
    INSERT INTO public.asset_pm_tasks (asset_id, title, daypart, interval_days, next_due_at, created_by)
    VALUES (
      NEW.id,
      'Routine service',
      'anytime',
      v_interval,
      COALESCE(NEW.purchase_date::timestamptz, NOW()) + (v_interval || ' days')::interval,
      NEW.created_by
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS assets_default_pm ON public.assets;
CREATE TRIGGER assets_default_pm
  AFTER INSERT ON public.assets
  FOR EACH ROW EXECUTE FUNCTION public.assets_after_insert();


-- ─────────────────────────────────────────────────────────────────────
-- 4. Coverage alert-stage columns (0 none · 1 expiring sent · 2 expired sent)
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS warranty_alert_stage INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amc_alert_stage      INT DEFAULT 0;

-- Reset the relevant stage whenever a coverage date is pushed out (renewal)
CREATE OR REPLACE FUNCTION public.assets_coverage_reset()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.warranty_until IS DISTINCT FROM OLD.warranty_until THEN
    NEW.warranty_alert_stage := 0;
  END IF;
  IF NEW.amc_until IS DISTINCT FROM OLD.amc_until THEN
    NEW.amc_alert_stage := 0;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS assets_coverage_reset_trg ON public.assets;
CREATE TRIGGER assets_coverage_reset_trg
  BEFORE UPDATE ON public.assets
  FOR EACH ROW EXECUTE FUNCTION public.assets_coverage_reset();


-- ─────────────────────────────────────────────────────────────────────
-- 5. Payload builders for asset emails
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.asset_base_json(a public.assets)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_store RECORD;
  v_cat   TEXT;
BEGIN
  SELECT store_name, region, city INTO v_store FROM public.stores WHERE id = a.store_id;
  SELECT name INTO v_cat FROM public.asset_categories WHERE id = a.category_id;
  RETURN jsonb_build_object(
    'name',     a.name,
    'code',     a.asset_code,
    'category', v_cat,
    'store',    COALESCE(v_store.store_name, '—'),
    'region',   COALESCE(v_store.region, ''),
    'storeAddress', v_store.city,
    'path',     '/assets/view/?id=' || a.id::text
  );
END;
$$;


-- ─────────────────────────────────────────────────────────────────────
-- 6. sweep_asset_coverage — daily warranty/AMC expiry alerts
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sweep_asset_coverage()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a       public.assets%ROWTYPE;
  targets UUID[];
  recips  JSONB;
  base    JSONB;
BEGIN
  FOR a IN
    SELECT * FROM public.assets
    WHERE status <> 'retired'
      AND (
        (warranty_until IS NOT NULL AND (
           (warranty_until < NOW() AND warranty_alert_stage < 2) OR
           (warranty_until < NOW() + INTERVAL '30 days' AND warranty_alert_stage < 1)
        )) OR
        (amc_until IS NOT NULL AND (
           (amc_until < NOW() AND amc_alert_stage < 2) OR
           (amc_until < NOW() + INTERVAL '30 days' AND amc_alert_stage < 1)
        ))
      )
    LIMIT 300
  LOOP
    targets := public.distinct_ids(
      public.store_verifier_ids(a.store_id) || public.region_am_ids(a.store_id) || public.leadership_ids());
    recips := public.recipients_from_ids(targets);
    base := public.asset_base_json(a);

    -- Warranty
    IF a.warranty_until IS NOT NULL THEN
      IF a.warranty_until < NOW() AND a.warranty_alert_stage < 2 THEN
        PERFORM public.dispatch_email(jsonb_build_object(
          'event', 'coverage_expired', 'recipients', recips,
          'asset', base || jsonb_build_object('coverageKind', 'Warranty', 'coverageUntil', to_char(a.warranty_until, 'DD Mon YYYY'))));
        UPDATE public.assets SET warranty_alert_stage = 2 WHERE id = a.id;
      ELSIF a.warranty_until < NOW() + INTERVAL '30 days' AND a.warranty_alert_stage < 1 THEN
        PERFORM public.dispatch_email(jsonb_build_object(
          'event', 'coverage_expiring', 'recipients', recips,
          'asset', base || jsonb_build_object('coverageKind', 'Warranty', 'coverageUntil', to_char(a.warranty_until, 'DD Mon YYYY'))));
        UPDATE public.assets SET warranty_alert_stage = 1 WHERE id = a.id;
      END IF;
    END IF;

    -- AMC
    IF a.amc_until IS NOT NULL THEN
      IF a.amc_until < NOW() AND a.amc_alert_stage < 2 THEN
        PERFORM public.dispatch_email(jsonb_build_object(
          'event', 'coverage_expired', 'recipients', recips,
          'asset', base || jsonb_build_object('coverageKind', 'AMC', 'coverageUntil', to_char(a.amc_until, 'DD Mon YYYY'))));
        UPDATE public.assets SET amc_alert_stage = 2 WHERE id = a.id;
      ELSIF a.amc_until < NOW() + INTERVAL '30 days' AND a.amc_alert_stage < 1 THEN
        PERFORM public.dispatch_email(jsonb_build_object(
          'event', 'coverage_expiring', 'recipients', recips,
          'asset', base || jsonb_build_object('coverageKind', 'AMC', 'coverageUntil', to_char(a.amc_until, 'DD Mon YYYY'))));
        UPDATE public.assets SET amc_alert_stage = 1 WHERE id = a.id;
      END IF;
    END IF;
  END LOOP;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────
-- 7. sweep_pm_due — daily preventive-maintenance-due alerts
--    (re-alerts at most weekly per task via last_alert_at)
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sweep_pm_due()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t        public.asset_pm_tasks%ROWTYPE;
  a        public.assets%ROWTYPE;
  targets  UUID[];
  overdue  INT;
BEGIN
  FOR t IN
    SELECT pt.* FROM public.asset_pm_tasks pt
    JOIN public.assets ast ON ast.id = pt.asset_id
    WHERE pt.is_active
      AND ast.status <> 'retired'
      AND pt.next_due_at IS NOT NULL
      AND pt.next_due_at < NOW()
      AND (pt.last_alert_at IS NULL OR pt.last_alert_at < NOW() - INTERVAL '7 days')
    LIMIT 300
  LOOP
    SELECT * INTO a FROM public.assets WHERE id = t.asset_id;
    targets := public.distinct_ids(
      public.store_staff_ids(a.store_id) || public.store_verifier_ids(a.store_id));
    overdue := GREATEST(0, EXTRACT(DAY FROM (NOW() - t.next_due_at))::int);

    PERFORM public.dispatch_email(jsonb_build_object(
      'event', 'pm_due',
      'recipients', public.recipients_from_ids(targets),
      'asset', public.asset_base_json(a),
      'pm', jsonb_build_object('title', t.title, 'overdueDays', overdue)));

    PERFORM public.dispatch_push(jsonb_build_object(
      'user_ids', to_jsonb(targets),
      'title', 'Maintenance due · ' || a.name,
      'body', t.title,
      'data', jsonb_build_object('path', '/assets/view/?id=' || a.id::text)));

    UPDATE public.asset_pm_tasks SET last_alert_at = NOW() WHERE id = t.id;
  END LOOP;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────
-- 8. AMC vendor dispatch — email the vendor when a ticket is raised on a
--    still-covered asset, and log it on the ticket.
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.notify_asset_ticket()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a public.assets%ROWTYPE;
  v public.vendors%ROWTYPE;
  ticket_json JSONB;
  asset_json  JSONB;
BEGIN
  IF NEW.asset_id IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO a FROM public.assets WHERE id = NEW.asset_id;
  IF a.id IS NULL OR a.amc_vendor_id IS NULL THEN RETURN NEW; END IF;
  IF a.amc_until IS NULL OR a.amc_until < CURRENT_DATE THEN RETURN NEW; END IF;  -- not covered

  SELECT * INTO v FROM public.vendors WHERE id = a.amc_vendor_id;
  IF v.id IS NULL OR v.email IS NULL OR NOT v.is_active THEN RETURN NEW; END IF;

  asset_json := public.asset_base_json(a);
  ticket_json := jsonb_build_object(
    'code', NEW.ticket_code, 'title', NEW.title, 'severity', NEW.severity,
    'category', NEW.category, 'path', '/tickets/view/?id=' || NEW.id::text);

  PERFORM public.dispatch_email(jsonb_build_object(
    'event', 'vendor_dispatch',
    'recipients', jsonb_build_array(jsonb_build_object('email', v.email, 'name', v.name)),
    'ticket', ticket_json,
    'asset',  asset_json,
    'vendor', jsonb_build_object('name', v.name, 'slaHours', v.sla_hours)));

  INSERT INTO public.comments (ticket_id, author_id, content, is_status_change)
  VALUES (NEW.id, NULL,
    '🛡️ Covered under AMC with ' || v.name || ' — service request emailed to ' || v.email ||
    COALESCE(' (SLA ' || v.sla_hours || 'h)', '') || '.',
    FALSE);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tickets_notify_asset ON public.tickets;
CREATE TRIGGER tickets_notify_asset
  AFTER INSERT ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.notify_asset_ticket();


-- ─────────────────────────────────────────────────────────────────────
-- 9. Schedule the two daily sweeps (idempotent)
-- ─────────────────────────────────────────────────────────────────────

DO $$
BEGIN PERFORM cron.unschedule('prism_asset_coverage_sweep'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$
BEGIN PERFORM cron.unschedule('prism_pm_due_sweep'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule('prism_asset_coverage_sweep', '45 3 * * *', $$SELECT public.sweep_asset_coverage();$$);
SELECT cron.schedule('prism_pm_due_sweep',         '0 4 * * *',  $$SELECT public.sweep_pm_due();$$);


SELECT 'assets v2 migration complete ✅' AS result;
