'use client'

import Link from 'next/link'
import { AppShell } from '@/components/layout/AppShell'
import { GlassPanel } from '@/components/ui/GlassPanel'
import { useNotifications, type NotifKind } from '@/lib/notifications'
import { SeverityBadge } from '@/components/tickets/Badges'
import { formatDistanceToNow } from 'date-fns'
import { Bell, ShieldAlert, Clock3, RefreshCw, Sparkles, Plus, Trash2, CheckCheck } from 'lucide-react'

const KIND_META: Record<NotifKind, { icon: React.ReactNode; color: string }> = {
  sla_breach: { icon: <ShieldAlert size={15} />, color: 'var(--color-danger)' },
  sla_soon:   { icon: <Clock3 size={15} />,      color: 'var(--color-warning)' },
  recurring:  { icon: <RefreshCw size={15} />,   color: 'var(--color-warning)' },
  auto:       { icon: <Sparkles size={15} />,    color: '#a78bfa' },
  new:        { icon: <Plus size={15} />,        color: 'var(--accent)' },
}

export default function AlertsPage() {
  const { items, unreadCount, loading, markAllRead, markRead, remove, clearAll } = useNotifications()

  return (
    <AppShell
      overline="Notifications"
      title="Alerts"
      subtitle={unreadCount > 0 ? `${unreadCount} unread` : 'You are all caught up'}
      actions={
        items.length > 0 ? (
          <div className="flex items-center gap-2">
            <button
              onClick={markAllRead}
              className="btn-ghost"
              style={{ padding: '6px 12px', fontSize: 11 }}
            >
              <CheckCheck size={13} /> Mark all read
            </button>
            <button
              onClick={clearAll}
              className="btn-ghost"
              style={{ padding: '6px 12px', fontSize: 11, color: 'var(--color-danger)' }}
            >
              <Trash2 size={13} /> Clear
            </button>
          </div>
        ) : undefined
      }
    >
      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 72 }} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <GlassPanel padding="lg" className="text-center">
          <Bell size={32} className="mx-auto mb-4 text-[var(--text-muted)]" />
          <p className="text-[14px] font-semibold text-[var(--text-secondary)] mb-1">No alerts</p>
          <p className="text-xs text-[var(--text-muted)]">
            SLA warnings, new tickets and recurring issues show up here.
          </p>
        </GlassPanel>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((n) => {
            const meta = KIND_META[n.kind]
            return (
              <div key={n.id} className="relative">
                <Link
                  href={`/tickets/view?id=${n.ticketId}`}
                  onClick={() => markRead(n.id)}
                  className="flex items-start gap-3 px-4 py-3.5 rounded-[14px] transition-colors"
                  style={{
                    background: n.read ? 'var(--card-bg)' : 'var(--accent-dim)',
                    border: `1px solid ${n.read ? 'var(--border-subtle)' : 'var(--accent-border)'}`,
                  }}
                >
                  <span
                    className="w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0 mt-0.5"
                    style={{ color: meta.color, background: `${'var(--bg-tertiary)'}` }}
                  >
                    {meta.icon}
                  </span>
                  <span className="flex-1 min-w-0 pr-8">
                    <span className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-bold text-[var(--text-primary)]">{n.title}</span>
                      {n.severity && <SeverityBadge severity={n.severity} />}
                    </span>
                    <span className="block text-[12px] text-[var(--text-secondary)] truncate mt-0.5">
                      {n.body}
                    </span>
                    <span className="block text-[10px] text-[var(--text-muted)] mt-1">
                      {n.ticketCode ? `#${n.ticketCode} · ` : ''}
                      {formatDistanceToNow(new Date(n.ts), { addSuffix: true })}
                    </span>
                  </span>
                </Link>
                <button
                  aria-label="Dismiss"
                  onClick={() => remove(n.id)}
                  className="absolute top-3 right-3 w-7 h-7 rounded-md flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--color-danger)]"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </AppShell>
  )
}
