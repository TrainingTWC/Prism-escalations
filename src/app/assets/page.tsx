'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AppShell } from '@/components/layout/AppShell'
import { GlassPanel } from '@/components/ui/GlassPanel'
import { AssetStatusBadge, CoverageBadge } from '@/components/assets/AssetBadges'
import { supabase } from '@/lib/supabase/client'
import { useAuthStore } from '@/store/auth.store'
import { canManageAssets } from '@/lib/asset-utils'
import { tapLight, tapMedium } from '@/lib/native/haptics'
import type { AssetWithRelations } from '@/lib/supabase/database.types'
import { QrCode, Plus, Printer, Upload, MapPin, ChevronRight, Search, Wrench, Truck, BarChart3, ArrowLeftRight, Package, Trash2, Check, X, CheckSquare } from 'lucide-react'

type QuickFilter = 'all' | 'active' | 'pm_due' | 'in_repair' | 'no_coverage' | 'retired'

/** PostgREST puts `id=in.(…)` in the URL, so delete in URL-safe batches. */
const DELETE_BATCH = 50

const QUICK_FILTERS: { value: QuickFilter; label: string }[] = [
  { value: 'all',         label: 'All' },
  { value: 'active',      label: 'Active' },
  { value: 'pm_due',      label: 'PM Due' },
  { value: 'in_repair',   label: 'In Repair' },
  { value: 'no_coverage', label: 'No Coverage' },
  { value: 'retired',     label: 'Retired' },
]

