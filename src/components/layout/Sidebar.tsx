'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import {
  LayoutDashboard, Ticket, Store, Users, BarChart3,
  AlertTriangle, LogOut, ChevronLeft, Home, Brain,
} from 'lucide-react'
import { useAuthStore } from '@/store/auth.store'
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
  { href: '/escalations', icon: AlertTriangle,   label: 'Escalations' },
  { href: '/analytics',   icon: BarChart3,       label: 'Analytics' },
  { href: '/intelligence', icon: Brain,          label: 'AI Intelligence' },
]

const ADMIN_NAV: NavItem[] = [
  { href: '/stores', icon: Store, label: 'Stores' },
  { href: '/team',   icon: Users, label: 'Team' },
]

export function Sidebar() {
  const pathname = usePathname()
  const { profile, signOut } = useAuthStore()
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
      className="fixed top-0 left-0 bottom-0 z-50 flex flex-col transition-[width] duration-300"
      style={{
        width,
        background: 'var(--sidebar-bg)',
        borderRight: '1px solid var(--sidebar-border)',
        backdropFilter: 'blur(16px) saturate(1.2)',
      }}
    >
      {/* Brand */}
      <div className="h-14 px-4 flex items-center border-b border-[var(--sidebar-border)] shrink-0">
        <div className={cn('flex items-center gap-3 w-full', collapsed && 'justify-center')}>
          <PrismLogo size={34} className="shrink-0" />
          {!collapsed && (
            <div className="min-w-0 leading-tight">
              <div className="text-[14px] font-extrabold tracking-tight text-[var(--text-primary)]">
                PRISM
              </div>
              <div className="text-[9px] font-bold uppercase tracking-[0.20em] text-[var(--accent)]">
                Escalations
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Nav */}
      <nav className={cn('flex-1 overflow-y-auto py-4 flex flex-col gap-0.5', collapsed ? 'px-3' : 'px-3')}>
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

      {/* Bottom: user + actions */}
      <div className="px-3 py-3 border-t border-[var(--sidebar-border)] flex flex-col gap-2 shrink-0">
        {profile && !collapsed && (
          <div
            className="flex items-center gap-2.5 rounded-lg px-2.5 py-2"
            style={{ background: 'var(--card-bg)', border: '1px solid var(--border-subtle)' }}
          >
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-bold shrink-0"
              style={{
                background: 'linear-gradient(135deg, var(--color-ember-500) 0%, var(--color-ember-400) 100%)',
                color: '#1A0E05',
              }}
            >
              {profile.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 leading-tight">
              <div className="text-[12px] font-semibold text-[var(--text-primary)] truncate">
                {profile.name}
              </div>
              <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--accent)] truncate">
                {profile.role.replace(/_/g, ' ')}
              </div>
            </div>
          </div>
        )}

        <div className={cn('flex gap-1', collapsed ? 'flex-col' : 'flex-row')}>
          <button
            onClick={signOut}
            title="Sign out"
            className={cn(
              'h-9 rounded-lg flex items-center justify-center gap-2 text-[12px] text-[var(--text-tertiary)] hover:text-[var(--color-danger)] hover:bg-[var(--card-bg-hover)] transition-colors',
              collapsed ? 'w-full' : 'flex-1 px-3',
            )}
          >
            <LogOut size={14} />
            {!collapsed && <span>Sign out</span>}
          </button>

          <button
            onClick={toggle}
            title={collapsed ? 'Expand' : 'Collapse'}
            className={cn(
              'h-9 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--card-bg-hover)] transition-colors',
              collapsed ? 'w-full' : 'w-9',
            )}
          >
            <ChevronLeft size={14} className={cn('transition-transform', collapsed && 'rotate-180')} />
          </button>
        </div>
      </div>
    </aside>
  )
}

export { SIDEBAR_WIDTH as SIDEBAR_WIDTH_EXPANDED, SIDEBAR_WIDTH_COLLAPSED }


