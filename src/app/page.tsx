'use client'

import Link from 'next/link'
import { AppShell } from '@/components/layout/AppShell'
import { PrismLogo } from '@/components/ui/PrismLogo'
import {
  LayoutDashboard,
  Ticket,
  AlertTriangle,
  BarChart3,
  Store,
  Users,
  ArrowRight,
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

const SECONDARY_MODULES: ModuleCard[] = [
  {
    href: '/analytics',
    icon: <BarChart3 size={22} />,
    title: 'ANALYTICS',
    description: 'Resolution trends, team performance and SLA compliance over time.',
  },
  {
    href: '/stores',
    icon: <Store size={22} />,
    title: 'STORES',
    description: 'Store-level ticket volume, escalation rates and operational risk scores.',
  },
  {
    href: '/team',
    icon: <Users size={22} />,
    title: 'TEAM',
    description: 'Manage team roles, permissions and the employee roster.',
  },
]

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

export default function HomePage() {
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
            Unified operational issue management. Track tickets, SLA exposure, escalations
            and risk across your retail network from one command centre.
          </p>
        </div>

        {/* Primary modules */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-10">
          {PRIMARY_MODULES.map((mod) => (
            <ModuleCardComponent key={mod.href} {...mod} />
          ))}
        </div>

        {/* Section divider */}
        <div className="mb-6">
          <p
            className="text-[10px] font-bold uppercase tracking-[0.20em] mb-1"
            style={{ color: 'var(--text-muted)' }}
          >
            Analysis &amp; Admin
          </p>
          <h2
            className="text-[18px] font-extrabold tracking-tight"
            style={{ color: 'var(--text-primary)' }}
          >
            Supporting tools
          </h2>
        </div>

        {/* Secondary modules */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {SECONDARY_MODULES.map((mod) => (
            <ModuleCardComponent key={mod.href} {...mod} />
          ))}
        </div>

      </div>
    </AppShell>
  )
}