export default function AssetsPage() {
  const { profile } = useAuthStore()
  const manager = canManageAssets(profile)
  // Mirrors the assets_delete RLS policy — only super admins can delete.
  const canDelete = profile?.role === 'super_admin'

  const [assets, setAssets] = useState<AssetWithRelations[]>([])
  const [pmDueIds, setPmDueIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [quick, setQuick] = useState<QuickFilter>('all')
  const [search, setSearch] = useState('')
  const [storeFilter, setStoreFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')

  // Bulk delete
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmBulk, setConfirmBulk] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [bulkErr, setBulkErr] = useState('')

  const fetchAssets = useCallback(async () => {
    // RLS scopes automatically: store staff see their store, dept owners
    // their department's categories, AMs their region, leadership all.
    const { data } = await supabase
      .from('assets')
      .select('*, category:asset_categories(*), store:stores(*), amc_vendor:vendors(*)')
      .order('created_at', { ascending: false })
    setAssets((data as unknown as AssetWithRelations[]) || [])

    // Which assets have an overdue PM task (RLS scopes this too)
    const { data: due } = await supabase
      .from('asset_pm_tasks')
      .select('asset_id')
      .eq('is_active', true)
      .lt('next_due_at', new Date().toISOString())
    setPmDueIds(new Set(((due as { asset_id: string }[] | null) ?? []).map((d) => d.asset_id)))

    setLoading(false)
  }, [])

  useEffect(() => { fetchAssets() }, [fetchAssets])

  const storeOptions = useMemo(() => {
    const m = new Map<string, string>()
    assets.forEach((a) => { if (a.store) m.set(a.store.id, a.store.store_name) })
    return Array.from(m.entries()).sort((x, y) => x[1].localeCompare(y[1]))
  }, [assets])

  const categoryOptions = useMemo(() => {
    const m = new Map<string, string>()
    assets.forEach((a) => { if (a.category) m.set(a.category.id, a.category.name) })
    return Array.from(m.entries()).sort((x, y) => x[1].localeCompare(y[1]))
  }, [assets])

  const visible = useMemo(() => assets.filter((a) => {
    if (quick === 'active' && a.status !== 'active') return false
    if (quick === 'in_repair' && a.status !== 'in_repair') return false
    if (quick === 'retired' && a.status !== 'retired') return false
    if (quick === 'pm_due' && !pmDueIds.has(a.id)) return false
    if (quick === 'no_coverage' && (a.warranty_until || a.amc_until)) return false
    if (storeFilter && a.store_id !== storeFilter) return false
    if (categoryFilter && a.category_id !== categoryFilter) return false
    if (search) {
      const q = search.toLowerCase()
      const hay = `${a.name} ${a.asset_code} ${a.make ?? ''} ${a.model ?? ''} ${a.serial_no ?? ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  }), [assets, quick, search, storeFilter, categoryFilter, pmDueIds])

  // Filters can hide already-selected assets. Only ever act on what's on screen,
  // so a narrowed filter can't delete something the user can no longer see.
  const selectedVisible = useMemo(
    () => visible.filter((a) => selected.has(a.id)),
    [visible, selected],
  )
  const allVisibleSelected = visible.length > 0 && selectedVisible.length === visible.length

  const exitSelectMode = useCallback(() => {
    setSelectMode(false)
    setSelected(new Set())
    setConfirmBulk(false)
    setBulkErr('')
  }, [])

  const toggleOne = (id: string) => {
    tapLight()
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAllVisible = () => {
    tapLight()
    setSelected(allVisibleSelected ? new Set() : new Set(visible.map((a) => a.id)))
  }

  const deleteSelected = async () => {
    if (deleting) return
    const ids = selectedVisible.map((a) => a.id)
    if (ids.length === 0) return

    tapMedium()
    setDeleting(true)
    setBulkErr('')

    // tickets.asset_id is ON DELETE SET NULL — past tickets survive, just
    // unlinked. PM tasks/logs cascade away with the asset.
    let removed = 0
    for (let i = 0; i < ids.length; i += DELETE_BATCH) {
      const batch = ids.slice(i, i + DELETE_BATCH)
      // .select() returns the rows actually deleted, so an RLS block surfaces
      // as a short count instead of a silent no-op.
      const { data, error } = await supabase.from('assets').delete().in('id', batch).select('id')
      if (error) {
        setBulkErr(
          removed > 0
            ? `${removed} deleted, then failed: ${error.message}`
            : error.message,
        )
        await fetchAssets()
        setDeleting(false)
        setConfirmBulk(false)
        setSelected(new Set())
        return
      }
      removed += (data ?? []).length
    }

    await fetchAssets()
    setDeleting(false)

    if (removed < ids.length) {
      setConfirmBulk(false)
      setSelected(new Set())
      setBulkErr(`Deleted ${removed} of ${ids.length}. The rest were blocked by permissions.`)
      return
    }
    exitSelectMode()
  }

  return (
    <AppShell
      overline="Asset Registry"
      title="Assets"
      subtitle={
        selectMode
          ? `${selectedVisible.length} of ${visible.length} selected`
          : `${visible.length} ${visible.length === 1 ? 'asset' : 'assets'} in your scope`
      }
      actions={
        selectMode ? (
          <button
            onClick={exitSelectMode}
            className="btn-ghost"
            style={{ padding: '7px 13px', fontSize: 12 }}
          >
            <X size={13} /> Done
          </button>
        ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <Link href="/assets/analytics" className="btn-ghost" style={{ padding: '7px 13px', fontSize: 12 }}>
            <BarChart3 size={13} /> Analytics
          </Link>
          <Link href="/assets/transfers" className="btn-ghost" style={{ padding: '7px 13px', fontSize: 12 }}>
            <ArrowLeftRight size={13} /> Transfers
          </Link>
          <Link href="/assets/parts" className="btn-ghost" style={{ padding: '7px 13px', fontSize: 12 }}>
            <Package size={13} /> Spare parts
          </Link>
          {canDelete && assets.length > 0 && (
            <button
              onClick={() => { tapLight(); setBulkErr(''); setSelectMode(true) }}
              className="btn-ghost"
              style={{ padding: '7px 13px', fontSize: 12 }}
            >
              <CheckSquare size={13} /> Select
            </button>
          )}
          {manager && (<>
            <Link href="/assets/import" className="btn-ghost" style={{ padding: '7px 13px', fontSize: 12 }}>
              <Upload size={13} /> Import CSV
            </Link>
            <Link href="/assets/labels" className="btn-ghost" style={{ padding: '7px 13px', fontSize: 12 }}>
              <Printer size={13} /> Print labels
            </Link>
            <Link href="/assets/new" className="btn-primary" style={{ padding: '7px 14px', fontSize: 12 }}>
              <Plus size={13} strokeWidth={2.5} /> Add asset
            </Link>
          </>)}
        </div>
        )
      }
    >
      {/* Quick filter chips */}
      <div className="flex gap-2 overflow-x-auto pb-1 mb-4 -mx-1 px-1" style={{ scrollbarWidth: 'none' }}>
        {QUICK_FILTERS.map(({ value, label }) => {
          const active = quick === value
          return (
            <button
              key={value}
              onClick={() => { tapLight(); setQuick(value) }}
              className="shrink-0 px-3.5 py-2 rounded-full text-[12px] font-bold transition-all"
              style={{
                background: active ? 'var(--accent-dim)' : 'var(--card-bg)',
                border: `1px solid ${active ? 'var(--accent)' : 'var(--border-subtle)'}`,
                color: active ? 'var(--accent)' : 'var(--text-tertiary)',
              }}
            >
              {label}
            </button>
          )
        })}
      </div>

      {/* Search + selects */}
      <div className="flex gap-2 flex-wrap mb-5">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, code, serial…"
            className="prism-input pl-9"
          />
        </div>
        {storeOptions.length > 1 && (
          <select value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)} className="prism-input" style={{ width: 'auto', minWidth: 150, fontSize: 12 }}>
            <option value="">All stores</option>
            {storeOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        )}
        {categoryOptions.length > 1 && (
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="prism-input" style={{ width: 'auto', minWidth: 150, fontSize: 12 }}>
            <option value="">All categories</option>
            {categoryOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 96 }} />)}
        </div>
      ) : visible.length === 0 ? (
        <GlassPanel padding="lg" className="text-center">
          <QrCode size={32} className="mx-auto mb-4 text-[var(--text-muted)]" />
          <p className="text-[14px] font-semibold text-[var(--text-secondary)] mb-1">
            {assets.length === 0 ? 'No assets registered yet' : 'No assets match this filter'}
          </p>
          <p className="text-xs text-[var(--text-muted)] max-w-[420px] mx-auto">
            {assets.length === 0
              ? manager
                ? 'Add your first asset (or import a CSV), then print QR labels — staff scan a label with their phone camera to report a problem in seconds.'
                : 'Assets for your store will appear here once your manager registers them.'
              : 'Try a different filter or search term.'}
          </p>
          {assets.length === 0 && manager && (
            <div className="flex gap-2 justify-center mt-4">
              <Link href="/assets/new" className="btn-primary" style={{ padding: '9px 16px', fontSize: 13 }}>
                <Plus size={14} /> Add asset
              </Link>
              <Link href="/assets/import" className="btn-ghost" style={{ padding: '9px 16px', fontSize: 13 }}>
                <Upload size={14} /> Import CSV
              </Link>
            </div>
          )}
        </GlassPanel>
      ) : (
        <div className={`grid grid-cols-1 xl:grid-cols-2 gap-3 ${selectMode ? 'pb-28 lg:pb-24' : ''}`}>
          {visible.map((a, i) => {
            const picked = selected.has(a.id)
            const body = (
              <div className="flex items-start gap-3.5 px-4 py-4">
                <span
                  className="w-11 h-11 rounded-[12px] flex items-center justify-center shrink-0 mt-0.5 transition-colors"
                  style={
                    selectMode
                      ? {
                          background: picked ? 'var(--accent)' : 'transparent',
                          color: '#fff',
                          border: `1.5px solid ${picked ? 'var(--accent)' : 'var(--border-primary)'}`,
                        }
                      : { background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-border)' }
                  }
                >
                  {selectMode
                    ? picked && <Check size={20} strokeWidth={3} />
                    : a.status === 'in_repair' ? <Wrench size={18} /> : a.status === 'retired' ? <Truck size={18} /> : <QrCode size={18} />}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-[10px] font-mono-value font-semibold text-[var(--text-muted)]">{a.asset_code}</span>
                    <AssetStatusBadge status={a.status} />
                    <CoverageBadge asset={a} />
                    {pmDueIds.has(a.id) && (
                      <span className="badge-pill inline-flex items-center gap-1" style={{ fontSize: 10, color: 'var(--color-warning)', background: 'rgba(234,179,8,0.10)', border: '1px solid rgba(234,179,8,0.30)', fontWeight: 700, letterSpacing: '0.03em', padding: '3px 8px' }}>
                        <Wrench size={9} /> PM due
                      </span>
                    )}
                  </div>
                  <h3 className="text-[14px] font-semibold text-[var(--text-primary)] truncate">{a.name}</h3>
                  <div className="flex items-center gap-3 flex-wrap mt-1 text-[11px] text-[var(--text-tertiary)]">
                    {a.category && <span>{a.category.name}</span>}
                    {a.store && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin size={10} className="text-[var(--accent)]" /> {a.store.store_name}
                      </span>
                    )}
                    {(a.make || a.model) && (
                      <span className="text-[var(--text-muted)]">{[a.make, a.model].filter(Boolean).join(' ')}</span>
                    )}
                  </div>
                </div>
                {!selectMode && <ChevronRight size={15} className="text-[var(--text-muted)] shrink-0 mt-3" />}
              </div>
            )

            const style = {
              animationDelay: `${Math.min(i, 10) * 40}ms`,
              textDecoration: 'none',
              borderRadius: 16,
              ...(picked ? { borderColor: 'var(--accent)', background: 'var(--accent-dim)' } : null),
            }

            return selectMode ? (
              <button
                key={a.id}
                type="button"
                aria-pressed={picked}
                onClick={() => toggleOne(a.id)}
                className="glass block w-full text-left animate-fadeInUp"
                style={style}
              >
                {body}
              </button>
            ) : (
              <Link
                key={a.id}
                href={`/assets/view?id=${a.id}`}
                className="glass glass-interactive block animate-fadeInUp"
                style={style}
              >
                {body}
              </Link>
            )
          })}
        </div>
      )}

      {/* Bulk action bar — floats clear of the mobile tab bar */}
      {selectMode && (
        <div className="fixed left-0 right-0 z-[55] px-4 lg:px-10 bottom-[calc(env(safe-area-inset-bottom)+74px)] lg:bottom-6 pointer-events-none">
          <div
            className="max-w-[560px] mx-auto rounded-2xl px-3 py-2.5 flex items-center gap-2 pointer-events-auto animate-fadeInUp"
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-primary)',
              boxShadow: '0 12px 36px rgba(0,0,0,0.35)',
            }}
          >
            <button
              onClick={toggleAllVisible}
              disabled={visible.length === 0}
              className="text-[11px] font-bold rounded-[10px] px-3 py-2 shrink-0 transition-colors"
              style={{
                color: 'var(--text-secondary)',
                background: 'var(--card-bg)',
                border: '1px solid var(--border-subtle)',
                opacity: visible.length === 0 ? 0.5 : 1,
              }}
            >
              {allVisibleSelected ? 'Clear' : 'All'}
            </button>
            <span className="text-[12px] font-semibold flex-1 min-w-0 truncate text-[var(--text-secondary)]">
              {selectedVisible.length} selected
            </span>
            <button
              onClick={() => { tapLight(); setBulkErr(''); setConfirmBulk(true) }}
              disabled={selectedVisible.length === 0}
              className="text-[12px] font-bold rounded-[10px] px-3.5 py-2 shrink-0 inline-flex items-center gap-1.5 transition-colors"
              style={{
                color: selectedVisible.length === 0 ? 'var(--text-muted)' : '#fff',
                background: selectedVisible.length === 0 ? 'var(--card-bg)' : 'var(--color-danger)',
                border: `1px solid ${selectedVisible.length === 0 ? 'var(--border-subtle)' : 'var(--color-danger)'}`,
              }}
            >
              <Trash2 size={13} /> Delete
            </button>
          </div>
        </div>
      )}

      {/* Errors survive the modal closing, so surface them as a toast */}
      {bulkErr && !confirmBulk && (
        <div className="fixed left-0 right-0 z-[56] px-4 lg:px-10 bottom-[calc(env(safe-area-inset-bottom)+140px)] lg:bottom-24 pointer-events-none">
          <div
            className="max-w-[560px] mx-auto rounded-xl px-3.5 py-2.5 text-[11px] font-semibold text-center pointer-events-auto"
            style={{
              background: 'rgba(239,68,68,0.10)',
              border: '1px solid rgba(239,68,68,0.30)',
              color: 'var(--color-danger)',
              backdropFilter: 'blur(8px)',
            }}
            onClick={() => setBulkErr('')}
          >
            {bulkErr}
          </div>
        </div>
      )}

      {/* Confirm bulk delete */}
      {confirmBulk && (
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-4">
          <button
            aria-label="Cancel"
            className="absolute inset-0"
            style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)' }}
            onClick={() => { if (!deleting) setConfirmBulk(false) }}
          />
          <div
            className="relative w-full max-w-[420px] rounded-2xl p-5 animate-fadeInUp"
            style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}
          >
            <div
              className="w-11 h-11 rounded-[12px] flex items-center justify-center mx-auto mb-3"
              style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.25)', color: 'var(--color-danger)' }}
            >
              <Trash2 size={19} />
            </div>
            <p className="text-[14px] font-bold text-center text-[var(--text-primary)] mb-1.5">
              Delete {selectedVisible.length} {selectedVisible.length === 1 ? 'asset' : 'assets'}?
            </p>
            <p className="text-[11px] leading-relaxed text-center text-[var(--text-muted)] mb-4">
              This cannot be undone. Their QR codes stop resolving and their maintenance
              schedules are removed. Past tickets stay — just unlinked from these assets.
            </p>

            <div className="max-h-[132px] overflow-y-auto rounded-[10px] mb-4" style={{ border: '1px solid var(--border-subtle)' }}>
              {selectedVisible.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center gap-2 px-3 py-2 text-[11px]"
                  style={{ borderBottom: '1px solid var(--border-subtle)' }}
                >
                  <span className="font-mono-value text-[var(--text-muted)] shrink-0">{a.asset_code}</span>
                  <span className="truncate text-[var(--text-secondary)]">{a.name}</span>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setConfirmBulk(false)}
                disabled={deleting}
                className="flex-1 text-[12px] font-semibold rounded-[10px] py-2.5"
                style={{
                  color: 'var(--text-secondary)',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                Cancel
              </button>
              <button
                onClick={deleteSelected}
                disabled={deleting}
                className="flex-1 text-[12px] font-bold rounded-[10px] py-2.5"
                style={{ color: '#fff', background: 'var(--color-danger)', opacity: deleting ? 0.6 : 1 }}
              >
                {deleting ? 'Deleting…' : `Delete ${selectedVisible.length}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  )
}
