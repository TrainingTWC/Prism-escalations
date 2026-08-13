'use client'

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { AppShell } from '@/components/layout/AppShell'
import { GlassPanel } from '@/components/ui/GlassPanel'
import { Button, ButtonLink } from '@/components/ui/Button'
import { supabase } from '@/lib/supabase/client'
import { useAuthStore } from '@/store/auth.store'
import { CATEGORIES, SEVERITY_OPTIONS } from '@/lib/ticket-utils'
import { buzzSuccess, tapLight, tapMedium } from '@/lib/native/haptics'
import type { AssetWithRelations, DepartmentRouting, Profile, Store } from '@/lib/supabase/database.types'
import {
  ArrowLeft, AlertCircle, Camera, X, MapPin, UserCheck, UserX, QrCode,
  Wrench, Store as StoreIcon, Users, Monitor, Truck, ShieldCheck, Wallet, GraduationCap,
} from 'lucide-react'

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  Operations:  <StoreIcon size={18} />,
  Maintenance: <Wrench size={18} />,
  HR:          <Users size={18} />,
  IT:          <Monitor size={18} />,
  SCM:         <Truck size={18} />,
  QA:          <ShieldCheck size={18} />,
  Finance:     <Wallet size={18} />,
  'L&D':       <GraduationCap size={18} />,
}

const LOCKED_STORE_ROLES = ['store_team', 'store_manager']

function NewTicketInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const assetParam = searchParams.get('asset')
  const { profile } = useAuthStore()
  const [stores, setStores] = useState<Store[]>([])
  const [routing, setRouting] = useState<DepartmentRouting[]>([])
  const [owners, setOwners] = useState<Record<string, Pick<Profile, 'id' | 'name'>>>({})
  const [asset, setAsset] = useState<AssetWithRelations | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [photos, setPhotos] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [form, setForm] = useState({
    title: '',
    description: '',
    category: 'Operations' as keyof typeof CATEGORIES,
    sub_category: '',
    severity: 'P2' as 'P0' | 'P1' | 'P2' | 'P3',
    store_id: '',
  })

  useEffect(() => {
    supabase.from('stores').select('*').order('store_name').then(({ data }) => {
      setStores(data || [])
    })
    supabase.from('department_routing').select('*').eq('is_active', true).then(async ({ data }) => {
      const rows = (data as DepartmentRouting[] | null) || []
      setRouting(rows)
      const ids = Array.from(new Set(rows.map((r) => r.owner_id)))
      if (ids.length) {
        const { data: profs } = await supabase.from('profiles').select('id, name').in('id', ids)
        const map: Record<string, Pick<Profile, 'id' | 'name'>> = {}
        for (const p of (profs as Pick<Profile, 'id' | 'name'>[] | null) || []) map[p.id] = p
        setOwners(map)
      }
    })
  }, [])

  useEffect(() => {
    if (profile?.store_id) setForm((f) => ({ ...f, store_id: f.store_id || profile.store_id! }))
  }, [profile])

  // Scan-to-report: an asset id in the URL pins store + department to the asset
  useEffect(() => {
    if (!assetParam) return
    supabase
      .from('assets')
      .select('*, category:asset_categories(*), store:stores(*)')
      .eq('id', assetParam)
      .maybeSingle()
      .then(({ data }) => {
        const a = data as unknown as AssetWithRelations | null
        if (!a) return
        setAsset(a)
        setForm((f) => ({
          ...f,
          store_id: a.store_id,
          category: (a.category?.department ?? f.category) as keyof typeof CATEGORIES,
          sub_category: a.category?.name ?? f.sub_category,
        }))
      })
  }, [assetParam])

  const storeLocked = !!profile && LOCKED_STORE_ROLES.includes(profile.role) && !!profile.store_id
  const selectedStore = stores.find((s) => s.id === form.store_id)
  const subcategories = CATEGORIES[form.category] || []

  // Live preview of who this ticket will be routed to
  const routedOwner = useMemo(() => {
    const region = selectedStore?.region ?? null
    const exact = routing.find((r) => r.department === form.category && r.region === region)
    const fallback = routing.find((r) => r.department === form.category && r.region === null)
    const hit = exact ?? fallback
    return hit ? owners[hit.owner_id] ?? null : null
  }, [routing, owners, form.category, selectedStore])

  const addPhotos = (files: FileList | null) => {
    if (!files) return
    const list = Array.from(files).filter((f) => f.type.startsWith('image/')).slice(0, 4 - photos.length)
    if (!list.length) return
    setPhotos((p) => [...p, ...list])
    setPreviews((p) => [...p, ...list.map((f) => URL.createObjectURL(f))])
  }

  const removePhoto = (i: number) => {
    URL.revokeObjectURL(previews[i])
    setPhotos((p) => p.filter((_, idx) => idx !== i))
    setPreviews((p) => p.filter((_, idx) => idx !== i))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!profile || loading) return
    tapMedium()
    setLoading(true)
    setError('')

    // ticket_code is assigned server-side by the assign_ticket_code trigger
    // (DEPT-AUDITCODE-NNNN, see supabase/migration_ticket_code_department.sql)
    // assigned_to + sla_deadline are stamped by the DB (routing table + severity)
    const { data: created, error: insertError } = await supabase
      .from('tickets')
      .insert({
        title: form.title,
        description: form.description || null,
        category: form.category,
        sub_category: form.sub_category || null,
        severity: form.severity,
        store_id: form.store_id,
        raised_by: profile.id,
        source_type: 'store',
        status: 'open',
        asset_id: asset?.id ?? null,
      } as never)
      .select('id')
      .single()

    if (insertError || !created) {
      setError(insertError?.message ?? 'Could not create the ticket')
      setLoading(false)
      return
    }

    const ticketId = (created as { id: string }).id

    // Upload photo evidence (best effort — the ticket exists either way)
    for (const file of photos) {
      const path = `${ticketId}/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, '_')}`
      const { error: upErr } = await supabase.storage.from('ticket-attachments').upload(path, file)
      if (upErr) continue
      const { data: pub } = supabase.storage.from('ticket-attachments').getPublicUrl(path)
      await supabase.from('attachments').insert({
        ticket_id: ticketId,
        uploaded_by: profile.id,
        file_url: pub.publicUrl,
        file_name: file.name,
        file_type: file.type,
      } as never)
    }

    buzzSuccess()
    router.push(`/tickets/view?id=${ticketId}`)
  }

  const labelClass = 'block text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-tertiary)] mb-2'

  return (
    <AppShell
      overline="New Issue"
      title="Create Ticket"
      subtitle="30 seconds: what, where, how bad — we route it to the right person."
    >
      <div className="max-w-[680px]">
        <Link
          href="/tickets"
          className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors mb-5"
        >
          <ArrowLeft size={12} /> Back to tickets
        </Link>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          {/* Scan-to-report banner: the asset pins store + routing */}
          {asset && (
            <div
              className="flex items-center gap-3 px-4 py-3.5 rounded-[14px]"
              style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-border)' }}
            >
              <span
                className="w-10 h-10 rounded-[11px] flex items-center justify-center shrink-0"
                style={{ background: 'var(--bg-tertiary)', color: 'var(--accent)' }}
              >
                <QrCode size={17} />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.10em] text-[var(--accent)]">Reporting a problem on</p>
                <p className="text-[14px] font-bold text-[var(--text-primary)] truncate">{asset.name}</p>
                <p className="text-[11px] text-[var(--text-muted)]">
                  {asset.asset_code}{asset.category ? ` · ${asset.category.name}` : ''}{asset.store ? ` · ${asset.store.store_name}` : ''}
                </p>
              </div>
              <Link
                href={`/assets/view?id=${asset.id}`}
                className="shrink-0 text-[11px] font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                View
              </Link>
            </div>
          )}

          <GlassPanel padding="md">
            {/* Title */}
            <div className="mb-5">
              <label className={labelClass}>What&apos;s the issue? *</label>
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Coffee grinder not working"
                required
                autoFocus
                className="prism-input"
                style={{ fontSize: 15, padding: '13px 14px' }}
              />
            </div>

            {/* Department + type pickers (hidden when an asset pins the routing) */}
            {!asset && (<>
            <div className="mb-5">
              <label className={labelClass}>Department *</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {Object.keys(CATEGORIES).map((c) => {
                  const selected = form.category === c
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => { tapLight(); setForm((f) => ({ ...f, category: c as keyof typeof CATEGORIES, sub_category: '' })) }}
                      className="flex flex-col items-center gap-1.5 rounded-[12px] px-2 py-3 transition-all"
                      style={{
                        background: selected ? 'var(--accent-dim)' : 'var(--bg-tertiary)',
                        border: `1px solid ${selected ? 'var(--accent)' : 'var(--border-subtle)'}`,
                        color: selected ? 'var(--accent)' : 'var(--text-secondary)',
                        boxShadow: selected ? '0 0 0 3px var(--accent-glow)' : undefined,
                      }}
                    >
                      {CATEGORY_ICONS[c]}
                      <span className="text-[11px] font-bold">{c}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Sub-category chips */}
            {subcategories.length > 0 && (
              <div className="mb-5">
                <label className={labelClass}>Type</label>
                <div className="flex gap-2 flex-wrap">
                  {subcategories.map((s) => {
                    const selected = form.sub_category === s
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => { tapLight(); setForm((f) => ({ ...f, sub_category: selected ? '' : s })) }}
                        className="px-3.5 py-2 rounded-full text-[12px] font-semibold transition-all"
                        style={{
                          background: selected ? 'var(--accent-dim)' : 'var(--bg-tertiary)',
                          border: `1px solid ${selected ? 'var(--accent)' : 'var(--border-subtle)'}`,
                          color: selected ? 'var(--accent)' : 'var(--text-secondary)',
                        }}
                      >
                        {s}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
            </>)}

            {/* Severity */}
            <div className="mb-5">
              <label className={labelClass}>How bad is it? *</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {SEVERITY_OPTIONS.map(({ value, short, desc, color }) => {
                  const selected = form.severity === value
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => { tapLight(); setForm((f) => ({ ...f, severity: value })) }}
                      className="rounded-[12px] px-3 py-3 text-center transition-all"
                      style={{
                        background: selected ? `color-mix(in oklab, ${color} 12%, transparent)` : 'var(--bg-tertiary)',
                        border: `1px solid ${selected ? color : 'var(--border-subtle)'}`,
                        boxShadow: selected ? `0 0 0 3px color-mix(in oklab, ${color} 14%, transparent)` : undefined,
                      }}
                    >
                      <div className="text-[13px] font-bold" style={{ color: selected ? color : 'var(--text-secondary)' }}>
                        {value} · {short}
                      </div>
                      <div className="text-[10px] text-[var(--text-muted)] mt-0.5">{desc}</div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Store (hidden when an asset pins it) */}
            {!asset && (
            <div className="mb-5">
              <label className={labelClass}>Store *</label>
              {storeLocked && selectedStore ? (
                <div
                  className="flex items-center gap-2.5 px-3.5 py-3 rounded-[10px] text-[13px] font-semibold text-[var(--text-primary)]"
                  style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)' }}
                >
                  <MapPin size={14} className="text-[var(--accent)]" />
                  {selectedStore.store_name}
                  <span className="text-[11px] font-normal text-[var(--text-muted)]">
                    ({selectedStore.store_code}) · {selectedStore.region}
                  </span>
                </div>
              ) : (
                <select
                  value={form.store_id}
                  onChange={(e) => setForm((f) => ({ ...f, store_id: e.target.value }))}
                  required
                  className="prism-input"
                >
                  <option value="">Select store…</option>
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>{s.store_name} ({s.store_code})</option>
                  ))}
                </select>
              )}
            </div>
            )}

            {/* Photos */}
            <div className="mb-5">
              <label className={labelClass}>Photo evidence</label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="hidden"
                onChange={(e) => { addPhotos(e.target.files); e.target.value = '' }}
              />
              <div className="flex gap-2 flex-wrap">
                {previews.map((src, i) => (
                  <div key={src} className="relative w-[72px] h-[72px] rounded-[10px] overflow-hidden"
                       style={{ border: '1px solid var(--border-primary)' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={`evidence ${i + 1}`} className="w-full h-full object-cover" />
                    <button
                      type="button"
                      aria-label="Remove photo"
                      onClick={() => removePhoto(i)}
                      className="absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center"
                      style={{ background: 'rgba(0,0,0,0.65)', color: '#fff' }}
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
                {photos.length < 4 && (
                  <button
                    type="button"
                    onClick={() => { tapLight(); fileInputRef.current?.click() }}
                    className="w-[72px] h-[72px] rounded-[10px] flex flex-col items-center justify-center gap-1 text-[var(--text-muted)] transition-colors hover:text-[var(--accent)]"
                    style={{ background: 'var(--bg-tertiary)', border: '1px dashed var(--border-primary)' }}
                  >
                    <Camera size={18} />
                    <span className="text-[9px] font-bold uppercase">Add</span>
                  </button>
                )}
              </div>
            </div>

            {/* Description */}
            <div>
              <label className={labelClass}>Details (optional)</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Anything the fixer should know…"
                rows={3}
                className="prism-input"
                style={{ resize: 'vertical' }}
              />
            </div>
          </GlassPanel>

          {/* Routing preview */}
          <div
            className="flex items-center gap-3 px-4 py-3.5 rounded-[14px]"
            style={{
              background: routedOwner ? 'rgba(34,197,94,0.07)' : 'var(--card-bg)',
              border: `1px solid ${routedOwner ? 'rgba(34,197,94,0.25)' : 'var(--border-subtle)'}`,
            }}
          >
            {routedOwner ? (
              <>
                <UserCheck size={16} style={{ color: 'var(--color-success)' }} className="shrink-0" />
                <p className="text-[12px] text-[var(--text-secondary)]">
                  Will be assigned to{' '}
                  <span className="font-bold text-[var(--text-primary)]">{routedOwner.name}</span>
                  {' '}({form.category}) — they get an instant email + push.
                </p>
              </>
            ) : (
              <>
                <UserX size={16} className="text-[var(--text-muted)] shrink-0" />
                <p className="text-[12px] text-[var(--text-muted)]">
                  No routing owner set for {form.category}
                  {selectedStore ? ` in ${selectedStore.region}` : ''} yet — the ticket will wait in the
                  department queue.
                </p>
              </>
            )}
          </div>

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
            <Button type="submit" disabled={loading} variant="primary" className="flex-1 justify-center"
                    style={{ padding: '13px 18px', fontSize: 14 }}>
              {loading ? 'Creating…' : 'Create Ticket'}
            </Button>
            <ButtonLink href="/tickets" variant="ghost">Cancel</ButtonLink>
          </div>
        </form>
      </div>
    </AppShell>
  )
}

export default function NewTicketPage() {
  return (
    <Suspense fallback={
      <AppShell overline="New Issue" title="Create Ticket">
        <div className="skeleton" style={{ height: 420, maxWidth: 680 }} />
      </AppShell>
    }>
      <NewTicketInner />
    </Suspense>
  )
}
