-- =====================================================================
-- Migration: AI Intelligence — server-side aggregation, evidence
--            retrieval (RAG-lite), and async Deep Research jobs.
-- Run in Supabase SQL Editor:
--   https://supabase.com/dashboard/project/sldvlxpxdcgzrlyqezsi/sql/new
--
-- WHY:
--  * analytics_snapshot()  — computes the dashboard aggregate IN POSTGRES,
--    so the browser stops downloading every ticket (scales to 1000s).
--  * evidence_sample()     — returns only the most decision-relevant tickets
--    (breached -> critical -> oldest) as a bounded set for the prompt.
--  * deep_research_jobs    — async job store. kimi-k2.6 is slow and used to
--    blow the Edge Function compute budget (WORKER_RESOURCE_LIMIT). The
--    function now writes results here from a background task; the client
--    polls this table for the finished report.
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1. analytics_snapshot()  →  the full dashboard aggregate as jsonb
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.analytics_snapshot()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH t AS (
  SELECT
    tk.*,
    (tk.status IN ('closed','resolved')
      OR tk.resolved_at IS NOT NULL
      OR tk.closed_at IS NOT NULL) AS is_closed,
    (tk.sla_deadline IS NOT NULL AND tk.sla_deadline < now()) AS is_breached
  FROM public.tickets tk
),
base AS (
  SELECT
    count(*)                                                            AS total,
    count(*) FILTER (WHERE NOT is_closed)                               AS active,
    count(*) FILTER (WHERE is_closed)                                   AS resolved,
    count(*) FILTER (WHERE NOT is_closed AND is_breached)               AS breached_open,
    count(*) FILTER (WHERE NOT is_closed AND severity = 'critical')     AS critical_open,
    count(*) FILTER (WHERE status IN ('snag','escalated'))              AS escalated,
    count(*) FILTER (WHERE reopen_count > 0)                            AS reopened,
    avg(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600.0)
      FILTER (WHERE resolved_at IS NOT NULL)                           AS mttr_hours,
    count(*) FILTER (
      WHERE sla_deadline IS NOT NULL
        AND COALESCE(resolved_at, closed_at) IS NOT NULL)               AS sla_with_deadline,
    count(*) FILTER (
      WHERE sla_deadline IS NOT NULL
        AND COALESCE(resolved_at, closed_at) IS NOT NULL
        AND COALESCE(resolved_at, closed_at) <= sla_deadline)           AS sla_ok
  FROM t
),
by_status AS (
  SELECT COALESCE(jsonb_object_agg(status, c), '{}'::jsonb) AS j
  FROM (SELECT status, count(*) c FROM t GROUP BY status) s
),
by_severity AS (
  SELECT COALESCE(jsonb_object_agg(severity, c), '{}'::jsonb) AS j
  FROM (SELECT severity, count(*) c FROM t GROUP BY severity) s
),
by_category AS (
  SELECT COALESCE(jsonb_object_agg(category, c), '{}'::jsonb) AS j
  FROM (SELECT category, count(*) c FROM t GROUP BY category) s
),
aging AS (
  SELECT
    count(*) FILTER (WHERE age_days <= 1)                       AS d01,
    count(*) FILTER (WHERE age_days > 1 AND age_days <= 3)      AS d13,
    count(*) FILTER (WHERE age_days > 3 AND age_days <= 7)      AS d37,
    count(*) FILTER (WHERE age_days > 7)                        AS d7p
  FROM (
    SELECT EXTRACT(EPOCH FROM (now() - created_at)) / 86400.0 AS age_days
    FROM t WHERE NOT is_closed
  ) a
),
trend AS (
  SELECT
    to_char((current_date - g.i), 'YYYY-MM-DD')                          AS d,
    (SELECT count(*) FROM t WHERE t.created_at::date = (current_date - g.i)) AS c
  FROM generate_series(0, 29) AS g(i)
),
trend_arr AS (
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object('date', d, 'count', c) ORDER BY d), '[]'::jsonb) AS j,
    COALESCE(SUM(c) FILTER (WHERE d::date >= current_date - 6), 0)                          AS last7,
    COALESCE(SUM(c) FILTER (WHERE d::date >= current_date - 13
                              AND d::date <= current_date - 7), 0)                          AS prev7
  FROM trend
),
store_vol AS (
  SELECT
    COALESCE(s.store_code, t.store_id::text, 'Unknown')                       AS code,
    COALESCE(s.store_name, s.store_code, t.store_id::text, 'Unknown')         AS name,
    count(*)                                                                  AS cnt,
    count(*) FILTER (WHERE NOT t.is_closed AND t.is_breached)                 AS breached
  FROM t LEFT JOIN public.stores s ON s.id = t.store_id
  GROUP BY 1, 2
),
top_volume AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object('code', code, 'name', name, 'count', cnt)), '[]'::jsonb) AS j
  FROM (SELECT code, name, cnt FROM store_vol ORDER BY cnt DESC LIMIT 8) x
),
top_breach AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object('code', code, 'name', name, 'breached', breached)), '[]'::jsonb) AS j
  FROM (SELECT code, name, breached FROM store_vol WHERE breached > 0 ORDER BY breached DESC LIMIT 8) x
)
SELECT jsonb_build_object(
  'generatedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'window', jsonb_build_object('days', 30),
  'totals', jsonb_build_object(
    'total', base.total,
    'active', base.active,
    'resolved', base.resolved,
    'breachedOpen', base.breached_open,
    'criticalOpen', base.critical_open,
    'escalated', base.escalated
  ),
  'rates', jsonb_build_object(
    'mttrHours', CASE WHEN base.mttr_hours IS NULL THEN NULL
                      ELSE round(base.mttr_hours::numeric, 1) END,
    'slaCompliancePct', CASE WHEN base.sla_with_deadline > 0
                             THEN round(100.0 * base.sla_ok / base.sla_with_deadline)
                             ELSE NULL END,
    'reopenRatePct', CASE WHEN base.total > 0
                          THEN round(100.0 * base.reopened / base.total) ELSE 0 END,
    'resolutionRatePct', CASE WHEN base.total > 0
                              THEN round(100.0 * base.resolved / base.total) ELSE 0 END
  ),
  'byStatus', by_status.j,
  'bySeverity', by_severity.j,
  'byCategory', by_category.j,
  'agingOpen', jsonb_build_object('0-1d', aging.d01, '1-3d', aging.d13, '3-7d', aging.d37, '7d+', aging.d7p),
  'volumeTrend', trend_arr.j,
  'trend', jsonb_build_object(
    'last7', trend_arr.last7,
    'prev7', trend_arr.prev7,
    'changePct', CASE WHEN trend_arr.prev7 > 0
                      THEN round(100.0 * (trend_arr.last7 - trend_arr.prev7) / trend_arr.prev7)
                      ELSE NULL END
  ),
  'topStoresByVolume', top_volume.j,
  'topStoresByBreach', top_breach.j
)
FROM base, by_status, by_severity, by_category, aging, trend_arr, top_volume, top_breach;
$$;

