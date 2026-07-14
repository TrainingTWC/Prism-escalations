'use client'

import { supabase } from '@/lib/supabase/client'

// ─── Ticket shape used for aggregation ─────────────────────────────────────────
export interface AnalyticsTicket {
  id: string
  category: string
  severity: string
  status: string
  blocked?: boolean | null
  store_id: string | null
  sla_deadline: string | null
  resolved_at: string | null
  closed_at: string | null
  created_at: string
  reopen_count: number
  store?: { store_name?: string | null; store_code?: string | null } | null
}

// ─── AI report contract (mirrors the Edge Function schema) ─────────────────────
export interface AiInsight {
  title: string
  detail: string
  metric?: string
  severity?: 'info' | 'warning' | 'critical'
}
export interface AiPrediction {
  title: string
  detail: string
  timeframe?: string
  likelihood?: 'low' | 'medium' | 'high'
  confidence?: number
}
export interface AiRecommendation {
  title: string
  detail: string
  priority?: 'low' | 'medium' | 'high' | 'urgent'
  expectedImpact?: string
}
export interface AiRisk {
  area: string
  signal: string
  severity?: 'low' | 'medium' | 'high' | 'critical'
}
export interface AiAnomaly {
  title: string
  detail: string
}
export interface AiInsightReport {
  generatedAt: string
  model?: string
  mode?: string
  headline: string
  healthScore: number
  healthLabel: string
  summary: string
  insights: AiInsight[]
  predictions: AiPrediction[]
  recommendations: AiRecommendation[]
  risks: AiRisk[]
  anomalies: AiAnomaly[]
}

// ─── Deep Research report contract (kimi-k2.6 strategist dive) ─────────────────
export interface AiRootCause {
  title: string
  analysis: string
  evidence?: string
  confidence?: number
}
export interface AiStrategicPlay {
  title: string
  rationale: string
  steps: string[]
  expectedOutcome?: string
  effort?: 'low' | 'medium' | 'high'
  priority?: 'low' | 'medium' | 'high' | 'urgent'
  horizon?: string
}
export interface AiScenario {
  name: string
  probability?: number
  narrative: string
  impact?: 'low' | 'medium' | 'high' | 'severe'
}
export interface AiKpiTarget {
  metric: string
  current: string
  target: string
  timeframe?: string
}
export interface AiWatchItem {
  item: string
  why: string
  trigger?: string
}
export interface AiDeepReport {
  generatedAt: string
  model?: string
  mode?: string
  executiveSummary: string
  situationAssessment: string
  rootCauses: AiRootCause[]
  strategicPlays: AiStrategicPlay[]
  scenarios: AiScenario[]
  kpiTargets: AiKpiTarget[]
  watchList: AiWatchItem[]
  bottomLine: string
}

// ─── Deterministic snapshot (computed client-side, sent to the model) ──────────
export interface AnalyticsSnapshot {
  generatedAt: string
  window: { days: number }
  totals: {
    total: number
    active: number
    resolved: number
    breachedOpen: number
    criticalOpen: number
    escalated: number
  }
  rates: {
    mttrHours: number | null
    slaCompliancePct: number | null
    reopenRatePct: number
    resolutionRatePct: number
  }
  byStatus: Record<string, number>
  bySeverity: Record<string, number>
  byCategory: Record<string, number>
  agingOpen: { '0-1d': number; '1-3d': number; '3-7d': number; '7d+': number }
  volumeTrend: { date: string; count: number }[]
  trend: { last7: number; prev7: number; changePct: number | null }
  topStoresByVolume: { code: string; name: string; count: number }[]
  topStoresByBreach: { code: string; name: string; breached: number }[]
}

// ─── Evidence sample (RAG-lite retrieval, computed server-side) ────────────────
export interface EvidenceTicket {
  ticket_code: string
  title: string
  category: string
  severity: string
  status: string
  store_code: string
  created: string
  age_days: number
  breached: boolean
  reopen_count: number
}

