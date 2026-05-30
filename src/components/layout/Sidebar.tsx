'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import {
  LayoutDashboard, Ticket, Store, Users, BarChart3,
  AlertTriangle, Home, Brain,
} from 'lucide-react'
import { SIDEBAR_WIDTH, SIDEBAR_WIDTH_COLLAPSED } from '@/lib/sidebar-context'
import { cn } from '@/lib/cn'
import { PrismLogo } from '@/components/ui/PrismLogo'

interface NavItem {
  href: string
  icon: typeof LayoutDashboard
  label: string
}

const PRIMARY_NAV: NavItem[] = [
  { href: '/',             icon: Home,            label: 'Home' },
  { href: '/dashboard',    icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/tickets',      icon: Ticket,          label: 'Tickets' },
  { href: '/escalations',  icon: AlertTriangle,   label: 'Escalations' },
  { href: '/analytics',    icon: BarChart3,       label: 'Analytics' },
  { href: '/intelligence', icon: Brain,           label: 'AI Intelligence' },
]

const ADMIN_NAV: NavItem[] = [
  { href: '/stores', icon: Store, label: 'Stores' },
  { href: '/team',   icon: Users, label: 'Team' },
]

export function Sidebar() {
  const pathname = usePathname()

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/')

  const renderNavItem = ({ href, icon: Icon, label }: NavItem) => {
    const active = isActive(href)
    return (
      <Link
        key={href}
        href={href}
        className={cn(
          'group relative flex items-center gap-3 h-9 rounded-lg px-3 text-[13px] font-medium transition-all',
          'border border-transparent',
          active
            ? 'bg-[var(--accent-dim)] text-[var(--accent)] border-[var(--accent-border)]'
            : 'text-[var(--text-tertiary)] hover:bg-[var(--card-bg-hover)] hover:text-[var(--text-primary)]',
        )}
      >
        {active && (
          <span
            className="absolute -left-3 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full"
            style={{ background: 'var(--accent)', boxShadow: '0 0 8px var(--accent-glow)' }}
          />
        )}
        <Icon size={16} strokeWidth={active ? 2.4 : 1.9} className="shrink-0" />
        <span className="truncate">{label}</span>
      </Link>
    )
  }

  return (
    <aside
      className="fixed top-0 left-0 bottom-0 z-50 flex flex-col"
      style={{
        width: SIDEBAR_WIDTH,
        background: 'var(--sidebar-bg)',
        borderRight: '1px solid var(--sidebar-border)',
        backdropFilter: 'blur(16px) saturate(1.2)',
      }}
    >
      {/* Brand */}
      <div className="h-14 px-4 flex items-center border-b border-[var(--sidebar-border)] shrink-0">
        <Link href="/" className="flex items-center gap-3 w-full group">
          <PrismLogo size={34} className="shrink-0" />
          <span className="text-[12px] font-bold uppercase tracking-[0.22em] text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors truncate">
            Prism Escalations
          </span>
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-4 flex flex-col gap-0.5 px-3">
        <div className="px-3 mb-2 text-[9px] font-bold uppercase tracking-[0.20em] text-[var(--text-muted)]">
          Menu
        </div>
        {PRIMARY_NAV.map(renderNavItem)}

        <div className="mt-5 mb-2 px-3">
          <div className="text-[9px] font-bold uppercase tracking-[0.20em] text-[var(--text-muted)]">
            Admin
          </div>
        </div>

        {ADMIN_NAV.map(renderNavItem)}
      </nav>
    </aside>
  )
}

export { SIDEBAR_WIDTH as SIDEBAR_WIDTH_EXPANDED, SIDEBAR_WIDTH_COLLAPSED }
