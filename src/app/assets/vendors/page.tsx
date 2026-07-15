'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { AppShell } from '@/components/layout/AppShell'
import { GlassPanel } from '@/components/ui/GlassPanel'
import { Button } from '@/components/ui/Button'
import { supabase } from '@/lib/supabase/client'
import { useAuthStore } from '@/store/auth.store'
import { canManageAssets } from '@/lib/asset-utils'
import type { Vendor } from '@/lib/supabase/database.types'
import { ArrowLeft, Plus, Phone, Mail, Clock, Handshake, Ban, RotateCcw, AlertCircle } from 'lucide-react'

const EMPTY = { name: '', contact_name: '', phone: '', email: '', sla_hours: '', notes: '' }

export default function VendorsPage() {
  const { profile } = useAuthStore()
  const canEdit = canManageAssets(profile) || profile?.role === 'dept_owner'

  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ ...EMPTY })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const fetchVendors = useCallback(async () => {
    const { data } = await supabase.from('vendors').select('*').order('name')
    setVendors((data as unknown as Vendor[]) || [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchVendors() }, [fetchVendors])

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim() || saving) return
    setSaving(true)
    setError('')
    const { error: err } = await supabase.from('vendors').insert({
      name: form.name.trim(),
      contact_name: form.contact_name || null,
      phone: form.phone || null,
      email: form.email || null,
      sla_hours: form.sla_hours ? Number(form.sla_hours) : null,
      notes: form.notes || null,
    } as never)
    if (err) setError(err.message)
    else {
      setForm({ ...EMPTY })
      setShowForm(false)
      await fetchVendors()
    }
    setSaving(false)
  }

  const toggleActive = async (v: Vendor) => {
    await supabase.from('vendors').update({ is_active: !v.is_active } as never).eq('id', v.id)
    await fetchVendors()
  }

  const labelClass = 'block text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-tertiary)] mb-2'

  return (
    <AppShell
      overline="Service Partners"
      title="Vendors"
      subtitle="AMC and service vendors — attached to assets so warranty work routes to the right people."
      actions={
        canEdit ? (
          <Button variant="primary" size="sm" onClick={() => setShowForm((v) => !v)}>
            <Plus size={13} /> Add vendor
          </Button>
        ) : undefined
      }
    >
      <div className="max-w-[840px]">
        <Link href="/assets" className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors mb-5">
          <ArrowLeft size={12} /> All assets
        </Link>

        {showForm && (
          <GlassPanel padding="md" className="mb-4" title="New vendor">
            <form onSubmit={save} className="flex flex-col gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Vendor name *</label>
                  <input type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required className="prism-input" placeholder="e.g. Fraluma Services" />
                </div>
                <div>
                  <label className={labelClass}>Contact person</label>
                  <input type="text" value={form.contact_name} onChange={(e) => setForm((f) => ({ ...f, contact_name: e.target.value }))} className="prism-input" />
                </div>
                <div>
                  <label className={labelClass}>Phone</label>
                  <input type="tel" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} className="prism-input" />
                </div>
                <div>
                  <label className={labelClass}>Email</label>
                  <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className="prism-input" />
                </div>
                <div>
                  <label className={labelClass}>Contracted SLA (hours)</label>
                  <input type="number" min="1" value={form.sla_hours} onChange={(e) => setForm((f) => ({ ...f, sla_hours: e.target.value }))} className="prism-input" placeholder="e.g. 48" />
                </div>
                <div>
                  <label className={labelClass}>Notes</label>
                  <input type="text" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="prism-input" placeholder="Coverage, escalation contact…" />
                </div>
              </div>
              {error && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.20)' }}>
                  <AlertCircle size={13} className="text-[var(--color-danger)] shrink-0" />
                  <span className="text-[11px] text-[var(--color-danger)]">{error}</span>
                </div>
              )}
              <div className="flex gap-2">
                <Button type="submit" variant="primary" disabled={saving || !form.name.trim()}>
                  {saving ? 'Saving…' : 'Save vendor'}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
              </div>
            </form>
          </GlassPanel>
        )}

        {loading ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 84 }} />)}
          </div>
        ) : vendors.length === 0 ? (
          <GlassPanel padding="lg" className="text-center">
            <Handshake size={32} className="mx-auto mb-4 text-[var(--text-muted)]" />
            <p className="text-[14px] font-semibold text-[var(--text-secondary)] mb-1">No vendors yet</p>
            <p className="text-xs text-[var(--text-muted)]">Add AMC and service partners here, then attach them to assets.</p>
          </GlassPanel>
        ) : (
          <div className="flex flex-col gap-2.5">
            {vendors.map((v) => (
              <GlassPanel key={v.id} padding="sm">
                <div className="flex items-center gap-3.5">
                  <span
                    className="w-10 h-10 rounded-[11px] flex items-center justify-center shrink-0"
                    style={{
                      background: v.is_active ? 'var(--accent-dim)' : 'var(--bg-tertiary)',
                      color: v.is_active ? 'var(--accent)' : 'var(--text-muted)',
                    }}
                  >
                    <Handshake size={17} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-semibold text-[var(--text-primary)] truncate">
                      {v.name}
                      {!v.is_active && <span className="ml-2 text-[10px] font-bold uppercase text-[var(--text-muted)]">Inactive</span>}
                    </p>
                    <div className="flex items-center gap-3.5 flex-wrap mt-1 text-[11px] text-[var(--text-tertiary)]">
                      {v.contact_name && <span>{v.contact_name}</span>}
                      {v.phone && (
                        <a href={`tel:${v.phone}`} className="inline-flex items-center gap-1 text-[var(--accent)]">
                          <Phone size={10} /> {v.phone}
                        </a>
                      )}
                      {v.email && (
                        <a href={`mailto:${v.email}`} className="inline-flex items-center gap-1 text-[var(--accent)]">
                          <Mail size={10} /> {v.email}
                        </a>
                      )}
                      {v.sla_hours != null && (
                        <span className="inline-flex items-center gap-1">
                          <Clock size={10} /> {v.sla_hours} hr SLA
                        </span>
                      )}
                    </div>
                    {v.notes && <p className="text-[11px] text-[var(--text-muted)] mt-1 truncate">{v.notes}</p>}
                  </div>
                  {canEdit && (
                    <button
                      onClick={() => toggleActive(v)}
                      title={v.is_active ? 'Deactivate' : 'Reactivate'}
                      className="shrink-0 w-8 h-8 rounded-md flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                    >
                      {v.is_active ? <Ban size={14} /> : <RotateCcw size={14} />}
                    </button>
                  )}
                </div>
              </GlassPanel>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  )
}
