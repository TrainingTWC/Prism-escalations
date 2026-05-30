'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Bell, CheckCheck, Trash2, X, AlertTriangle, Clock, RefreshCw, Sparkles, Plus,
} from 'lucide-react'
import { useNotifications, type NotifKind } from '@/lib/notifications'
import { formatDistanceToNow } from 'date-fns'

const KIND_META: Record<NotifKind, { icon: React.ElementType; color: string; tint: string }> = {
  sla_breach: { icon: AlertTriangle, color: 'var(--color-danger)', tint: 'rgba(239,68,68,0.14)' },
  sla_soon: { icon: Clock, color: 'var(--color-warning)', tint: 'rgba(234,179,8,0.14)' },
  recurring: { icon: RefreshCw, color: 'var(--accent)', tint: 'var(--accent-dim)' },
  auto: { icon: Sparkles, color: 'var(--accent)', tint: 'var(--accent-dim)' },
  new: { icon: Plus, color: 'var(--color-success)', tint: 'rgba(34,197,94,0.14)' },
}

export function NotificationBell() {
  const router = useRouter()
  const { items, unreadCount, loading, markAllRead, markRead, remove, clearAll } = useNotifications()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const openTicket = (id: string, notifId: string) => {
    markRead(notifId)
    setOpen(false)
    router.push(`/tickets/view?id=${id}`)
  }

  return (
    <div className="relative" ref={wrapRef}>
      <button
        aria-label="Notifications"
        onClick={() => setOpen((v) => !v)}
        className="relative w-9 h-9 rounded-lg flex items-center justify-center transition-colors"
        style={{
          background: open ? 'var(--accent-dim)' : 'var(--card-bg)',
          border: `1px solid ${open ? 'var(--accent-border)' : 'var(--border-subtle)'}`,
          color: open ? 'var(--accent)' : 'var(--text-tertiary)',
        }}
      >
        <Bell size={14} />
        {unreadCount > 0 && (
          <span
            className="absolute -top-1.5 -right-1.5 min-w-[17px] h-[17px] px-1 rounded-full flex items-center justify-center text-[10px] font-bold leading-none"
            style={{
              background: 'var(--color-danger)',
              color: '#fff',
              boxShadow: '0 0 0 2px var(--sidebar-bg)',
            }}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 w-[360px] max-w-[calc(100vw-2rem)] rounded-[14px] overflow-hidden z-50 animate-fadeInUp"
          style={{
            background: 'var(--glass-bg)',
            border: '1px solid var(--border-primary)',
            backdropFilter: 'blur(18px) saturate(1.2)',
            WebkitBackdropFilter: 'blur(18px) saturate(1.2)',
            boxShadow: '0 20px 50px rgba(0,0,0,0.45)',
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 h-12"
            style={{ borderBottom: '1px solid var(--border-subtle)' }}
          >
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-bold text-[var(--text-primary)]">Notifications</span>
              {unreadCount > 0 && (
                <span
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                  style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}
                >
                  {unreadCount} new
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={markAllRead}
                disabled={unreadCount === 0}
                title="Mark all as read"
                className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] font-semibold transition-colors disabled:opacity-40"
                style={{ color: 'var(--text-secondary)' }}
              >
                <CheckCheck size={13} /> Read
              </button>
              <button
                onClick={clearAll}
                disabled={items.length === 0}
                title="Clear all"
                className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] font-semibold transition-colors disabled:opacity-40 hover:text-[var(--color-danger)]"
                style={{ color: 'var(--text-secondary)' }}
              >
                <Trash2 size={13} /> Clear
              </button>
            </div>
          </div>

          {/* List */}
          <div className="max-h-[420px] overflow-y-auto">
            {loading && items.length === 0 && (
              <p className="text-[12px] text-[var(--text-muted)] text-center py-10">Loading…</p>
            )}
            {!loading && items.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
                <span
                  className="w-11 h-11 rounded-full grid place-items-center mb-3"
                  style={{ background: 'var(--card-bg)', color: 'var(--text-muted)' }}
                >
                  <Bell size={18} />
                </span>
                <p className="text-[13px] font-semibold text-[var(--text-secondary)]">You&apos;re all caught up</p>
                <p className="text-[11px] text-[var(--text-muted)] mt-1">New alerts will show up here.</p>
              </div>
            )}

            {items.map((n) => {
              const meta = KIND_META[n.kind]
              const Icon = meta.icon
              return (
                <div
                  key={n.id}
                  onClick={() => openTicket(n.ticketId, n.id)}
                  className="group relative flex gap-3 px-4 py-3 cursor-pointer transition-colors"
                  style={{
                    borderBottom: '1px solid var(--border-subtle)',
                    background: n.read ? 'transparent' : 'var(--accent-dim)',
                  }}
                >
                  {!n.read && (
                    <span
                      className="absolute left-1.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full"
                      style={{ background: 'var(--accent)' }}
                    />
                  )}
                  <span
                    className="shrink-0 w-8 h-8 rounded-lg grid place-items-center mt-0.5"
                    style={{ background: meta.tint, color: meta.color }}
                  >
                    <Icon size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-[12.5px] font-bold text-[var(--text-primary)] truncate">{n.title}</p>
                      {n.ticketCode && (
                        <span className="text-[10px] font-mono-value text-[var(--text-muted)] shrink-0">
                          #{n.ticketCode}
                        </span>
                      )}
                    </div>
                    <p className="text-[12px] text-[var(--text-secondary)] truncate">{n.body}</p>
                    <p className="text-[10.5px] text-[var(--text-muted)] mt-0.5">
                      {formatDistanceToNow(new Date(n.ts), { addSuffix: true })}
                    </p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      remove(n.id)
                    }}
                    aria-label="Dismiss"
                    className="shrink-0 self-start w-6 h-6 rounded-md grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity hover:text-[var(--color-danger)]"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    <X size={13} />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
