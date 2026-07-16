'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AppShell } from '@/components/layout/AppShell'
import { GlassPanel } from '@/components/ui/GlassPanel'
import { Button } from '@/components/ui/Button'
import { supabase } from '@/lib/supabase/client'
import { useAuthStore } from '@/store/auth.store'
import { canManageAssets } from '@/lib/asset-utils'
import { buzzSuccess, tapLight } from '@/lib/native/haptics'
import type { SparePart, AssetCategory, Store } from '@/lib/supabase/database.types'
import { ArrowLeft, Package, Plus, X, AlertTriangle, Search, Minus, PlusCircle, Trash2 } from 'lucide-react'

const EMPTY_FORM = { store_id: '', category_id: '', name: '', sku: '', qty_on_hand: '0', reorder_threshold: '0', notes: '' }

export default function SparePartsPage() {
  const { profile } = useAuthStore()
  const manager = canManageAssets(profile)

  const [parts, setParts] = useState<SparePart[]>([])
  const [categories, setCategories] = useState<AssetCategory[]>([])
  const [stores, setStores] = useState<Store[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [storeFilter, setStoreFilter] = useState('')
  const [lowOnly, setLowOnly] = useState(false)

  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    const { data: p } = await supabase.from('spare_parts').select('*').order('name')
    setParts((p as SparePart[]) || [])
    const { data: c } = await supabase.from('asset_categories').select('*').order('name')
    setCategories((c as AssetCategory[]) || [])
    const { data: s } = await supabase.from('stores').select('*').order('store_name')
    setStores((s as Store[]) || [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  useEffect(() => {
    if (!adding && profile?.store_id) setForm((f) => ({ ...f, store_id: f.store_id || profile.store_id! }))
  }, [adding, profile])

  const storeName = useMemo(() => {
    const m = new Map<string, string>()
    stores.forEach((s) => m.set(s.id, s.store_name))
    return m
  }, [stores])

  const visible = useMemo(() => parts.filter((p) => {
    if (storeFilter && p.store_id !== storeFilter) return false
    if (lowOnly && !(p.reorder_threshold != null && p.qty_on_hand <= p.reorder_threshold)) return false
    if (search) {
      const q = search.toLowerCase()
      const hay = `${p.name} ${p.sku ?? ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  }), [parts, search, storeFilter, lowOnly])

  const createPart = async () => {
    if (!form.name.trim() || !form.store_id || saving) return
    setSaving(true)
    setErr('')
    const { error } = await supabase.from('spare_parts').insert({
      store_id: form.store_id,
      category_id: form.category_id || null,
      name: form.name.trim(),
      sku: form.sku || null,
      qty_on_hand: Number(form.qty_on_hand) || 0,
      reorder_threshold: form.reorder_threshold ? Number(form.reorder_threshold) : 0,
      notes: form.notes || null,
    } as never)
    if (error) { setErr(error.message); setSaving(false); return }
    buzzSuccess()
    setForm({ ...EMPTY_FORM, store_id: form.store_id })
    setAdding(false)
    setSaving(false)
    await fetchAll()
  }

  const adjustQty = async (part: SparePart, delta: number) => {
    if (busyId) return
    tapLight()
    setBusyId(part.id)
    await supabase.from('spare_parts').update({ qty_on_hand: Math.max(0, part.qty_on_hand + delta) } as never).eq('id', part.id)
    await fetchAll()
    setBusyId(null)
  }

  const deletePart = async (id: string) => {
    setBusyId(id)
    await supabase.from('spare_parts').delete().eq('id', id)
    await fetchAll()
    setBusyId(null)
  }

  const lowCount = parts.filter((p) => p.reorder_threshold != null && p.qty_on_hand <= p.reorder_threshold).length

  return (
    <AppShell
      overline="Asset Registry"
      title="Spare Parts"
      subtitle={`${visible.length} ${visible.length === 1 ? 'part' : 'parts'} in your scope${lowCount ? ` · ${lowCount} low stock` : ''}`}
      actions={
        manager ? (
          <button onClick={() => setAdding((v) => !v)} className={adding ? 'btn-ghost' : 'btn-primary'} style={{ padding: '7px 14px', fontSize: 12 }}>
            {adding ? <X size={13} /> : <Plus size={13} strokeWidth={2.5} />} {adding ? 'Cancel' : 'Add part'}
          </button>
        ) : undefined
      }
    >
      <Link href="/assets" className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors mb-5">
        <ArrowLeft size={12} /> All assets
      </Link>

      {adding && (
        <GlassPanel padding="md" className="mb-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.10em] text-[var(--accent)] mb-3">New spare part</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-tertiary)] mb-1.5">Store *</label>
              <select value={form.store_id} onChange={(e) => setForm((f) => ({ ...f, store_id: e.target.value }))} className="prism-input">
                <option value="">Select…</option>
                {stores.map((s) => <option key={s.id} value={s.id}>{s.store_name} ({s.store_code})</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-tertiary)] mb-1.5">Equipment category</label>
              <select value={form.category_id} onChange={(e) => setForm((f) => ({ ...f, category_id: e.target.value }))} className="prism-input">
                <option value="">None</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <input type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Part name * (e.g. Group head gasket)" className="prism-input" />
            <input type="text" value={form.sku} onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))} placeholder="SKU (optional)" className="prism-input" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-tertiary)] mb-1.5">Qty on hand</label>
              <input type="number" min="0" value={form.qty_on_hand} onChange={(e) => setForm((f) => ({ ...f, qty_on_hand: e.target.value }))} className="prism-input" />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-tertiary)] mb-1.5">Reorder below</label>
              <input type="number" min="0" value={form.reorder_threshold} onChange={(e) => setForm((f) => ({ ...f, reorder_threshold: e.target.value }))} className="prism-input" />
            </div>
          </div>
          <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Notes (optional)" rows={2} className="prism-input mb-3" style={{ resize: 'vertical' }} />
          {err && <p className="text-[11px] text-[var(--color-danger)] mb-3">{err}</p>}
          <Button variant="primary" size="sm" disabled={saving || !form.name.trim() || !form.store_id} onClick={createPart}>
            {saving ? 'Adding…' : 'Add part'}
          </Button>
        </GlassPanel>
      )}

      <div className="flex gap-2 flex-wrap mb-5">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or SKU…" className="prism-input pl-9" />
        </div>
        {stores.length > 1 && (
          <select value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)} className="prism-input" style={{ width: 'auto', minWidth: 150, fontSize: 12 }}>
            <option value="">All stores</option>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.store_name}</option>)}
          </select>
        )}
        <button
          onClick={() => setLowOnly((v) => !v)}
          className="shrink-0 px-3.5 py-2 rounded-full text-[12px] font-bold transition-all inline-flex items-center gap-1.5"
          style={{
            background: lowOnly ? 'rgba(234,179,8,0.10)' : 'var(--card-bg)',
            border: `1px solid ${lowOnly ? 'var(--color-warning)' : 'var(--border-subtle)'}`,
            color: lowOnly ? 'var(--color-warning)' : 'var(--text-tertiary)',
          }}
        >
          <AlertTriangle size={12} /> Low stock
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 90 }} />)}
        </div>
      ) : visible.length === 0 ? (
        <GlassPanel padding="lg" className="text-center">
          <Package size={28} className="mx-auto mb-3 text-[var(--text-muted)]" />
          <p className="text-[13px] font-semibold text-[var(--text-secondary)]">
            {parts.length === 0 ? 'No spare parts tracked yet' : 'No parts match this filter'}
          </p>
        </GlassPanel>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {visible.map((p) => {
            const low = p.reorder_threshold != null && p.qty_on_hand <= p.reorder_threshold
            return (
              <GlassPanel key={p.id} padding="md">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-[var(--text-primary)] truncate">{p.name}</p>
                    <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
                      {storeName.get(p.store_id) ?? '—'}{p.sku ? ` · ${p.sku}` : ''}
                    </p>
                    {low && (
                      <span className="badge-pill inline-flex items-center gap-1 mt-1.5" style={{ fontSize: 9, color: 'var(--color-warning)', background: 'rgba(234,179,8,0.10)', fontWeight: 700, padding: '2px 7px' }}>
                        <AlertTriangle size={9} /> Reorder
                      </span>
                    )}
                  </div>
                  {manager && (
                    <button onClick={() => deletePart(p.id)} disabled={busyId === p.id} aria-label="Delete part" className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--color-danger)] transition-colors">
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
                <div className="flex items-center justify-between mt-3">
                  <span className="text-[11px] text-[var(--text-muted)]">On hand</span>
                  <div className="flex items-center gap-2">
                    <button disabled={busyId === p.id} onClick={() => adjustQty(p, -1)} className="w-7 h-7 rounded-full flex items-center justify-center disabled:opacity-50" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)' }}>
                      <Minus size={12} />
                    </button>
                    <span className="text-[15px] font-bold font-mono-value text-[var(--text-primary)] min-w-[24px] text-center">{p.qty_on_hand}</span>
                    <button disabled={busyId === p.id} onClick={() => adjustQty(p, 1)} className="w-7 h-7 rounded-full flex items-center justify-center disabled:opacity-50" style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', color: 'var(--accent)' }}>
                      <PlusCircle size={12} />
                    </button>
                  </div>
                </div>
              </GlassPanel>
            )
          })}
        </div>
      )}
    </AppShell>
  )
}
