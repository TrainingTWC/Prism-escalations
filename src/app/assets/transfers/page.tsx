'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { AppShell } from '@/components/layout/AppShell'
import { GlassPanel } from '@/components/ui/GlassPanel'
import { Button } from '@/components/ui/Button'
import { supabase } from '@/lib/supabase/client'
import { useAuthStore } from '@/store/auth.store'
import { canManageAssets } from '@/lib/asset-utils'
import { buzzSuccess, tapLight } from '@/lib/native/haptics'
import type { Store, AssetWithRelations } from '@/lib/supabase/database.types'
import { formatDistanceToNow } from 'date-fns'
import { ArrowLeftRight, ArrowLeft, Plus, X, Truck, CheckCircle2, XCircle, PackageCheck } from 'lucide-react'

interface TransferRow {
  id: string
  asset_id: string
  from_store_id: string
  to_store_id: string
  status: string
  notes: string | null
  requested_at: string
  in_transit_at: string | null
  received_at: string | null
  cancelled_at: string | null
  asset: { name: string; asset_code: string } | null
  from_store: { store_name: string } | null
  to_store: { store_name: string } | null
}

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  requested:  { label: 'Requested',  color: 'var(--color-warning)', bg: 'rgba(234,179,8,0.10)' },
  in_transit: { label: 'In Transit', color: '#7C5CFF',              bg: 'rgba(124,92,255,0.10)' },
  received:   { label: 'Received',   color: 'var(--color-success)', bg: 'rgba(34,197,94,0.10)' },
  cancelled:  { label: 'Cancelled',  color: 'var(--text-muted)',    bg: 'var(--bg-tertiary)' },
}

