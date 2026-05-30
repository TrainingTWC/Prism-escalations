'use client'

import Link from 'next/link'
import { MapPin, Clock, User, ChevronRight, CheckCircle2, Circle } from 'lucide-react'
import { SeverityBadge, StatusPill, AutoSourceBadge, PatternBadge } from './Badges'
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

const CATEGORY_STUB: Record<string, [string, string]> = {
  Operations: ['#E07B39', '#A85225'],
  HR:         ['#EC4899', '#9D174D'],
  IT:         ['#3B82F6', '#1E40AF'],
  SCM:        ['#22C55E', '#15803D'],
  QA:         ['#EAB308', '#A16207'],
}

export function TicketCard({ ticket, index = 0, selectable, selected, onToggle }: TicketCardProps) {
  const [stubFrom, stubTo] = CATEGORY_STUB[ticket.category] ?? ['#C76A2E', '#7A3A0E']
  const stub = `linear-gradient(160deg, ${stubFrom} 0%, ${stubTo} 100%)`
  const isClosed = ticket.status === 'closed' || ticket.status === 'resolved'

  const inner = (
    <article
      className={cn(
        'glass relative overflow-hidden flex isolate',
        selectable ? 'cursor-pointer' : 'glass-interactive',
        selected && 'ring-1 ring-[var(--accent)]',
      )}
      style={{ background: selected ? 'var(--accent-dim)' : undefined }}
    >
      {/* ── Left stub: department label, colour-coded ───────────────── */}
      <div
        className="relative shrink-0 w-[40px] flex flex-col items-center justify-between py-3"
        style={{ background: stub }}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-white/80" />
        <span
          className="font-black uppercase text-white text-[10px] tracking-[0.22em] whitespace-nowrap"
          style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
        >
          {ticket.category}
        </span>
        <span className="w-1.5 h-1.5 rounded-full bg-white/80" />
      </div>

      {/* ── Perforation divider with punch-out notches ──────────────── */}
      <div className="relative w-px shrink-0">
        <span
          className="absolute left-1/2 -translate-x-1/2 -top-[7px] w-[14px] h-[14px] rounded-full z-10"
          style={{ background: 'var(--bg-primary)' }}
        />
        <span
          className="absolute left-1/2 -translate-x-1/2 -bottom-[7px] w-[14px] h-[14px] rounded-full z-10"
          style={{ background: 'var(--bg-primary)' }}
        />
        <span
          className="absolute left-1/2 -translate-x-1/2 top-2 bottom-2 w-px"
          style={{
            backgroundImage:
              'repeating-linear-gradient(to bottom, var(--border-primary) 0 4px, transparent 4px 9px)',
          }}
        />
      </div>

      {/* ── Body ────────────────────────────────────────────────────── */}
      <div className={cn('flex-1 min-w-0 px-5 py-4', selectable && 'pr-9')}>
        {/* Checkbox overlay */}
        {selectable && (
          <div className="absolute top-3.5 right-4 z-10">
            {selected
              ? <CheckCircle2 size={18} style={{ color: 'var(--accent)' }} />
              : <Circle size={18} className="text-[var(--text-muted)]" />}
          </div>
        )}

        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            {/* Top row */}
            <div className="flex items-center gap-2 flex-wrap mb-2">
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
              {!isClosed && <SlaCountdown deadline={ticket.sla_deadline} compact />}
              <ChevronRight size={14} className="text-[var(--text-muted)]" />
            </div>
          )}
          {selectable && !isClosed && (
            <div className="shrink-0">
              <SlaCountdown deadline={ticket.sla_deadline} compact />
            </div>
          )}
        </div>
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

