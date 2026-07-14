'use client'

import { useEffect, useMemo, useState } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase/client'
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { format, subDays, eachDayOfInterval, startOfDay } from 'date-fns'
import { Clock, ShieldAlert, RefreshCcw, TrendingUp, Brain, ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { normalizeSeverity } from '@/lib/ticket-utils'

// ─── colour palette ──────────────────────────────────────────────────────────
const CAT_COLORS: Record<string, string> = {
  Operations:  '#E07B39',
  Maintenance: '#6B7280',
  HR:          '#8B5CF6',
  IT:          '#3B82F6',
  SCM:         '#10B981',
  QA:          '#EF4444',
  Finance:     '#F59E0B',
  'L&D':       '#EC4899',
}
const SEV_COLORS: Record<string, string> = {
  P0: '#EF4444',
  P1: '#F59E0B',
  P2: '#E07B39',
  P3: '#22C55E',
}
const STATUS_COLORS: Record<string, string> = {
  open:        '#8B5CF6',
  in_progress: '#E07B39',
  resolved:    '#22C55E',
  closed:      '#6B7280',
  rejected:    '#EF4444',
}

// ─── types ───────────────────────────────────────────────────────────────────
interface TicketRow {
  id: string
  category: string
  severity: string
  status: string
  blocked: boolean | null
  store_id: string | null
  sla_deadline: string | null
  resolved_at: string | null
  closed_at: string | null
  created_at: string
  reopen_count: number
  store?: { store_name: string; store_code: string } | null
}

// ─── custom tooltip ───────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border-primary)', borderRadius: 8, padding: '8px 12px', backdropFilter: 'blur(12px)' }}>
      {label && <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{label}</p>}
      {payload.map((p) => (
        <p key={p.name} style={{ fontSize: 12, fontWeight: 600, color: p.color }}>
          {p.name}: {p.value}
        </p>
      ))}
    </div>
  )
}

