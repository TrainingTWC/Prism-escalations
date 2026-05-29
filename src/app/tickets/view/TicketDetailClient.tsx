'use client'

import { useCallback, useEffect, useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { AppShell } from '@/components/layout/AppShell'
import { GlassPanel } from '@/components/ui/GlassPanel'
import { Button } from '@/components/ui/Button'
import { SlaCountdown } from '@/components/tickets/SlaCountdown'
import { SeverityBadge, StatusPill, CategoryBadge } from '@/components/tickets/Badges'
import { supabase } from '@/lib/supabase/client'
import { useAuthStore } from '@/store/auth.store'
import { STATUS_FLOW, STATUS_LABELS, ESCALATION_LABELS } from '@/lib/ticket-utils'
import type { TicketWithRelations, Comment, Escalation } from '@/lib/supabase/database.types'
import { formatDistanceToNow, format } from 'date-fns'
import ReactMarkdown from 'react-markdown'
import {
  ArrowLeft, MapPin, User, Clock, Send, AlertTriangle,
  CheckCircle, ChevronRight, Sparkles, RefreshCw, ExternalLink, Trash2,
} from 'lucide-react'

const STATUS_ORDER = ['open', 'acknowledged', 'accepted', 'in_progress', 'waiting', 'snag', 'resolved', 'verification', 'closed']

type TicketUpdate = {
  status: string
  updated_at: string
  first_response_at?: string
  resolved_at?: string
  closed_at?: string
}

function TicketDetailInner() {
  const searchParams = useSearchParams()
  const id = searchParams.get('id')
  const { profile } = useAuthStore()
  const router = useRouter()
  const [ticket, setTicket] = useState<TicketWithRelations | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [escalations, setEscalations] = useState<Escalation[]>([])
  const [loading, setLoading] = useState(true)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [transitioning, setTransitioning] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

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
      .from('escalations').select('*').eq('ticket_id', id).order('triggered_at', { ascending: true })

    setTicket(tkt as unknown as TicketWithRelations)
    setComments(cmts || [])
    setEscalations(escs || [])
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

  const transitionStatus = async (newStatus: string) => {
    if (!ticket || !profile) return
    setTransitioning(true)

    const updates: TicketUpdate = {
      status: newStatus,
      updated_at: new Date().toISOString(),
    }
    if (newStatus === 'acknowledged' && !ticket.first_response_at) {
      updates.first_response_at = new Date().toISOString()
    }
    if (newStatus === 'resolved') updates.resolved_at = new Date().toISOString()
    if (newStatus === 'closed')   updates.closed_at   = new Date().toISOString()

    await supabase.from('tickets').update(updates as never).eq('id', ticket.id)
    await supabase.from('comments').insert({
      ticket_id: ticket.id,
      author_id: profile.id,
      content: `Status changed from ${STATUS_LABELS[ticket.status]} to ${STATUS_LABELS[newStatus]}`,
      is_status_change: true,
      old_status: ticket.status,
      new_status: newStatus,
    } as never)
    setTransitioning(false)
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
          <p className="text-[var(--text-muted)]">Ticket not found.</p>
        </GlassPanel>
      </AppShell>
    )
  }

  const nextStatuses = STATUS_FLOW[ticket.status] || []
  const currentStepIndex = STATUS_ORDER.indexOf(ticket.status)

  return (
    <AppShell
      overline={`#${ticket.ticket_code}`}
      title={ticket.title}
      subtitle={ticket.sub_category ? `${ticket.category} · ${ticket.sub_category}` : ticket.category}
    >
      <div className="max-w-[1000px]">
        <Link
          href="/tickets"
          className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors mb-6"
        >
          <ArrowLeft size={12} /> Back to tickets
        </Link>

        <div className="grid gap-5 grid-cols-1 lg:grid-cols-[1fr_320px]">
          {/* Main column */}
          <div className="flex flex-col gap-4">
            {/* Header card */}
            <GlassPanel padding="lg">
              <div className="flex items-center gap-2 flex-wrap mb-3">
                <CategoryBadge category={ticket.category} />
                {ticket.sub_category && (
                  <span className="text-[11px] text-[var(--text-muted)]">{ticket.sub_category}</span>
                )}
                <SeverityBadge severity={ticket.severity} />
                <StatusPill status={ticket.status} />
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
                      table: ({ children }) => <table className="w-full text-[11px] mb-2 border-collapse">{children}</table>,
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

              <div className="flex gap-5 flex-wrap text-[13px]">
                {ticket.store && (
                  <span className="inline-flex items-center gap-1.5 text-[var(--text-secondary)]">
                    <MapPin size={12} className="text-[var(--accent)]" />
                    {ticket.store.store_name}
                    <span className="text-[var(--text-muted)]">· {ticket.store.region}</span>
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

            {/* Status timeline */}
            <GlassPanel padding="md" title="Status Timeline">
              <div className="flex items-center overflow-x-auto pb-1">
                {STATUS_ORDER.map((status, idx) => {
                  const isPast    = idx < currentStepIndex
                  const isCurrent = idx === currentStepIndex
                  const dotBg    = isCurrent ? 'var(--accent)' : isPast ? 'var(--color-success)' : 'var(--bg-tertiary)'
                  const dotBorder = isCurrent ? 'var(--accent)' : isPast ? 'var(--color-success)' : 'var(--border-primary)'
                  const labelColor = isCurrent ? 'var(--accent)' : isPast ? 'var(--color-success)' : 'var(--text-muted)'
                  return (
                    <div key={status} className="flex items-center">
                      <div className="flex flex-col items-center gap-1">
                        <div
                          className="w-7 h-7 rounded-full flex items-center justify-center transition-all"
                          style={{ background: dotBg, border: `2px solid ${dotBorder}` }}
                        >
                          {isPast && <CheckCircle size={12} color="var(--bg-primary)" />}
                          {isCurrent && (
                            <span
                              className="block rounded-full"
                              style={{ width: 8, height: 8, background: 'var(--bg-primary)' }}
                            />
                          )}
                        </div>
                        <span
                          className="text-[9px] font-bold uppercase tracking-[0.04em] whitespace-nowrap"
                          style={{ color: labelColor }}
                        >
                          {STATUS_LABELS[status]}
                        </span>
                      </div>
                      {idx < STATUS_ORDER.length - 1 && (
                        <div
                          className="mx-0.5 mb-[18px] h-0.5 shrink-0"
                          style={{
                            width: 32,
                            background: idx < currentStepIndex ? 'var(--color-success)' : 'var(--border-subtle)',
                          }}
                        />
                      )}
                    </div>
                  )
                })}
              </div>

              {nextStatuses.length > 0 && (
                <div className="flex gap-2 mt-4 flex-wrap">
                  {nextStatuses.map((next) => (
                    <Button
                      key={next}
                      variant="ghost"
                      size="sm"
                      disabled={transitioning}
                      onClick={() => transitionStatus(next)}
                      trailing={<ChevronRight size={12} />}
                    >
                      Move to {STATUS_LABELS[next]}
                    </Button>
                  ))}
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
            <GlassPanel padding="md" title="SLA Status">
              <SlaCountdown deadline={ticket.sla_deadline} />
            </GlassPanel>

            <GlassPanel padding="md" title="Details">
              <div className="flex flex-col gap-2.5">
                {[
                  { label: 'Ticket ID',      value: `#${ticket.ticket_code}` },
                  { label: 'Source',         value: ticket.source_type },
                  { label: 'Reopened',       value: `${ticket.reopen_count}×` },
                  { label: 'Assigned to',    value: ticket.assigned_to_profile?.name || 'Unassigned' },
                  { label: 'First Response', value: ticket.first_response_at ? formatDistanceToNow(new Date(ticket.first_response_at), { addSuffix: true }) : '—' },
                  { label: 'Resolved',       value: ticket.resolved_at ? format(new Date(ticket.resolved_at), 'dd MMM, HH:mm') : '—' },
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
                    return (
                      <div
                        key={esc.id}
                        className="px-3 py-2 rounded-[10px]"
                        style={{ background: bg, border: `1px solid ${color}33` }}
                      >
                        <div className="text-[12px] font-bold mb-0.5" style={{ color }}>
                          Level {esc.level} — {ESCALATION_LABELS[esc.level]}
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

                  {/* Audit score bar */}
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

                  {/* Metadata rows */}
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

                  {/* Recurring pattern warning */}
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

                  {/* Failing checkpoints */}
                  {Array.isArray(ticket.intelligence_deductions) && ticket.intelligence_deductions.length > 0 && (
                    <div>
                      <p className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-[0.06em] mb-2">
                        Failed checkpoints
                      </p>
                      <div className="flex flex-col gap-1.5">
                        {(ticket.intelligence_deductions as Array<{
                          questionText: string
                          scoreEarned: number
                          weightMax: number
                          isCritical: boolean
                          comment?: string
                        }>).map((q, i) => (
                          <div
                            key={i}
                            className="px-2.5 py-2 rounded-[8px] text-[11px]"
                            style={{
                              background: 'var(--bg-tertiary)',
                              border: `1px solid ${q.isCritical ? 'rgba(239,68,68,0.25)' : 'var(--border-subtle)'}`,
                            }}
                          >
                            <div className="flex justify-between gap-2 mb-0.5">
                              <span
                                className="text-[var(--text-secondary)] leading-tight"
                                style={{ flex: 1 }}
                              >
                                {q.questionText}
                              </span>
                              <span
                                className="font-mono font-bold shrink-0"
                                style={{
                                  color: q.scoreEarned === 0 ? 'var(--color-danger)' : 'var(--color-warning)',
                                }}
                              >
                                {q.scoreEarned}/{q.weightMax}
                              </span>
                            </div>
                            {q.comment && (
                              <p className="text-[10px] text-[var(--text-muted)] italic mt-0.5">
                                &ldquo;{q.comment}&rdquo;
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Deep link to Intelligence */}
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
