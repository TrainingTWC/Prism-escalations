'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AppShell } from '@/components/layout/AppShell'
import { GlassPanel } from '@/components/ui/GlassPanel'
import { AssetStatusBadge, CoverageBadge } from '@/components/assets/AssetBadges'
import { supabase } from '@/lib/supabase/client'
import { useAuthStore } from '@/store/auth.store'
import { canManageAssets } from '@/lib/asset-utils'
import { tapLight } from '@/lib/native/haptics'
import type { AssetWithRelations } from '@/lib/supabase/database.types'
import { QrCode, Plus, Printer, Upload, MapPin, ChevronRight, Search, Wrench, Truck } from 'lucide-react'

type QuickFilter = 'all' | 'active' | 'pm_due' | 'in_repair' | 'no_coverage' | 'retired'

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

  const [assets, setAssets] = useState<AssetWithRelations[]>([])
  const [pmDueIds, setPmDueIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [quick, setQuick] = useState<QuickFilter>('all')
  const [search, setSearch] = useState('')
  const [storeFilter, setStoreFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')

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

  return (
    <AppShell
      overline="Asset Registry"
      title="Assets"
      subtitle={`${visible.length} ${visible.length === 1 ? 'asset' : 'assets'} in your scope`}
      actions={
        manager ? (
          <div className="flex items-center gap-2 flex-wrap">
            <Link href="/assets/import" className="btn-ghost" style={{ padding: '7px 13px', fontSize: 12 }}>
              <Upload size={13} /> Import CSV
            </Link>
            <Link href="/assets/labels" className="btn-ghost" style={{ padding: '7px 13px', fontSize: 12 }}>
              <Printer size={13} /> Print labels
            </Link>
            <Link href="/assets/new" className="btn-primary" style={{ padding: '7px 14px', fontSize: 12 }}>
              <Plus size={13} strokeWidth={2.5} /> Add asset
            </Link>
          </div>
        ) : undefined
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
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {visible.map((a, i) => (
            <Link
              key={a.id}
              href={`/assets/view?id=${a.id}`}
              className="glass glass-interactive block animate-fadeInUp"
              style={{ animationDelay: `${Math.min(i, 10) * 40}ms`, textDecoration: 'none', borderRadius: 16 }}
            >
              <div className="flex items-start gap-3.5 px-4 py-4">
                <span
                  className="w-11 h-11 rounded-[12px] flex items-center justify-center shrink-0 mt-0.5"
                  style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-border)' }}
                >
                  {a.status === 'in_repair' ? <Wrench size={18} /> : a.status === 'retired' ? <Truck size={18} /> : <QrCode size={18} />}
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
                <ChevronRight size={15} className="text-[var(--text-muted)] shrink-0 mt-3" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  )
}
