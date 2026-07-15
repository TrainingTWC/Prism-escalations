'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { AppShell } from '@/components/layout/AppShell'
import { GlassPanel } from '@/components/ui/GlassPanel'
import { Button, ButtonLink } from '@/components/ui/Button'
import { supabase } from '@/lib/supabase/client'
import { useAuthStore } from '@/store/auth.store'
import { canManageAssets } from '@/lib/asset-utils'
import { buzzSuccess, tapMedium } from '@/lib/native/haptics'
import type { Asset, AssetCategory, Store, Vendor } from '@/lib/supabase/database.types'
import { ArrowLeft, AlertCircle, Plus, X } from 'lucide-react'

const EMPTY_FORM = {
  name: '',
  category_id: '',
  store_id: '',
  make: '',
  model: '',
  serial_no: '',
  purchase_date: '',
  warranty_until: '',
  amc_vendor_id: '',
  amc_until: '',
  notes: '',
}

function AssetFormInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const editId = searchParams.get('id')
  const { profile } = useAuthStore()

  const [categories, setCategories] = useState<AssetCategory[]>([])
  const [stores, setStores] = useState<Store[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Inline "add vendor" mini-form
  const [addingVendor, setAddingVendor] = useState(false)
  const [vendorForm, setVendorForm] = useState({ name: '', phone: '', email: '', sla_hours: '' })
  const [vendorSaving, setVendorSaving] = useState(false)

  useEffect(() => {
    supabase.from('asset_categories').select('*').order('name').then(({ data }) => setCategories(data || []))
    supabase.from('stores').select('*').order('store_name').then(({ data }) => setStores(data || []))
    supabase.from('vendors').select('*').eq('is_active', true).order('name').then(({ data }) => setVendors(data || []))
  }, [])

  // Pre-select the manager's own store for new assets
  useEffect(() => {
    if (!editId && profile?.store_id) setForm((f) => ({ ...f, store_id: f.store_id || profile.store_id! }))
  }, [profile, editId])

  // Load asset when editing
  useEffect(() => {
    if (!editId) return
    supabase.from('assets').select('*').eq('id', editId).maybeSingle().then(({ data }) => {
      const a = data as unknown as Asset | null
      if (!a) return
      setForm({
        name: a.name,
        category_id: a.category_id,
        store_id: a.store_id,
        make: a.make ?? '',
        model: a.model ?? '',
        serial_no: a.serial_no ?? '',
        purchase_date: a.purchase_date ?? '',
        warranty_until: a.warranty_until ?? '',
        amc_vendor_id: a.amc_vendor_id ?? '',
        amc_until: a.amc_until ?? '',
        notes: a.notes ?? '',
      })
    })
  }, [editId])

  const saveVendor = async () => {
    if (!vendorForm.name.trim() || vendorSaving) return
    setVendorSaving(true)
    const { data, error: err } = await supabase
      .from('vendors')
      .insert({
        name: vendorForm.name.trim(),
        phone: vendorForm.phone || null,
        email: vendorForm.email || null,
        sla_hours: vendorForm.sla_hours ? Number(vendorForm.sla_hours) : null,
      } as never)
      .select('*')
      .single()
    if (!err && data) {
      const v = data as unknown as Vendor
      setVendors((prev) => [...prev, v].sort((a, b) => a.name.localeCompare(b.name)))
      setForm((f) => ({ ...f, amc_vendor_id: v.id }))
      setAddingVendor(false)
      setVendorForm({ name: '', phone: '', email: '', sla_hours: '' })
    }
    setVendorSaving(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!profile || loading) return
    tapMedium()
    setLoading(true)
    setError('')

    const payload = {
      name: form.name.trim(),
      category_id: form.category_id,
      store_id: form.store_id,
      make: form.make || null,
      model: form.model || null,
      serial_no: form.serial_no || null,
      purchase_date: form.purchase_date || null,
      warranty_until: form.warranty_until || null,
      amc_vendor_id: form.amc_vendor_id || null,
      amc_until: form.amc_until || null,
      notes: form.notes || null,
    }

    if (editId) {
      const { error: err } = await supabase.from('assets').update(payload as never).eq('id', editId)
      if (err) { setError(err.message); setLoading(false); return }
      buzzSuccess()
      router.push(`/assets/view?id=${editId}`)
    } else {
      const { data, error: err } = await supabase
        .from('assets')
        .insert({ ...payload, created_by: profile.id } as never)
        .select('id')
        .single()
      if (err || !data) { setError(err?.message ?? 'Could not create the asset'); setLoading(false); return }
      buzzSuccess()
      router.push(`/assets/view?id=${(data as { id: string }).id}`)
    }
  }

  if (profile && !canManageAssets(profile)) {
    return (
      <AppShell overline="Assets" title="No access">
        <GlassPanel padding="lg" className="text-center">
          <p className="text-[13px] text-[var(--text-muted)]">
            Only store managers, area managers and leadership can register assets.
          </p>
        </GlassPanel>
      </AppShell>
    )
  }

  const labelClass = 'block text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-tertiary)] mb-2'

  return (
    <AppShell
      overline={editId ? 'Edit Asset' : 'New Asset'}
      title={editId ? 'Edit Asset' : 'Register Asset'}
      subtitle={editId ? 'Update the registry record.' : 'Register it once, print the QR label, and staff can report problems in seconds.'}
    >
      <div className="max-w-[680px]">
        <Link
          href={editId ? `/assets/view?id=${editId}` : '/assets'}
          className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors mb-5"
        >
          <ArrowLeft size={12} /> Back
        </Link>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <GlassPanel padding="md">
            <div className="mb-5">
              <label className={labelClass}>Asset name *</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. La Marzocco Linea — Bar 1"
                required
                autoFocus
                className="prism-input"
                style={{ fontSize: 15, padding: '13px 14px' }}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
              <div>
                <label className={labelClass}>Category *</label>
                <select
                  value={form.category_id}
                  onChange={(e) => setForm((f) => ({ ...f, category_id: e.target.value }))}
                  required
                  className="prism-input"
                >
                  <option value="">Select…</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass}>Store *</label>
                <select
                  value={form.store_id}
                  onChange={(e) => setForm((f) => ({ ...f, store_id: e.target.value }))}
                  required
                  className="prism-input"
                >
                  <option value="">Select…</option>
                  {stores.map((s) => <option key={s.id} value={s.id}>{s.store_name} ({s.store_code})</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
              <div>
                <label className={labelClass}>Make</label>
                <input type="text" value={form.make} onChange={(e) => setForm((f) => ({ ...f, make: e.target.value }))} placeholder="La Marzocco" className="prism-input" />
              </div>
              <div>
                <label className={labelClass}>Model</label>
                <input type="text" value={form.model} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))} placeholder="Linea PB" className="prism-input" />
              </div>
              <div>
                <label className={labelClass}>Serial no.</label>
                <input type="text" value={form.serial_no} onChange={(e) => setForm((f) => ({ ...f, serial_no: e.target.value }))} placeholder="SN-…" className="prism-input" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
              <div>
                <label className={labelClass}>Purchase date</label>
                <input type="date" value={form.purchase_date} onChange={(e) => setForm((f) => ({ ...f, purchase_date: e.target.value }))} className="prism-input" />
              </div>
              <div>
                <label className={labelClass}>Warranty until</label>
                <input type="date" value={form.warranty_until} onChange={(e) => setForm((f) => ({ ...f, warranty_until: e.target.value }))} className="prism-input" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
              <div>
                <label className={labelClass}>AMC vendor</label>
                <div className="flex gap-2">
                  <select
                    value={form.amc_vendor_id}
                    onChange={(e) => setForm((f) => ({ ...f, amc_vendor_id: e.target.value }))}
                    className="prism-input flex-1"
                  >
                    <option value="">No AMC</option>
                    {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                  <button
                    type="button"
                    aria-label="Add vendor"
                    onClick={() => setAddingVendor((v) => !v)}
                    className="w-10 shrink-0 rounded-[8px] flex items-center justify-center"
                    style={{
                      background: addingVendor ? 'var(--accent-dim)' : 'var(--bg-tertiary)',
                      border: `1px solid ${addingVendor ? 'var(--accent)' : 'var(--border-subtle)'}`,
                      color: addingVendor ? 'var(--accent)' : 'var(--text-tertiary)',
                    }}
                  >
                    {addingVendor ? <X size={14} /> : <Plus size={14} />}
                  </button>
                </div>
              </div>
              <div>
                <label className={labelClass}>AMC until</label>
                <input type="date" value={form.amc_until} onChange={(e) => setForm((f) => ({ ...f, amc_until: e.target.value }))} className="prism-input" />
              </div>
            </div>

            {addingVendor && (
              <div
                className="mb-5 p-4 rounded-[12px]"
                style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--accent-border)' }}
              >
                <p className="text-[11px] font-bold uppercase tracking-[0.10em] text-[var(--accent)] mb-3">New vendor</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input type="text" value={vendorForm.name} onChange={(e) => setVendorForm((v) => ({ ...v, name: e.target.value }))} placeholder="Vendor name *" className="prism-input" />
                  <input type="tel" value={vendorForm.phone} onChange={(e) => setVendorForm((v) => ({ ...v, phone: e.target.value }))} placeholder="Phone" className="prism-input" />
                  <input type="email" value={vendorForm.email} onChange={(e) => setVendorForm((v) => ({ ...v, email: e.target.value }))} placeholder="Email" className="prism-input" />
                  <input type="number" min="1" value={vendorForm.sla_hours} onChange={(e) => setVendorForm((v) => ({ ...v, sla_hours: e.target.value }))} placeholder="SLA (hours)" className="prism-input" />
                </div>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  disabled={vendorSaving || !vendorForm.name.trim()}
                  onClick={saveVendor}
                  className="mt-3"
                >
                  {vendorSaving ? 'Saving…' : 'Save vendor'}
                </Button>
              </div>
            )}

            <div>
              <label className={labelClass}>Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Location in store, quirks, install details…"
                rows={3}
                className="prism-input"
                style={{ resize: 'vertical' }}
              />
            </div>
          </GlassPanel>

          {error && (
            <div
              className="flex items-center gap-2 px-3.5 py-2.5 rounded-lg"
              style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.20)' }}
            >
              <AlertCircle size={14} className="text-[var(--color-danger)] shrink-0" />
              <span className="text-[12px] text-[var(--color-danger)]">{error}</span>
            </div>
          )}

          <div className="flex gap-3">
            <Button type="submit" disabled={loading} variant="primary" className="flex-1 justify-center" style={{ padding: '13px 18px', fontSize: 14 }}>
              {loading ? 'Saving…' : editId ? 'Save changes' : 'Register asset'}
            </Button>
            <ButtonLink href={editId ? `/assets/view?id=${editId}` : '/assets'} variant="ghost">Cancel</ButtonLink>
          </div>
        </form>
      </div>
    </AppShell>
  )
}

export default function AssetFormPage() {
  return (
    <Suspense fallback={
      <AppShell overline="Assets" title="Loading…">
        <div className="skeleton" style={{ height: 400 }} />
      </AppShell>
    }>
      <AssetFormInner />
    </Suspense>
  )
}
