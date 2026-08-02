'use client'

import Link from 'next/link'
import { AppShell } from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase/client'
import { useCachedQuery } from '@/lib/use-cached-query'
import { normalizeStatus, normalizeSeverity } from '@/lib/ticket-utils'
import { tapLight } from '@/lib/native/haptics'
import {
  LayoutDashboard,
  Ticket,
  AlertTriangle,
  ArrowRight,
  ChevronRight,
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

/**
 * Phones get a compact tap row (icon · title · chevron); ≥ lg it becomes the
 * tall description card.
 */
function ModuleCardComponent({ href, icon, title, description }: ModuleCard) {
  return (
    <Link
      href={href}
      onClick={() => tapLight()}
      className="module-card group flex flex-row lg:flex-col items-center lg:items-start gap-3.5 lg:gap-5 rounded-2xl p-4 lg:p-8"
    >
      <div
        className="w-11 h-11 lg:w-14 lg:h-14 rounded-xl flex items-center justify-center shrink-0"
        style={{
          background: 'var(--accent-dim)',
          color: 'var(--accent)',
          border: '1px solid var(--accent-border)',
        }}
      >
        {icon}
      </div>
      <div className="flex flex-col gap-1 lg:gap-2.5 flex-1 min-w-0">
        <div
          className="text-[13px] lg:text-[15px] font-extrabold tracking-[0.12em] lg:tracking-widest"
          style={{ color: 'var(--text-primary)' }}
        >
          {title}
        </div>
        <p
          className="text-[11.5px] lg:text-[13px] leading-snug lg:leading-relaxed line-clamp-2 lg:line-clamp-none"
          style={{ color: 'var(--text-tertiary)' }}
        >
          {description}
        </p>
      </div>
      <ChevronRight size={16} className="shrink-0 lg:hidden" style={{ color: 'var(--text-muted)' }} />
      <div
        className="hidden lg:flex items-center gap-1 text-[12px] font-bold tracking-widest"
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
      className="flex flex-col gap-2 lg:gap-3 rounded-xl p-3.5 lg:p-5"
      style={{ background: 'var(--card-bg)', border: '1px solid var(--border-subtle)' }}
    >
      <div className="flex items-center gap-2 lg:gap-2.5">
        <div
          className="w-7 h-7 lg:w-8 lg:h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{
            background: 'var(--accent-dim)',
            color: 'var(--accent)',
            border: '1px solid var(--accent-border)',
          }}
        >
          {icon}
        </div>
        <span
          className="text-[10px] lg:text-[11px] font-bold uppercase tracking-[0.10em] lg:tracking-[0.12em] truncate"
          style={{ color: 'var(--text-secondary)' }}
        >
          {label}
        </span>
      </div>
      <div className="flex items-baseline gap-1.5 lg:gap-2">
        <span
          className="text-[26px] lg:text-[30px] font-extrabold leading-none tracking-tight"
          style={{ color: 'var(--text-primary)' }}
        >
          {value}
        </span>
        <span className="text-[10px] lg:text-[11px] font-semibold" style={{ color: 'var(--accent)' }}>
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
      {/* AppShell already supplies the page gutter — no extra padding here. */}
      <div className="max-w-6xl">

        {/* Hero */}
        <div className="mb-7 lg:mb-14">
          <p
            className="text-[10px] lg:text-[12px] font-bold uppercase tracking-[0.20em] lg:tracking-[0.22em] mb-2 lg:mb-4"
            style={{ color: 'var(--accent)' }}
          >
            Operational Intelligence
          </p>
          <h1
            className="text-[34px] sm:text-[52px] md:text-[72px] lg:text-[84px] font-extrabold tracking-tight leading-[0.95] mb-3 lg:mb-6"
            style={{ color: 'var(--text-primary)' }}
          >
            PRISM{' '}
            <span className="text-gradient-ember">ESCALATIONS</span>
          </h1>
          <p
            className="text-[13px] lg:text-[16px] leading-relaxed max-w-2xl"
            style={{ color: 'var(--text-secondary)' }}
          >
            Unified operational issue management and risk mitigation across your network.{' '}
            <span className="hidden sm:inline">
              Track tickets, SLA exposure, escalations and risk from one command centre.
            </span>
          </p>
        </div>

        {/* Live numbers lead on phones; the module grid leads on desktop. */}
        <div className="flex flex-col gap-8 lg:gap-14">

          {/* Active tickets */}
          <section className="order-1 lg:order-2">
            <div className="mb-3 lg:mb-6 flex items-end justify-between gap-4">
              <div>
                <p
                  className="text-[10px] font-bold uppercase tracking-[0.20em] mb-1"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Live status
                </p>
                <h2
                  className="text-[16px] lg:text-[18px] font-extrabold tracking-tight"
                  style={{ color: 'var(--text-primary)' }}
                >
                  Active tickets
                </h2>
              </div>
              <Link
                href="/tickets"
                className="flex items-center gap-1 text-[11px] font-bold tracking-widest shrink-0"
                style={{ color: 'var(--accent)' }}
              >
                VIEW ALL <ArrowRight size={11} />
              </Link>
            </div>

            <div className="grid grid-cols-2 gap-3 lg:gap-4">
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
          </section>

          {/* Primary modules */}
          <section className="order-2 lg:order-1">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-2.5 lg:gap-5">
              {PRIMARY_MODULES.map((mod) => (
                <ModuleCardComponent key={mod.href} {...mod} />
              ))}
            </div>
          </section>

        </div>
      </div>

      {/* Desktop FAB only — phones raise tickets from the bottom nav's centre button. */}
      <Link
        href="/tickets/new"
        aria-label="Raise a ticket"
        className="hidden lg:flex fixed bottom-8 right-8 z-50 w-14 h-14 rounded-full items-center justify-center transition-transform duration-200 hover:scale-105"
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
