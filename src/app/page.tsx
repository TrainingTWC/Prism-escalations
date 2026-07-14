'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AppShell } from '@/components/layout/AppShell'
import { GlassPanel } from '@/components/ui/GlassPanel'
import { SeverityBadge, BlockedBadge, AutoSourceBadge } from '@/components/tickets/Badges'
import { SlaCountdown } from '@/components/tickets/SlaCountdown'
import { supabase } from '@/lib/supabase/client'
import { useAuthStore } from '@/store/auth.store'
import {
  ROLE_LABELS, getPrimaryAction, normalizeStatus, normalizeSeverity,
  SEVERITY_ORDER, type TicketAction,
} from '@/lib/ticket-utils'
import { applyTicketAction } from '@/lib/ticket-actions'
import { buzzSuccess, tapMedium } from '@/lib/native/haptics'
import type { TicketWithRelations } from '@/lib/supabase/database.types'
import {
  Ticket, CheckCircle2, ShieldAlert, OctagonAlert, Inbox,
  ChevronRight, Play, BadgeCheck, MapPin, ArrowRight,
  LayoutDashboard, AlertTriangle, BarChart3, Brain,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

type ActionableTicket = TicketWithRelations & { _action: TicketAction }

const MODULES = [
  { href: '/dashboard',    icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/escalations',  icon: AlertTriangle,   label: 'Escalations' },
  { href: '/analytics',    icon: BarChart3,       label: 'Analytics' },
  { href: '/intelligence', icon: Brain,           label: 'Intelligence' },
]

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

export default function HomePage() {
  const { profile } = useAuthStore()
  const [tickets, setTickets] = useState<TicketWithRelations[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const fetchTickets = useCallback(async () => {
    // RLS scopes this automatically: store teams see their store,
    // departments their department, AMs their region, leadership everything.
    const { data } = await supabase
      .from('tickets')
      .select('*, store:stores(*)')
      .in('status', ['open', 'in_progress', 'resolved'])
      .order('created_at', { ascending: false })
      .limit(120)
    setTickets((data as unknown as TicketWithRelations[]) || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchTickets()
    const channel = supabase
      .channel('home-tickets')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, fetchTickets)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fetchTickets])

  const stats = useMemo(() => {
    const now = Date.now()
    let open = 0, blocked = 0, verify = 0, breached = 0
    for (const t of tickets) {
      const s = normalizeStatus(t.status)
      if (s === 'open' || s === 'in_progress') open++
      if (t.blocked) blocked++
      if (s === 'resolved') verify++
      if ((s === 'open' || s === 'in_progress') && t.sla_deadline && new Date(t.sla_deadline).getTime() < now) breached++
    }
    return { open, blocked, verify, breached }
  }, [tickets])

  const actionable = useMemo<ActionableTicket[]>(() => {
    if (!profile) return []
    return tickets
      .map((t) => ({ ...t, _action: getPrimaryAction(t, profile) }))
      .filter((t): t is ActionableTicket => t._action !== null)
      .sort((a, b) =>
        SEVERITY_ORDER.indexOf(normalizeSeverity(a.severity)) -
        SEVERITY_ORDER.indexOf(normalizeSeverity(b.severity)))
      .slice(0, 12)
  }, [tickets, profile])

  const recent = useMemo(
    () => tickets.filter((t) => !actionable.some((a) => a.id === t.id)).slice(0, 5),
    [tickets, actionable],
  )

  const runAction = async (t: ActionableTicket) => {
    if (!profile || busyId) return
    tapMedium()
    setBusyId(t.id)
    const { error } = await applyTicketAction(t, profile, t._action)
    if (!error) buzzSuccess()
    await fetchTickets()
    setBusyId(null)
  }

  const scopeLine = profile
    ? profile.role === 'store_team' || profile.role === 'store_manager'
      ? 'Your store’s live queue'
      : profile.role === 'dept_owner'
        ? `${profile.department ?? 'Department'} queue`
        : profile.role === 'area_manager'
          ? `${profile.region ?? 'Region'} operations`
          : 'Network-wide operations'
    : ''

  const firstName = profile?.name?.split(' ')[0] ?? ''

  return (
    <AppShell title="Home" bare>
      {/* Greeting */}
      <div className="mb-6 lg:mb-8 pt-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.22em] mb-2" style={{ color: 'var(--accent)' }}>
          Prism Escalations
        </p>
        <h1 className="text-[30px] lg:text-[44px] font-extrabold tracking-tight leading-[1.02] text-[var(--text-primary)]">
          {greeting()}{firstName ? `, ${firstName}` : ''}
        </h1>
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          {profile && (
            <span
              className="badge-pill"
              style={{
                fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em',
                color: 'var(--accent)', background: 'var(--accent-dim)', border: '1px solid var(--accent-border)',
              }}
            >
              {ROLE_LABELS[profile.role] ?? profile.role}
            </span>
          )}
          <span className="text-[12px] text-[var(--text-tertiary)]">{scopeLine}</span>
        </div>
      </div>

      {/* Stat chips */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-7">
        {[
          { label: 'Active',        value: stats.open,     icon: <Ticket size={14} />,       color: 'var(--accent)' },
          { label: 'Blocked',       value: stats.blocked,  icon: <OctagonAlert size={14} />, color: 'var(--color-danger)' },
          { label: 'To verify',     value: stats.verify,   icon: <BadgeCheck size={14} />,   color: 'var(--color-success)' },
          { label: 'SLA breached',  value: stats.breached, icon: <ShieldAlert size={14} />,  color: 'var(--color-warning)' },
        ].map(({ label, value, icon, color }) => (
          <Link
            key={label}
            href="/tickets"
            className="flex items-center gap-3 px-4 py-3.5 rounded-[14px] transition-colors"
            style={{ background: 'var(--card-bg)', border: '1px solid var(--border-subtle)' }}
          >
            <span className="w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0"
                  style={{ color, background: 'var(--bg-tertiary)' }}>
              {icon}
            </span>
            <span>
              <span className="block text-[20px] font-extrabold leading-none font-mono-value text-[var(--text-primary)]">
                {loading ? '—' : value}
              </span>
              <span className="block text-[10px] font-bold uppercase tracking-[0.10em] text-[var(--text-muted)] mt-1">
                {label}
              </span>
            </span>
          </Link>
        ))}
      </div>

      {/* Needs your action */}
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.20em] mb-1 text-[var(--text-muted)]">
            Your queue
          </p>
          <h2 className="text-[18px] font-extrabold tracking-tight text-[var(--text-primary)]">
            Needs your action{actionable.length > 0 ? ` (${actionable.length})` : ''}
          </h2>
        </div>
        <Link href="/tickets" className="flex items-center gap-1 text-[11px] font-bold tracking-widest shrink-0"
              style={{ color: 'var(--accent)' }}>
          ALL TICKETS <ArrowRight size={11} />
        </Link>
      </div>

      {loading ? (
        <div className="flex flex-col gap-2.5 mb-8">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 96 }} />)}
        </div>
      ) : actionable.length === 0 ? (
        <GlassPanel padding="lg" className="text-center mb-8">
          <CheckCircle2 size={32} className="mx-auto mb-3" style={{ color: 'var(--color-success)' }} />
          <p className="text-[14px] font-semibold text-[var(--text-secondary)] mb-1">All clear</p>
          <p className="text-xs text-[var(--text-muted)]">Nothing is waiting on you right now.</p>
        </GlassPanel>
      ) : (
        <div className="flex flex-col gap-2.5 mb-8">
          {actionable.map((t) => {
            const isVerify = t._action.key === 'verify'
            const isResolve = t._action.key === 'resolve'
            return (
              <div
                key={t.id}
                className="glass overflow-hidden"
                style={{ borderRadius: 16 }}
              >
                <Link href={`/tickets/view?id=${t.id}`} className="block px-4 pt-3.5 pb-2.5">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <span className="text-[10px] font-mono-value font-semibold text-[var(--text-muted)]">
                      #{t.ticket_code}
                    </span>
                    <SeverityBadge severity={t.severity} />
                    {t.blocked && <BlockedBadge reason={t.blocked_reason} />}
                    {t.intelligence_source && <AutoSourceBadge confidence={t.intelligence_ai_confidence} />}
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-[14px] font-semibold text-[var(--text-primary)] leading-snug flex-1 min-w-0">
                      {t.title}
                    </h3>
                    <ChevronRight size={15} className="text-[var(--text-muted)] shrink-0 mt-0.5" />
                  </div>
                  <div className="flex items-center gap-3 flex-wrap mt-1.5 text-[11px] text-[var(--text-tertiary)]">
                    {t.store && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin size={10} className="text-[var(--accent)]" /> {t.store.store_name}
                      </span>
                    )}
                    <span>{formatDistanceToNow(new Date(t.created_at), { addSuffix: true })}</span>
                    {normalizeStatus(t.status) !== 'resolved' && (
                      <SlaCountdown deadline={t.sla_deadline} compact />
                    )}
                  </div>
                </Link>

                {/* One-tap action bar */}
                <div className="px-3.5 pb-3.5 pt-0.5">
                  {isResolve ? (
                    // marking fixed should attach photo proof → go to the ticket
                    <Link
                      href={`/tickets/view?id=${t.id}`}
                      className="btn-primary w-full justify-center"
                      style={{ padding: '11px 16px', fontSize: 13 }}
                    >
                      <CheckCircle2 size={15} /> {t._action.label}
                    </Link>
                  ) : (
                    <button
                      disabled={busyId === t.id}
                      onClick={() => runAction(t)}
                      className="w-full inline-flex items-center justify-center gap-2 rounded-[10px] font-bold text-[13px] transition-all disabled:opacity-60"
                      style={isVerify ? {
                        padding: '11px 16px',
                        background: 'rgba(34,197,94,0.12)',
                        border: '1px solid rgba(34,197,94,0.35)',
                        color: 'var(--color-success)',
                      } : {
                        padding: '11px 16px',
                        background: 'var(--accent-dim)',
                        border: '1px solid var(--accent-border)',
                        color: 'var(--accent)',
                      }}
                    >
                      {isVerify ? <BadgeCheck size={15} /> : <Play size={15} />}
                      {busyId === t.id ? 'Working…' : t._action.label}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Recent activity in scope */}
      {recent.length > 0 && (
        <>
          <div className="mb-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.20em] mb-1 text-[var(--text-muted)]">
              Live
            </p>
            <h2 className="text-[18px] font-extrabold tracking-tight text-[var(--text-primary)]">
              Recent in your scope
            </h2>
          </div>
          <div className="flex flex-col gap-2 mb-8">
            {recent.map((t) => (
              <Link
                key={t.id}
                href={`/tickets/view?id=${t.id}`}
                className="flex items-center gap-3 px-4 py-3 rounded-[13px] transition-colors"
                style={{ background: 'var(--card-bg)', border: '1px solid var(--border-subtle)' }}
              >
                <Inbox size={15} className="text-[var(--text-muted)] shrink-0" />
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] font-semibold text-[var(--text-primary)] truncate">{t.title}</span>
                  <span className="block text-[10px] text-[var(--text-muted)] mt-0.5">
                    #{t.ticket_code}{t.store ? ` · ${t.store.store_name}` : ''} · {formatDistanceToNow(new Date(t.created_at), { addSuffix: true })}
                  </span>
                </span>
                <SeverityBadge severity={t.severity} />
                <ChevronRight size={14} className="text-[var(--text-muted)] shrink-0" />
              </Link>
            ))}
          </div>
        </>
      )}

      {/* Modules (desktop discovers via sidebar; useful on mobile) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-4">
        {MODULES.map(({ href, icon: Icon, label }) => (
          <Link
            key={href}
            href={href}
            className="flex items-center gap-2.5 px-4 py-3.5 rounded-[13px] text-[12px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)] transition-colors"
            style={{ background: 'var(--card-bg)', border: '1px solid var(--border-subtle)' }}
          >
            <Icon size={15} style={{ color: 'var(--accent)' }} />
            {label}
          </Link>
        ))}
      </div>
    </AppShell>
  )
}
