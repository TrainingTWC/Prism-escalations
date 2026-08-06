-- =====================================================================
-- ROSTER PROVISIONING — every active employee becomes a dashboard user
-- =====================================================================
-- Replaces the admin-invite flow (invite-user Edge Function + Team page
-- "Invite a dashboard user" panel, both deleted). Nobody is emailed an
-- invitation any more: accounts are created silently from employee_roster
-- and simply exist, waiting. The employee's first contact with the app is
-- their own doing — SSO from Prism Platform, or /login/setup to pick a
-- password. Ticket/escalation notification email is unchanged.
--
-- RUN THIS IN: Supabase SQL Editor (whole file).
--
-- AFTER RUNNING:
--   supabase functions deploy provision-roster-users
--   supabase functions deploy self-signup --no-verify-jwt
--   supabase functions delete invite-user
--
-- Then open Team → "Provision dashboard users" and run the backfill once
-- (~2,200 employees, batched). The nightly cron below only picks up the
-- handful of new joiners the 01:30 IST roster sync brought in.
-- =====================================================================


-- ─────────────────────────────────────────────────────────────────────
-- 1. Which active employees don't have an account yet?
--
--    An employee counts as provisioned if a profile carries their emp_id
--    OR their email — the email arm catches the accounts that predate
--    emp_id stamping (the original hand-made logins).
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.unprovisioned_roster_employees(p_limit INT DEFAULT 200)
RETURNS TABLE (
  emp_id      TEXT,
  name        TEXT,
  email       TEXT,
  department  TEXT,
  region      TEXT,
  store_code  TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.emp_id, r.name, r.email, r.department, r.region, r.store_code
  FROM public.employee_roster r
  WHERE r.is_active = TRUE
    AND r.email IS NOT NULL
    AND r.email <> ''
    AND POSITION('@' IN r.email) > 1
    AND NOT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.emp_id = r.emp_id
         OR LOWER(p.email) = LOWER(r.email)
    )
  ORDER BY r.name
  LIMIT GREATEST(p_limit, 1);
$$;

REVOKE ALL ON FUNCTION public.unprovisioned_roster_employees(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unprovisioned_roster_employees(INT) TO service_role;


-- ─────────────────────────────────────────────────────────────────────
-- 2. How many are still outstanding? (drives the progress UI)
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.unprovisioned_roster_count()
RETURNS INT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INT
  FROM public.employee_roster r
  WHERE r.is_active = TRUE
    AND r.email IS NOT NULL
    AND r.email <> ''
    AND POSITION('@' IN r.email) > 1
    AND NOT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.emp_id = r.emp_id
         OR LOWER(p.email) = LOWER(r.email)
    );
$$;

REVOKE ALL ON FUNCTION public.unprovisioned_roster_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unprovisioned_roster_count() TO authenticated, service_role;


-- ─────────────────────────────────────────────────────────────────────
-- 3. Leavers: park the profile, never delete it.
--
--    Tickets FK to profiles(id) via assigned_to/created_by, so deleting a
--    departed employee's profile would orphan history. status='inactive'
--    is enough — every Owner/assignee picker already filters on
--    status='active'.
--
--    Only roster-derived profiles (emp_id IS NOT NULL) are touched, and
--    super_admin/leadership are never auto-parked: those are deliberate
--    grants that may legitimately have no roster row (contractors, the
--    original admin account) and locking them out would be self-inflicted.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_departed_profiles()
RETURNS TABLE (deactivated INT, reactivated INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_off INT := 0;
  v_on  INT := 0;
BEGIN
  -- A wiped/failed roster sync must not cascade into mass deactivation.
  IF (SELECT COUNT(*) FROM public.employee_roster WHERE is_active) = 0 THEN
    RETURN QUERY SELECT 0, 0;
    RETURN;
  END IF;

  WITH off AS (
    UPDATE public.profiles p
    SET status = 'inactive'
    WHERE p.emp_id IS NOT NULL
      AND p.status = 'active'
      AND p.role NOT IN ('super_admin', 'leadership')
      AND NOT EXISTS (
        SELECT 1 FROM public.employee_roster r
        WHERE r.emp_id = p.emp_id AND r.is_active
      )
    RETURNING 1
  )
  SELECT COUNT(*)::INT INTO v_off FROM off;

  -- Rejoiners / roster corrections come back automatically.
  WITH on_again AS (
    UPDATE public.profiles p
    SET status = 'active'
    WHERE p.emp_id IS NOT NULL
      AND p.status = 'inactive'
      AND EXISTS (
        SELECT 1 FROM public.employee_roster r
        WHERE r.emp_id = p.emp_id AND r.is_active
      )
    RETURNING 1
  )
  SELECT COUNT(*)::INT INTO v_on FROM on_again;

  RETURN QUERY SELECT v_off, v_on;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_departed_profiles() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_departed_profiles() TO service_role;


-- ─────────────────────────────────────────────────────────────────────
-- 4. Nightly top-up.
--
--    Runs after the 01:30 IST Convex roster sync, so it sees that day's
--    joiners and leavers. Mirrors dispatch_email's shape: reads config
--    from vault, no-ops silently if it isn't there yet.
--
--    REQUIRED once, in the SQL editor (project_url likely already exists
--    from the email/push setup — skip it if so):
--      SELECT vault.create_secret('https://sldvlxpxdcgzrlyqezsi.supabase.co', 'project_url');
--      SELECT vault.create_secret('<SERVICE_ROLE_KEY>', 'service_role_key');
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dispatch_roster_provisioning()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = vault, public
AS $$
DECLARE
  v_url TEXT;
  v_key TEXT;
BEGIN
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'project_url'       LIMIT 1;
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key'  LIMIT 1;

  IF v_url IS NULL OR v_key IS NULL THEN
    RETURN; -- not configured yet; no-op rather than erroring nightly
  END IF;

  PERFORM net.http_post(
    url     := v_url || '/functions/v1/provision-roster-users',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := jsonb_build_object('limit', 400)
  );
END;
$$;

SELECT cron.unschedule('prism_roster_provisioning')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prism_roster_provisioning');

-- 02:15 IST = 20:45 UTC, 45 min after the roster sync lands.
SELECT cron.schedule(
  'prism_roster_provisioning',
  '45 20 * * *',
  $$SELECT public.dispatch_roster_provisioning();$$
);
