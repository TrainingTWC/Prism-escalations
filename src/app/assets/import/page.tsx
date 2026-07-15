'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AppShell } from '@/components/layout/AppShell'
import { GlassPanel } from '@/components/ui/GlassPanel'
import { Button } from '@/components/ui/Button'
import { supabase } from '@/lib/supabase/client'
import { useAuthStore } from '@/store/auth.store'
import { canManageAssets } from '@/lib/asset-utils'
import { parseCsv, downloadCsv } from '@/lib/csv'
import { buzzSuccess } from '@/lib/native/haptics'
import type { AssetCategory, Store } from '@/lib/supabase/database.types'
import { ArrowLeft, Upload, Download, CheckCircle2, AlertTriangle } from 'lucide-react'

const TEMPLATE_HEADER = 'name,category,store_code,make,model,serial_no,purchase_date,warranty_until'
const TEMPLATE_EXAMPLE = 'La Marzocco Linea — Bar 1,Espresso Machine,IND-001,La Marzocco,Linea PB,SN12345,2025-04-01,2027-04-01'

interface ParsedRow {
  line: number
  name: string
  categoryName: string
  storeCode: string
  make: string
  model: string
  serial_no: string
  purchase_date: string
  warranty_until: string
  categoryId?: string
  storeId?: string
  problem?: string
}

