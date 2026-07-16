'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AppShell } from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase/client'
import { coverageState, pmState, type CoverageState, type PmState } from '@/lib/asset-utils'
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { format, subDays, eachDayOfInterval, startOfDay } from 'date-fns'
import { ArrowLeft, Wrench, ShieldAlert, Clock, TrendingUp, RefreshCcw, AlertTriangle } from 'lucide-react'

// ─── palette (mirrors /analytics conventions) ────────────────────────────────
const COVERAGE_COLORS: Record<CoverageState, string> = {
  covered: '#22C55E', expiring: '#EAB308', expired: '#EF4444', none: '#6B7280',
}
const PM_COLORS: Record<PmState, string> = {
  overdue: '#EF4444', due_soon: '#EAB308', scheduled: '#22C55E', no_schedule: '#6B7280',
}
const SEV_COLORS: Record<string, string> = { P0: '#EF4444', P1: '#EAB308', P2: '#3B82F6', P3: '#7A7A88' }
const CAT_COLORS: Record<string, string> = {
  Operations: '#E07B39', Maintenance: '#6B7280', HR: '#8B5CF6', IT: '#3B82F6',
  SCM: '#10B981', QA: '#EF4444', Finance: '#F59E0B', 'L&D': '#EC4899',
}

// ─── shapes ───────────────────────────────────────────────────────────────────
interface AssetRow {
  id: string
  name: string
  asset_code: string
  status: string
  warranty_until: string | null
  amc_until: string | null
  created_at: string
  category: { name: string } | null
  store: { store_name: string; store_code: string } | null
}
interface AssetTicketRow {
  id: string
  asset_id: string
  severity: string
  status: string
  created_at: string
  resolved_at: string | null
  closed_at: string | null
}
interface PmTaskRow {
  id: string
  asset_id: string
  next_due_at: string | null
  is_active: boolean
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

function Panel({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-[14px] p-5 ${className}`} style={{ background: 'var(--card-bg)', border: '1px solid var(--border-primary)' }}>
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)] mb-4">{title}</p>
      {children}
    </div>
  )
}

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

export default function AssetAnalyticsPage() {
  const [assets, setAssets] = useState<AssetRow[]>([])
  const [tickets, setTickets] = useState<AssetTicketRow[]>([])
  const [pmTasks, setPmTasks] = useState<PmTaskRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const [{ data: a }, { data: t }, { data: p }] = await Promise.all([
        supabase.from('assets').select('id, name, asset_code, status, warranty_until, amc_until, created_at, category:asset_categories(name), store:stores(store_name, store_code)'),
        supabase.from('tickets').select('id, asset_id, severity, status, created_at, resolved_at, closed_at').not('asset_id', 'is', null),
        supabase.from('asset_pm_tasks').select('id, asset_id, next_due_at, is_active').eq('is_active', true),
      ])
      setAssets((a as unknown as AssetRow[]) || [])
      setTickets((t as unknown as AssetTicketRow[]) || [])
      setPmTasks((p as unknown as PmTaskRow[]) || [])
      setLoading(false)
    }
    load()
  }, [])

  // ── ticket lookup per asset ────────────────────────────────────────────────
  const ticketsByAsset = useMemo(() => {
    const m = new Map<string, AssetTicketRow[]>()
    tickets.forEach((t) => {
      const list = m.get(t.asset_id) ?? []
      list.push(t)
      m.set(t.asset_id, list)
    })
    return m
  }, [tickets])

  // ── fleet health KPIs ───────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const total = assets.length
    const active = assets.filter((a) => a.status === 'active').length
    const inRepair = assets.filter((a) => a.status === 'in_repair').length
    const retired = assets.filter((a) => a.status === 'retired').length

    const resolved = tickets.filter((t) => t.resolved_at)
    const mttrHours = resolved.length
      ? resolved.reduce((acc, t) => acc + (new Date(t.resolved_at!).getTime() - new Date(t.created_at).getTime()) / 3_600_000, 0) / resolved.length
      : 0
    const mttrDisplay = resolved.length === 0 ? '—' : mttrHours < 24 ? `${Math.round(mttrHours)}h` : `${(mttrHours / 24).toFixed(1)}d`

    // MTBF proxy: for assets with 2+ tickets, average gap (days) between consecutive tickets
    const gaps: number[] = []
    ticketsByAsset.forEach((list) => {
      if (list.length < 2) return
      const sorted = [...list].sort((x, y) => new Date(x.created_at).getTime() - new Date(y.created_at).getTime())
      for (let i = 1; i < sorted.length; i++) {
        gaps.push((new Date(sorted[i].created_at).getTime() - new Date(sorted[i - 1].created_at).getTime()) / 86_400_000)
      }
    })
    const mtbfDays = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null
    const mtbfDisplay = mtbfDays == null ? 'Not enough data' : `${Math.round(mtbfDays)}d`

    const openNow = tickets.filter((t) => !['closed', 'rejected'].includes(t.status)).length

    const pmOverdue = pmTasks.filter((t) => pmState(t) === 'overdue').length

    return { total, active, inRepair, retired, mttrDisplay, mtbfDisplay, openNow, pmOverdue, ticketedAssets: ticketsByAsset.size }
  }, [assets, tickets, pmTasks, ticketsByAsset])

  // ── ticket volume, last 30 days (asset-linked tickets only) ─────────────────
  const volumeData = useMemo(() => {
    const days = eachDayOfInterval({ start: subDays(new Date(), 29), end: new Date() })
    const map: Record<string, number> = {}
    days.forEach((d) => { map[format(d, 'yyyy-MM-dd')] = 0 })
    tickets.forEach((t) => {
      const key = format(startOfDay(new Date(t.created_at)), 'yyyy-MM-dd')
      if (key in map) map[key] += 1
    })
    return days.map((d) => ({ date: format(d, 'MMM d'), count: map[format(d, 'yyyy-MM-dd')] }))
  }, [tickets])

  // ── repeat offenders ─────────────────────────────────────────────────────────
  const repeatOffenders = useMemo(() => {
    return assets
      .map((a) => {
        const list = ticketsByAsset.get(a.id) ?? []
        const last = list.reduce<string | null>((max, t) => (!max || t.created_at > max ? t.created_at : max), null)
        return { asset: a, count: list.length, last }
      })
      .filter((r) => r.count > 0)
      .sort((x, y) => y.count - x.count)
      .slice(0, 10)
  }, [assets, ticketsByAsset])

  // ── by category / by store (asset-linked tickets) ────────────────────────────
  const categoryData = useMemo(() => {
    const assetCategory = new Map(assets.map((a) => [a.id, a.category?.name ?? 'Unknown']))
    const map: Record<string, number> = {}
    tickets.forEach((t) => {
      const cat = assetCategory.get(t.asset_id) ?? 'Unknown'
      map[cat] = (map[cat] ?? 0) + 1
    })
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  }, [assets, tickets])

  const storeData = useMemo(() => {
    const assetStore = new Map(assets.map((a) => [a.id, a.store?.store_name ?? 'Unknown']))
    const map: Record<string, number> = {}
    tickets.forEach((t) => {
      const s = assetStore.get(t.asset_id) ?? 'Unknown'
      map[s] = (map[s] ?? 0) + 1
    })
    return Object.entries(map).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 10)
  }, [assets, tickets])

  // ── severity split of asset tickets ──────────────────────────────────────────
  const severityData = useMemo(() => {
    const map: Record<string, number> = { P0: 0, P1: 0, P2: 0, P3: 0 }
    tickets.forEach((t) => { if (t.severity in map) map[t.severity]++ })
    return Object.entries(map).map(([name, value]) => ({ name, value, key: name }))
  }, [tickets])

  // ── coverage snapshot ─────────────────────────────────────────────────────────
  const coverageData = useMemo(() => {
    const map: Record<CoverageState, number> = { covered: 0, expiring: 0, expired: 0, none: 0 }
    assets.filter((a) => a.status !== 'retired').forEach((a) => {
      const { state } = coverageState(a)
      map[state]++
    })
    const labels: Record<CoverageState, string> = { covered: 'Covered', expiring: 'Expiring soon', expired: 'Expired', none: 'No coverage' }
    return (Object.keys(map) as CoverageState[]).map((k) => ({ key: k, name: labels[k], value: map[k] }))
  }, [assets])

  // ── PM compliance ─────────────────────────────────────────────────────────────
  const pmData = useMemo(() => {
    const map: Record<PmState, number> = { overdue: 0, due_soon: 0, scheduled: 0, no_schedule: 0 }
    pmTasks.forEach((t) => { map[pmState(t)]++ })
    const labels: Record<PmState, string> = { overdue: 'Overdue', due_soon: 'Due soon', scheduled: 'Scheduled', no_schedule: 'One-off' }
    return (Object.keys(map) as PmState[]).map((k) => ({ key: k, name: labels[k], value: map[k] }))
  }, [pmTasks])

  const axisStyle = { fontSize: 11, fill: 'var(--text-muted)' }
  const gridStyle = { stroke: 'var(--border-subtle)', strokeDasharray: '3 3' }

  if (loading) {
    return (
      <AppShell overline="Fleet Insights" title="Asset Analytics" subtitle="Loading data...">
        <div className="grid grid-cols-2 gap-4 mb-6 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 100 }} />)}
        </div>
        {[220, 180, 180].map((h, i) => <div key={i} className="skeleton mb-4" style={{ height: h }} />)}
      </AppShell>
    )
  }

  return (
    <AppShell
      overline="Fleet Insights"
      title="Asset Analytics"
      subtitle={`Computed from ${stats.total} assets · ${tickets.length} linked tickets`}
      actions={
        <Link href="/assets" className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
          <ArrowLeft size={12} /> All assets
        </Link>
      }
    >
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-4 mb-6 sm:grid-cols-4">
        <KPI label="Fleet" value={stats.total} sub={`${stats.active} active · ${stats.inRepair} in repair · ${stats.retired} retired`} icon={<TrendingUp size={15} />} />
        <KPI label="Avg MTTR" value={stats.mttrDisplay} sub="Reported → fixed" icon={<Clock size={15} />} tone="#8B5CF6" />
        <KPI label="Avg MTBF" value={stats.mtbfDisplay} sub="Between repeat failures" icon={<RefreshCcw size={15} />} tone="#3B82F6" />
        <KPI
          label="PM overdue"
          value={stats.pmOverdue}
          sub={`${pmTasks.length} scheduled tasks`}
          icon={<Wrench size={15} />}
          tone={stats.pmOverdue === 0 ? '#22C55E' : '#EF4444'}
        />
      </div>

      {/* Volume */}
      <Panel title="Asset-linked ticket volume — last 30 days" className="mb-4">
        {tickets.length === 0 ? (
          <p className="text-[12px] text-[var(--text-muted)] text-center py-8">No asset tickets yet — this fills in once staff start reporting problems via QR scans.</p>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={volumeData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="assetVolGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#E07B39" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#E07B39" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} {...gridStyle} />
              <XAxis dataKey="date" tick={axisStyle} tickLine={false} axisLine={false} interval={4} />
              <YAxis tick={axisStyle} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="count" name="Tickets" stroke="#E07B39" strokeWidth={2} fill="url(#assetVolGrad)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </Panel>

      {/* Category + Severity */}
      <div className="grid grid-cols-1 gap-4 mb-4 sm:grid-cols-2">
        <Panel title="Failures by category">
          {categoryData.length === 0 ? (
            <p className="text-[12px] text-[var(--text-muted)] text-center py-8">No data yet</p>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={categoryData} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid horizontal={false} {...gridStyle} />
                <XAxis type="number" tick={axisStyle} tickLine={false} axisLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={axisStyle} tickLine={false} axisLine={false} width={84} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--accent-dim)' }} />
                <Bar dataKey="value" name="Tickets" radius={[0, 4, 4, 0]}>
                  {categoryData.map((entry) => <Cell key={entry.name} fill={CAT_COLORS[entry.name] ?? '#8B5CF6'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Panel>

        <Panel title="Failures by severity">
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={severityData} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid horizontal={false} {...gridStyle} />
              <XAxis type="number" tick={axisStyle} tickLine={false} axisLine={false} allowDecimals={false} />
              <YAxis type="category" dataKey="name" tick={axisStyle} tickLine={false} axisLine={false} width={40} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--accent-dim)' }} />
              <Bar dataKey="value" name="Tickets" radius={[0, 4, 4, 0]}>
                {severityData.map((entry) => <Cell key={entry.key} fill={SEV_COLORS[entry.key] ?? '#8B5CF6'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      {/* Coverage + PM compliance */}
      <div className="grid grid-cols-1 gap-4 mb-4 sm:grid-cols-2">
        <Panel title="Coverage snapshot">
          <div className="flex items-center gap-8 justify-center flex-wrap">
            <ResponsiveContainer width={150} height={150}>
              <PieChart>
                <Pie data={coverageData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={44} outerRadius={70} strokeWidth={0}>
                  {coverageData.map((entry) => <Cell key={entry.key} fill={COVERAGE_COLORS[entry.key]} />)}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-col gap-2">
              {coverageData.map((entry) => (
                <div key={entry.key} className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: COVERAGE_COLORS[entry.key] }} />
                  <span className="text-[12px] text-[var(--text-secondary)]">{entry.name}</span>
                  <span className="text-[12px] font-bold text-[var(--text-primary)] ml-auto pl-6">{entry.value}</span>
                </div>
              ))}
            </div>
          </div>
        </Panel>

        <Panel title="PM compliance">
          <div className="flex items-center gap-8 justify-center flex-wrap">
            <ResponsiveContainer width={150} height={150}>
              <PieChart>
                <Pie data={pmData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={44} outerRadius={70} strokeWidth={0}>
                  {pmData.map((entry) => <Cell key={entry.key} fill={PM_COLORS[entry.key]} />)}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-col gap-2">
              {pmData.map((entry) => (
                <div key={entry.key} className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: PM_COLORS[entry.key] }} />
                  <span className="text-[12px] text-[var(--text-secondary)]">{entry.name}</span>
                  <span className="text-[12px] font-bold text-[var(--text-primary)] ml-auto pl-6">{entry.value}</span>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      </div>

      {/* Top stores */}
      <Panel title="Top 10 stores by asset-ticket volume" className="mb-4">
        {storeData.length === 0 ? (
          <p className="text-[12px] text-[var(--text-muted)] text-center py-8">No store data available</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={storeData} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid horizontal={false} {...gridStyle} />
              <XAxis type="number" tick={axisStyle} tickLine={false} axisLine={false} allowDecimals={false} />
              <YAxis type="category" dataKey="name" tick={{ ...axisStyle, fontSize: 10 }} tickLine={false} axisLine={false} width={100}
                tickFormatter={(v: string) => v.length > 16 ? v.slice(0, 15) + '…' : v}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--accent-dim)' }} />
              <Bar dataKey="count" name="Tickets" fill="#E07B39" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Panel>

      {/* Repeat offenders */}
      <Panel title="Repeat offenders — most-ticketed assets">
        {repeatOffenders.length === 0 ? (
          <p className="text-[12px] text-[var(--text-muted)] text-center py-8">No repeat issues yet — good sign.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {repeatOffenders.map((r, i) => (
              <Link
                key={r.asset.id}
                href={`/assets/view?id=${r.asset.id}`}
                className="flex items-center gap-3 px-3.5 py-2.5 rounded-[10px] transition-colors"
                style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)', textDecoration: 'none' }}
              >
                <span className="text-[11px] font-mono-value font-bold text-[var(--text-muted)] w-5 shrink-0">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-[var(--text-primary)] truncate">{r.asset.name}</p>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    {r.asset.asset_code}{r.asset.category ? ` · ${r.asset.category.name}` : ''}{r.asset.store ? ` · ${r.asset.store.store_name}` : ''}
                  </p>
                </div>
                {r.count >= 3 && <AlertTriangle size={13} style={{ color: 'var(--color-warning)' }} className="shrink-0" />}
                <span
                  className="shrink-0 text-[13px] font-black px-2.5 py-1 rounded-full"
                  style={{ color: r.count >= 3 ? 'var(--color-danger)' : 'var(--text-secondary)', background: r.count >= 3 ? 'rgba(239,68,68,0.10)' : 'var(--card-bg)' }}
                >
                  {r.count}
                </span>
              </Link>
            ))}
          </div>
        )}
      </Panel>

      {stats.openNow > 0 && (
        <div className="flex items-center gap-2 mt-4 px-4 py-3 rounded-[12px]" style={{ background: 'rgba(234,179,8,0.07)', border: '1px solid rgba(234,179,8,0.22)' }}>
          <ShieldAlert size={14} style={{ color: 'var(--color-warning)' }} className="shrink-0" />
          <p className="text-[12px] text-[var(--text-secondary)]">{stats.openNow} asset ticket{stats.openNow === 1 ? '' : 's'} currently open across the fleet.</p>
        </div>
      )}
    </AppShell>
  )
}
