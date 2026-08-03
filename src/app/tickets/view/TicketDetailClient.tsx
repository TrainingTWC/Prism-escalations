'use client'

import { useCallback, useEffect, useRef, useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { AppShell } from '@/components/layout/AppShell'
import { GlassPanel } from '@/components/ui/GlassPanel'
import { Button } from '@/components/ui/Button'
import { SlaCountdown } from '@/components/tickets/SlaCountdown'
import { SeverityBadge, StatusPill, CategoryBadge, BlockedBadge } from '@/components/tickets/Badges'
import { supabase } from '@/lib/supabase/client'
import { useAuthStore } from '@/store/auth.store'
import {
  STATUS_LABELS, STATUS_ORDER, ESCALATION_LABELS, normalizeStatus,
  getPrimaryAction, getSecondaryAction, isFixer, type TicketAction,
} from '@/lib/ticket-utils'
import { applyTicketAction, setTicketBlocked } from '@/lib/ticket-actions'
import { buzzSuccess, tapLight, tapMedium } from '@/lib/native/haptics'
import { CoverageBadge } from '@/components/assets/AssetBadges'
import type { TicketWithRelations, Comment, Escalation, Attachment, AssetWithRelations, SparePart } from '@/lib/supabase/database.types'
import { formatDistanceToNow, format } from 'date-fns'
import ReactMarkdown from 'react-markdown'
import {
  ArrowLeft, MapPin, User, Clock, Send, AlertTriangle, Camera, X,
  CheckCircle, Sparkles, RefreshCw, ExternalLink, Trash2, Play,
  BadgeCheck, OctagonAlert, Undo2, XCircle, QrCode, Phone, Package,
} from 'lucide-react'

type SheetKind = 'resolve' | 'block' | 'reopen' | 'reject' | null

type RungPerson = { id: string; name: string; email: string | null }
type EscalationWithPeople = Escalation & {
  policy?: { escalation_policy_people?: { profile: RungPerson | null; employee: RungPerson | null }[] | null } | null
}

function TicketDetailInner() {
  const searchParams = useSearchParams()
  const id = searchParams.get('id')
  const { profile } = useAuthStore()
  const router = useRouter()
  const [ticket, setTicket] = useState<TicketWithRelations | null>(null)
  const [asset, setAsset] = useState<AssetWithRelations | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [escalations, setEscalations] = useState<EscalationWithPeople[]>([])
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [loading, setLoading] = useState(true)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Action sheet (resolve w/ photo, block reason, reopen reason, reject reason)
  const [sheet, setSheet] = useState<SheetKind>(null)
  const [sheetNote, setSheetNote] = useState('')
  const [sheetPhotos, setSheetPhotos] = useState<File[]>([])
  const [sheetPreviews, setSheetPreviews] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Spare part used while fixing (store-scoped, independent of a linked asset)
  const [storeParts, setStoreParts] = useState<SparePart[]>([])
  const [usePartId, setUsePartId] = useState('')
  const [usePartQty, setUsePartQty] = useState('1')

  const fetchAll = useCallback(async () => {
    if (!id) return
    const { data: tkt } = await supabase
      .from('tickets')
      .select(`*, store:stores(*), raised_by_profile:profiles!tickets_raised_by_fkey(*), assigned_to_profile:profiles!tickets_assigned_to_fkey(*)`)
      .eq('id', id)
      .single()

    const { data: cmts } = await supabase
      .from('comments').select('*').eq('ticket_id', id).order('created_at', { ascending: true })

    const { data: escs } = await supabase
      .from('escalations')
      .select('*, policy:escalation_policies(escalation_policy_people(profile:profiles(id, name, email), employee:employee_roster(id, name, email)))')
      .eq('ticket_id', id)
      .order('triggered_at', { ascending: true })

    const { data: atts } = await supabase
      .from('attachments').select('*').eq('ticket_id', id).order('created_at', { ascending: true })

    const t = tkt as unknown as TicketWithRelations | null
    if (t?.asset_id) {
      const { data: a } = await supabase
        .from('assets')
        .select('*, category:asset_categories(*), amc_vendor:vendors(*)')
        .eq('id', t.asset_id)
        .maybeSingle()
      setAsset((a as unknown as AssetWithRelations) ?? null)
    } else {
      setAsset(null)
    }

    setTicket(tkt as unknown as TicketWithRelations)
    setComments(cmts || [])
    setEscalations((escs as unknown as EscalationWithPeople[]) || [])
    setAttachments(atts || [])
    setLoading(false)
  }, [id])

  useEffect(() => {
    fetchAll()
    if (!id) return
    const channel = supabase
      .channel(`ticket-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'comments', filter: `ticket_id=eq.${id}` }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets', filter: `id=eq.${id}` }, fetchAll)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [id, fetchAll])

  const openSheet = (kind: SheetKind) => {
    tapLight()
    setSheetNote('')
    sheetPreviews.forEach((u) => URL.revokeObjectURL(u))
    setSheetPhotos([])
    setSheetPreviews([])
    setUsePartId('')
    setUsePartQty('1')
    setSheet(kind)
    if (kind === 'resolve' && ticket?.store_id) {
      supabase.from('spare_parts').select('*').eq('store_id', ticket.store_id).order('name')
        .then(({ data }) => setStoreParts((data as SparePart[]) || []))
    }
  }

  const addSheetPhotos = (files: FileList | null) => {
    if (!files) return
    const list = Array.from(files).filter((f) => f.type.startsWith('image/')).slice(0, 4 - sheetPhotos.length)
    setSheetPhotos((p) => [...p, ...list])
    setSheetPreviews((p) => [...p, ...list.map((f) => URL.createObjectURL(f))])
  }

  const uploadSheetPhotos = async () => {
    if (!ticket || !profile) return
    for (const file of sheetPhotos) {
      const path = `${ticket.id}/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, '_')}`
      const { error } = await supabase.storage.from('ticket-attachments').upload(path, file)
      if (error) continue
      const { data: pub } = supabase.storage.from('ticket-attachments').getPublicUrl(path)
      await supabase.from('attachments').insert({
        ticket_id: ticket.id,
        uploaded_by: profile.id,
        file_url: pub.publicUrl,
        file_name: file.name,
        file_type: file.type,
      } as never)
    }
  }

  const runAction = async (action: TicketAction, note?: string) => {
    if (!ticket || !profile || busy) return
    tapMedium()
    setBusy(true)
    const { error } = await applyTicketAction(ticket, profile, action, note)
    if (!error) buzzSuccess()
    setSheet(null)
    await fetchAll()
    setBusy(false)
  }

  const confirmSheet = async () => {
    if (!ticket || !profile || busy) return
    if (sheet === 'resolve') {
      setBusy(true)
      await uploadSheetPhotos()
      if (usePartId && Number(usePartQty) > 0) {
        await supabase.rpc('spare_part_use', {
          p_part_id: usePartId,
          p_qty: Number(usePartQty),
          p_ticket_id: ticket.id,
        } as never)
      }
      setBusy(false)
      await runAction({ key: 'resolve', label: 'Mark fixed', nextStatus: 'resolved', tone: 'success' }, sheetNote)
    } else if (sheet === 'block') {
      setBusy(true)
      const { error } = await setTicketBlocked(ticket, profile, true, sheetNote)
      if (!error) buzzSuccess()
      setSheet(null)
      await fetchAll()
      setBusy(false)
    } else if (sheet === 'reopen') {
      await runAction({ key: 'reopen', label: 'Reopen', nextStatus: 'in_progress', tone: 'danger' }, sheetNote)
    } else if (sheet === 'reject') {
      await runAction({ key: 'reject', label: 'Reject', nextStatus: 'rejected', tone: 'danger' }, sheetNote)
    }
  }

  const unblock = async () => {
    if (!ticket || !profile || busy) return
    tapMedium()
    setBusy(true)
    await setTicketBlocked(ticket, profile, false)
    await fetchAll()
    setBusy(false)
  }

  const deleteTicket = async () => {
    if (!ticket) return
    setDeleting(true)
    await supabase.from('tickets').delete().eq('id', ticket.id)
    router.push('/tickets')
  }

  const addComment = async () => {
    if (!comment.trim() || !profile || !ticket) return
    setSubmitting(true)
    await supabase.from('comments').insert({
      ticket_id: ticket.id,
      author_id: profile.id,
      content: comment.trim(),
      is_status_change: false,
    } as never)
    setComment('')
    setSubmitting(false)
  }

  if (loading) {
    return (
      <AppShell overline="Ticket" title="Loading…">
        <div className="flex flex-col gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 120 }} />
          ))}
        </div>
      </AppShell>
    )
  }

  if (!ticket) {
    return (
      <AppShell overline="Ticket" title="Not found">
        <GlassPanel padding="lg" className="text-center">
          <p className="text-[var(--text-muted)]">Ticket not found — it may be outside your scope.</p>
        </GlassPanel>
      </AppShell>
    )
  }

  const status = normalizeStatus(ticket.status)
  const currentStepIndex = ticket.status === 'rejected' ? 0 : STATUS_ORDER.indexOf(status)
  const primary = getPrimaryAction(ticket, profile)
  const secondary = getSecondaryAction(ticket, profile)
  const fixer = profile ? isFixer(ticket, profile) : false
  const canBlockToggle = fixer && status === 'in_progress'

  // Which handler does the primary button call?
  const onPrimary = () => {
    if (!primary) return
    if (primary.key === 'resolve') openSheet('resolve')
    else runAction(primary)
  }
  const onSecondary = () => {
    if (!secondary) return
    if (secondary.key === 'reopen') openSheet('reopen')
    else if (secondary.key === 'reject') openSheet('reject')
  }

  const actionIcon = (key: TicketAction['key'], size = 15) =>
    key === 'start' ? <Play size={size} />
    : key === 'resolve' ? <CheckCircle size={size} />
    : key === 'verify' ? <BadgeCheck size={size} />
    : key === 'reopen' ? <Undo2 size={size} />
    : <XCircle size={size} />

  const primaryStyle = primary?.key === 'verify' || primary?.key === 'resolve'
    ? { background: 'rgba(34,197,94,0.14)', border: '1px solid rgba(34,197,94,0.40)', color: 'var(--color-success)' }
    : { background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', color: 'var(--accent)' }

  const sheetTitles: Record<Exclude<SheetKind, null>, { title: string; hint: string; cta: string; photos: boolean }> = {
    resolve: { title: 'Mark as fixed', hint: 'Add a photo of the fix so the manager can verify faster.', cta: 'Confirm fixed', photos: true },
    block:   { title: 'Flag a snag',   hint: 'What is blocking you? The store and area manager will be notified.', cta: 'Flag blocked', photos: false },
    reopen:  { title: 'Not fixed — reopen', hint: 'Tell the fixer what is still wrong.', cta: 'Reopen ticket', photos: false },
    reject:  { title: 'Reject ticket', hint: 'Why is this ticket invalid or not actionable?', cta: 'Reject ticket', photos: false },
  }

  return (
    <AppShell
      overline={`#${ticket.ticket_code}`}
      title={ticket.title}
      subtitle={ticket.sub_category ? `${ticket.category} · ${ticket.sub_category}` : ticket.category}
    >
      <div className="max-w-[1000px] pb-24 lg:pb-0">
        <Link
          href="/tickets"
          className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors mb-5"
        >
          <ArrowLeft size={12} /> Back to tickets
        </Link>

        <div className="grid gap-4 lg:gap-5 grid-cols-1 lg:grid-cols-[1fr_320px]">
          {/* Main column */}
          <div className="flex flex-col gap-4">
            {/* Blocked banner */}
            {ticket.blocked && (
              <div
                className="flex items-start gap-3 px-4 py-3.5 rounded-[14px]"
                style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.30)' }}
              >
                <OctagonAlert size={17} className="shrink-0 mt-0.5" style={{ color: 'var(--color-danger)' }} />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-bold" style={{ color: 'var(--color-danger)' }}>Blocked</p>
                  <p className="text-[12px] text-[var(--text-secondary)] mt-0.5">{ticket.blocked_reason}</p>
                  {ticket.blocked_at && (
                    <p className="text-[10px] text-[var(--text-muted)] mt-1">
                      since {formatDistanceToNow(new Date(ticket.blocked_at), { addSuffix: true })}
                    </p>
                  )}
                </div>
                {canBlockToggle && (
                  <button
                    onClick={unblock}
                    disabled={busy}
                    className="shrink-0 text-[11px] font-bold px-3 py-1.5 rounded-[8px]"
                    style={{ background: 'var(--card-bg)', border: '1px solid var(--border-primary)', color: 'var(--text-secondary)' }}
                  >
                    Unblock
                  </button>
                )}
              </div>
            )}

            {/* Header card */}
            <GlassPanel padding="lg">
              <div className="flex items-center gap-2 flex-wrap mb-3">
                <CategoryBadge category={ticket.category} />
                {ticket.sub_category && (
                  <span className="text-[11px] text-[var(--text-muted)]">{ticket.sub_category}</span>
                )}
                <SeverityBadge severity={ticket.severity} />
                <StatusPill status={ticket.status} />
                {ticket.blocked && <BlockedBadge reason={ticket.blocked_reason} />}
                {ticket.source_type && (
                  <span className="text-[10px] uppercase tracking-[0.06em] text-[var(--text-muted)]">
                    via {ticket.source_type}
                  </span>
                )}
              </div>

              {ticket.description && (
                <div className="ticket-description text-sm leading-relaxed text-[var(--text-secondary)] mb-4">
                  <ReactMarkdown
                    components={{
                      h2: ({ children }) => <h2 className="text-[13px] font-bold text-[var(--text-primary)] mt-4 mb-1.5 first:mt-0">{children}</h2>,
                      h3: ({ children }) => <h3 className="text-[12px] font-semibold text-[var(--text-secondary)] uppercase tracking-[0.06em] mt-3 mb-1 first:mt-0">{children}</h3>,
                      strong: ({ children }) => <strong className="font-semibold text-[var(--text-primary)]">{children}</strong>,
                      p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                      ul: ({ children }) => <ul className="flex flex-col gap-1 mb-2 pl-0">{children}</ul>,
                      li: ({ children }) => <li className="flex gap-2 text-[12px]"><span className="text-[var(--accent)] shrink-0 mt-0.5">·</span><span>{children}</span></li>,
                      table: ({ children }) => <div className="overflow-x-auto"><table className="w-full text-[11px] mb-2 border-collapse">{children}</table></div>,
                      th: ({ children }) => <th className="text-left font-semibold text-[var(--text-muted)] uppercase tracking-[0.06em] pb-1 pr-4">{children}</th>,
                      td: ({ children }) => <td className="text-[var(--text-secondary)] py-0.5 pr-4 border-t border-[var(--border-subtle)]">{children}</td>,
                      hr: () => <hr className="border-[var(--border-subtle)] my-3" />,
                      em: ({ children }) => <em className="text-[var(--text-muted)] not-italic text-[11px]">{children}</em>,
                      blockquote: ({ children }) => <blockquote className="pl-3 border-l-2 border-[var(--accent)] text-[var(--text-muted)] italic text-[11px] my-1">{children}</blockquote>,
                    }}
                  >
                    {ticket.description}
                  </ReactMarkdown>
                </div>
              )}

              <div className="flex gap-x-5 gap-y-2 flex-wrap text-[13px]">
                {ticket.store && (
                  <span className="inline-flex items-center gap-1.5 min-w-0">
                    <MapPin size={13} className="text-[var(--accent)] shrink-0" />
                    <span className="font-semibold text-[var(--text-primary)]">
                      {ticket.store.store_name}
                    </span>
                    <span className="text-[11px] font-medium text-[var(--text-tertiary)]">
                      · {ticket.store.region}
                    </span>
                  </span>
                )}
                {ticket.raised_by_profile && (
                  <span className="inline-flex items-center gap-1.5 text-[var(--text-secondary)]">
                    <User size={12} className="text-[var(--text-tertiary)]" />
                    {ticket.raised_by_profile.name}
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5 text-[var(--text-muted)]">
                  <Clock size={12} />
                  {format(new Date(ticket.created_at), 'dd MMM yyyy, HH:mm')}
                </span>
              </div>
            </GlassPanel>

            {/* Photo evidence */}
            {attachments.length > 0 && (
              <GlassPanel padding="md" title="Photo Evidence">
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {attachments.map((a) => (
                    <a
                      key={a.id}
                      href={a.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block aspect-square rounded-[10px] overflow-hidden"
                      style={{ border: '1px solid var(--border-primary)' }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={a.file_url} alt={a.file_name ?? 'evidence'} className="w-full h-full object-cover" loading="lazy" />
                    </a>
                  ))}
                </div>
              </GlassPanel>
            )}

            {/* Status timeline + actions */}
            <GlassPanel padding="md" title="Status">
              {ticket.status === 'rejected' ? (
                <div
                  className="flex items-center gap-3 px-4 py-3 rounded-[10px]"
                  style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}
                >
                  <span
                    className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-[11px] font-bold"
                    style={{ background: 'var(--color-danger)', color: '#fff' }}
                  >✕</span>
                  <div>
                    <p className="text-[13px] font-bold" style={{ color: 'var(--color-danger)' }}>Ticket Rejected</p>
                    <p className="text-[11px] text-[var(--text-muted)]">This ticket was rejected and will not be actioned.</p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between sm:justify-start">
                  {STATUS_ORDER.map((s, idx) => {
                    const isPast    = idx < currentStepIndex
                    const isCurrent = idx === currentStepIndex
                    const dotBg     = isCurrent ? 'var(--accent)' : isPast ? 'var(--color-success)' : 'var(--bg-tertiary)'
                    const dotBorder = isCurrent ? 'var(--accent)' : isPast ? 'var(--color-success)' : 'var(--border-primary)'
                    const labelColor = isCurrent ? 'var(--accent)' : isPast ? 'var(--color-success)' : 'var(--text-muted)'
                    return (
                      <div key={s} className="flex items-center flex-1 sm:flex-initial last:flex-initial">
                        <div className="flex flex-col items-center gap-1.5">
                          <div
                            className="w-8 h-8 rounded-full flex items-center justify-center transition-all"
                            style={{ background: dotBg, border: `2px solid ${dotBorder}` }}
                          >
                            {isPast && <CheckCircle size={13} color="var(--bg-primary)" />}
                            {isCurrent && (
                              <span className="block rounded-full" style={{ width: 8, height: 8, background: 'var(--bg-primary)' }} />
                            )}
                          </div>
                          <span
                            className="text-[9px] font-bold uppercase tracking-[0.04em] whitespace-nowrap"
                            style={{ color: labelColor }}
                          >
                            {STATUS_LABELS[s]}
                          </span>
                        </div>
                        {idx < STATUS_ORDER.length - 1 && (
                          <div
                            className="mx-1 sm:mx-2 mb-[18px] h-0.5 flex-1 sm:flex-initial sm:w-14"
                            style={{ background: idx < currentStepIndex ? 'var(--color-success)' : 'var(--border-subtle)' }}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Desktop action row (mobile uses the sticky bar) */}
              {(primary || secondary || canBlockToggle) && (
                <div className="hidden lg:flex gap-2 mt-5 flex-wrap">
                  {primary && (
                    <button
                      disabled={busy}
                      onClick={onPrimary}
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-[10px] text-[13px] font-bold transition-all disabled:opacity-50"
                      style={primaryStyle}
                    >
                      {actionIcon(primary.key)} {primary.label}
                    </button>
                  )}
                  {secondary && (
                    <button
                      disabled={busy}
                      onClick={onSecondary}
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-[10px] text-[13px] font-semibold transition-all disabled:opacity-50"
                      style={{ color: 'var(--color-danger)', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}
                    >
                      {actionIcon(secondary.key, 14)} {secondary.label}
                    </button>
                  )}
                  {canBlockToggle && !ticket.blocked && (
                    <button
                      disabled={busy}
                      onClick={() => openSheet('block')}
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-[10px] text-[13px] font-semibold transition-all disabled:opacity-50"
                      style={{ color: 'var(--color-warning)', background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.25)' }}
                    >
                      <OctagonAlert size={14} /> Flag snag
                    </button>
                  )}
                </div>
              )}
            </GlassPanel>

            {/* Comments */}
            <GlassPanel padding="md" title="Activity & Comments">
              <div className="flex flex-col gap-3 mb-5 max-h-[400px] overflow-y-auto pr-1">
                {comments.length === 0 && (
                  <p className="text-[13px] text-[var(--text-muted)] text-center py-4">
                    No activity yet
                  </p>
                )}
                {comments.map((cmt) => {
                  const isStatus = cmt.is_status_change
                  return (
                    <div
                      key={cmt.id}
                      className="px-3.5 py-2.5 rounded-[10px]"
                      style={{
                        background: isStatus ? 'var(--accent-dim)' : 'var(--card-bg)',
                        border: `1px solid ${isStatus ? 'var(--accent-border)' : 'var(--border-subtle)'}`,
                      }}
                    >
                      <div
                        className="text-[12px] leading-relaxed"
                        style={{ color: isStatus ? 'var(--accent)' : 'var(--text-primary)' }}
                      >
                        {cmt.content}
                      </div>
                      <div className="text-[11px] text-[var(--text-muted)] mt-1">
                        {formatDistanceToNow(new Date(cmt.created_at), { addSuffix: true })}
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="flex gap-2">
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && e.metaKey) addComment() }}
                  placeholder="Add a comment or update…"
                  rows={2}
                  className="prism-input flex-1"
                  style={{ resize: 'none' }}
                />
                <Button
                  variant="primary"
                  size="md"
                  disabled={submitting || !comment.trim()}
                  onClick={addComment}
                  className="self-end"
                >
                  <Send size={14} />
                </Button>
              </div>
            </GlassPanel>
          </div>

          {/* Sidebar */}
          <div className="flex flex-col gap-4">
            {status !== 'closed' && ticket.status !== 'rejected' && (
              <GlassPanel padding="md" title="SLA Status">
                <SlaCountdown deadline={ticket.sla_deadline} />
              </GlassPanel>
            )}

            {/* Linked asset (scan-to-report tickets) */}
            {asset && (
              <GlassPanel
                padding="md"
                title={
                  <span className="inline-flex items-center gap-1.5">
                    <QrCode size={12} className="text-[var(--accent)]" /> Asset
                  </span>
                }
              >
                <Link href={`/assets/view?id=${asset.id}`} className="block" style={{ textDecoration: 'none' }}>
                  <p className="text-[13px] font-bold text-[var(--text-primary)]">{asset.name}</p>
                  <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                    {asset.asset_code}{asset.category ? ` · ${asset.category.name}` : ''}
                  </p>
                </Link>
                <div className="mt-2.5">
                  <CoverageBadge asset={asset} />
                </div>
                {asset.amc_vendor && (
                  <div
                    className="mt-3 px-3 py-2.5 rounded-[10px]"
                    style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)' }}
                  >
                    <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                      AMC — route to vendor
                    </p>
                    <p className="text-[12px] font-semibold text-[var(--text-primary)] mt-0.5">{asset.amc_vendor.name}</p>
                    {asset.amc_vendor.phone && (
                      <a href={`tel:${asset.amc_vendor.phone}`} className="inline-flex items-center gap-1.5 text-[11px] text-[var(--accent)] mt-1">
                        <Phone size={10} /> {asset.amc_vendor.phone}
                      </a>
                    )}
                  </div>
                )}
              </GlassPanel>
            )}

            <GlassPanel padding="md" title="Details">
              <div className="flex flex-col gap-2.5">
                {[
                  { label: 'Ticket ID',      value: `#${ticket.ticket_code}` },
                  { label: 'Source',         value: ticket.source_type },
                  { label: 'Reopened',       value: `${ticket.reopen_count}×` },
                  { label: 'Assigned to',    value: ticket.assigned_to_profile?.name || 'Department queue' },
                  { label: 'First Response', value: ticket.first_response_at ? formatDistanceToNow(new Date(ticket.first_response_at), { addSuffix: true }) : '—' },
                  { label: 'Resolved',       value: ticket.resolved_at ? format(new Date(ticket.resolved_at), 'dd MMM, HH:mm') : '—' },
                  { label: 'Closed',         value: ticket.closed_at ? format(new Date(ticket.closed_at), 'dd MMM, HH:mm') : '—' },
                ].map(({ label, value }) => (
                  <div key={label} className="flex justify-between items-center">
                    <span className="text-xs text-[var(--text-muted)]">{label}</span>
                    <span className="text-xs font-semibold text-[var(--text-secondary)] text-right max-w-[160px] capitalize">
                      {value}
                    </span>
                  </div>
                ))}
              </div>
            </GlassPanel>

            {escalations.length > 0 && (
              <GlassPanel
                padding="md"
                title={
                  <span className="inline-flex items-center gap-1.5">
                    <AlertTriangle size={12} className="text-[var(--color-warning)]" />
                    Escalations
                  </span>
                }
              >
                <div className="flex flex-col gap-2">
                  {escalations.map((esc) => {
                    const color = esc.level >= 3 ? 'var(--color-danger)' : 'var(--color-warning)'
                    const bg    = esc.level >= 3 ? 'rgba(239,68,68,0.08)' : 'rgba(234,179,8,0.08)'
                    const people = (esc.policy?.escalation_policy_people ?? [])
                      .map((j) => j.profile ?? j.employee)
                      .filter((p): p is RungPerson => p != null)
                    return (
                      <div
                        key={esc.id}
                        className="px-3 py-2 rounded-[10px]"
                        style={{ background: bg, border: `1px solid ${color}33` }}
                      >
                        <div className="text-[12px] font-bold mb-0.5" style={{ color }}>
                          Level {esc.level}
                        </div>
                        <div className="text-[11px] text-[var(--text-secondary)]">
                          {people.length > 0
                            ? `Notified: ${people.map((p) => p.name).join(', ')}`
                            : (ESCALATION_LABELS[esc.level] ?? 'Escalation')}
                        </div>
                        <div className="text-[11px] text-[var(--text-muted)]">
                          {esc.reason.replace(/_/g, ' ')} · {formatDistanceToNow(new Date(esc.triggered_at), { addSuffix: true })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </GlassPanel>
            )}

            {/* Intelligence panel — only for auto-created tickets */}
            {ticket.intelligence_source && (
              <GlassPanel
                padding="md"
                title={
                  <span className="inline-flex items-center gap-1.5">
                    <Sparkles size={12} style={{ color: '#a78bfa' }} />
                    <span style={{ color: '#a78bfa' }}>Prism Intelligence</span>
                  </span>
                }
              >
                <div className="flex flex-col gap-3">
                  {ticket.intelligence_audit_pct != null && (
                    <div>
                      <div className="flex justify-between text-[11px] mb-1">
                        <span className="text-[var(--text-muted)]">Audit score</span>
                        <span
                          className="font-bold"
                          style={{
                            color: ticket.intelligence_audit_pct >= 80
                              ? 'var(--color-success)'
                              : ticket.intelligence_audit_pct >= 60
                                ? 'var(--color-warning)'
                                : 'var(--color-danger)',
                          }}
                        >
                          {ticket.intelligence_audit_pct.toFixed(1)}%
                        </span>
                      </div>
                      <div
                        className="w-full rounded-full overflow-hidden"
                        style={{ height: 5, background: 'var(--bg-tertiary)' }}
                      >
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${ticket.intelligence_audit_pct}%`,
                            background: ticket.intelligence_audit_pct >= 80
                              ? 'var(--color-success)'
                              : ticket.intelligence_audit_pct >= 60
                                ? 'var(--color-warning)'
                                : 'var(--color-danger)',
                          }}
                        />
                      </div>
                    </div>
                  )}

                  <div className="flex flex-col gap-2">
                    {[
                      { label: 'Program',  value: ticket.intelligence_program_name },
                      { label: 'Store code', value: ticket.intelligence_store_code },
                      {
                        label: 'AI confidence',
                        value: ticket.intelligence_ai_confidence != null
                          ? `${Math.round(ticket.intelligence_ai_confidence * 100)}%`
                          : null,
                      },
                      { label: 'Suggested role', value: ticket.intelligence_suggested_role },
                    ]
                      .filter((r) => r.value)
                      .map(({ label, value }) => (
                        <div key={label} className="flex justify-between items-center">
                          <span className="text-[11px] text-[var(--text-muted)]">{label}</span>
                          <span className="text-[11px] font-semibold text-[var(--text-secondary)] text-right max-w-[140px] truncate">
                            {value}
                          </span>
                        </div>
                      ))}
                  </div>

                  {ticket.intelligence_pattern_flag && (
                    <div
                      className="flex items-start gap-2 px-3 py-2 rounded-[10px] text-[11px]"
                      style={{
                        background: 'rgba(234,179,8,0.08)',
                        border: '1px solid rgba(234,179,8,0.25)',
                        color: 'var(--color-warning)',
                      }}
                    >
                      <RefreshCw size={11} className="mt-0.5 shrink-0" />
                      <span>{ticket.intelligence_pattern_note ?? 'Recurring issue detected at this store'}</span>
                    </div>
                  )}

                  {status === 'closed' && (
                    <div
                      className="flex items-start gap-2 px-3 py-2 rounded-[10px] text-[11px]"
                      style={{
                        background: 'rgba(34,197,94,0.08)',
                        border: '1px solid rgba(34,197,94,0.25)',
                        color: 'var(--color-success)',
                      }}
                    >
                      <BadgeCheck size={11} className="mt-0.5 shrink-0" />
                      <span>Audit tickets auto-close when the next audit finds the issue resolved.</span>
                    </div>
                  )}

                  {ticket.intelligence_submission_id && (
                    <a
                      href={`${process.env.NEXT_PUBLIC_INTELLIGENCE_APP_URL ?? '#'}/submissions/${ticket.intelligence_submission_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-1.5 text-[11px] font-semibold rounded-[8px] py-2 transition-colors"
                      style={{
                        color: '#a78bfa',
                        background: 'rgba(139,92,246,0.10)',
                        border: '1px solid rgba(139,92,246,0.20)',
                      }}
                    >
                      <ExternalLink size={11} />
                      View in Prism Intelligence
                    </a>
                  )}
                </div>
              </GlassPanel>
            )}

            {/* Super-admin delete */}
            {profile?.role === 'super_admin' && (
              <GlassPanel padding="md">
                {!confirmDelete ? (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="w-full flex items-center justify-center gap-2 text-[12px] font-semibold rounded-[8px] py-2 transition-colors"
                    style={{
                      color: 'var(--color-danger)',
                      background: 'rgba(239,68,68,0.07)',
                      border: '1px solid rgba(239,68,68,0.20)',
                    }}
                  >
                    <Trash2 size={13} />
                    Delete Ticket
                  </button>
                ) : (
                  <div className="flex flex-col gap-2">
                    <p className="text-[11px] text-[var(--color-danger)] text-center font-semibold">
                      Permanently delete this ticket?
                    </p>
                    <p className="text-[10px] text-[var(--text-muted)] text-center">
                      This cannot be undone. All comments and escalation history will be removed.
                    </p>
                    <div className="flex gap-2 mt-1">
                      <button
                        onClick={() => setConfirmDelete(false)}
                        disabled={deleting}
                        className="flex-1 text-[11px] font-semibold rounded-[8px] py-1.5 transition-colors"
                        style={{
                          color: 'var(--text-secondary)',
                          background: 'var(--bg-tertiary)',
                          border: '1px solid var(--border-subtle)',
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={deleteTicket}
                        disabled={deleting}
                        className="flex-1 text-[11px] font-bold rounded-[8px] py-1.5 transition-colors"
                        style={{
                          color: '#fff',
                          background: 'var(--color-danger)',
                          opacity: deleting ? 0.6 : 1,
                        }}
                      >
                        {deleting ? 'Deleting…' : 'Yes, Delete'}
                      </button>
                    </div>
                  </div>
                )}
              </GlassPanel>
            )}
          </div>
        </div>
      </div>

      {/* ── Mobile sticky action bar (above the bottom nav) ─────────────── */}
      {(primary || secondary || canBlockToggle) && (
        <div
          className="fixed left-0 right-0 z-40 lg:hidden px-4 py-3 flex gap-2"
          style={{
            bottom: 'calc(62px + env(safe-area-inset-bottom))',
            background: 'color-mix(in oklab, var(--bg-secondary) 92%, transparent)',
            borderTop: '1px solid var(--border-primary)',
            backdropFilter: 'blur(16px) saturate(1.2)',
            WebkitBackdropFilter: 'blur(16px) saturate(1.2)',
          }}
        >
          {canBlockToggle && !ticket.blocked && (
            <button
              disabled={busy}
              onClick={() => openSheet('block')}
              aria-label="Flag snag"
              className="w-12 shrink-0 rounded-[12px] flex items-center justify-center disabled:opacity-50"
              style={{ color: 'var(--color-warning)', background: 'rgba(234,179,8,0.10)', border: '1px solid rgba(234,179,8,0.30)' }}
            >
              <OctagonAlert size={18} />
            </button>
          )}
          {secondary && (
            <button
              disabled={busy}
              onClick={onSecondary}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-[12px] py-3 text-[13px] font-bold disabled:opacity-50"
              style={{ color: 'var(--color-danger)', background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.30)' }}
            >
              {actionIcon(secondary.key, 14)} {secondary.label}
            </button>
          )}
          {primary && (
            <button
              disabled={busy}
              onClick={onPrimary}
              className="flex-[1.4] inline-flex items-center justify-center gap-2 rounded-[12px] py-3 text-[14px] font-extrabold disabled:opacity-50"
              style={primaryStyle}
            >
              {actionIcon(primary.key, 16)} {busy ? 'Working…' : primary.label}
            </button>
          )}
        </div>
      )}

      {/* ── Action sheet ─────────────────────────────────────────────────── */}
      {sheet && (
        <div className="fixed inset-0 z-[70]">
          <button
            aria-label="Close"
            className="absolute inset-0"
            style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)' }}
            onClick={() => setSheet(null)}
          />
          <div
            className="absolute bottom-0 left-0 right-0 lg:bottom-auto lg:top-1/2 lg:left-1/2 lg:right-auto lg:-translate-x-1/2 lg:-translate-y-1/2 lg:w-[440px] lg:rounded-[20px] rounded-t-[22px] p-5 animate-fadeInUp"
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-primary)',
              paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)',
            }}
          >
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-[15px] font-bold text-[var(--text-primary)]">{sheetTitles[sheet].title}</h3>
              <button
                aria-label="Close"
                onClick={() => setSheet(null)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--text-muted)]"
                style={{ background: 'var(--card-bg)', border: '1px solid var(--border-subtle)' }}
              >
                <X size={14} />
              </button>
            </div>
            <p className="text-[12px] text-[var(--text-muted)] mb-4">{sheetTitles[sheet].hint}</p>

            <textarea
              value={sheetNote}
              onChange={(e) => setSheetNote(e.target.value)}
              placeholder={sheet === 'resolve' ? 'What did you do? (optional)' : 'Reason…'}
              rows={2}
              autoFocus
              className="prism-input mb-3"
              style={{ resize: 'none' }}
            />

            {sheetTitles[sheet].photos && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  className="hidden"
                  onChange={(e) => { addSheetPhotos(e.target.files); e.target.value = '' }}
                />
                <div className="flex gap-2 flex-wrap mb-4">
                  {sheetPreviews.map((src, i) => (
                    <div key={src} className="relative w-[64px] h-[64px] rounded-[10px] overflow-hidden"
                         style={{ border: '1px solid var(--border-primary)' }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt={`fix ${i + 1}`} className="w-full h-full object-cover" />
                      <button
                        type="button"
                        aria-label="Remove photo"
                        onClick={() => {
                          URL.revokeObjectURL(sheetPreviews[i])
                          setSheetPhotos((p) => p.filter((_, idx) => idx !== i))
                          setSheetPreviews((p) => p.filter((_, idx) => idx !== i))
                        }}
                        className="absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center"
                        style={{ background: 'rgba(0,0,0,0.65)', color: '#fff' }}
                      >
                        <X size={10} />
                      </button>
                    </div>
                  ))}
                  {sheetPhotos.length < 4 && (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-[64px] h-[64px] rounded-[10px] flex flex-col items-center justify-center gap-0.5 text-[var(--text-muted)]"
                      style={{ background: 'var(--bg-tertiary)', border: '1px dashed var(--border-primary)' }}
                    >
                      <Camera size={16} />
                      <span className="text-[8px] font-bold uppercase">Photo</span>
                    </button>
                  )}
                </div>
              </>
            )}

            {sheet === 'resolve' && storeParts.length > 0 && (
              <div className="mb-4">
                <label className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-tertiary)] mb-1.5">
                  <Package size={11} /> Used a spare part? (optional)
                </label>
                <div className="flex gap-2">
                  <select value={usePartId} onChange={(e) => setUsePartId(e.target.value)} className="prism-input flex-1">
                    <option value="">None</option>
                    {storeParts.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} ({p.qty_on_hand} on hand)</option>
                    ))}
                  </select>
                  {usePartId && (
                    <input
                      type="number"
                      min="1"
                      value={usePartQty}
                      onChange={(e) => setUsePartQty(e.target.value)}
                      className="prism-input"
                      style={{ width: 64 }}
                    />
                  )}
                </div>
              </div>
            )}

            <button
              disabled={busy || (sheet !== 'resolve' && !sheetNote.trim())}
              onClick={confirmSheet}
              className="w-full btn-primary justify-center disabled:opacity-50"
              style={{ padding: '13px 18px', fontSize: 14 }}
            >
              {busy ? 'Working…' : sheetTitles[sheet].cta}
            </button>
          </div>
        </div>
      )}
    </AppShell>
  )
}

export default function TicketDetailPage() {
  return (
    <Suspense fallback={
      <AppShell overline="Ticket" title="Loading…">
        <div className="flex flex-col gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 120 }} />
          ))}
        </div>
      </AppShell>
    }>
      <TicketDetailInner />
    </Suspense>
  )
}
