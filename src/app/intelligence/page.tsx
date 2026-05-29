'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AppShell } from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase/client'
import {
  AreaChart, Area, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ComposedChart, ReferenceLine,
} from 'recharts'
import { format } from 'date-fns'
import {
  Sparkles, Brain, TrendingUp, TrendingDown, AlertTriangle, Lightbulb,
  Target, Activity, RefreshCcw, ShieldAlert, Gauge, Zap, ArrowRight, Loader2,
} from 'lucide-react'
import {
  buildAnalyticsSnapshot, requestAiInsights,
  type AnalyticsTicket, type AnalyticsSnapshot, type AiInsightReport,
} from '@/lib/intelligence/analytics-ai'

// ─── tone helpers ──────────────────────────────────────────────────────────────
const SEVERITY_TONE: Record<string, string> = {
  info: '#3B82F6', warning: '#F59E0B', critical: '#EF4444',
  low: '#22C55E', medium: '#E07B39', high: '#F59E0B',
}
const PRIORITY_TONE: Record<string, string> = {
  low: '#22C55E', medium: '#E07B39', high: '#F59E0B', urgent: '#EF4444',
}
const LIKELIHOOD_TONE: Record<string, string> = {
  low: '#22C55E', medium: '#F59E0B', high: '#EF4444',
}
function tone(map: Record<string, string>, key?: string) {
  return (key && map[key]) || '#8B5CF6'
}
function healthTone(score: number) {
  if (score >= 75) return '#22C55E'
  if (score >= 50) return '#E07B39'
  if (score >= 30) return '#F59E0B'
  return '#EF4444'
}

// ─── reusable panel ──────────────────────────────────────────────────────────
function Panel({ title, icon, children, className = '', accent }: {
  title: string; icon?: React.ReactNode; children: React.ReactNode; className?: string; accent?: string
}) {
  return (
    <div className={`rounded-[16px] p-5 ${className}`} style={{ background: 'var(--card-bg)', border: '1px solid var(--border-primary)' }}>
      <div className="flex items-center gap-2 mb-4">
        {icon && <span style={{ color: accent ?? 'var(--accent)' }}>{icon}</span>}
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">{title}</p>
      </div>
      {children}
    </div>
  )
}

function Pill({ text, color }: { text: string; color: string }) {
  return (
    <span className="text-[10px] font-bold uppercase tracking-[0.08em] px-2 py-0.5 rounded-full"
      style={{ color, background: `${color}1A`, border: `1px solid ${color}33` }}>
      {text}
    </span>
  )
}

// ─── deterministic forecast (linear regression on daily volume) ────────────────
function forecastVolume(trend: { date: string; count: number }[], horizon = 7) {
  const n = trend.length
  if (n < 4) return [] as { date: string; forecast: number }[]
  const xs = trend.map((_, i) => i)
  const ys = trend.map((t) => t.count)
  const meanX = xs.reduce((a, b) => a + b, 0) / n
  const meanY = ys.reduce((a, b) => a + b, 0) / n
  let num = 0, den = 0
  for (let i = 0; i < n; i++) { num += (xs[i] - meanX) * (ys[i] - meanY); den += (xs[i] - meanX) ** 2 }
  const slope = den === 0 ? 0 : num / den
  const intercept = meanY - slope * meanX
  const out: { date: string; forecast: number }[] = []
  const last = new Date(trend[n - 1].date)
  for (let h = 1; h <= horizon; h++) {
    const d = new Date(last); d.setDate(d.getDate() + h)
    out.push({ date: d.toISOString().slice(0, 10), forecast: Math.max(0, Math.round((intercept + slope * (n - 1 + h)) * 10) / 10) })
  }
  return out
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border-primary)', borderRadius: 8, padding: '8px 12px', backdropFilter: 'blur(12px)' }}>
      {label && <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{label}</p>}
      {payload.map((p) => (
        <p key={p.name} style={{ fontSize: 12, fontWeight: 600, color: p.color }}>{p.name}: {p.value}</p>
      ))}
    </div>
  )
}

