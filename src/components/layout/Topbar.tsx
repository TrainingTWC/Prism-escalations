'use client'

import Link from 'next/link'
import { Plus, Search, Sun, Moon, KeyRound, LogOut } from 'lucide-react'
import { useAuthStore } from '@/store/auth.store'
import { useTheme } from '@/lib/theme-context'
import { NotificationBell } from './NotificationBell'
import { PrismLogo } from '@/components/ui/PrismLogo'

export function Topbar() {
  const { profile, signOut } = useAuthStore()
  const { theme, toggleTheme } = useTheme()

  return (
    <header
      className="h-14 sticky top-0 z-40 flex items-center justify-between px-4 lg:px-6 gap-3"
      style={{
        background: 'color-mix(in oklab, var(--sidebar-bg) 92%, transparent)',
        borderBottom: '1px solid var(--sidebar-border)',
        backdropFilter: 'blur(16px) saturate(1.2)',
        WebkitBackdropFilter: 'blur(16px) saturate(1.2)',
      }}
    >
      {/* Mobile: brand (sidebar is hidden) */}
      <Link href="/" className="flex lg:hidden items-center gap-2.5 shrink-0">
        <PrismLogo size={28} className="shrink-0" />
        <span className="text-[13px] font-extrabold tracking-tight text-[var(--text-primary)]">
          Prism <span className="text-gradient-ember">Escalations</span>
        </span>
      </Link>

      {/* Desktop: search */}
      <div className="relative w-full max-w-md hidden lg:block">
        <Search
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none"
        />
        <input
          type="text"
          placeholder="Search Prism Escalations…"
          className="prism-input pl-9 pr-12 h-9"
          style={{ fontSize: 12 }}
        />
        <span
          className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-semibold px-1.5 py-0.5 rounded border"
          style={{
            color: 'var(--text-muted)',
            background: 'var(--bg-tertiary)',
            borderColor: 'var(--border-subtle)',
          }}
        >
          ⌘K
        </span>
      </div>

      <div className="flex items-center gap-2">
        {/* New Ticket (desktop; mobile has the centre + tab) */}
        <Link
          href="/tickets/new"
          className="btn-primary hidden lg:inline-flex"
          style={{ padding: '7px 14px', fontSize: 12 }}
        >
          <Plus size={13} strokeWidth={2.5} />
          <span>New Ticket</span>
        </Link>

        {/* Theme */}
        <button
          onClick={toggleTheme}
          aria-label="Toggle theme"
          className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors"
          style={{
            background: 'var(--card-bg)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--text-tertiary)',
          }}
        >
          {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
        </button>

        {/* Notifications */}
        <NotificationBell />

        {/* User */}
        {profile && (
          <div
            className="flex items-center gap-2 pl-3 ml-1"
            style={{ borderLeft: '1px solid var(--border-subtle)' }}
          >
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-bold"
              style={{
                background: 'linear-gradient(135deg, var(--color-ember-500) 0%, var(--color-ember-400) 100%)',
                color: '#1A0E05',
              }}
            >
              {profile.name.charAt(0).toUpperCase()}
            </div>
            <div className="hidden md:block text-left leading-tight">
              <div className="text-[12px] font-semibold text-[var(--text-primary)] truncate max-w-[140px]">
                {profile.name}
              </div>
              <div className="text-[10px] font-bold uppercase tracking-[0.10em] text-[var(--accent)] truncate max-w-[140px]">
                {profile.role.replace(/_/g, ' ')}
              </div>
            </div>

            <Link
              href="/team"
              aria-label="Account"
              title="Account"
              className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors"
              style={{
                background: 'var(--card-bg)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-tertiary)',
              }}
            >
              <KeyRound size={14} />
            </Link>

            <button
              onClick={signOut}
              aria-label="Sign out"
              title="Sign out"
              className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors hover:text-[var(--color-danger)]"
              style={{
                background: 'var(--card-bg)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-tertiary)',
              }}
            >
              <LogOut size={14} />
            </button>
          </div>
        )}
      </div>
    </header>
  )
}

