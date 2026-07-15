'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { AppShell } from '@/components/layout/AppShell'
import { GlassPanel } from '@/components/ui/GlassPanel'
import { Button } from '@/components/ui/Button'
import { supabase } from '@/lib/supabase/client'
import { useAuthStore } from '@/store/auth.store'
import { canManageAssets } from '@/lib/asset-utils'
import { parseCsv, downloadCsv } from '@/lib/csv'
import type { Vendor } from '@/lib/supabase/database.types'
import {
  ArrowLeft, Plus, Phone, Mail, Clock, Handshake, Ban, RotateCcw,
  AlertCircle, Upload, Download, CheckCircle2, AlertTriangle, X,
} from 'lucide-react'

const EMPTY = { name: '', contact_name: '', phone: '', email: '', sla_hours: '', notes: '' }

const CSV_HEADER = 'name,contact_name,phone,email,sla_hours,notes'
const CSV_EXAMPLE = 'Fraluma Services,Rakesh Nair,+919876543210,service@fraluma.in,48,La Marzocco AMC partner — South'

interface VendorImportRow {
  line: number
  name: string
  contact_name: string
  phone: string
  email: string
  sla_hours: string
  notes: string
  problem?: string
}

export default function VendorsPage() {
  const { profile } = useAuthStore()
  const canEdit = canManageAssets(profile) || profile?.role === 'dept_owner'

  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ ...EMPTY })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Bulk import
  const [showImport, setShowImport] = useState(false)
  const [importRows, setImportRows] = useState<VendorImportRow[]>([])
  const [importFileName, setImportFileName] = useState('')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ ok: number; failed: number } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const fetchVendors = useCallback(async () => {
    const { data } = await supabase.from('vendors').select('*').order('name')
    setVendors((data as unknown as Vendor[]) || [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchVendors() }, [fetchVendors])

  const handleImportFile = async (file: File | null) => {
    if (!file) return
    setImportFileName(file.name)
    setImportResult(null)
    const parsed = parseCsv(await file.text())
    if (parsed.length < 2) { setImportRows([]); return }

    const header = parsed[0].map((h) => h.toLowerCase().trim())
    const idx = (c: string) => header.indexOf(c)
    const iName = idx('name'), iContact = idx('contact_name'), iPhone = idx('phone')
    const iEmail = idx('email'), iSla = idx('sla_hours'), iNotes = idx('notes')

    const rows: VendorImportRow[] = parsed.slice(1).map((cells, n) => {
      const get = (i: number) => (i >= 0 ? (cells[i] ?? '').trim() : '')
      const r: VendorImportRow = {
        line: n + 2,
        name: get(iName),
        contact_name: get(iContact),
        phone: get(iPhone),
        email: get(iEmail),
        sla_hours: get(iSla),
        notes: get(iNotes),
      }
      if (!r.name) r.problem = 'Missing name'
      else if (r.sla_hours && isNaN(Number(r.sla_hours))) r.problem = 'SLA must be a number'
      return r
    })
    setImportRows(rows)
  }

  const runImport = async () => {
    const valid = importRows.filter((r) => !r.problem)
    if (valid.length === 0 || importing) return
    setImporting(true)
    let ok = 0, failed = 0
    for (let i = 0; i < valid.length; i += 50) {
      const batch = valid.slice(i, i + 50).map((r) => ({
        name: r.name,
        contact_name: r.contact_name || null,
        phone: r.phone || null,
        email: r.email || null,
        sla_hours: r.sla_hours ? Number(r.sla_hours) : null,
        notes: r.notes || null,
      }))
      const { error: err } = await supabase.from('vendors').insert(batch as never)
      if (err) failed += batch.length
      else ok += batch.length
    }
    setImportResult({ ok, failed })
    setImportRows([])
    setImportFileName('')
    setImporting(false)
    if (ok > 0) await fetchVendors()
  }

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
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => { setShowImport((v) => !v); setShowForm(false) }}>
              <Upload size={13} /> Import CSV
            </Button>
            <Button variant="primary" size="sm" onClick={() => { setShowForm((v) => !v); setShowImport(false) }}>
              <Plus size={13} /> Add vendor
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="max-w-[840px]">
        <Link href="/assets" className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors mb-5">
          <ArrowLeft size={12} /> All assets
        </Link>

        {showImport && (
          <GlassPanel padding="md" className="mb-4" title="Import vendors from CSV">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => { handleImportFile(e.target.files?.[0] ?? null); e.target.value = '' }}
            />
            <div className="flex items-center gap-2 flex-wrap mb-4">
              <Button variant="ghost" size="sm" onClick={() => downloadCsv('vendors-import-template.csv', CSV_HEADER, [CSV_EXAMPLE])}>
                <Download size={13} /> Download template
              </Button>
              <Button variant="primary" size="sm" onClick={() => fileRef.current?.click()}>
                <Upload size={13} /> Choose CSV
              </Button>
              {importFileName && <span className="text-[12px] text-[var(--text-muted)]">{importFileName}</span>}
              <button
                aria-label="Close"
                onClick={() => { setShowImport(false); setImportRows([]); setImportFileName(''); setImportResult(null) }}
                className="ml-auto w-8 h-8 rounded-md flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                <X size={15} />
              </button>
            </div>
            <p className="text-[11px] text-[var(--text-muted)] mb-3">
              Columns: <code className="font-mono-value text-[10px]">{CSV_HEADER}</code>. Only <b>name</b> is required.
            </p>

            {importRows.length > 0 && (() => {
              const valid = importRows.filter((r) => !r.problem)
              const invalid = importRows.filter((r) => r.problem)
              return (
                <>
                  {invalid.length > 0 && (
                    <div className="mb-3 flex flex-col gap-1.5">
                      {invalid.slice(0, 6).map((r) => (
                        <div key={r.line} className="flex items-center gap-2 px-3 py-2 rounded-[8px] text-[12px]"
                             style={{ background: 'rgba(234,179,8,0.07)', border: '1px solid rgba(234,179,8,0.22)' }}>
                          <AlertTriangle size={12} className="shrink-0" style={{ color: 'var(--color-warning)' }} />
                          <span className="text-[var(--text-secondary)]">Line {r.line}: {r.problem} — will be skipped</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="overflow-x-auto rounded-[10px]" style={{ border: '1px solid var(--border-subtle)' }}>
                    <table className="w-full text-[12px]" style={{ borderCollapse: 'collapse', minWidth: 480 }}>
                      <thead>
                        <tr style={{ background: 'var(--bg-tertiary)' }}>
                          {['Name', 'Contact', 'Phone', 'SLA'].map((h) => (
                            <th key={h} className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--text-muted)]">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {valid.slice(0, 15).map((r) => (
                          <tr key={r.line} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                            <td className="px-3 py-2 text-[var(--text-primary)] font-semibold">{r.name}</td>
                            <td className="px-3 py-2 text-[var(--text-secondary)]">{r.contact_name || '—'}</td>
                            <td className="px-3 py-2 text-[var(--text-muted)]">{r.phone || '—'}</td>
                            <td className="px-3 py-2 text-[var(--text-muted)]">{r.sla_hours ? `${r.sla_hours}h` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {valid.length > 15 && <p className="text-[11px] text-[var(--text-muted)] mt-2">Showing 15 of {valid.length} rows.</p>}
                  <Button variant="primary" disabled={importing || valid.length === 0} onClick={runImport} className="w-full justify-center mt-4" style={{ padding: '11px 16px', fontSize: 13 }}>
                    {importing ? 'Importing…' : `Import ${valid.length} vendor${valid.length === 1 ? '' : 's'}`}
                  </Button>
                </>
              )
            })()}

            {importResult && (
              <div className="flex items-center gap-3 mt-4 px-3.5 py-3 rounded-[10px]" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)' }}>
                <CheckCircle2 size={18} style={{ color: importResult.failed ? 'var(--color-warning)' : 'var(--color-success)' }} />
                <p className="text-[13px] font-semibold text-[var(--text-primary)]">
                  {importResult.ok} imported{importResult.failed ? `, ${importResult.failed} failed` : ''}
                </p>
              </div>
            )}
          </GlassPanel>
        )}

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
