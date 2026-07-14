'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Home, Ticket, Plus, Bell, Menu, X,
  LayoutDashboard, AlertTriangle, BarChart3, Brain, Store, Users, Route,
  Sun, Moon, LogOut,
} from 'lucide-react'
import { useAuthStore } from '@/store/auth.store'
import { useTheme } from '@/lib/theme-context'
import { ROLE_LABELS } from '@/lib/ticket-utils'
import { tapLight } from '@/lib/native/haptics'
import { cn } from '@/lib/cn'

const TABS = [
  { href: '/',        icon: Home,   label: 'Home' },
  { href: '/tickets', icon: Ticket, label: 'Tickets' },
  // centre slot = create button
  { href: '/alerts',  icon: Bell,   label: 'Alerts' },
]

const MENU_LINKS = [
  { href: '/dashboard',    icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/escalations',  icon: AlertTriangle,   label: 'Escalations' },
  { href: '/analytics',    icon: BarChart3,       label: 'Analytics' },
  { href: '/intelligence', icon: Brain,           label: 'AI Intelligence' },
]

const ADMIN_LINKS = [
  { href: '/stores',  icon: Store, label: 'Stores' },
  { href: '/team',    icon: Users, label: 'Team' },
  { href: '/routing', icon: Route, label: 'Routing' },
]

/**
 * Mobile-only bottom tab bar (hidden ≥ lg where the sidebar takes over).
 * Home · Tickets · [+ Create] · Alerts · Menu-sheet
 */
export function BottomNav() {
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)
  const { profile, signOut } = useAuthStore()
  const { theme, toggleTheme } = useTheme()

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/')

  const tabClass = (active: boolean) =>
    cn(
      'flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-colors',
      active ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]',
    )

  const isAdmin = profile?.role === 'super_admin' || profile?.role === 'leadership'

  return (
    <>
      {/* Menu sheet */}
      {menuOpen && (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <button
            aria-label="Close menu"
            className="absolute inset-0"
            style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)' }}
            onClick={() => setMenuOpen(false)}
          />
          <div
            className="absolute bottom-0 left-0 right-0 rounded-t-[22px] px-5 pt-5 safe-bottom animate-fadeInUp"
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-primary)',
              borderBottom: 'none',
              paddingBottom: 'calc(env(safe-area-inset-bottom) + 84px)',
            }}
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-[14px] font-bold text-[var(--text-primary)]">{profile?.name ?? 'Menu'}</p>
                {profile && (
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--accent)]">
                    {ROLE_LABELS[profile.role] ?? profile.role}
                  </p>
                )}
              </div>
              <button
                aria-label="Close"
                onClick={() => setMenuOpen(false)}
                className="w-9 h-9 rounded-lg flex items-center justify-center"
                style={{ background: 'var(--card-bg)', border: '1px solid var(--border-subtle)', color: 'var(--text-tertiary)' }}
              >
                <X size={16} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-3">
              {MENU_LINKS.map(({ href, icon: Icon, label }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => { tapLight(); setMenuOpen(false) }}
                  className={cn(
                    'flex items-center gap-2.5 px-3.5 py-3 rounded-[12px] text-[13px] font-semibold',
                    isActive(href) ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]',
                  )}
                  style={{
                    background: isActive(href) ? 'var(--accent-dim)' : 'var(--card-bg)',
                    border: `1px solid ${isActive(href) ? 'var(--accent-border)' : 'var(--border-subtle)'}`,
                  }}
                >
                  <Icon size={16} />
                  {label}
                </Link>
              ))}
            </div>

            {isAdmin && (
              <>
                <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--text-muted)] px-1 mb-2">Admin</p>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  {ADMIN_LINKS.map(({ href, icon: Icon, label }) => (
                    <Link
                      key={href}
                      href={href}
                      onClick={() => { tapLight(); setMenuOpen(false) }}
                      className="flex items-center gap-2.5 px-3.5 py-3 rounded-[12px] text-[13px] font-semibold text-[var(--text-secondary)]"
                      style={{ background: 'var(--card-bg)', border: '1px solid var(--border-subtle)' }}
                    >
                      <Icon size={16} />
                      {label}
                    </Link>
                  ))}
                </div>
              </>
            )}

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => { tapLight(); toggleTheme() }}
                className="flex-1 flex items-center justify-center gap-2 px-3.5 py-3 rounded-[12px] text-[13px] font-semibold text-[var(--text-secondary)]"
                style={{ background: 'var(--card-bg)', border: '1px solid var(--border-subtle)' }}
              >
                {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
                {theme === 'dark' ? 'Light mode' : 'Dark mode'}
              </button>
              <button
                onClick={() => { tapLight(); signOut() }}
                className="flex-1 flex items-center justify-center gap-2 px-3.5 py-3 rounded-[12px] text-[13px] font-semibold"
                style={{
                  background: 'rgba(239,68,68,0.07)',
                  border: '1px solid rgba(239,68,68,0.20)',
                  color: 'var(--color-danger)',
                }}
              >
                <LogOut size={15} />
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tab bar */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 lg:hidden"
        style={{
          background: 'color-mix(in oklab, var(--sidebar-bg) 96%, transparent)',
          borderTop: '1px solid var(--border-primary)',
          backdropFilter: 'blur(18px) saturate(1.2)',
          WebkitBackdropFilter: 'blur(18px) saturate(1.2)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        <div className="flex items-stretch h-[62px]">
          {TABS.slice(0, 2).map(({ href, icon: Icon, label }) => (
            <Link key={href} href={href} onClick={() => tapLight()} className={tabClass(isActive(href))}>
              <Icon size={20} strokeWidth={isActive(href) ? 2.4 : 1.9} />
              <span className="text-[9px] font-bold uppercase tracking-[0.08em]">{label}</span>
            </Link>
          ))}

          {/* Centre create button */}
          <div className="flex-1 flex items-center justify-center">
            <Link
              href="/tickets/new"
              aria-label="Create ticket"
              onClick={() => tapLight()}
              className="w-[52px] h-[52px] -mt-6 rounded-full flex items-center justify-center"
              style={{
                background: 'linear-gradient(135deg, var(--color-ember-500) 0%, var(--color-ember-400) 100%)',
                color: '#1A0E05',
                boxShadow: '0 10px 26px rgba(224, 123, 57, 0.45), 0 0 0 5px var(--bg-primary)',
              }}
            >
              <Plus size={26} strokeWidth={2.6} />
            </Link>
          </div>

          {TABS.slice(2).map(({ href, icon: Icon, label }) => (
            <Link key={href} href={href} onClick={() => tapLight()} className={tabClass(isActive(href))}>
              <Icon size={20} strokeWidth={isActive(href) ? 2.4 : 1.9} />
              <span className="text-[9px] font-bold uppercase tracking-[0.08em]">{label}</span>
            </Link>
          ))}

          <button
            onClick={() => { tapLight(); setMenuOpen((v) => !v) }}
            className={tabClass(menuOpen)}
          >
            <Menu size={20} strokeWidth={menuOpen ? 2.4 : 1.9} />
            <span className="text-[9px] font-bold uppercase tracking-[0.08em]">Menu</span>
          </button>
        </div>
      </nav>
    </>
  )
}
