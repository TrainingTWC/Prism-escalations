'use client'

import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { TicketCard } from '@/components/tickets/TicketCard'
import { GlassPanel } from '@/components/ui/GlassPanel'
import { FilterBar, FilterItem } from '@/components/ui/FilterBar'
import { supabase } from '@/lib/supabase/client'
import type { TicketWithRelations } from '@/lib/supabase/database.types'
import { Filter } from 'lucide-react'

const STATUSES   = ['open', 'acknowledged', 'accepted', 'in_progress', 'waiting', 'snag', 'resolved', 'verification', 'closed']
const SEVERITIES = ['critical', 'high', 'medium', 'low']
const CATEGORIES = ['Operations', 'HR', 'IT', 'SCM', 'QA']
const STATUS_LABELS: Record<string, string> = {
  open: 'Open', acknowledged: 'Acknowledged', accepted: 'Accepted',
  in_progress: 'In Progress', waiting: 'Waiting', snag: 'SNAG',
  resolved: 'Resolved', verification: 'Verification', closed: 'Closed',
}

interface Filters {
  status: string
  severity: string
  category: string
  search: string
}

export default function TicketsPage() {
  const [tickets, setTickets] = useState<TicketWithRelations[]>([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState<Filters>({ status: '', severity: '', category: '', search: '' })

  const fetchTickets = useCallback(async () => {
    let query = supabase
      .from('tickets')
      .select(`*, store:stores(*), raised_by_profile:profiles!tickets_raised_by_fkey(*), assigned_to_profile:profiles!tickets_assigned_to_fkey(*), escalations(*)`)
      .order('created_at', { ascending: false })

    if (filters.status)   query = query.eq('status', filters.status)
    if (filters.severity) query = query.eq('severity', filters.severity)
    if (filters.category) query = query.eq('category', filters.category)
    if (filters.search)   query = query.ilike('title', `%${filters.search}%`)

    const { data } = await query
    setTickets((data as unknown as TicketWithRelations[]) || [])
    setLoading(false)
  }, [filters])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchTickets()
    const channel = supabase
      .channel('tickets-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, fetchTickets)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fetchTickets])

  const hasFilters   = Boolean(filters.status || filters.severity || filters.category || filters.search)
  const clearFilters = () => setFilters({ status: '', severity: '', category: '', search: '' })

  const selectClass = 'prism-input'
  const selectStyle = { width: 'auto', minWidth: 140, fontSize: 12 } as const

  return (
    <AppShell
      overline="Issue Queue"
      title="Tickets"
      subtitle={`${tickets.length} ${tickets.length === 1 ? 'ticket' : 'tickets'} matching current view`}
    >
      <FilterBar
        onSearch={(v) => setFilters((f) => ({ ...f, search: v }))}
        searchValue={filters.search}
        placeholder="Search by title…"
        showClear={hasFilters}
        onClear={clearFilters}
        trailing={
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">
            {loading ? '…' : `${tickets.length} results`}
          </span>
        }
        className="mb-6"
      >
        <FilterItem label="Status">
          <select
            value={filters.status}
            onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
            className={selectClass}
            style={selectStyle}
          >
            <option value="">All Statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
        </FilterItem>
        <FilterItem label="Severity">
          <select
            value={filters.severity}
            onChange={(e) => setFilters((f) => ({ ...f, severity: e.target.value }))}
            className={selectClass}
            style={{ ...selectStyle, minWidth: 130 }}
          >
            <option value="">All Severities</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
        </FilterItem>
        <FilterItem label="Category">
          <select
            value={filters.category}
            onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))}
            className={selectClass}
            style={{ ...selectStyle, minWidth: 130 }}
          >
            <option value="">All Categories</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </FilterItem>
      </FilterBar>

      {/* List */}
      {loading ? (
        <div className="flex flex-col gap-2.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 96 }} />
          ))}
        </div>
      ) : tickets.length === 0 ? (
        <GlassPanel padding="lg" className="text-center">
          <Filter size={32} className="mx-auto mb-4 text-[var(--text-muted)]" />
          <p className="text-[14px] font-semibold text-[var(--text-secondary)] mb-1">No tickets found</p>
          <p className="text-xs text-[var(--text-muted)]">
            {hasFilters ? 'Try clearing your filters' : 'Create your first ticket to get started'}
          </p>
        </GlassPanel>
      ) : (
        <div className="flex flex-col gap-2.5">
          {tickets.map((ticket, i) => (
            <TicketCard key={ticket.id} ticket={ticket} index={i} />
          ))}
        </div>
      )}
    </AppShell>
  )
}

