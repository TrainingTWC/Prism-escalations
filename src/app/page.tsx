'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AppShell } from '@/components/layout/AppShell'
import { PrismLogo } from '@/components/ui/PrismLogo'
import { supabase } from '@/lib/supabase/client'
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

const ACTIVE_STATUSES = new Set([
  'open',
  'acknowledged',
  'accepted',
  'in_progress',
  'waiting',
  'snag',
])

function ModuleCardComponent({ href, icon, title, description }: ModuleCard) {
  return (
    <Link
      href={href}
      className="group flex flex-col gap-4 rounded-2xl p-6 transition-all duration-200"
      style={{
        background: 'var(--card-bg)',
        border: '1px solid var(--card-border)',
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget
        el.style.background = 'var(--card-bg-hover)'
        el.style.borderColor = 'var(--accent-border)'
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget
        el.style.background = 'var(--card-bg)'
        el.style.borderColor = 'var(--card-border)'
      }}
    >
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
        style={{
          background: 'var(--accent-dim)',
          color: 'var(--accent)',
          border: '1px solid var(--accent-border)',
        }}
      >
        {icon}
      </div>
      <div className="flex flex-col gap-2 flex-1">
        <div
          className="text-[13px] font-extrabold tracking-[0.12em]"
          style={{ color: 'var(--text-primary)' }}
        >
          {title}
        </div>
        <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
          {description}
        </p>
      </div>
      <div
        className="flex items-center gap-1 text-[11px] font-bold tracking-widest transition-colors"
        style={{ color: 'var(--accent)' }}
      >
        OPEN <ArrowRight size={11} />
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
      style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}
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
  const [highPriority, setHighPriority] = useState<number | null>(null)
  const [slaBreaches, setSlaBreaches] = useState<number | null>(null)

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('tickets')
        .select('severity, status, sla_deadline')

      const rows = data ?? []
      const now = Date.now()

      const high = rows.filter(
        (t) =>
          ACTIVE_STATUSES.has(t.status) &&
          (t.severity === 'high' || t.severity === 'critical'),
      ).length

      const breached = rows.filter(
        (t) =>
          ACTIVE_STATUSES.has(t.status) &&
          t.sla_deadline !== null &&
          new Date(t.sla_deadline).getTime() < now,
      ).length

      setHighPriority(high)
      setSlaBreaches(breached)
    }

    load()
  }, [])

  return (
    <AppShell title="Home" bare>
      <div className="px-8 py-10 max-w-5xl">

        {/* Hero */}
        <div className="mb-12">
          <div className="flex items-center gap-4 mb-8">
            <PrismLogo size={52} />
          </div>
          <p
            className="text-[11px] font-bold uppercase tracking-[0.20em] mb-3"
            style={{ color: 'var(--accent)' }}
          >
            Operational Intelligence
          </p>
          <h1
            className="text-[42px] font-extrabold tracking-tight leading-none mb-4"
            style={{ color: 'var(--text-primary)' }}
          >
            PRISM{' '}
            <span className="text-gradient-ember">ESCALATIONS</span>
          </h1>
          <p
            className="text-[14px] leading-relaxed max-w-xl"
            style={{ color: 'var(--text-secondary)' }}
          >
            Unified operational issue management and risk mitigation across your network.
            Track tickets, SLA exposure, escalations and risk from one command centre.
          </p>
        </div>

        {/* Primary modules */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-12">
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