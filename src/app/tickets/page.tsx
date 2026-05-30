'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
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
  store: string
  region: string
  am: string
  trainer: string
  hr: string
  search: string
}

const EMPTY_FILTERS: Filters = { status: '', severity: '', category: '', store: '', region: '', am: '', trainer: '', hr: '', search: '' }

export default function TicketsPage() {
  const { profile } = useAuthStore()
  const isSuperAdmin = profile?.role === 'super_admin'

  const [tickets, setTickets] = useState<TicketWithRelations[]>([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)

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

  // Filter option lists, derived from the loaded tickets
  const storeOptions = useMemo(() => {
    const m = new Map<string, string>()
    tickets.forEach((t) => { if (t.store) m.set(t.store.id, t.store.store_name) })
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]))
  }, [tickets])

  const regionOptions = useMemo(
    () => Array.from(new Set(tickets.map((t) => t.store?.region).filter(Boolean) as string[])).sort(),
    [tickets],
  )

  const amOptions = useMemo(
    () => Array.from(new Set(tickets.map((t) => t.store?.am_name).filter(Boolean) as string[])).sort(),
    [tickets],
  )

  const trainerOptions = useMemo(
    () => Array.from(new Set(tickets.map((t) => t.store?.trainer_name).filter(Boolean) as string[])).sort(),
    [tickets],
  )

  const hrOptions = useMemo(
    () => Array.from(new Set(tickets.map((t) => t.store?.hr_name).filter(Boolean) as string[])).sort(),
    [tickets],
  )

  // Client-side filtering for store / region / AM / trainer / HR
  const visibleTickets = useMemo(() => tickets.filter((t) => {
    if (filters.store && t.store?.id !== filters.store) return false
    if (filters.region && t.store?.region !== filters.region) return false
    if (filters.am && t.store?.am_name !== filters.am) return false
    if (filters.trainer && t.store?.trainer_name !== filters.trainer) return false
    if (filters.hr && t.store?.hr_name !== filters.hr) return false
    return true
  }), [tickets, filters.store, filters.region, filters.am, filters.trainer, filters.hr])


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
    if (selected.size === visibleTickets.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(visibleTickets.map((t) => t.id)))
    }
  }

  const handleDelete = async () => {
    if (selected.size === 0) return
    setDeleting(true)
    const ids = Array.from(selected)
    const { error } = await supabase.from('tickets').delete().in('id', ids)
    if (error) {
      console.error('Delete failed:', error.message)
      alert(`Delete failed: ${error.message}`)
      setDeleting(false)
      return
    }
    setTickets((prev) => prev.filter((t) => !selected.has(t.id)))
    exitSelectMode()
    setDeleting(false)
  }

  const hasFilters   = Boolean(filters.status || filters.severity || filters.category || filters.store || filters.region || filters.am || filters.trainer || filters.hr || filters.search)
  const clearFilters = () => setFilters(EMPTY_FILTERS)

  const selectClass = 'prism-input'
  const selectStyle = { width: 'auto', minWidth: 140, fontSize: 12 } as const
  const allSelected = visibleTickets.length > 0 && selected.size === visibleTickets.length

  return (
    <AppShell
      overline="Issue Queue"
      title="Tickets"
      subtitle={`${visibleTickets.length} ${visibleTickets.length === 1 ? 'ticket' : 'tickets'} matching current view`}
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
              {loading ? '...' : `${visibleTickets.length} results`}
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
        <FilterItem label="Store">
          <select value={filters.store} onChange={(e) => setFilters((f) => ({ ...f, store: e.target.value }))} className={selectClass} style={{ ...selectStyle, minWidth: 150 }}>
            <option value="">All Stores</option>
            {storeOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </FilterItem>
        <FilterItem label="Region">
          <select value={filters.region} onChange={(e) => setFilters((f) => ({ ...f, region: e.target.value }))} className={selectClass} style={{ ...selectStyle, minWidth: 130 }}>
            <option value="">All Regions</option>
            {regionOptions.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </FilterItem>
        {amOptions.length > 0 && (
          <FilterItem label="Area Manager">
            <select value={filters.am} onChange={(e) => setFilters((f) => ({ ...f, am: e.target.value }))} className={selectClass} style={{ ...selectStyle, minWidth: 150 }}>
              <option value="">All AMs</option>
              {amOptions.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </FilterItem>
        )}
        {trainerOptions.length > 0 && (
          <FilterItem label="Trainer">
            <select value={filters.trainer} onChange={(e) => setFilters((f) => ({ ...f, trainer: e.target.value }))} className={selectClass} style={{ ...selectStyle, minWidth: 150 }}>
              <option value="">All Trainers</option>
              {trainerOptions.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </FilterItem>
        )}
        {hrOptions.length > 0 && (
          <FilterItem label="HR">
            <select value={filters.hr} onChange={(e) => setFilters((f) => ({ ...f, hr: e.target.value }))} className={selectClass} style={{ ...selectStyle, minWidth: 150 }}>
              <option value="">All HRs</option>
              {hrOptions.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </FilterItem>
        )}
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
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 118 }} />)}
        </div>
      ) : visibleTickets.length === 0 ? (
        <GlassPanel padding="lg" className="text-center">
          <Filter size={32} className="mx-auto mb-4 text-[var(--text-muted)]" />
          <p className="text-[14px] font-semibold text-[var(--text-secondary)] mb-1">No tickets found</p>
          <p className="text-xs text-[var(--text-muted)]">{hasFilters ? 'Try clearing your filters' : 'Create your first ticket to get started'}</p>
        </GlassPanel>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3" style={{ paddingBottom: selectMode ? 96 : 0 }}>
          {visibleTickets.map((ticket, i) => (
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
