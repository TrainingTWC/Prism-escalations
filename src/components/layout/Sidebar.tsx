'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import {
  LayoutDashboard, Ticket, Store, Users, BarChart3,
  AlertTriangle, ChevronLeft, Home, Brain, Search, Route, QrCode, GitBranch,
} from 'lucide-react'
import { useSidebar, SIDEBAR_WIDTH, SIDEBAR_WIDTH_COLLAPSED } from '@/lib/sidebar-context'
import { cn } from '@/lib/cn'
import { PrismLogo } from '@/components/ui/PrismLogo'

interface NavItem {
  href: string
  icon: typeof LayoutDashboard
  label: string
}

const PRIMARY_NAV: NavItem[] = [
  { href: '/',            icon: Home,            label: 'Home' },
  { href: '/dashboard',   icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/tickets',     icon: Ticket,          label: 'Tickets' },
  { href: '/assets',      icon: QrCode,          label: 'Assets' },
  { href: '/escalations', icon: AlertTriangle,   label: 'Escalations' },
  { href: '/analytics',   icon: BarChart3,       label: 'Analytics' },
  { href: '/intelligence', icon: Brain,          label: 'AI Intelligence' },
]

const ADMIN_NAV: NavItem[] = [
  { href: '/stores',            icon: Store,     label: 'Stores' },
  { href: '/team',              icon: Users,     label: 'Team' },
  { href: '/routing',           icon: Route,     label: 'Routing' },
  { href: '/escalation-matrix', icon: GitBranch, label: 'Escalation Matrix' },
]

export function Sidebar() {
  const pathname = usePathname()
  const { collapsed, toggle, width } = useSidebar()

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/')

  const renderNavItem = ({ href, icon: Icon, label }: NavItem) => {
    const active = isActive(href)
    return (
      <Link
        key={href}
        href={href}
        title={collapsed ? label : undefined}
        className={cn(
          'group relative flex items-center gap-3 h-9 rounded-lg px-3 text-[13px] font-medium transition-all',
          'border border-transparent',
          collapsed && 'justify-center px-0',
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
        {!collapsed && <span className="truncate">{label}</span>}
      </Link>
    )
  }

  return (
    <aside
      className="fixed top-0 left-0 bottom-0 z-50 hidden lg:flex flex-col transition-[width] duration-300"
      style={{
        width,
        background: 'var(--sidebar-bg)',
        borderRight: '1px solid var(--sidebar-border)',
        backdropFilter: 'blur(16px) saturate(1.2)',
      }}
    >
      {/* Brand */}
      <div className="h-14 px-4 flex items-center border-b border-[var(--sidebar-border)] shrink-0">
        <Link
          href="/"
          className={cn('flex items-center gap-3 w-full group', collapsed && 'justify-center')}
        >
          <PrismLogo size={34} className="shrink-0" />
          {!collapsed && (
            <span className="text-[12px] font-bold uppercase tracking-[0.22em] text-[var(--text-muted)] group-hover:text-[var(--text-secondary)] transition-colors truncate">
              Prism Escalations
            </span>
          )}
        </Link>
      </div>

      {/* Product heading + search */}
      {!collapsed && (
        <div className="px-4 pt-5 pb-4 flex flex-col gap-4 shrink-0">
          <Link href="/" className="inline-block">
            <h2 className="text-[20px] font-extrabold tracking-tight text-[var(--text-primary)] leading-none hover:text-[var(--accent)] transition-colors">
              Prism Escalations
            </h2>
          </Link>
          <div className="relative">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none"
            />
            <input
              type="text"
              placeholder="Search Prism Escalations…"
              className="prism-input pl-9 h-9"
              style={{ fontSize: 12 }}
            />
          </div>
        </div>
      )}

      {/* Nav */}
      <nav className={cn('flex-1 overflow-y-auto py-4 flex flex-col gap-0.5', collapsed ? 'px-3' : 'px-3')}>
        {!collapsed && (
          <div className="px-3 mb-2 text-[9px] font-bold uppercase tracking-[0.20em] text-[var(--text-muted)]">
            Menu
          </div>
        )}
        {PRIMARY_NAV.map(renderNavItem)}

        <div className={cn('mt-5 mb-2', collapsed ? 'px-0 text-center' : 'px-3')}>
          {collapsed ? (
            <div className="h-px w-6 mx-auto bg-[var(--border-subtle)]" />
          ) : (
            <div className="text-[9px] font-bold uppercase tracking-[0.20em] text-[var(--text-muted)]">
              Admin
            </div>
          )}
        </div>

        {ADMIN_NAV.map(renderNavItem)}
      </nav>

      {/* Bottom: collapse toggle */}
      <div className="px-3 py-3 border-t border-[var(--sidebar-border)] shrink-0">
        <button
          onClick={toggle}
          title={collapsed ? 'Expand' : 'Collapse'}
          className={cn(
            'w-full h-9 rounded-lg flex items-center justify-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--card-bg-hover)] transition-colors',
          )}
        >
          <ChevronLeft size={14} className={cn('transition-transform', collapsed && 'rotate-180')} />
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  )
}

export { SIDEBAR_WIDTH as SIDEBAR_WIDTH_EXPANDED, SIDEBAR_WIDTH_COLLAPSED }


