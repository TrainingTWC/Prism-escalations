-- =====================================================================
-- Push notifications — device token registry + triggers
-- Run in Supabase SQL Editor:
--   https://supabase.com/dashboard/project/sldvlxpxdcgzrlyqezsi/sql/new
--
-- Powers background push to the Android APK (Capacitor + FCM). The Edge
-- Function `send-push` reads from `device_tokens` and delivers via FCM HTTP v1.
-- Safe to run multiple times.
-- =====================================================================

-- ── 1. Device token registry ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.device_tokens (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,
  platform    TEXT NOT NULL DEFAULT 'android',
  device_id   TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS device_tokens_user_idx ON public.device_tokens (user_id);

ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;

-- A signed-in user manages only their own tokens. The Edge Function uses the
-- service role and bypasses RLS for reads/deletes during delivery.
DROP POLICY IF EXISTS device_tokens_select ON public.device_tokens;
CREATE POLICY device_tokens_select ON public.device_tokens
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS device_tokens_upsert ON public.device_tokens;
CREATE POLICY device_tokens_upsert ON public.device_tokens
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS device_tokens_update ON public.device_tokens;
CREATE POLICY device_tokens_update ON public.device_tokens
  FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS device_tokens_delete ON public.device_tokens;
CREATE POLICY device_tokens_delete ON public.device_tokens
  FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

-- Track which tickets have already fired an SLA-breach push (avoid repeats).
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS sla_breach_notified BOOLEAN DEFAULT FALSE;

-- ── 2. Extensions used to call the Edge Function from Postgres ────────
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ── 3. Secrets (Supabase Vault) ──────────────────────────────────────
-- Replace the placeholder values ONCE, then never commit real values.
--   project_url       = https://sldvlxpxdcgzrlyqezsi.supabase.co
--   push_fn_secret    = the same value you set as PUSH_FN_SECRET on the function
-- (run these manually, editing the values):
--
--   SELECT vault.create_secret('https://sldvlxpxdcgzrlyqezsi.supabase.co', 'project_url');
--   SELECT vault.create_secret('<PUSH_FN_SECRET>', 'push_fn_secret');

CREATE OR REPLACE FUNCTION private_push_config()
RETURNS TABLE (project_url TEXT, fn_secret TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = vault, public AS $$
  SELECT
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url'  LIMIT 1),
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'push_fn_secret' LIMIT 1);
$$;

-- ── 4. Helper: POST a payload to the send-push function ──────────────
CREATE OR REPLACE FUNCTION public.dispatch_push(payload JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  cfg RECORD;
BEGIN
  SELECT * INTO cfg FROM private_push_config();
  IF cfg.project_url IS NULL OR cfg.fn_secret IS NULL THEN
    RETURN; -- not configured yet; no-op
  END IF;

  PERFORM net.http_post(
    url     := cfg.project_url || '/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-secret', cfg.fn_secret
    ),
    body    := payload
  );
END;
$$;

-- ── 5. New-ticket notification ───────────────────────────────────────
-- Notify the assignee (if any) plus all admins / managers on ticket creation.
CREATE OR REPLACE FUNCTION public.notify_new_ticket()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  target_ids UUID[];
  store_name TEXT;
BEGIN
  SELECT s.store_name INTO store_name FROM public.stores s WHERE s.id = NEW.store_id;

  SELECT ARRAY(
    SELECT DISTINCT p.id FROM public.profiles p
    WHERE p.role IN ('admin', 'super_admin', 'manager', 'area_manager', 'leadership')
       OR p.id = NEW.assigned_to
  ) INTO target_ids;

  PERFORM public.dispatch_push(jsonb_build_object(
    'user_ids', to_jsonb(target_ids),
    'title', 'New ' || NEW.severity || ' ticket',
    'body',  NEW.title || COALESCE(' · ' || store_name, ''),
    'data',  jsonb_build_object('ticketId', NEW.id::text, 'path', '/tickets/view/?id=' || NEW.id::text)
  ));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tickets_notify_new ON public.tickets;
CREATE TRIGGER tickets_notify_new
  AFTER INSERT ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.notify_new_ticket();

-- ── 6. SLA-breach sweep (runs every 5 minutes) ───────────────────────
CREATE OR REPLACE FUNCTION public.sweep_sla_breaches()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  t RECORD;
  store_name TEXT;
  target_ids UUID[];
BEGIN
  FOR t IN
    SELECT * FROM public.tickets
    WHERE sla_deadline IS NOT NULL
      AND sla_deadline < NOW()
      AND COALESCE(sla_breach_notified, FALSE) = FALSE
      AND status NOT IN ('resolved', 'closed')
    LIMIT 200
  LOOP
    SELECT s.store_name INTO store_name FROM public.stores s WHERE s.id = t.store_id;

    SELECT ARRAY(
      SELECT DISTINCT p.id FROM public.profiles p
      WHERE p.role IN ('admin', 'super_admin', 'manager', 'area_manager', 'leadership')
         OR p.id = t.assigned_to
    ) INTO target_ids;

    PERFORM public.dispatch_push(jsonb_build_object(
      'user_ids', to_jsonb(target_ids),
      'title', 'SLA breached · ' || t.ticket_code,
      'body',  t.title || COALESCE(' · ' || store_name, ''),
      'data',  jsonb_build_object('ticketId', t.id::text, 'path', '/tickets/view/?id=' || t.id::text)
    ));

    UPDATE public.tickets SET sla_breach_notified = TRUE WHERE id = t.id;
  END LOOP;
END;
$$;

-- Schedule the sweep (idempotent: unschedule first if it exists).
DO $$
BEGIN
  PERFORM cron.unschedule('prism_sla_breach_sweep');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule('prism_sla_breach_sweep', '*/5 * * * *', $$SELECT public.sweep_sla_breaches();$$);

SELECT 'push notifications schema ready ✅' AS result;