function TransfersInner() {
  const searchParams = useSearchParams()
  const preselectAsset = searchParams.get('asset')
  const { profile } = useAuthStore()
  const manager = canManageAssets(profile)

  const [transfers, setTransfers] = useState<TransferRow[]>([])
  const [assets, setAssets] = useState<AssetWithRelations[]>([])
  const [stores, setStores] = useState<Store[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'active' | 'history'>('active')
  const [busyId, setBusyId] = useState<string | null>(null)

  const [adding, setAdding] = useState(!!preselectAsset)
  const [form, setForm] = useState({ asset_id: preselectAsset ?? '', to_store_id: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const fetchAll = useCallback(async () => {
    const { data: t } = await supabase
      .from('asset_transfers')
      .select('*, asset:assets(name, asset_code), from_store:stores!asset_transfers_from_store_id_fkey(store_name), to_store:stores!asset_transfers_to_store_id_fkey(store_name)')
      .order('requested_at', { ascending: false })
    setTransfers((t as unknown as TransferRow[]) || [])

    const { data: a } = await supabase
      .from('assets')
      .select('*, category:asset_categories(*), store:stores(*)')
      .neq('status', 'retired')
      .order('name')
    setAssets((a as unknown as AssetWithRelations[]) || [])

    const { data: s } = await supabase.from('stores').select('*').order('store_name')
    setStores((s as Store[]) || [])

    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const selectedAsset = useMemo(() => assets.find((a) => a.id === form.asset_id) ?? null, [assets, form.asset_id])

  const createTransfer = async () => {
    if (!selectedAsset || !form.to_store_id || !profile || saving) return
    if (selectedAsset.store_id === form.to_store_id) { setErr('Pick a different destination store.'); return }
    setSaving(true)
    setErr('')
    const { error } = await supabase.from('asset_transfers').insert({
      asset_id: selectedAsset.id,
      from_store_id: selectedAsset.store_id,
      to_store_id: form.to_store_id,
      notes: form.notes || null,
      requested_by: profile.id,
    } as never)
    if (error) { setErr(error.message); setSaving(false); return }
    buzzSuccess()
    setForm({ asset_id: '', to_store_id: '', notes: '' })
    setAdding(false)
    setSaving(false)
    await fetchAll()
  }

  const advance = async (t: TransferRow, status: string) => {
    if (busyId) return
    tapLight()
    setBusyId(t.id)
    await supabase.from('asset_transfers').update({ status } as never).eq('id', t.id)
    await fetchAll()
    setBusyId(null)
  }

  const active = transfers.filter((t) => t.status === 'requested' || t.status === 'in_transit')
  const history = transfers.filter((t) => t.status === 'received' || t.status === 'cancelled')
  const visible = tab === 'active' ? active : history

  return (
    <AppShell
      overline="Asset Registry"
      title="Transfers"
      subtitle={`${active.length} active transfer${active.length === 1 ? '' : 's'}`}
      actions={
        manager ? (
          <button onClick={() => setAdding((v) => !v)} className={adding ? 'btn-ghost' : 'btn-primary'} style={{ padding: '7px 14px', fontSize: 12 }}>
            {adding ? <X size={13} /> : <Plus size={13} strokeWidth={2.5} />} {adding ? 'Cancel' : 'Request transfer'}
          </button>
        ) : undefined
      }
    >
      <Link href="/assets" className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors mb-5">
        <ArrowLeft size={12} /> All assets
      </Link>

      {adding && (
        <GlassPanel padding="md" className="mb-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.10em] text-[var(--accent)] mb-3">New transfer request</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-tertiary)] mb-1.5">Asset (from your scope)</label>
              <select value={form.asset_id} onChange={(e) => setForm((f) => ({ ...f, asset_id: e.target.value }))} className="prism-input">
                <option value="">Select…</option>
                {assets.map((a) => (
                  <option key={a.id} value={a.id}>{a.asset_code} — {a.name}{a.store ? ` (${a.store.store_name})` : ''}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-tertiary)] mb-1.5">Send to store</label>
              <select value={form.to_store_id} onChange={(e) => setForm((f) => ({ ...f, to_store_id: e.target.value }))} className="prism-input">
                <option value="">Select…</option>
                {stores.filter((s) => s.id !== selectedAsset?.store_id).map((s) => (
                  <option key={s.id} value={s.id}>{s.store_name} ({s.store_code})</option>
                ))}
              </select>
            </div>
          </div>
          <textarea
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            placeholder="Why is this moving? (optional)"
            rows={2}
            className="prism-input mb-3"
            style={{ resize: 'vertical' }}
          />
          <p className="text-[10px] text-[var(--text-muted)] mb-3">
            Don&apos;t see the asset you need? Ask its store manager to request the send, or contact your Area Manager — you can only pick from assets already in your scope.
          </p>
          {err && <p className="text-[11px] text-[var(--color-danger)] mb-3">{err}</p>}
          <Button variant="primary" size="sm" disabled={saving || !form.asset_id || !form.to_store_id} onClick={createTransfer}>
            {saving ? 'Requesting…' : 'Request transfer'}
          </Button>
        </GlassPanel>
      )}

      <div className="flex gap-2 mb-4">
        {(['active', 'history'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setTab(v)}
            className="px-3.5 py-2 rounded-full text-[12px] font-bold transition-all"
            style={{
              background: tab === v ? 'var(--accent-dim)' : 'var(--card-bg)',
              border: `1px solid ${tab === v ? 'var(--accent)' : 'var(--border-subtle)'}`,
              color: tab === v ? 'var(--accent)' : 'var(--text-tertiary)',
            }}
          >
            {v === 'active' ? `Active (${active.length})` : `History (${history.length})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 90 }} />)}
        </div>
      ) : visible.length === 0 ? (
        <GlassPanel padding="lg" className="text-center">
          <ArrowLeftRight size={28} className="mx-auto mb-3 text-[var(--text-muted)]" />
          <p className="text-[13px] font-semibold text-[var(--text-secondary)]">
            {tab === 'active' ? 'No active transfers' : 'No completed transfers yet'}
          </p>
        </GlassPanel>
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((t) => {
            const meta = STATUS_META[t.status] ?? STATUS_META.requested
            return (
              <GlassPanel key={t.id} padding="md">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <span
                        className="badge-pill"
                        style={{ fontSize: 10, color: meta.color, background: meta.bg, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', padding: '3px 9px' }}
                      >
                        {meta.label}
                      </span>
                      <span className="text-[10px] font-mono-value text-[var(--text-muted)]">{t.asset?.asset_code}</span>
                    </div>
                    <p className="text-[13px] font-semibold text-[var(--text-primary)]">{t.asset?.name ?? 'Asset'}</p>
                    <p className="text-[11px] text-[var(--text-tertiary)] mt-1 inline-flex items-center gap-1.5">
                      {t.from_store?.store_name ?? '—'} <ArrowLeftRight size={10} /> {t.to_store?.store_name ?? '—'}
                    </p>
                    {t.notes && <p className="text-[11px] text-[var(--text-muted)] mt-1">{t.notes}</p>}
                    <p className="text-[10px] text-[var(--text-muted)] mt-1.5">
                      Requested {formatDistanceToNow(new Date(t.requested_at), { addSuffix: true })}
                    </p>
                  </div>

                  {manager && (t.status === 'requested' || t.status === 'in_transit') && (
                    <div className="flex gap-2 shrink-0">
                      {t.status === 'requested' && (
                        <button
                          disabled={busyId === t.id}
                          onClick={() => advance(t, 'in_transit')}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[9px] text-[12px] font-bold disabled:opacity-50"
                          style={{ color: '#7C5CFF', background: 'rgba(124,92,255,0.10)', border: '1px solid rgba(124,92,255,0.30)' }}
                        >
                          <Truck size={13} /> Ship
                        </button>
                      )}
                      {t.status === 'in_transit' && (
                        <button
                          disabled={busyId === t.id}
                          onClick={() => advance(t, 'received')}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[9px] text-[12px] font-bold disabled:opacity-50"
                          style={{ color: 'var(--color-success)', background: 'rgba(34,197,94,0.10)', border: '1px solid rgba(34,197,94,0.30)' }}
                        >
                          <PackageCheck size={13} /> Mark received
                        </button>
                      )}
                      <button
                        disabled={busyId === t.id}
                        onClick={() => advance(t, 'cancelled')}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[9px] text-[12px] font-bold disabled:opacity-50"
                        style={{ color: 'var(--color-danger)', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.20)' }}
                      >
                        <XCircle size={13} /> Cancel
                      </button>
                    </div>
                  )}
                  {t.status === 'received' && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-[var(--color-success)] font-semibold shrink-0">
                      <CheckCircle2 size={13} /> Arrived
                    </span>
                  )}
                </div>
              </GlassPanel>
            )
          })}
        </div>
      )}
    </AppShell>
  )
}

export default function TransfersPage() {
  return (
    <Suspense fallback={
      <AppShell overline="Asset Registry" title="Loading…">
        <div className="skeleton" style={{ height: 300 }} />
      </AppShell>
    }>
      <TransfersInner />
    </Suspense>
  )
}