// ─── Server-side aggregation (Postgres RPC, Redis-cached via the Edge Function) ─
// The snapshot is computed IN THE DATABASE and cached in Redis (60s) by the
// function, so the browser never downloads tickets and repeat loads are instant.
export async function fetchAnalyticsSnapshot(): Promise<AnalyticsSnapshot> {
  const { data, error } = await supabase.functions.invoke('ai-insights', {
    body: { mode: 'snapshot' },
  })
  if (error) throw new Error(error.message || 'Failed to load analytics snapshot')
  const snap = (data as { snapshot?: AnalyticsSnapshot })?.snapshot
  if (!snap) throw new Error('Analytics snapshot returned no data')
  return snap
}

// Bounded set of the most decision-relevant open tickets (breached → critical → oldest).
export async function fetchEvidenceSample(limit = 12): Promise<EvidenceTicket[]> {
  const { data, error } = await supabase.rpc('evidence_sample', { sample_limit: limit })
  if (error) throw new Error(error.message || 'Failed to load evidence sample')
  return (Array.isArray(data) ? data : []) as unknown as EvidenceTicket[]
}

function hoursBetween(a: string, b: string) {
  return (new Date(b).getTime() - new Date(a).getTime()) / 3_600_000
}
function daysAgo(iso: string) {
  return (Date.now() - new Date(iso).getTime()) / 86_400_000
}
function isClosed(t: AnalyticsTicket) {
  return t.status === 'closed' || t.status === 'resolved' || !!t.resolved_at || !!t.closed_at
}

export function buildAnalyticsSnapshot(tickets: AnalyticsTicket[]): AnalyticsSnapshot {
  const now = new Date()
  const total = tickets.length

  const byStatus: Record<string, number> = {}
  const bySeverity: Record<string, number> = {}
  const byCategory: Record<string, number> = {}
  const aging = { '0-1d': 0, '1-3d': 0, '3-7d': 0, '7d+': 0 }

  const storeVol: Record<string, { name: string; count: number; breached: number }> = {}

  let active = 0
  let resolved = 0
  let breachedOpen = 0
  let criticalOpen = 0
  let escalated = 0
  let reopened = 0

  let mttrSum = 0
  let mttrCount = 0
  let slaWithDeadline = 0
  let slaOk = 0

  for (const t of tickets) {
    byStatus[t.status] = (byStatus[t.status] || 0) + 1
    bySeverity[t.severity] = (bySeverity[t.severity] || 0) + 1
    byCategory[t.category] = (byCategory[t.category] || 0) + 1

    const closed = isClosed(t)
    if (closed) resolved++
    else active++

    if (t.reopen_count > 0) reopened++
    if (t.blocked) escalated++

    const code = t.store?.store_code || t.store_id || 'Unknown'
    const name = t.store?.store_name || code
    if (!storeVol[code]) storeVol[code] = { name, count: 0, breached: 0 }
    storeVol[code].count++

    const breached = !!t.sla_deadline && new Date(t.sla_deadline) < now
    if (!closed) {
      if (breached) { breachedOpen++; storeVol[code].breached++ }
      if (t.severity === 'P0' || t.severity === 'critical') criticalOpen++
      const age = daysAgo(t.created_at)
      if (age <= 1) aging['0-1d']++
      else if (age <= 3) aging['1-3d']++
      else if (age <= 7) aging['3-7d']++
      else aging['7d+']++
    }

    // MTTR from created -> resolved
    if (t.resolved_at) {
      mttrSum += hoursBetween(t.created_at, t.resolved_at)
      mttrCount++
    }
    // SLA compliance among finished tickets that had a deadline
    const finish = t.resolved_at || t.closed_at
    if (t.sla_deadline && finish) {
      slaWithDeadline++
      if (new Date(finish) <= new Date(t.sla_deadline)) slaOk++
    }
  }

  // 30-day volume trend
  const trendMap: Record<string, number> = {}
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now)
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - i)
    trendMap[d.toISOString().slice(0, 10)] = 0
  }
  for (const t of tickets) {
    const key = new Date(t.created_at).toISOString().slice(0, 10)
    if (key in trendMap) trendMap[key]++
  }
  const volumeTrend = Object.entries(trendMap).map(([date, count]) => ({ date, count }))

  const last7 = volumeTrend.slice(-7).reduce((a, b) => a + b.count, 0)
  const prev7 = volumeTrend.slice(-14, -7).reduce((a, b) => a + b.count, 0)
  const changePct = prev7 > 0 ? Math.round(((last7 - prev7) / prev7) * 100) : null

  const stores = Object.entries(storeVol).map(([code, v]) => ({ code, ...v }))

  return {
    generatedAt: now.toISOString(),
    window: { days: 30 },
    totals: { total, active, resolved, breachedOpen, criticalOpen, escalated },
    rates: {
      mttrHours: mttrCount ? Math.round((mttrSum / mttrCount) * 10) / 10 : null,
      slaCompliancePct: slaWithDeadline ? Math.round((slaOk / slaWithDeadline) * 100) : null,
      reopenRatePct: total ? Math.round((reopened / total) * 100) : 0,
      resolutionRatePct: total ? Math.round((resolved / total) * 100) : 0,
    },
    byStatus,
    bySeverity,
    byCategory,
    agingOpen: aging,
    volumeTrend,
    trend: { last7, prev7, changePct },
    topStoresByVolume: stores.sort((a, b) => b.count - a.count).slice(0, 8)
      .map(({ code, name, count }) => ({ code, name, count })),
    topStoresByBreach: stores.filter((s) => s.breached > 0).sort((a, b) => b.breached - a.breached).slice(0, 8)
      .map(({ code, name, breached }) => ({ code, name, breached })),
  }
}

