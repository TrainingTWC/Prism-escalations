'use client'

import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { TicketCard } from '@/components/tickets/TicketCard'
import { GlassPanel } from '@/components/ui/GlassPanel'
import { FilterBar, FilterItem } from '@/components/ui/FilterBar'
import { supabase } from '@/lib/supabase/client'
import { useAuthStore } from '@/store/auth.store'
import type { TicketWithRelations } from '@/lib/supabase/database.types'
import { Filter, Trash2, X, CheckSquare, Square } from 'lucide-react'

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
  const { profile } = useAuthStore()
  const isSuperAdmin = profile?.role === 'super_admin'

  const [tickets, setTickets] = useState<TicketWithRelations[]>([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState<Filters>({ status: '', severity: '', category: '', search: '' })

  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

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
    fetchTickets()
    const channel = supabase
      .channel('tickets-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, fetchTickets)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fetchTickets])

  const exitSelectMode = () => {
    setSelectMode(false)
    setSelected(new Set())
    setConfirmDelete(false)
  }

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (selected.size === tickets.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(tickets.map((t) => t.id)))
    }
  }

  const handleDelete = async () => {
    if (selected.size === 0) return
    setDeleting(true)
    const ids = Array.from(selected)
    await supabase.from('tickets').delete().in('id', ids)
    setTickets((prev) => prev.filter((t) => !selected.has(t.id)))
    exitSelectMode()
    setDeleting(false)
  }

  const hasFilters   = Boolean(filters.status || filters.severity || filters.category || filters.search)
  const clearFilters = () => setFilters({ status: '', severity: '', category: '', search: '' })

  const selectClass = 'prism-input'
  const selectStyle = { width: 'auto', minWidth: 140, fontSize: 12 } as const
  const allSelected = tickets.length > 0 && selected.size === tickets.length

  return (
    <AppShell
      overline="Issue Queue"
      title="Tickets"
      subtitle={`${tickets.length} ${tickets.length === 1 ? 'ticket' : 'tickets'} matching current view`}
    >
      <FilterBar
        onSearch={(v) => setFilters((f) => ({ ...f, search: v }))}
        searchValue={filters.search}
        placeholder="Search by title..."
        showClear={hasFilters}
        onClear={clearFilters}
        trailing={
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">
              {loading ? '...' : `${tickets.length} results`}
            </span>
            {isSuperAdmin && !selectMode && (
              <button
                onClick={() => setSelectMode(true)}
                className="text-[11px] font-semibold text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
              >
                Select
              </button>
            )}
            {isSuperAdmin && selectMode && (
              <button
                onClick={exitSelectMode}
                className="text-[11px] font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
        }
        className="mb-6"
      >
        <FilterItem label="Status">
          <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} className={selectClass} style={selectStyle}>
            <option value="">All Statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
        </FilterItem>
        <FilterItem label="Severity">
          <select value={filters.severity} onChange={(e) => setFilters((f) => ({ ...f, severity: e.target.value }))} className={selectClass} style={{ ...selectStyle, minWidth: 130 }}>
            <option value="">All Severities</option>
            {SEVERITIES.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
          </select>
        </FilterItem>
        <FilterItem label="Category">
          <select value={filters.category} onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))} className={selectClass} style={{ ...selectStyle, minWidth: 130 }}>
            <option value="">All Categories</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </FilterItem>
      </FilterBar>

      {selectMode && (
        <div className="flex items-center justify-between px-4 py-2.5 rounded-[10px] mb-3" style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent)33' }}>
          <button onClick={toggleAll} className="flex items-center gap-2 text-[12px] font-semibold text-[var(--accent)]">
            {allSelected ? <CheckSquare size={15} /> : <Square size={15} />}
            {allSelected ? 'Deselect all' : 'Select all'}
          </button>
          <span className="text-[11px] text-[var(--text-muted)]">
            {selected.size > 0 ? `${selected.size} selected` : 'Click cards to select'}
          </span>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col gap-2.5">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 96 }} />)}
        </div>
      ) : tickets.length === 0 ? (
        <GlassPanel padding="lg" className="text-center">
          <Filter size={32} className="mx-auto mb-4 text-[var(--text-muted)]" />
          <p className="text-[14px] font-semibold text-[var(--text-secondary)] mb-1">No tickets found</p>
          <p className="text-xs text-[var(--text-muted)]">{hasFilters ? 'Try clearing your filters' : 'Create your first ticket to get started'}</p>
        </GlassPanel>
      ) : (
        <div className="flex flex-col gap-2.5" style={{ paddingBottom: selectMode ? 96 : 0 }}>
          {tickets.map((ticket, i) => (
            <TicketCard key={ticket.id} ticket={ticket} index={i} selectable={selectMode} selected={selected.has(ticket.id)} onToggle={toggleOne} />
          ))}
        </div>
      )}

      {selectMode && selected.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4" style={{ background: 'var(--card-bg)', borderTop: '1px solid var(--border-primary)', backdropFilter: 'blur(16px)' }}>
          {!confirmDelete ? (
            <>
              <span className="text-[13px] font-semibold text-[var(--text-primary)]">{selected.size} ticket{selected.size > 1 ? 's' : ''} selected</span>
              <div className="flex items-center gap-3">
                <button onClick={exitSelectMode} className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-[12px] font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors" style={{ border: '1px solid var(--border-subtle)' }}>
                  <X size={13} /> Cancel
                </button>
                <button onClick={() => setConfirmDelete(true)} className="flex items-center gap-1.5 px-4 py-1.5 rounded-[8px] text-[12px] font-bold" style={{ background: 'var(--color-danger)18', border: '1px solid var(--color-danger)44', color: 'var(--color-danger)' }}>
                  <Trash2 size={13} /> Delete {selected.size} ticket{selected.size > 1 ? 's' : ''}
                </button>
              </div>
            </>
          ) : (
            <>
              <span className="text-[13px] font-semibold" style={{ color: 'var(--color-danger)' }}>Permanently delete {selected.size} ticket{selected.size > 1 ? 's' : ''}? This cannot be undone.</span>
              <div className="flex items-center gap-3">
                <button onClick={() => setConfirmDelete(false)} className="px-3 py-1.5 rounded-[8px] text-[12px] font-semibold text-[var(--text-muted)]" style={{ border: '1px solid var(--border-subtle)' }}>Cancel</button>
                <button onClick={handleDelete} disabled={deleting} className="flex items-center gap-1.5 px-4 py-1.5 rounded-[8px] text-[12px] font-bold" style={{ background: 'var(--color-danger)', color: '#fff', opacity: deleting ? 0.6 : 1 }}>
                  <Trash2 size={13} /> {deleting ? 'Deleting...' : 'Confirm delete'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </AppShell>
  )
}
