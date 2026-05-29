'use client'

import Link from 'next/link'
import { MapPin, Clock, User, ChevronRight, CheckCircle2, Circle } from 'lucide-react'
import { SeverityBadge, StatusPill, CategoryBadge, AutoSourceBadge, PatternBadge } from './Badges'
import { SlaCountdown } from './SlaCountdown'
import type { TicketWithRelations } from '@/lib/supabase/database.types'
import { formatDistanceToNow } from 'date-fns'
import { cn } from '@/lib/cn'

interface TicketCardProps {
  ticket: TicketWithRelations
  index?: number
  selectable?: boolean
  selected?: boolean
  onToggle?: (id: string) => void
}

export function TicketCard({ ticket, index = 0, selectable, selected, onToggle }: TicketCardProps) {
  const isCritical = ticket.severity === 'critical'
  const isHigh = ticket.severity === 'high'
  const accentBar = isCritical
    ? 'var(--color-danger)'
    : isHigh
      ? 'var(--color-warning)'
      : 'transparent'

  const inner = (
    <article
      className={cn(
        'glass relative overflow-hidden',
        'px-5 py-4',
        selectable ? 'cursor-pointer' : 'glass-interactive',
        selected && 'ring-1 ring-[var(--accent)]',
      )}
      style={{
        borderLeft: `3px solid ${selected ? 'var(--accent)' : accentBar}`,
        background: selected ? 'var(--accent-dim)' : undefined,
      }}
    >
      {/* Checkbox overlay */}
      {selectable && (
        <div className="absolute top-3.5 right-4 z-10">
          {selected
            ? <CheckCircle2 size={18} style={{ color: 'var(--accent)' }} />
            : <Circle size={18} className="text-[var(--text-muted)]" />}
        </div>
      )}

      <div className="flex items-start justify-between gap-4">
        <div className={cn('flex-1 min-w-0', selectable && 'pr-6')}>
          {/* Top row */}
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <CategoryBadge category={ticket.category} />
            <span className="text-[11px] font-mono-value text-[var(--text-muted)] font-semibold">
              #{ticket.ticket_code}
            </span>
            <SeverityBadge severity={ticket.severity} />
            <StatusPill status={ticket.status} />
            {ticket.intelligence_source && (
              <AutoSourceBadge confidence={ticket.intelligence_ai_confidence} />
            )}
            {ticket.intelligence_pattern_flag && <PatternBadge />}
          </div>

          {/* Title */}
          <h3 className="text-[14px] font-semibold text-[var(--text-primary)] mb-1.5 truncate">
            {ticket.title}
          </h3>

          {/* Meta row */}
          <div className="flex items-center gap-4 flex-wrap text-xs text-[var(--text-tertiary)]">
            {ticket.store && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin size={11} className="text-[var(--accent)]" />
                <span className="text-[var(--text-secondary)]">{ticket.store.store_name}</span>
                <span className="text-[var(--text-muted)]">· {ticket.store.region}</span>
              </span>
            )}
            {ticket.raised_by_profile && (
              <span className="inline-flex items-center gap-1.5">
                <User size={11} />
                {ticket.raised_by_profile.name}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 text-[var(--text-muted)]">
              <Clock size={11} />
              {formatDistanceToNow(new Date(ticket.created_at), { addSuffix: true })}
            </span>
          </div>
        </div>

        {/* Right: SLA + arrow */}
        {!selectable && (
          <div className="flex flex-col items-end gap-2 shrink-0">
            {ticket.status !== 'closed' && ticket.status !== 'resolved' && (
              <SlaCountdown deadline={ticket.sla_deadline} compact />
            )}
            <ChevronRight size={14} className="text-[var(--text-muted)]" />
          </div>
        )}
        {selectable && ticket.status !== 'closed' && ticket.status !== 'resolved' && (
          <div className="shrink-0 pr-8">
            <SlaCountdown deadline={ticket.sla_deadline} compact />
          </div>
        )}
      </div>
    </article>
  )

  if (selectable) {
    return (
      <div
        className="animate-fadeInUp"
        style={{ animationDelay: `${index * 40}ms` }}
        onClick={() => onToggle?.(ticket.id)}
      >
        {inner}
      </div>
    )
  }

  return (
    <Link
      href={`/tickets/view?id=${ticket.id}`}
      className="block animate-fadeInUp"
      style={{ animationDelay: `${index * 40}ms`, textDecoration: 'none' }}
    >
      {inner}
    </Link>
  )
}

