'use client'

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import Link from 'next/link'
import { AppShell } from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase/client'
import type { TicketWithRelations } from '@/lib/supabase/database.types'
import {
  ArrowRight,
  CheckCircle,
  Clock,
  Flame,
  Gauge,
  ListChecks,
  MapPin,
  RadioTower,
  ShieldAlert,
  Sparkles,
  Ticket,
} from 'lucide-react'

const SEVERITIES = [
  { key: 'critical', label: 'Critical', color: '#EF4444' },
  { key: 'high', label: 'High', color: '#F59E0B' },
  { key: 'medium', label: 'Medium', color: '#E07B39' },
  { key: 'low', label: 'Low', color: '#22C55E' },
] as const

const CATEGORIES = [
  { key: 'Operations', color: '#E07B39' },
  { key: 'HR', color: '#8B5CF6' },
  { key: 'IT', color: '#3B82F6' },
  { key: 'SCM', color: '#10B981' },
  { key: 'QA', color: '#EF4444' },
] as const

function pct(value: number, total: number) {
  if (total <= 0) return 0
  return Math.round((value / total) * 100)
}

function formatPercent(value: number) {
  return `${Math.max(0, Math.min(100, value)).toFixed(1)}%`
}

function statusTone(status: TicketWithRelations['status']) {
  if (status === 'closed' || status === 'resolved') return '#22C55E'
  if (status === 'in_progress') return '#E07B39'
  if (status === 'escalated') return '#EF4444'
  return '#8B5CF6'
}

function severityTone(severity: TicketWithRelations['severity']) {
  return SEVERITIES.find((item) => item.key === severity)?.color ?? '#71717A'
}

function PremiumMetric({
  label,
  value,
  caption,
  icon,
  tone = '#E07B39',
  delta,
}: {
  label: string
  value: string | number
  caption: string
  icon: ReactNode
  tone?: string
  delta?: string
}) {
  return (
    <div className="prism-premium-metric">
      <div className="flex items-start justify-between gap-3">
        <div className="premium-kicker">{label}</div>
        <div className="premium-icon" style={{ '--tone': tone } as CSSProperties}>{icon}</div>
      </div>
      <div className="mt-6 flex items-end justify-between gap-3">
        <div>
          <div className="premium-number">{value}</div>
          <div className="premium-caption mt-1">{caption}</div>
        </div>
        {delta && (
          <div className="premium-delta" style={{ color: tone, borderColor: `${tone}33`, background: `${tone}12` }}>
            {delta}
          </div>
        )}
      </div>
    </div>
  )
}

function MiniBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const width = Math.max(4, pct(value, total))
  return (
    <div className="premium-bar-row">
      <div className="flex items-center justify-between gap-3">
        <span>{label}</span>
        <strong style={{ color }}>{value}</strong>
      </div>
      <div className="premium-track">
        <div className="premium-track-fill" style={{ width: `${width}%`, background: color }} />
      </div>
    </div>
  )
}

function InsightCard({ tone, title, detail, value }: { tone: string; title: string; detail: string; value: string }) {
  return (
    <div className="premium-insight">
      <div className="premium-insight-mark" style={{ background: tone }} />
      <div className="min-w-0">
        <div className="premium-insight-title">{title}</div>
        <div className="premium-insight-detail">{detail}</div>
      </div>
      <div className="premium-insight-value" style={{ color: tone }}>{value}</div>
    </div>
  )
}