export default function IntelligencePage() {
  const [tickets, setTickets] = useState<AnalyticsTicket[]>([])
  const [loading, setLoading] = useState(true)
  const [snapshot, setSnapshot] = useState<AnalyticsSnapshot | null>(null)
  const [report, setReport] = useState<AiInsightReport | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      const PAGE = 1000
      let offset = 0
      const all: AnalyticsTicket[] = []
      while (true) {
        const { data } = await supabase
          .from('tickets')
          .select('id, category, severity, status, store_id, sla_deadline, resolved_at, closed_at, created_at, reopen_count, store:stores(store_name, store_code)')
          .range(offset, offset + PAGE - 1)
          .order('created_at', { ascending: false })
        if (!data || data.length === 0) break
        all.push(...(data as unknown as AnalyticsTicket[]))
        if (data.length < PAGE) break
        offset += PAGE
      }
      setTickets(all)
      setSnapshot(buildAnalyticsSnapshot(all))
      setLoading(false)
    }
    load()
  }, [])

  const runAnalysis = async () => {
    if (!snapshot) return
    setAiLoading(true)
    setAiError(null)
    try {
      const result = await requestAiInsights(snapshot)
      setReport(result)
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Failed to generate AI analysis')
    } finally {
      setAiLoading(false)
    }
  }

  // Auto-run once the snapshot is ready and there is data.
  useEffect(() => {
    if (snapshot && snapshot.totals.total > 0 && !report && !aiLoading && !aiError) {
      runAnalysis()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot])

  const trendData = useMemo(() => {
    if (!snapshot) return []
    const hist = snapshot.volumeTrend.map((d) => ({ date: d.date, actual: d.count, forecast: null as number | null }))
    const fc = forecastVolume(snapshot.volumeTrend)
    const bridge = hist.length ? [{ date: hist[hist.length - 1].date, actual: hist[hist.length - 1].actual, forecast: hist[hist.length - 1].actual }] : []
    const fcRows = fc.map((f) => ({ date: f.date, actual: null as number | null, forecast: f.forecast }))
    return [...hist, ...bridge.slice(0, 0), ...fcRows].map((r) => ({ ...r, label: format(new Date(r.date), 'MMM d') }))
  }, [snapshot])

  const axisStyle = { fontSize: 11, fill: 'var(--text-muted)' }
  const gridStyle = { stroke: 'var(--border-subtle)', strokeDasharray: '3 3' }

  if (loading) {
    return (
      <AppShell overline="Intelligence" title="AI Intelligence" subtitle="Loading operational data…">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {[160, 160, 160].map((h, i) => <div key={i} className="skeleton" style={{ height: h }} />)}
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell
      overline="Intelligence"
      title="AI Intelligence"
      subtitle={`Operational analysis across ${snapshot?.totals.total ?? 0} tickets`}
      actions={
        <button onClick={runAnalysis} disabled={aiLoading || !snapshot?.totals.total}
          className="inline-flex items-center gap-2 h-9 px-4 rounded-lg text-[13px] font-semibold transition-colors disabled:opacity-50"
          style={{ background: 'var(--accent)', color: '#1A0E05' }}>
          {aiLoading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCcw size={14} />}
          {report ? 'Re-analyse' : 'Generate analysis'}
        </button>
      }
    >
      {/* ── Hero: headline + health ─────────────────────────────────────────── */}
      <div className="rounded-[18px] p-6 mb-5 relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, rgba(224,123,57,0.10), rgba(139,92,246,0.08))', border: '1px solid var(--border-primary)' }}>
        <div className="absolute -right-10 -top-10 w-44 h-44 rounded-full blur-3xl" style={{ background: 'rgba(224,123,57,0.18)' }} />
        <div className="relative flex flex-col lg:flex-row lg:items-center gap-6 justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-3">
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg" style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>
                <Brain size={15} />
              </span>
              <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--accent)]">AI Operational Briefing</span>
              {report?.model && <span className="text-[10px] text-[var(--text-muted)]">· {report.model}</span>}
            </div>

            {aiLoading && !report ? (
              <div className="flex items-center gap-3 text-[var(--text-muted)]">
                <Loader2 size={18} className="animate-spin" />
                <span className="text-[14px]">Analysing {snapshot?.totals.total ?? 0} tickets…</span>
              </div>
            ) : aiError ? (
              <div className="max-w-xl">
                <p className="text-[15px] font-semibold text-[var(--color-danger)] mb-1">AI analysis unavailable</p>
                <p className="text-[12px] text-[var(--text-muted)] leading-relaxed">{aiError}</p>
                <p className="text-[11px] text-[var(--text-muted)] mt-2">
                  Ensure the <code>ai-insights</code> Edge Function is deployed and the <code>NVIDIA_API_KEY</code> secret is set.
                </p>
              </div>
            ) : report ? (
              <>
                <h2 className="text-[22px] lg:text-[26px] font-black leading-tight text-[var(--text-primary)] mb-2">{report.headline}</h2>
                <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed max-w-2xl">{report.summary}</p>
                <p className="text-[10px] text-[var(--text-muted)] mt-3">Generated {format(new Date(report.generatedAt), "MMM d, HH:mm")}</p>
              </>
            ) : (
              <p className="text-[14px] text-[var(--text-muted)]">No analysis yet — press “Generate analysis”.</p>
            )}
          </div>

          {report && (
            <div className="flex items-center gap-4 shrink-0">
              <div className="relative w-[120px] h-[120px] rounded-full grid place-items-center"
                style={{ background: `conic-gradient(${healthTone(report.healthScore)} ${report.healthScore * 3.6}deg, var(--border-subtle) 0deg)` }}>
                <div className="w-[96px] h-[96px] rounded-full grid place-items-center" style={{ background: 'var(--bg-primary)' }}>
                  <div className="text-center">
                    <div className="text-[30px] font-black leading-none" style={{ color: healthTone(report.healthScore) }}>{report.healthScore}</div>
                    <div className="text-[9px] uppercase tracking-wider text-[var(--text-muted)] mt-0.5">Health</div>
                  </div>
                </div>
              </div>
              <div className="hidden sm:block">
                <Pill text={report.healthLabel} color={healthTone(report.healthScore)} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── deterministic stat strip ────────────────────────────────────────── */}
      {snapshot && (
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3 mb-5">
          <Stat label="Active" value={snapshot.totals.active} icon={<Activity size={14} />} tone="#8B5CF6" />
          <Stat label="Critical open" value={snapshot.totals.criticalOpen} icon={<ShieldAlert size={14} />} tone="#EF4444" />
          <Stat label="SLA breached" value={snapshot.totals.breachedOpen} icon={<AlertTriangle size={14} />} tone="#F59E0B" />
          <Stat label="SLA compliance" value={snapshot.rates.slaCompliancePct != null ? `${snapshot.rates.slaCompliancePct}%` : '—'} icon={<Gauge size={14} />} tone="#22C55E" />
          <Stat label="Avg MTTR" value={snapshot.rates.mttrHours != null ? (snapshot.rates.mttrHours < 24 ? `${Math.round(snapshot.rates.mttrHours)}h` : `${(snapshot.rates.mttrHours / 24).toFixed(1)}d`) : '—'} icon={<RefreshCcw size={14} />} tone="#3B82F6" />
          <Stat
            label="7-day trend"
            value={snapshot.trend.changePct != null ? `${snapshot.trend.changePct > 0 ? '+' : ''}${snapshot.trend.changePct}%` : '—'}
            icon={snapshot.trend.changePct != null && snapshot.trend.changePct > 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
            tone={snapshot.trend.changePct != null && snapshot.trend.changePct > 0 ? '#EF4444' : '#22C55E'}
          />
        </div>
      )}

      {/* ── forecast chart ──────────────────────────────────────────────────── */}
      <Panel title="Volume & 7-day forecast" icon={<TrendingUp size={14} />} className="mb-5">
        <ResponsiveContainer width="100%" height={230}>
          <ComposedChart data={trendData} margin={{ top: 6, right: 8, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="aiVol" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#E07B39" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#E07B39" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} {...gridStyle} />
            <XAxis dataKey="label" tick={axisStyle} tickLine={false} axisLine={false} interval={5} />
            <YAxis tick={axisStyle} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip content={<ChartTooltip />} />
            <Area type="monotone" dataKey="actual" name="Actual" stroke="#E07B39" strokeWidth={2} fill="url(#aiVol)" dot={false} connectNulls />
            <Line type="monotone" dataKey="forecast" name="Forecast" stroke="#8B5CF6" strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls />
            <ReferenceLine x={trendData.length ? trendData[snapshot ? snapshot.volumeTrend.length - 1 : 0]?.label : undefined} stroke="var(--border-subtle)" strokeDasharray="2 2" />
          </ComposedChart>
        </ResponsiveContainer>
        <p className="text-[11px] text-[var(--text-muted)] mt-2">Dashed line = linear projection of daily ticket volume for the next 7 days.</p>
      </Panel>

      {/* ── AI sections grid ────────────────────────────────────────────────── */}
      {report && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
            {/* Insights */}
            <Panel title="Key insights" icon={<Sparkles size={14} />} accent="#E07B39">
              <div className="flex flex-col gap-3">
                {report.insights.length === 0 && <Empty text="No insights surfaced." />}
                {report.insights.map((it, i) => {
                  const c = tone(SEVERITY_TONE, it.severity)
                  return (
                    <div key={i} className="rounded-[12px] p-3.5" style={{ background: 'var(--card-bg-hover)', border: '1px solid var(--border-subtle)' }}>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-[13px] font-bold text-[var(--text-primary)]">{it.title}</span>
                        {it.severity && <Pill text={it.severity} color={c} />}
                      </div>
                      <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed">{it.detail}</p>
                      {it.metric && <p className="text-[11px] font-semibold mt-1.5" style={{ color: c }}>{it.metric}</p>}
                    </div>
                  )
                })}
              </div>
            </Panel>

            {/* Predictions */}
            <Panel title="Predictions & forecasts" icon={<Target size={14} />} accent="#8B5CF6">
              <div className="flex flex-col gap-3">
                {report.predictions.length === 0 && <Empty text="No predictions available." />}
                {report.predictions.map((p, i) => {
                  const c = tone(LIKELIHOOD_TONE, p.likelihood)
                  return (
                    <div key={i} className="rounded-[12px] p-3.5" style={{ background: 'var(--card-bg-hover)', border: '1px solid var(--border-subtle)' }}>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-[13px] font-bold text-[var(--text-primary)]">{p.title}</span>
                        {p.likelihood && <Pill text={`${p.likelihood} likelihood`} color={c} />}
                      </div>
                      <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed">{p.detail}</p>
                      <div className="flex items-center gap-3 mt-2">
                        {p.timeframe && <span className="text-[11px] text-[var(--text-muted)]">⏱ {p.timeframe}</span>}
                        {typeof p.confidence === 'number' && (
                          <div className="flex items-center gap-1.5 flex-1 max-w-[140px]">
                            <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border-subtle)' }}>
                              <div className="h-full rounded-full" style={{ width: `${p.confidence}%`, background: '#8B5CF6' }} />
                            </div>
                            <span className="text-[10px] text-[var(--text-muted)]">{p.confidence}%</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </Panel>
          </div>

          {/* Recommendations */}
          <Panel title="Recommended actions" icon={<Lightbulb size={14} />} accent="#F59E0B" className="mb-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {report.recommendations.length === 0 && <Empty text="No recommendations." />}
              {report.recommendations.map((r, i) => {
                const c = tone(PRIORITY_TONE, r.priority)
                return (
                  <div key={i} className="rounded-[12px] p-4 flex gap-3" style={{ background: 'var(--card-bg-hover)', border: '1px solid var(--border-subtle)' }}>
                    <span className="mt-0.5 shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-lg" style={{ background: `${c}1A`, color: c }}>
                      <Zap size={14} />
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-[13px] font-bold text-[var(--text-primary)]">{r.title}</span>
                        {r.priority && <Pill text={r.priority} color={c} />}
                      </div>
                      <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed">{r.detail}</p>
                      {r.expectedImpact && <p className="text-[11px] mt-1.5 text-[var(--text-muted)]">Impact: <span className="text-[var(--text-secondary)]">{r.expectedImpact}</span></p>}
                    </div>
                  </div>
                )
              })}
            </div>
          </Panel>

          {/* Risks + Anomalies */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
            <Panel title="Risk radar" icon={<ShieldAlert size={14} />} accent="#EF4444">
              <div className="flex flex-col gap-2.5">
                {report.risks.length === 0 && <Empty text="No active risks flagged." />}
                {report.risks.map((r, i) => {
                  const c = tone(SEVERITY_TONE, r.severity)
                  return (
                    <div key={i} className="flex items-center gap-3 rounded-[10px] px-3 py-2.5" style={{ background: 'var(--card-bg-hover)', border: '1px solid var(--border-subtle)' }}>
                      <span className="w-1.5 h-9 rounded-full shrink-0" style={{ background: c }} />
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] font-bold text-[var(--text-primary)]">{r.area}</div>
                        <div className="text-[11px] text-[var(--text-secondary)]">{r.signal}</div>
                      </div>
                      {r.severity && <Pill text={r.severity} color={c} />}
                    </div>
                  )
                })}
              </div>
            </Panel>

            <Panel title="Anomalies" icon={<AlertTriangle size={14} />} accent="#06B6D4">
              <div className="flex flex-col gap-2.5">
                {report.anomalies.length === 0 ? (
                  <div className="text-center py-6">
                    <p className="text-[12px] text-[var(--text-muted)]">No statistical anomalies detected.</p>
                  </div>
                ) : report.anomalies.map((a, i) => (
                  <div key={i} className="rounded-[10px] px-3 py-2.5" style={{ background: 'var(--card-bg-hover)', border: '1px solid var(--border-subtle)' }}>
                    <div className="text-[12px] font-bold text-[var(--text-primary)] mb-0.5">{a.title}</div>
                    <div className="text-[11px] text-[var(--text-secondary)] leading-relaxed">{a.detail}</div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        </>
      )}

      <div className="flex items-center justify-center">
        <Link href="/analytics" className="inline-flex items-center gap-1.5 text-[12px] text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors">
          View full analytics charts <ArrowRight size={13} />
        </Link>
      </div>
    </AppShell>
  )
}

function Stat({ label, value, icon, tone }: { label: string; value: string | number; icon: React.ReactNode; tone: string }) {
  return (
    <div className="rounded-[12px] p-3.5" style={{ background: 'var(--card-bg)', border: '1px solid var(--border-primary)' }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--text-muted)]">{label}</span>
        <span className="w-6 h-6 rounded-md grid place-items-center" style={{ background: `${tone}18`, color: tone }}>{icon}</span>
      </div>
      <div className="text-[22px] font-black leading-none" style={{ color: tone }}>{value}</div>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="text-[12px] text-[var(--text-muted)] text-center py-4">{text}</p>
}
