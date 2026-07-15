'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import QRCode from 'qrcode'
import { AppShell } from '@/components/layout/AppShell'
import { GlassPanel } from '@/components/ui/GlassPanel'
import { AssetStatusBadge, CoverageBadge } from '@/components/assets/AssetBadges'
import { PmPanel } from '@/components/assets/PmPanel'
import { SeverityBadge, StatusPill } from '@/components/tickets/Badges'
import { supabase } from '@/lib/supabase/client'
import { useAuthStore } from '@/store/auth.store'
import { canManageAssets, warrantyState, amcState, COVERAGE_META, assetScanUrl } from '@/lib/asset-utils'
import { tapLight, tapMedium } from '@/lib/native/haptics'
import type { AssetWithRelations, Ticket } from '@/lib/supabase/database.types'
import { format, formatDistanceToNow } from 'date-fns'
import {
  ArrowLeft, MapPin, Megaphone, Pencil, QrCode as QrIcon, History,
  Wrench, CheckCircle2, Archive, Phone, Mail, Clock,
} from 'lucide-react'

function fmtDate(d: string | null): string {
  return d ? format(new Date(d), 'dd MMM yyyy') : '—'
}

function AssetViewInner() {
  const searchParams = useSearchParams()
  const id = searchParams.get('id')
  const code = searchParams.get('code')
  const { profile } = useAuthStore()
  const manager = canManageAssets(profile)

  const [asset, setAsset] = useState<AssetWithRelations | null>(null)
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [qrDataUrl, setQrDataUrl] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const fetchAll = useCallback(async () => {
    if (!id && !code) { setLoading(false); return }
    let query = supabase
      .from('assets')
      .select('*, category:asset_categories(*), store:stores(*), amc_vendor:vendors(*)')
    query = id ? query.eq('id', id) : query.eq('asset_code', code!)
    const { data: a } = await query.maybeSingle()
    const found = a as unknown as AssetWithRelations | null
    setAsset(found)

    if (found) {
      const { data: tkts } = await supabase
        .from('tickets')
        .select('*')
        .eq('asset_id', found.id)
        .order('created_at', { ascending: false })
        .limit(20)
      setTickets((tkts as unknown as Ticket[]) || [])
    }
    setLoading(false)
  }, [id, code])

  useEffect(() => { fetchAll() }, [fetchAll])

  useEffect(() => {
    if (!asset) return
    QRCode.toDataURL(assetScanUrl(asset.asset_code), {
      width: 480,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#09090B', light: '#FFFFFF' },
    }).then(setQrDataUrl).catch(() => setQrDataUrl(''))
  }, [asset])

  const setStatus = async (status: string) => {
    if (!asset || busy) return
    tapMedium()
    setBusy(true)
    await supabase.from('assets').update({ status } as never).eq('id', asset.id)
    await fetchAll()
    setBusy(false)
  }

  if (loading) {
    return (
      <AppShell overline="Asset" title="Loading…">
        <div className="flex flex-col gap-4">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 120 }} />)}
        </div>
      </AppShell>
    )
  }

  if (!asset) {
    return (
      <AppShell overline="Asset" title="Not found">
        <GlassPanel padding="lg" className="text-center">
          <QrIcon size={32} className="mx-auto mb-4 text-[var(--text-muted)]" />
          <p className="text-[14px] font-semibold text-[var(--text-secondary)] mb-1">Asset not found</p>
          <p className="text-xs text-[var(--text-muted)]">
            {code ? `No asset matches code ${code} — or it's outside your scope.` : 'It may be outside your scope.'}
          </p>
        </GlassPanel>
      </AppShell>
    )
  }

  const wState = warrantyState(asset)
  const aState = amcState(asset)
  const openTickets = tickets.filter((t) => !['closed', 'rejected'].includes(t.status))

  return (
    <AppShell
      overline={asset.asset_code}
      title={asset.name}
      subtitle={`${asset.category?.name ?? 'Asset'}${asset.store ? ` · ${asset.store.store_name}` : ''}`}
    >
      <div className="max-w-[1000px] pb-24 lg:pb-0">
        <Link
          href="/assets"
          className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors mb-5"
        >
          <ArrowLeft size={12} /> All assets
        </Link>

        <div className="grid gap-4 lg:gap-5 grid-cols-1 lg:grid-cols-[1fr_320px]">
          {/* Main column */}
          <div className="flex flex-col gap-4">
            {/* Header card + primary action */}
            <GlassPanel padding="lg">
              <div className="flex items-center gap-2 flex-wrap mb-4">
                <AssetStatusBadge status={asset.status} />
                <CoverageBadge asset={asset} />
                {asset.category && (
                  <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                    {asset.category.department}
                  </span>
                )}
              </div>

              <div className="flex gap-5 flex-wrap text-[13px] mb-5">
                {asset.store && (
                  <span className="inline-flex items-center gap-1.5 text-[var(--text-secondary)]">
                    <MapPin size={12} className="text-[var(--accent)]" />
                    {asset.store.store_name}
                    <span className="text-[var(--text-muted)]">· {asset.store.region}</span>
                  </span>
                )}
                {(asset.make || asset.model) && (
                  <span className="text-[var(--text-secondary)]">{[asset.make, asset.model].filter(Boolean).join(' ')}</span>
                )}
                {asset.serial_no && (
                  <span className="text-[var(--text-muted)] font-mono-value">S/N {asset.serial_no}</span>
                )}
              </div>

              {asset.notes && (
                <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed mb-5">{asset.notes}</p>
              )}

              {/* THE button — what the QR scan is for */}
              {asset.status !== 'retired' && (
                <Link
                  href={`/tickets/new?asset=${asset.id}`}
                  onClick={() => tapLight()}
                  className="btn-primary w-full justify-center"
                  style={{ padding: '14px 18px', fontSize: 15 }}
                >
                  <Megaphone size={17} /> Report a problem
                </Link>
              )}

              {openTickets.length > 0 && (
                <p className="text-[11px] text-[var(--color-warning)] text-center mt-3">
                  ⚠ {openTickets.length} open ticket{openTickets.length > 1 ? 's' : ''} already exist{openTickets.length === 1 ? 's' : ''} for this asset — check below before reporting again.
                </p>
              )}
            </GlassPanel>

            {/* Preventive maintenance */}
            <PmPanel assetId={asset.id} canManage={manager} disabled={asset.status === 'retired'} />

            {/* Service history */}
            <GlassPanel
              padding="md"
              title={
                <span className="inline-flex items-center gap-1.5">
                  <History size={13} /> Service history
                </span>
              }
            >
              {tickets.length === 0 ? (
                <p className="text-[13px] text-[var(--text-muted)] text-center py-5">
                  No tickets yet — this asset has a clean record.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {tickets.map((t) => (
                    <Link
                      key={t.id}
                      href={`/tickets/view?id=${t.id}`}
                      className="flex items-center gap-3 px-3.5 py-3 rounded-[12px] transition-colors"
                      style={{ background: 'var(--card-bg)', border: '1px solid var(--border-subtle)', textDecoration: 'none' }}
                    >
                      <span className="flex-1 min-w-0">
                        <span className="block text-[13px] font-semibold text-[var(--text-primary)] truncate">{t.title}</span>
                        <span className="block text-[10px] text-[var(--text-muted)] mt-0.5">
                          #{t.ticket_code} · {formatDistanceToNow(new Date(t.created_at), { addSuffix: true })}
                        </span>
                      </span>
                      <SeverityBadge severity={t.severity} />
                      <StatusPill status={t.status} />
                    </Link>
                  ))}
                </div>
              )}
            </GlassPanel>
          </div>

          {/* Sidebar */}
          <div className="flex flex-col gap-4">
            {/* Coverage */}
            <GlassPanel padding="md" title="Coverage">
              <div className="flex flex-col gap-2.5">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-[var(--text-muted)]">Purchased</span>
                  <span className="text-xs font-semibold text-[var(--text-secondary)]">{fmtDate(asset.purchase_date)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-[var(--text-muted)]">Warranty until</span>
                  <span className="text-xs font-semibold" style={{ color: COVERAGE_META[wState].color }}>
                    {fmtDate(asset.warranty_until)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-[var(--text-muted)]">AMC until</span>
                  <span className="text-xs font-semibold" style={{ color: COVERAGE_META[aState].color }}>
                    {fmtDate(asset.amc_until)}
                  </span>
                </div>
              </div>

              {asset.amc_vendor && (
                <div
                  className="mt-4 px-3.5 py-3 rounded-[10px]"
                  style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)' }}
                >
                  <p className="text-[10px] font-bold uppercase tracking-[0.10em] text-[var(--text-muted)] mb-1.5">AMC Vendor</p>
                  <p className="text-[13px] font-semibold text-[var(--text-primary)]">{asset.amc_vendor.name}</p>
                  <div className="flex flex-col gap-1 mt-1.5">
                    {asset.amc_vendor.phone && (
                      <a href={`tel:${asset.amc_vendor.phone}`} className="inline-flex items-center gap-1.5 text-[11px] text-[var(--accent)]">
                        <Phone size={10} /> {asset.amc_vendor.phone}
                      </a>
                    )}
                    {asset.amc_vendor.email && (
                      <a href={`mailto:${asset.amc_vendor.email}`} className="inline-flex items-center gap-1.5 text-[11px] text-[var(--accent)]">
                        <Mail size={10} /> {asset.amc_vendor.email}
                      </a>
                    )}
                    {asset.amc_vendor.sla_hours != null && (
                      <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                        <Clock size={10} /> {asset.amc_vendor.sla_hours} hr SLA
                      </span>
                    )}
                  </div>
                </div>
              )}
            </GlassPanel>

            {/* QR label */}
            <GlassPanel padding="md" title="QR Label">
              {qrDataUrl ? (
                <div className="flex flex-col items-center gap-2">
                  <div className="p-2.5 rounded-[12px]" style={{ background: '#fff' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={qrDataUrl} alt={`QR for ${asset.asset_code}`} style={{ width: 150, height: 150, display: 'block' }} />
                  </div>
                  <span className="text-[11px] font-mono-value text-[var(--text-muted)]">{asset.asset_code}</span>
                  <p className="text-[10px] text-[var(--text-muted)] text-center">
                    Scan with any phone camera → opens this page.
                  </p>
                  <Link
                    href={`/assets/labels?id=${asset.id}`}
                    className="btn-ghost w-full justify-center mt-1"
                    style={{ padding: '8px 12px', fontSize: 12 }}
                  >
                    Print this label
                  </Link>
                </div>
              ) : (
                <div className="skeleton mx-auto" style={{ width: 150, height: 150 }} />
              )}
            </GlassPanel>

            {/* Manage */}
            {manager && (
              <GlassPanel padding="md" title="Manage">
                <div className="flex flex-col gap-2">
                  <Link
                    href={`/assets/new?id=${asset.id}`}
                    className="btn-ghost w-full justify-center"
                    style={{ padding: '9px 12px', fontSize: 12 }}
                  >
                    <Pencil size={13} /> Edit details
                  </Link>
                  {asset.status === 'active' && (
                    <button
                      disabled={busy}
                      onClick={() => setStatus('in_repair')}
                      className="w-full inline-flex items-center justify-center gap-2 rounded-[8px] py-2 text-[12px] font-semibold disabled:opacity-50"
                      style={{ color: 'var(--color-warning)', background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.25)' }}
                    >
                      <Wrench size={13} /> Mark in repair
                    </button>
                  )}
                  {asset.status === 'in_repair' && (
                    <button
                      disabled={busy}
                      onClick={() => setStatus('active')}
                      className="w-full inline-flex items-center justify-center gap-2 rounded-[8px] py-2 text-[12px] font-semibold disabled:opacity-50"
                      style={{ color: 'var(--color-success)', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)' }}
                    >
                      <CheckCircle2 size={13} /> Back in service
                    </button>
                  )}
                  {asset.status !== 'retired' ? (
                    <button
                      disabled={busy}
                      onClick={() => setStatus('retired')}
                      className="w-full inline-flex items-center justify-center gap-2 rounded-[8px] py-2 text-[12px] font-semibold disabled:opacity-50"
                      style={{ color: 'var(--text-muted)', background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)' }}
                    >
                      <Archive size={13} /> Retire asset
                    </button>
                  ) : (
                    <button
                      disabled={busy}
                      onClick={() => setStatus('active')}
                      className="w-full inline-flex items-center justify-center gap-2 rounded-[8px] py-2 text-[12px] font-semibold disabled:opacity-50"
                      style={{ color: 'var(--color-success)', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)' }}
                    >
                      <CheckCircle2 size={13} /> Restore to active
                    </button>
                  )}
                </div>
              </GlassPanel>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  )
}

export default function AssetViewPage() {
  return (
    <Suspense fallback={
      <AppShell overline="Asset" title="Loading…">
        <div className="flex flex-col gap-4">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 120 }} />)}
        </div>
      </AppShell>
    }>
      <AssetViewInner />
    </Suspense>
  )
}