export default function DashboardPage() {
  const [tickets, setTickets] = useState<TicketWithRelations[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchTickets = async () => {
      const { data } = await supabase
        .from('tickets')
        .select('*, store:stores(*), raised_by_profile:profiles!tickets_raised_by_fkey(*), assigned_to_profile:profiles!tickets_assigned_to_fkey(*), escalations(*)')
        .order('created_at', { ascending: false })
        .limit(30)

      setTickets((data as unknown as TicketWithRelations[]) || [])
      setLoading(false)
    }

    fetchTickets()
    const channel = supabase
      .channel('dashboard-tickets')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, fetchTickets)
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  const metrics = useMemo(() => {
    const active = tickets.filter((ticket) => ticket.status !== 'closed' && ticket.status !== 'resolved')
    const critical = active.filter((ticket) => ticket.severity === 'critical')
    const breached = active.filter((ticket) => ticket.sla_deadline && new Date(ticket.sla_deadline) < new Date())
    const resolvedToday = tickets.filter((ticket) => {
      if (!ticket.resolved_at) return false
      return new Date(ticket.resolved_at).toDateString() === new Date().toDateString()
    })
    const escalated = active.filter((ticket) => ticket.status === 'escalated')

    return {
      total: tickets.length,
      active,
      activeCount: active.length,
      criticalCount: critical.length,
      breachedCount: breached.length,
      resolvedToday: resolvedToday.length,
      escalatedCount: escalated.length,
      controlScore: Math.max(0, 100 - (critical.length * 12) - (breached.length * 10) - (escalated.length * 6)),
      slaHealth: Math.max(0, 100 - pct(breached.length, Math.max(active.length, 1))),
    }
  }, [tickets])

  const severityCounts = SEVERITIES.map((severity) => ({
    ...severity,
    count: metrics.active.filter((ticket) => ticket.severity === severity.key).length,
  }))
  const categoryCounts = CATEGORIES.map((category) => ({
    ...category,
    count: metrics.active.filter((ticket) => ticket.category === category.key).length,
  }))
  const maxCategory = Math.max(...categoryCounts.map((category) => category.count), 1)
  const recentOpen = metrics.active.slice(0, 8)
  const coverage = pct(metrics.total - metrics.activeCount, Math.max(metrics.total, 1))
  const radiusStyle = {
    '--score': `${metrics.controlScore * 3.6}deg`,
  } as CSSProperties

  return (
    <AppShell title="Mission Control" bare>
      <div className="prism-premium-dashboard">
        <header className="premium-dashboard-header">
          <div>
            <div className="premium-eyebrow">Prism Escalations</div>
            <h1>Mission Control</h1>
            <p>Multi-store escalation health, SLA exposure and operational action flow.</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="premium-live-chip">
              <span /> Live sync
            </div>
            <Link href="/tickets/new" className="premium-action-button">
              New ticket <ArrowRight size={13} />
            </Link>
          </div>
        </header>

        <section className="premium-metric-grid">
          <PremiumMetric
            label="Total tickets"
            value={loading ? '-' : metrics.total}
            caption="Current analysis window"
            icon={<Ticket size={15} />}
          />
          <PremiumMetric
            label="Active workload"
            value={loading ? '-' : metrics.activeCount}
            caption="Open + in-progress"
            icon={<RadioTower size={15} />}
            tone="#8B5CF6"
            delta={`${coverage}% closed`}
          />
          <PremiumMetric
            label="Critical pressure"
            value={loading ? '-' : metrics.criticalCount}
            caption="Immediate review required"
            icon={<ShieldAlert size={15} />}
            tone="#EF4444"
            delta={metrics.criticalCount > 0 ? 'Act now' : 'Clear'}
          />
          <PremiumMetric
            label="SLA health"
            value={loading ? '-' : formatPercent(metrics.slaHealth)}
            caption={`${metrics.breachedCount} breached deadlines`}
            icon={<Clock size={15} />}
            tone="#22C55E"
          />
          <PremiumMetric
            label="Resolved today"
            value={loading ? '-' : metrics.resolvedToday}
            caption="Closed this shift"
            icon={<CheckCircle size={15} />}
            tone="#10B981"
          />
        </section>

        <section className="premium-main-grid">
          <div className="premium-panel premium-panel-tall">
            <div className="premium-panel-header">
              <div>
                <div className="premium-kicker">Zero-tolerance watchlist</div>
                <h2>Tickets needing executive attention</h2>
              </div>
              <div className="premium-panel-stat" style={{ color: metrics.criticalCount > 0 ? '#EF4444' : '#22C55E' }}>
                {metrics.criticalCount + metrics.breachedCount}
              </div>
            </div>

            <div className="premium-watchlist">
              {(recentOpen.length > 0 ? recentOpen : []).slice(0, 5).map((ticket) => {
                const tone = severityTone(ticket.severity)
                const isBreached = ticket.sla_deadline && new Date(ticket.sla_deadline) < new Date()
                return (
                  <Link key={ticket.id} href={`/tickets/${ticket.id}`} className="premium-watch-row">
                    <span className="premium-score-bar" style={{ background: isBreached ? '#EF4444' : tone }} />
                    <div className="min-w-0">
                      <div className="premium-watch-title">{ticket.title}</div>
                      <div className="premium-watch-meta">
                        #{ticket.ticket_code} / {ticket.category} / {ticket.store?.store_name ?? 'Unassigned store'}
                      </div>
                    </div>
                    <div className="premium-watch-badge" style={{ color: tone, background: `${tone}12`, borderColor: `${tone}33` }}>
                      {isBreached ? 'Breach' : ticket.severity}
                    </div>
                  </Link>
                )
              })}

              {!loading && recentOpen.length === 0 && (
                <div className="premium-empty-state">
                  <Sparkles size={24} />
                  <strong>No open follow-ups.</strong>
                  <span>All active escalations are cleared for this window.</span>
                </div>
              )}
            </div>
          </div>

          <div className="premium-panel">
            <div className="premium-panel-header">
              <div>
                <div className="premium-kicker">Operational control</div>
                <h2>Control score</h2>
              </div>
              <Gauge size={17} />
            </div>
            <div className="premium-score-layout">
              <div className="premium-ring" style={radiusStyle}>
                <div>
                  <strong>{metrics.controlScore}</strong>
                  <span>score</span>
                </div>
              </div>
              <div className="premium-ring-legend">
                {severityCounts.map((severity) => (
                  <div key={severity.key}>
                    <span style={{ background: severity.color }} />
                    <p>{severity.label}</p>
                    <strong>{severity.count}</strong>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="premium-panel">
            <div className="premium-panel-header">
              <div>
                <div className="premium-kicker">By domain</div>
                <h2>Issue concentration</h2>
              </div>
              <ListChecks size={17} />
            </div>
            <div className="flex flex-col gap-3">
              {categoryCounts.map((category) => (
                <MiniBar
                  key={category.key}
                  label={category.key}
                  value={category.count}
                  total={maxCategory}
                  color={category.color}
                />
              ))}
            </div>
          </div>
        </section>

        <section className="premium-secondary-grid">
          <div className="premium-panel">
            <div className="premium-panel-header">
              <div>
                <div className="premium-kicker">Training insights</div>
                <h2>Signals to act on</h2>
              </div>
              <Flame size={17} />
            </div>
            <div className="flex flex-col gap-3">
              <InsightCard
                tone="#F59E0B"
                title="SLA exposure"
                detail="Breached tickets need immediate owner review."
                value={`${metrics.breachedCount}`}
              />
              <InsightCard
                tone="#EF4444"
                title="Critical pressure"
                detail="Critical issues open across the network."
                value={`${metrics.criticalCount}`}
              />
              <InsightCard
                tone="#8B5CF6"
                title="Escalation load"
                detail="Tickets currently in escalated state."
                value={`${metrics.escalatedCount}`}
              />
            </div>
          </div>

          <div className="premium-panel premium-table-panel">
            <div className="premium-panel-header">
              <div>
                <div className="premium-kicker">Open actions</div>
                <h2>Current ticket queue</h2>
              </div>
              <Link href="/tickets" className="premium-text-link">View all <ArrowRight size={12} /></Link>
            </div>

            <div className="premium-table">
              <div className="premium-table-head">
                <span>Ticket</span>
                <span>Store</span>
                <span>Severity</span>
                <span>Status</span>
              </div>
              {recentOpen.map((ticket) => {
                const tone = severityTone(ticket.severity)
                const stateTone = statusTone(ticket.status)
                return (
                  <Link key={ticket.id} href={`/tickets/${ticket.id}`} className="premium-table-row">
                    <span className="min-w-0">
                      <strong>{ticket.title}</strong>
                      <small>#{ticket.ticket_code} / {ticket.category}</small>
                    </span>
                    <span className="premium-store-cell">
                      <MapPin size={11} /> {ticket.store?.store_name ?? 'Unassigned'}
                    </span>
                    <span className="premium-token" style={{ color: tone, borderColor: `${tone}33`, background: `${tone}10` }}>
                      {ticket.severity}
                    </span>
                    <span className="premium-token" style={{ color: stateTone, borderColor: `${stateTone}33`, background: `${stateTone}10` }}>
                      {ticket.status.replace(/_/g, ' ')}
                    </span>
                  </Link>
                )
              })}
              {!loading && recentOpen.length === 0 && (
                <div className="premium-table-empty">No open actions in the current queue.</div>
              )}
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  )
}