// ─── panel wrapper ────────────────────────────────────────────────────────────
function Panel({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-[14px] p-5 ${className}`} style={{ background: 'var(--card-bg)', border: '1px solid var(--border-primary)' }}>
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)] mb-4">{title}</p>
      {children}
    </div>
  )
}

// ─── KPI card ─────────────────────────────────────────────────────────────────
function KPI({ label, value, sub, icon, tone = 'var(--accent)' }: { label: string; value: string | number; sub: string; icon: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-[14px] p-5 flex flex-col gap-3" style={{ background: 'var(--card-bg)', border: '1px solid var(--border-primary)' }}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">{label}</span>
        <div className="w-8 h-8 rounded-[8px] flex items-center justify-center" style={{ background: `${tone}18`, color: tone }}>{icon}</div>
      </div>
      <div>
        <div className="text-[28px] font-black leading-none" style={{ color: tone }}>{value}</div>
        <div className="text-[11px] text-[var(--text-muted)] mt-1">{sub}</div>
      </div>
    </div>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────
export default function AnalyticsPage() {
  const [tickets, setTickets] = useState<TicketRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const PAGE = 1000
      let offset = 0
      const all: TicketRow[] = []
      while (true) {
        const { data } = await supabase
          .from('tickets')
          .select('id, category, severity, status, blocked, store_id, sla_deadline, resolved_at, closed_at, created_at, reopen_count, store:stores(store_name, store_code)')
          .range(offset, offset + PAGE - 1)
          .order('created_at', { ascending: false })
        if (!data || data.length === 0) break
        all.push(...(data as unknown as TicketRow[]))
        if (data.length < PAGE) break
        offset += PAGE
      }
      setTickets(all)
      setLoading(false)
    }
    load()
  }, [])

  // ── derived metrics ──────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const total = tickets.length
    if (total === 0) return null

    // MTTR: average hours from created_at → resolved_at for resolved/closed tickets
    const resolved = tickets.filter((t) => t.resolved_at)
    const mttrHours = resolved.length
      ? resolved.reduce((acc, t) => {
          const diff = (new Date(t.resolved_at!).getTime() - new Date(t.created_at).getTime()) / 3_600_000
          return acc + diff
        }, 0) / resolved.length
      : 0
    const mttrDisplay = mttrHours < 24
      ? `${Math.round(mttrHours)}h`
      : `${(mttrHours / 24).toFixed(1)}d`

    // SLA compliance: of tickets that have a deadline AND are closed/resolved
    const withSla = tickets.filter((t) => t.sla_deadline && (t.resolved_at || t.closed_at))
    const slaOk = withSla.filter((t) => {
      const finish = t.resolved_at || t.closed_at
      return finish && new Date(finish) <= new Date(t.sla_deadline!)
    })
    const slaPct = withSla.length ? Math.round((slaOk.length / withSla.length) * 100) : null

    // Reopen rate
    const reopened = tickets.filter((t) => t.reopen_count > 0)
    const reopenPct = Math.round((reopened.length / total) * 100)

    // Escalation proxy: tickets flagged as blocked (snag)
    const escalated = tickets.filter((t) => t.blocked)

    return { total, mttrDisplay, slaPct, reopenPct, escalatedCount: escalated.length }
  }, [tickets])

  // ── volume last 30 days ───────────────────────────────────────────────────
  const volumeData = useMemo(() => {
    const days = eachDayOfInterval({ start: subDays(new Date(), 29), end: new Date() })
    const map: Record<string, number> = {}
    days.forEach((d) => { map[format(d, 'yyyy-MM-dd')] = 0 })
    tickets.forEach((t) => {
      const key = format(startOfDay(new Date(t.created_at)), 'yyyy-MM-dd')
      if (key in map) map[key]++
    })
    return days.map((d) => ({ date: format(d, 'MMM d'), count: map[format(d, 'yyyy-MM-dd')] }))
  }, [tickets])

  // ── category counts ───────────────────────────────────────────────────────
  const categoryData = useMemo(() =>
    Object.entries(
      tickets.reduce((acc, t) => { acc[t.category] = (acc[t.category] || 0) + 1; return acc }, {} as Record<string, number>)
    )
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value),
    [tickets]
  )

  // ── severity counts ───────────────────────────────────────────────────────
  const severityData = useMemo(() =>
    (['P0', 'P1', 'P2', 'P3'] as const).map((s) => ({
      name: s,
      value: tickets.filter((t) => normalizeSeverity(t.severity) === s).length,
      key: s,
    })),
    [tickets]
  )

  // ── status counts ─────────────────────────────────────────────────────────
  const statusData = useMemo(() =>
    Object.entries(
      tickets.reduce((acc, t) => { acc[t.status] = (acc[t.status] || 0) + 1; return acc }, {} as Record<string, number>)
    )
      .map(([name, value]) => ({ name: name.replace('_', ' '), key: name, value }))
      .sort((a, b) => b.value - a.value),
    [tickets]
  )

  // ── top stores ────────────────────────────────────────────────────────────
  const topStores = useMemo(() => {
    const map: Record<string, { name: string; count: number }> = {}
    tickets.forEach((t) => {
      const code = (t.store as { store_code?: string } | null)?.store_code || t.store_id || 'Unknown'
      const name = (t.store as { store_name?: string } | null)?.store_name || code
      if (!map[code]) map[code] = { name, count: 0 }
      map[code].count++
    })
    return Object.values(map).sort((a, b) => b.count - a.count).slice(0, 10)
  }, [tickets])

  const axisStyle = { fontSize: 11, fill: 'var(--text-muted)' }
  const gridStyle = { stroke: 'var(--border-subtle)', strokeDasharray: '3 3' }

  if (loading) {
    return (
      <AppShell overline="Insights" title="Analytics" subtitle="Loading data...">
        <div className="grid grid-cols-4 gap-4 mb-6">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 100 }} />)}
        </div>
        {[220, 180, 180].map((h, i) => <div key={i} className="skeleton mb-4" style={{ height: h }} />)}
      </AppShell>
    )
  }

  return (
    <AppShell
      overline="Insights"
      title="Analytics"
      subtitle={`Computed from ${stats?.total ?? 0} tickets`}
      actions={
        <Link href="/intelligence"
          className="inline-flex items-center gap-2 h-9 px-4 rounded-lg text-[13px] font-semibold transition-colors"
          style={{ background: 'var(--accent)', color: '#1A0E05' }}>
          <Brain size={15} /> AI Intelligence <ArrowRight size={13} />
        </Link>
      }
    >
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-4 mb-6 sm:grid-cols-4">
        <KPI
          label="Total tickets"
          value={stats?.total ?? 0}
          sub="All time"
          icon={<TrendingUp size={15} />}
        />
        <KPI
          label="Avg MTTR"
          value={stats?.mttrDisplay ?? '—'}
          sub="Created → resolved"
          icon={<Clock size={15} />}
          tone="#8B5CF6"
        />
        <KPI
          label="SLA compliance"
          value={stats?.slaPct != null ? `${stats.slaPct}%` : '—'}
          sub="Closed within SLA"
          icon={<ShieldAlert size={15} />}
          tone={stats?.slaPct != null && stats.slaPct >= 80 ? '#22C55E' : '#EF4444'}
        />
        <KPI
          label="Reopen rate"
          value={`${stats?.reopenPct ?? 0}%`}
          sub="Tickets re-opened"
          icon={<RefreshCcw size={15} />}
          tone={stats?.reopenPct != null && stats.reopenPct <= 10 ? '#22C55E' : '#F59E0B'}
        />
      </div>

      {/* Volume over time */}
      <Panel title="Ticket volume — last 30 days" className="mb-4">
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={volumeData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="volGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#E07B39" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#E07B39" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} {...gridStyle} />
            <XAxis dataKey="date" tick={axisStyle} tickLine={false} axisLine={false} interval={4} />
            <YAxis tick={axisStyle} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip content={<ChartTooltip />} />
            <Area type="monotone" dataKey="count" name="Tickets" stroke="#E07B39" strokeWidth={2} fill="url(#volGrad)" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </Panel>

      {/* Category + Severity */}
      <div className="grid grid-cols-1 gap-4 mb-4 sm:grid-cols-2">
        <Panel title="By category">
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={categoryData} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid horizontal={false} {...gridStyle} />
              <XAxis type="number" tick={axisStyle} tickLine={false} axisLine={false} allowDecimals={false} />
              <YAxis type="category" dataKey="name" tick={axisStyle} tickLine={false} axisLine={false} width={72} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--accent-dim)' }} />
              <Bar dataKey="value" name="Tickets" radius={[0, 4, 4, 0]}>
                {categoryData.map((entry) => (
                  <Cell key={entry.name} fill={CAT_COLORS[entry.name] ?? '#8B5CF6'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="By severity">
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={severityData} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid horizontal={false} {...gridStyle} />
              <XAxis type="number" tick={axisStyle} tickLine={false} axisLine={false} allowDecimals={false} />
              <YAxis type="category" dataKey="name" tick={axisStyle} tickLine={false} axisLine={false} width={64} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--accent-dim)' }} />
              <Bar dataKey="value" name="Tickets" radius={[0, 4, 4, 0]}>
                {severityData.map((entry) => (
                  <Cell key={entry.key} fill={SEV_COLORS[entry.key] ?? '#8B5CF6'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      {/* Status distribution */}
      <div className="grid grid-cols-1 gap-4 mb-4 sm:grid-cols-2">
        <Panel title="By status">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={statusData} layout="vertical" margin={{ top: 0, right: 16, left: 16, bottom: 0 }}>
              <CartesianGrid horizontal={false} {...gridStyle} />
              <XAxis type="number" tick={axisStyle} tickLine={false} axisLine={false} allowDecimals={false} />
              <YAxis type="category" dataKey="name" tick={axisStyle} tickLine={false} axisLine={false} width={80} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--accent-dim)' }} />
              <Bar dataKey="value" name="Tickets" radius={[0, 4, 4, 0]}>
                {statusData.map((entry) => (
                  <Cell key={entry.key} fill={STATUS_COLORS[entry.key] ?? '#8B5CF6'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="Top 10 stores by volume">
          {topStores.length === 0 ? (
            <p className="text-[12px] text-[var(--text-muted)] text-center py-8">No store data available</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={topStores} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid horizontal={false} {...gridStyle} />
                <XAxis type="number" tick={axisStyle} tickLine={false} axisLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={{ ...axisStyle, fontSize: 10 }} tickLine={false} axisLine={false} width={88}
                  tickFormatter={(v: string) => v.length > 14 ? v.slice(0, 13) + '…' : v}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--accent-dim)' }} />
                <Bar dataKey="count" name="Tickets" fill="#E07B39" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Panel>
      </div>

      {/* Severity pie */}
      <Panel title="Severity distribution">
        <div className="flex items-center gap-8 justify-center flex-wrap">
          <ResponsiveContainer width={180} height={180}>
            <PieChart>
              <Pie data={severityData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={52} outerRadius={80} strokeWidth={0}>
                {severityData.map((entry) => (
                  <Cell key={entry.key} fill={SEV_COLORS[entry.key] ?? '#8B5CF6'} />
                ))}
              </Pie>
              <Tooltip content={<ChartTooltip />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex flex-col gap-2">
            {severityData.map((entry) => (
              <div key={entry.key} className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: SEV_COLORS[entry.key] }} />
                <span className="text-[12px] text-[var(--text-secondary)] capitalize">{entry.name}</span>
                <span className="text-[12px] font-bold text-[var(--text-primary)] ml-auto pl-6">{entry.value}</span>
              </div>
            ))}
          </div>
        </div>
      </Panel>
    </AppShell>
  )
}