export default function AssetImportPage() {
  const router = useRouter()
  const { profile } = useAuthStore()
  const fileRef = useRef<HTMLInputElement>(null)

  const [categories, setCategories] = useState<AssetCategory[]>([])
  const [stores, setStores] = useState<Store[]>([])
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [fileName, setFileName] = useState('')
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ ok: number; failed: number } | null>(null)

  useEffect(() => {
    supabase.from('asset_categories').select('*').then(({ data }) => setCategories(data || []))
    supabase.from('stores').select('*').then(({ data }) => setStores(data || []))
  }, [])

  const catByName = useMemo(
    () => new Map(categories.map((c) => [c.name.toLowerCase().trim(), c.id])),
    [categories],
  )
  const storeByCode = useMemo(
    () => new Map(stores.map((s) => [s.store_code.toLowerCase().trim(), s.id])),
    [stores],
  )

  const downloadTemplate = () => downloadCsv('assets-import-template.csv', TEMPLATE_HEADER, [TEMPLATE_EXAMPLE])

  const handleFile = async (file: File | null) => {
    if (!file) return
    setFileName(file.name)
    setResult(null)
    const text = await file.text()
    const parsed = parseCsv(text)
    if (parsed.length < 2) { setRows([]); return }

    const header = parsed[0].map((h) => h.toLowerCase().trim())
    const idx = (col: string) => header.indexOf(col)
    const iName = idx('name'), iCat = idx('category'), iStore = idx('store_code')
    const iMake = idx('make'), iModel = idx('model'), iSerial = idx('serial_no')
    const iPurchase = idx('purchase_date'), iWarranty = idx('warranty_until')

    const out: ParsedRow[] = parsed.slice(1).map((cells, n) => {
      const get = (i: number) => (i >= 0 ? (cells[i] ?? '').trim() : '')
      const r: ParsedRow = {
        line: n + 2,
        name: get(iName),
        categoryName: get(iCat),
        storeCode: get(iStore),
        make: get(iMake),
        model: get(iModel),
        serial_no: get(iSerial),
        purchase_date: get(iPurchase),
        warranty_until: get(iWarranty),
      }
      r.categoryId = catByName.get(r.categoryName.toLowerCase())
      r.storeId = storeByCode.get(r.storeCode.toLowerCase())
      if (!r.name) r.problem = 'Missing name'
      else if (!r.categoryId) r.problem = `Unknown category "${r.categoryName}"`
      else if (!r.storeId) r.problem = `Unknown store code "${r.storeCode}"`
      else if (r.purchase_date && isNaN(Date.parse(r.purchase_date))) r.problem = 'Bad purchase_date (use YYYY-MM-DD)'
      else if (r.warranty_until && isNaN(Date.parse(r.warranty_until))) r.problem = 'Bad warranty_until (use YYYY-MM-DD)'
      return r
    })
    setRows(out)
  }

  const valid = rows.filter((r) => !r.problem)
  const invalid = rows.filter((r) => r.problem)

  const runImport = async () => {
    if (!profile || valid.length === 0 || importing) return
    setImporting(true)
    let ok = 0, failed = 0
    // Insert in batches of 50
    for (let i = 0; i < valid.length; i += 50) {
      const batch = valid.slice(i, i + 50).map((r) => ({
        name: r.name,
        category_id: r.categoryId!,
        store_id: r.storeId!,
        make: r.make || null,
        model: r.model || null,
        serial_no: r.serial_no || null,
        purchase_date: r.purchase_date || null,
        warranty_until: r.warranty_until || null,
        created_by: profile.id,
      }))
      const { error } = await supabase.from('assets').insert(batch as never)
      if (error) failed += batch.length
      else ok += batch.length
    }
    setResult({ ok, failed })
    setImporting(false)
    if (ok > 0) buzzSuccess()
  }

  if (profile && !canManageAssets(profile)) {
    return (
      <AppShell overline="Assets" title="No access">
        <GlassPanel padding="lg" className="text-center">
          <p className="text-[13px] text-[var(--text-muted)]">Only managers and leadership can import assets.</p>
        </GlassPanel>
      </AppShell>
    )
  }

  return (
    <AppShell
      overline="Bulk Onboarding"
      title="Import Assets"
      subtitle="Upload a CSV, review what will be created, import. Codes and QR labels are generated automatically."
    >
      <div className="max-w-[840px]">
        <Link href="/assets" className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors mb-5">
          <ArrowLeft size={12} /> All assets
        </Link>

        <GlassPanel padding="md" className="mb-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-[13px] font-semibold text-[var(--text-primary)]">1 · Get the template</p>
              <p className="text-[12px] text-[var(--text-muted)] mt-0.5">
                Columns: <code className="font-mono-value text-[11px]">{TEMPLATE_HEADER}</code>
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={downloadTemplate}>
              <Download size={13} /> Download template
            </Button>
          </div>
        </GlassPanel>

        <GlassPanel padding="md" className="mb-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-[13px] font-semibold text-[var(--text-primary)]">2 · Upload your file</p>
              <p className="text-[12px] text-[var(--text-muted)] mt-0.5">
                {fileName ? `Loaded: ${fileName}` : 'Category names and store codes must match the system.'}
              </p>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => { handleFile(e.target.files?.[0] ?? null); e.target.value = '' }}
            />
            <Button variant="primary" size="sm" onClick={() => fileRef.current?.click()}>
              <Upload size={13} /> Choose CSV
            </Button>
          </div>
        </GlassPanel>

        {rows.length > 0 && (
          <GlassPanel padding="md" className="mb-4" title={`3 · Review — ${valid.length} ready, ${invalid.length} with problems`}>
            {invalid.length > 0 && (
              <div className="mb-4 flex flex-col gap-1.5">
                {invalid.slice(0, 8).map((r) => (
                  <div key={r.line} className="flex items-center gap-2 px-3 py-2 rounded-[8px] text-[12px]"
                       style={{ background: 'rgba(234,179,8,0.07)', border: '1px solid rgba(234,179,8,0.22)' }}>
                    <AlertTriangle size={12} className="shrink-0" style={{ color: 'var(--color-warning)' }} />
                    <span className="text-[var(--text-secondary)]">Line {r.line}: {r.problem} — will be skipped</span>
                  </div>
                ))}
                {invalid.length > 8 && (
                  <p className="text-[11px] text-[var(--text-muted)] px-1">…and {invalid.length - 8} more with problems.</p>
                )}
              </div>
            )}

            <div className="overflow-x-auto rounded-[10px]" style={{ border: '1px solid var(--border-subtle)' }}>
              <table className="w-full text-[12px]" style={{ borderCollapse: 'collapse', minWidth: 560 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-tertiary)' }}>
                    {['Name', 'Category', 'Store', 'Make/Model', 'Warranty until'].map((h) => (
                      <th key={h} className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--text-muted)]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {valid.slice(0, 20).map((r) => (
                    <tr key={r.line} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                      <td className="px-3 py-2 text-[var(--text-primary)] font-semibold">{r.name}</td>
                      <td className="px-3 py-2 text-[var(--text-secondary)]">{r.categoryName}</td>
                      <td className="px-3 py-2 text-[var(--text-secondary)]">{r.storeCode}</td>
                      <td className="px-3 py-2 text-[var(--text-muted)]">{[r.make, r.model].filter(Boolean).join(' ') || '—'}</td>
                      <td className="px-3 py-2 text-[var(--text-muted)]">{r.warranty_until || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {valid.length > 20 && (
              <p className="text-[11px] text-[var(--text-muted)] mt-2">Showing first 20 of {valid.length} rows.</p>
            )}

            <div className="flex items-center gap-3 mt-5">
              <Button variant="primary" disabled={importing || valid.length === 0} onClick={runImport} className="flex-1 justify-center" style={{ padding: '12px 18px', fontSize: 14 }}>
                {importing ? 'Importing…' : `Import ${valid.length} asset${valid.length === 1 ? '' : 's'}`}
              </Button>
            </div>
          </GlassPanel>
        )}

        {result && (
          <GlassPanel padding="md">
            <div className="flex items-center gap-3">
              <CheckCircle2 size={20} style={{ color: result.failed ? 'var(--color-warning)' : 'var(--color-success)' }} />
              <div className="flex-1">
                <p className="text-[14px] font-semibold text-[var(--text-primary)]">
                  {result.ok} imported{result.failed ? `, ${result.failed} failed` : ''}
                </p>
                <p className="text-[12px] text-[var(--text-muted)]">Next: print the QR labels and stick them on the equipment.</p>
              </div>
              <Button variant="primary" size="sm" onClick={() => router.push('/assets/labels')}>Print labels</Button>
            </div>
          </GlassPanel>
        )}
      </div>
    </AppShell>
  )
}
