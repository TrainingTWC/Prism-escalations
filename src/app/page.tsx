'use client'

import Link from 'next/link'
import { AppShell } from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase/client'
import { useCachedQuery } from '@/lib/use-cached-query'
import { normalizeStatus, normalizeSeverity } from '@/lib/ticket-utils'
import {
  LayoutDashboard,
  Ticket,
  AlertTriangle,
  ArrowRight,
  Flame,
  ShieldAlert,
  Plus,
} from 'lucide-react'

interface ModuleCard {
  href: string
  icon: React.ReactNode
  title: string
  description: string
}

const PRIMARY_MODULES: ModuleCard[] = [
  {
    href: '/dashboard',
    icon: <LayoutDashboard size={22} />,
    title: 'MISSION CONTROL',
    description: 'Multi-store escalation health, SLA exposure and operational action flow.',
  },
  {
    href: '/tickets',
    icon: <Ticket size={22} />,
    title: 'TICKETS',
    description: 'Raise, track and resolve operational issues across all stores and departments.',
  },
  {
    href: '/escalations',
    icon: <AlertTriangle size={22} />,
    title: 'ESCALATIONS',
    description: 'Monitor active escalations, SLA breaches and critical pressure across the network.',
  },
]

function ModuleCardComponent({ href, icon, title, description }: ModuleCard) {
  return (
    <Link
      href={href}
      className="group flex flex-col gap-5 rounded-2xl p-8 transition-all duration-200"
      style={{
        background: 'var(--card-bg)',
        border: '1px solid var(--border-subtle)',
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget
        el.style.background = 'var(--card-bg-hover)'
        el.style.borderColor = 'var(--accent-border)'
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget
        el.style.background = 'var(--card-bg)'
        el.style.borderColor = 'var(--border-subtle)'
      }}
    >
      <div
        className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0"
        style={{
          background: 'var(--accent-dim)',
          color: 'var(--accent)',
          border: '1px solid var(--accent-border)',
        }}
      >
        {icon}
      </div>
      <div className="flex flex-col gap-2.5 flex-1">
        <div
          className="text-[15px] font-extrabold tracking-widest"
          style={{ color: 'var(--text-primary)' }}
        >
          {title}
        </div>
        <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
          {description}
        </p>
      </div>
      <div
        className="flex items-center gap-1 text-[12px] font-bold tracking-widest transition-colors"
        style={{ color: 'var(--accent)' }}
      >
        OPEN <ArrowRight size={12} />
      </div>
    </Link>
  )
}

function ActiveTicketStat({
  icon,
  label,
  value,
  caption,
}: {
  icon: React.ReactNode
  label: string
  value: string
  caption: string
}) {
  return (
    <div
      className="flex flex-col gap-3 rounded-xl p-5"
      style={{ background: 'var(--card-bg)', border: '1px solid var(--border-subtle)' }}
    >
      <div className="flex items-center gap-2.5">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{
            background: 'var(--accent-dim)',
            color: 'var(--accent)',
            border: '1px solid var(--accent-border)',
          }}
        >
          {icon}
        </div>
        <span
          className="text-[11px] font-bold uppercase tracking-[0.12em]"
          style={{ color: 'var(--text-secondary)' }}
        >
          {label}
        </span>
      </div>
      <div className="flex items-baseline gap-2">
        <span
          className="text-[30px] font-extrabold leading-none tracking-tight"
          style={{ color: 'var(--text-primary)' }}
        >
          {value}
        </span>
        <span className="text-[11px] font-semibold" style={{ color: 'var(--accent)' }}>
          {caption}
        </span>
      </div>
    </div>
  )
}

export default function HomePage() {
  // RLS scopes this to the signed-in user; the cache keeps the home landing
  // instant on return navigations.
  const { data } = useCachedQuery('home:ticket-stats', async () => {
    const { data } = await supabase
      .from('tickets')
      .select('severity, status, sla_deadline')

    const rows = data ?? []
    const now = Date.now()

    // A ticket is "active" while it's still open or in progress. normalizeStatus
    // folds the v3 status set (acknowledged/waiting/snag/…) into that shape.
    const isActive = (status: string | null) => {
      const s = normalizeStatus(status)
      return s === 'open' || s === 'in_progress'
    }

    const highPriority = rows.filter((t) => {
      const sev = normalizeSeverity(t.severity)
      return isActive(t.status) && (sev === 'P0' || sev === 'P1')
    }).length

    const slaBreaches = rows.filter(
      (t) =>
        isActive(t.status) &&
        t.sla_deadline !== null &&
        new Date(t.sla_deadline).getTime() < now,
    ).length

    return { highPriority, slaBreaches }
  })

  const highPriority = data?.highPriority ?? null
  const slaBreaches = data?.slaBreaches ?? null

  return (
    <AppShell title="Home" bare>
      <div className="px-8 py-10 max-w-6xl">

        {/* Hero */}
        <div className="mb-14">
          <p
            className="text-[12px] font-bold uppercase tracking-[0.22em] mb-4"
            style={{ color: 'var(--accent)' }}
          >
            Operational Intelligence
          </p>
          <h1
            className="text-[56px] md:text-[72px] lg:text-[84px] font-extrabold tracking-tight leading-[0.95] mb-6"
            style={{ color: 'var(--text-primary)' }}
          >
            PRISM{' '}
            <span className="text-gradient-ember">ESCALATIONS</span>
          </h1>
          <p
            className="text-[16px] leading-relaxed max-w-2xl"
            style={{ color: 'var(--text-secondary)' }}
          >
            Unified operational issue management and risk mitigation across your network.
            Track tickets, SLA exposure, escalations and risk from one command centre.
          </p>
        </div>

        {/* Primary modules */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-14">
          {PRIMARY_MODULES.map((mod) => (
            <ModuleCardComponent key={mod.href} {...mod} />
          ))}
        </div>

        {/* Active tickets */}
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <p
              className="text-[10px] font-bold uppercase tracking-[0.20em] mb-1"
              style={{ color: 'var(--text-muted)' }}
            >
              Live status
            </p>
            <h2
              className="text-[18px] font-extrabold tracking-tight"
              style={{ color: 'var(--text-primary)' }}
            >
              Active tickets
            </h2>
          </div>
          <Link
            href="/tickets"
            className="flex items-center gap-1 text-[11px] font-bold tracking-widest"
            style={{ color: 'var(--accent)' }}
          >
            VIEW ALL <ArrowRight size={11} />
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <ActiveTicketStat
            icon={<Flame size={16} />}
            label="High priority"
            value={highPriority === null ? '—' : String(highPriority)}
            caption="open"
          />
          <ActiveTicketStat
            icon={<ShieldAlert size={16} />}
            label="SLA breaches"
            value={slaBreaches === null ? '—' : String(slaBreaches)}
            caption="urgent"
          />
        </div>

      </div>

      {/* Floating action button */}
      <Link
        href="/tickets/new"
        aria-label="Raise a ticket"
        className="fixed bottom-8 right-8 z-50 w-14 h-14 rounded-full flex items-center justify-center transition-transform duration-200 hover:scale-105"
        style={{
          background: 'var(--accent)',
          color: '#fff',
          boxShadow: '0 12px 32px rgba(224, 123, 57, 0.45)',
        }}
      >
        <Plus size={24} />
      </Link>
    </AppShell>
  )
}
