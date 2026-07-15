'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import QRCode from 'qrcode'
import { supabase } from '@/lib/supabase/client'
import { assetScanUrl } from '@/lib/asset-utils'
import type { AssetWithRelations, Store } from '@/lib/supabase/database.types'
import { ArrowLeft, Printer } from 'lucide-react'

/**
 * Printable QR label sheets. 3 × 7 labels per A4 (Avery L7160-compatible,
 * 63.5 × 38.1 mm). Deliberately rendered WITHOUT the AppShell so the print
 * output is just labels; on-screen controls are hidden by @media print.
 */

interface LabelAsset extends AssetWithRelations {
  qr?: string
}

function LabelsInner() {
  const searchParams = useSearchParams()
  const singleId = searchParams.get('id')

  const [stores, setStores] = useState<Store[]>([])
  const [storeId, setStoreId] = useState('')
  const [assets, setAssets] = useState<LabelAsset[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('stores').select('*').order('store_name').then(({ data }) => setStores(data || []))
  }, [])

  const fetchAssets = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('assets')
      .select('*, category:asset_categories(*), store:stores(*)')
      .neq('status', 'retired')
      .order('asset_code')
    if (singleId) query = query.eq('id', singleId)
    else if (storeId) query = query.eq('store_id', storeId)
    const { data } = await query
    const rows = ((data as unknown as LabelAsset[]) || [])

    // Generate all QR data-URLs up front so print output is complete
    const withQr = await Promise.all(rows.map(async (a) => ({
      ...a,
      qr: await QRCode.toDataURL(assetScanUrl(a.asset_code), {
        width: 300, margin: 0, errorCorrectionLevel: 'M',
        color: { dark: '#000000', light: '#FFFFFF' },
      }).catch(() => ''),
    })))
    setAssets(withQr)
    setLoading(false)
  }, [singleId, storeId])

  useEffect(() => { fetchAssets() }, [fetchAssets])

  return (
    <div style={{ background: '#fff', minHeight: '100vh', color: '#111' }}>
      <style>{`
        .labels-controls { font-family: ui-sans-serif, system-ui, sans-serif; }
        .label-sheet {
          display: grid;
          grid-template-columns: repeat(3, 63.5mm);
          justify-content: center;
          gap: 0;
        }
        .qr-label {
          width: 63.5mm; height: 38.1mm;
          padding: 3mm;
          display: flex; align-items: center; gap: 3mm;
          border: 1px dashed #ccc;
          box-sizing: border-box;
          overflow: hidden;
          break-inside: avoid;
          page-break-inside: avoid;
          font-family: ui-sans-serif, system-ui, sans-serif;
        }
        .qr-label img { width: 26mm; height: 26mm; flex-shrink: 0; }
        .qr-label .txt { min-width: 0; }
        .qr-label .nm { font-size: 9pt; font-weight: 700; line-height: 1.15; color: #000;
                        display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
        .qr-label .cd { font-family: ui-monospace, monospace; font-size: 8pt; font-weight: 600; color: #333; margin-top: 1mm; }
        .qr-label .st { font-size: 6.5pt; color: #666; margin-top: 0.5mm;
                        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .qr-label .scan { font-size: 5.5pt; color: #999; margin-top: 0.5mm; letter-spacing: 0.02em; }
        @media print {
          .labels-controls { display: none !important; }
          .qr-label { border-color: transparent; }
          @page { size: A4; margin: 8mm; }
        }
      `}</style>

      {/* On-screen controls (hidden in print) */}
      <div className="labels-controls" style={{ padding: '20px 24px', borderBottom: '1px solid #e5e5e5', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <Link href="/assets" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#666', textDecoration: 'none' }}>
          <ArrowLeft size={14} /> Assets
        </Link>
        <strong style={{ fontSize: 15 }}>QR Label Sheets</strong>
        {!singleId && (
          <select
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
            style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid #ccc', fontSize: 13 }}
          >
            <option value="">All stores</option>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.store_name} ({s.store_code})</option>)}
          </select>
        )}
        <span style={{ fontSize: 12.5, color: '#888' }}>
          {loading ? 'Loading…' : `${assets.length} label${assets.length === 1 ? '' : 's'} · 21 per A4 (Avery L7160)`}
        </span>
        <button
          onClick={() => window.print()}
          disabled={loading || assets.length === 0}
          style={{
            marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 7,
            padding: '9px 18px', borderRadius: 9, border: 'none', cursor: 'pointer',
            background: '#E07B39', color: '#fff', fontSize: 13.5, fontWeight: 700,
            opacity: loading || assets.length === 0 ? 0.5 : 1,
          }}
        >
          <Printer size={15} /> Print
        </button>
      </div>

      {/* The sheet */}
      <div style={{ padding: '16px 0 40px' }}>
        {loading ? (
          <p className="labels-controls" style={{ textAlign: 'center', color: '#999', fontSize: 14, padding: 40 }}>Generating labels…</p>
        ) : assets.length === 0 ? (
          <p className="labels-controls" style={{ textAlign: 'center', color: '#999', fontSize: 14, padding: 40 }}>
            No assets to print — register assets first, or sign in if you haven&apos;t.
          </p>
        ) : (
          <div className="label-sheet">
            {assets.map((a) => (
              <div key={a.id} className="qr-label">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {a.qr && <img src={a.qr} alt={a.asset_code} />}
                <div className="txt">
                  <div className="nm">{a.name}</div>
                  <div className="cd">{a.asset_code}</div>
                  {a.store && <div className="st">{a.store.store_name}</div>}
                  <div className="scan">Broken? Scan to report</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default function LabelsPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: '#fff' }} />}>
      <LabelsInner />
    </Suspense>
  )
}