GRANT EXECUTE ON FUNCTION public.analytics_snapshot() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 2. evidence_sample(int)  →  bounded set of the most relevant open tickets
--    Retrieval ordering: breached first, then by severity, then oldest.
--    Returns at most `sample_limit` rows regardless of total volume.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.evidence_sample(sample_limit int DEFAULT 12)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb)
  FROM (
    SELECT
      t.ticket_code,
      left(t.title, 140)                                            AS title,
      t.category,
      t.severity,
      t.status,
      COALESCE(s.store_code, 'Unknown')                             AS store_code,
      to_char(t.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')        AS created,
      round((EXTRACT(EPOCH FROM (now() - t.created_at)) / 86400.0)::numeric, 1) AS age_days,
      (t.sla_deadline IS NOT NULL AND t.sla_deadline < now())       AS breached,
      t.reopen_count
    FROM public.tickets t
    LEFT JOIN public.stores s ON s.id = t.store_id
    WHERE NOT (t.status IN ('closed','resolved')
               OR t.resolved_at IS NOT NULL
               OR t.closed_at IS NOT NULL)
    ORDER BY
      (CASE WHEN t.sla_deadline IS NOT NULL AND t.sla_deadline < now() THEN 0 ELSE 1 END),
      (CASE t.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END),
      t.created_at ASC
    LIMIT GREATEST(1, LEAST(sample_limit, 30))
  ) x
$$;

GRANT EXECUTE ON FUNCTION public.evidence_sample(int) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 3. deep_research_jobs  →  async result store for kimi-k2.6 dives
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.deep_research_jobs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  requested_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'running'
                  CHECK (status IN ('running','complete','error')),
  model         TEXT,
  snapshot      JSONB,
  evidence      JSONB,
  report        JSONB,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ
);

ALTER TABLE public.deep_research_jobs ENABLE ROW LEVEL SECURITY;

-- Users can read only their own jobs.
DROP POLICY IF EXISTS "drj_select_own" ON public.deep_research_jobs;
CREATE POLICY "drj_select_own" ON public.deep_research_jobs
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = requested_by);

-- The Edge Function background task (service_role) creates + updates jobs.
DROP POLICY IF EXISTS "drj_service_all" ON public.deep_research_jobs;
CREATE POLICY "drj_service_all" ON public.deep_research_jobs
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS deep_research_jobs_requested_by_idx
  ON public.deep_research_jobs (requested_by, created_at DESC);