// ─── Invoke the secure Edge Function proxy ─────────────────────────────────────
export async function requestAiInsights(snapshot: AnalyticsSnapshot): Promise<AiInsightReport> {
  const { data, error } = await supabase.functions.invoke('ai-insights', {
    body: { snapshot, mode: 'fast' },
  })

  if (error) {
    throw new Error(error.message || 'AI insights request failed')
  }
  const report = (data as { report?: AiInsightReport })?.report
  if (!report) {
    throw new Error('AI service returned no report')
  }
  // Defensive normalisation so the UI never crashes on a partial response.
  return {
    generatedAt: report.generatedAt ?? new Date().toISOString(),
    model: report.model,
    mode: report.mode,
    headline: report.headline ?? 'No headline produced',
    healthScore: typeof report.healthScore === 'number' ? Math.max(0, Math.min(100, report.healthScore)) : 0,
    healthLabel: report.healthLabel ?? '—',
    summary: report.summary ?? '',
    insights: Array.isArray(report.insights) ? report.insights : [],
    predictions: Array.isArray(report.predictions) ? report.predictions : [],
    recommendations: Array.isArray(report.recommendations) ? report.recommendations : [],
    risks: Array.isArray(report.risks) ? report.risks : [],
    anomalies: Array.isArray(report.anomalies) ? report.anomalies : [],
  }
}

// ─── Deep Research — async job + polling, survives navigation ───────────────────
// Architecture:
//   1. Module-level singleton (_activePromise) survives Next.js client-side
//      navigation — the polling loop never dies when the user switches pages.
//   2. Result is cached in localStorage so if the job completes while the user
//      is on another page, it appears immediately on return.
//   3. On page mount: check cached result → attach to active promise → poll saved jobId.

const DEEP_JOB_KEY    = 'prism:deepJobId'
const DEEP_RESULT_KEY = 'prism:deepResult'

function saveDeepJobId(id: string)   { try { localStorage.setItem(DEEP_JOB_KEY,    id)                  } catch { /* SSR */ } }
function clearDeepJobId()            { try { localStorage.removeItem(DEEP_JOB_KEY)                       } catch { /* SSR */ } }
function saveDeepResult(r: AiDeepReport) { try { localStorage.setItem(DEEP_RESULT_KEY, JSON.stringify(r)) } catch { /* SSR */ } }
function clearDeepResult()           { try { localStorage.removeItem(DEEP_RESULT_KEY)                    } catch { /* SSR */ } }

export function getSavedDeepJobId(): string | null {
  try { return localStorage.getItem(DEEP_JOB_KEY) } catch { return null }
}
export function getSavedDeepResult(): AiDeepReport | null {
  try {
    const raw = localStorage.getItem(DEEP_RESULT_KEY)
    return raw ? (JSON.parse(raw) as AiDeepReport) : null
  } catch { return null }
}
export function clearDeepResearchCache() { clearDeepJobId(); clearDeepResult() }

// Module-level singleton — persists across Next.js client-side route changes.
let _activeJobId: string | null = null
let _activePromise: Promise<AiDeepReport> | null = null

export function getActiveDeepResearch(): { jobId: string | null; promise: Promise<AiDeepReport> | null } {
  return { jobId: _activeJobId, promise: _activePromise }
}

function normalizeSteps(steps: unknown): string[] {
  if (Array.isArray(steps)) return steps.map((s) => String(s)).filter(Boolean)
  if (typeof steps === 'string' && steps.trim()) {
    return steps
      .split(/(?<=[.;])\s+(?=[A-Z])/)
      .map((s) => s.trim())
      .filter(Boolean)
  }
  return []
}

function normalizeDeepReport(report: Partial<AiDeepReport>): AiDeepReport {
  return {
    generatedAt: report.generatedAt ?? new Date().toISOString(),
    model: report.model,
    mode: report.mode,
    executiveSummary: report.executiveSummary ?? '',
    situationAssessment: report.situationAssessment ?? '',
    rootCauses: Array.isArray(report.rootCauses) ? report.rootCauses : [],
    strategicPlays: Array.isArray(report.strategicPlays)
      ? report.strategicPlays.map((p) => ({ ...p, steps: normalizeSteps(p.steps) }))
      : [],
    scenarios: Array.isArray(report.scenarios) ? report.scenarios : [],
    kpiTargets: Array.isArray(report.kpiTargets) ? report.kpiTargets : [],
    watchList: Array.isArray(report.watchList) ? report.watchList : [],
    bottomLine: report.bottomLine ?? '',
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Poll a job until complete / error / 10-minute ceiling.
// Caches the result in localStorage so it survives page navigation.
export async function pollDeepJob(jobId: string): Promise<AiDeepReport> {
  const POLL_MS    = 3_000
  const TIMEOUT_MS = 10 * 60 * 1_000
  const started    = Date.now()

  while (Date.now() - started < TIMEOUT_MS) {
    await sleep(POLL_MS)
    const { data: job, error: pollErr } = await supabase.functions.invoke('ai-insights', {
      body: { mode: 'job', jobId },
    })

    if (pollErr) continue // transient — keep polling
    const status = (job as { status?: string })?.status
    if (status === 'complete' && (job as { report?: unknown }).report) {
      clearDeepJobId()
      const result = normalizeDeepReport((job as { report: Partial<AiDeepReport> }).report)
      saveDeepResult(result) // cache so return-after-completion shows instantly
      return result
    }
    if (status === 'error') {
      clearDeepJobId()
      throw new Error(`Deep research failed: ${(job as { error?: string }).error || 'unknown error'}`)
    }
  }

  clearDeepJobId()
  throw new Error('Deep research timed out. Please try again.')
}

export async function requestDeepResearch(
  snapshot: AnalyticsSnapshot,
  baseReport: AiInsightReport | null,
  evidence: EvidenceTicket[] | null = null,
): Promise<AiDeepReport> {
  // Clear any previous cached result so the new run starts clean.
  clearDeepResult()

  const { data, error } = await supabase.functions.invoke('ai-insights', {
    body: { snapshot, mode: 'deep', baseReport, evidence },
  })
  if (error) throw new Error(error.message || 'Failed to start deep research')
  const jobId = (data as { jobId?: string })?.jobId
  if (!jobId) throw new Error('Deep research did not return a job id')

  saveDeepJobId(jobId)
  _activeJobId = jobId

  // Store the promise at module level so navigating away and back can attach
  // to the same running promise without starting a second polling loop.
  _activePromise = pollDeepJob(jobId).finally(() => {
    if (_activeJobId === jobId) { _activeJobId = null; _activePromise = null }
  })

  return _activePromise
}
