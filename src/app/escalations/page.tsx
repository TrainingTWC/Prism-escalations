'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AppShell } from '@/components/layout/AppShell'
import { GlassPanel } from '@/components/ui/GlassPanel'
import { StatCard } from '@/components/ui/StatCard'
import { SeverityBadge, StatusPill } from '@/components/tickets/Badges'
import { supabase } from '@/lib/supabase/client'
import { ESCALATION_LABELS } from '@/lib/ticket-utils'
import { AlertTriangle, ArrowRight, CheckCircle, Shield, ShieldAlert, Siren, Crown } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

interface EscalationRow {
  id: string
  level: number
  reason: string
  triggered_at: string
  resolved: boolean
  ticket_id: string
  ticket?: {
    id: string
    title: string
    severity: string
    status: string
    store?: { store_name: string }
  } | null
}

const LEVEL_META: Record<number, { color: string; icon: React.ReactNode }> = {
  1: { color: 'var(--color-warning)', icon: <Shield size={14} /> },
  2: { color: 'var(--color-danger)',  icon: <ShieldAlert size={14} /> },
  3: { color: 'var(--color-danger)',  icon: <Siren size={14} /> },
  4: { color: 'var(--accent)',        icon: <Crown size={14} /> },
}

export default function EscalationsPage() {
  const [escalations, setEscalations] = useState<EscalationRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetch = async () => {
      const { data } = await supabase
        .from('escalations')
        .select(`*, ticket:tickets(*, store:stores(*))`)
        .eq('resolved', false)
        .order('triggered_at', { ascending: false })
      setEscalations((data as unknown as EscalationRow[]) || [])
      setLoading(false)
    }
    fetch()

    const channel = supabase
      .channel('escalations-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'escalations' }, fetch)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  const byLevel = (level: number) => escalations.filter((e) => e.level === level)

  return (
    <AppShell
      overline="Escalation Engine"
      title="Active Escalations"
      subtitle="Tickets that have breached SLA or require leadership attention."
    >
      {/* Summary row */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4 mb-7">
        {[1, 2, 3, 4].map((level) => {
          const meta = LEVEL_META[level]
          const count = byLevel(level).length
          return (
            <StatCard
              key={level}
              label={`Level ${level}`}
              value={loading ? '—' : count}
              subtitle={ESCALATION_LABELS[level]}
              icon={meta.icon}
              accent={meta.color}
              index={level - 1}
            />
          )
        })}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex flex-col gap-2.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 80 }} />
          ))}
        </div>
      ) : escalations.length === 0 ? (
        <GlassPanel padding="lg" className="text-center">
          <CheckCircle size={32} className="mx-auto mb-3 text-[var(--color-success)]" />
          <p className="text-[14px] font-semibold text-[var(--text-secondary)]">No active escalations</p>
          <p className="text-xs text-[var(--text-muted)] mt-1">All tickets are operating within SLA.</p>
        </GlassPanel>
      ) : (
        <div className="flex flex-col gap-2.5">
          {escalations.map((esc, i) => {
            const meta = LEVEL_META[esc.level] ?? LEVEL_META[1]
            return (
              <Link
                key={esc.id}
                href={`/tickets/${esc.ticket_id}`}
                className="block animate-fadeInUp"
                style={{ animationDelay: `${i * 40}ms`, textDecoration: 'none' }}
              >
                <article
                  className="glass glass-interactive flex items-center gap-4 px-5 py-3.5"
                  style={{ borderLeft: `3px solid ${meta.color}` }}
                >
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: `${meta.color}1F`, color: meta.color }}
                  >
                    <AlertTriangle size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span
                        className="text-[11px] font-bold uppercase tracking-[0.05em]"
                        style={{ color: meta.color }}
                      >
                        Level {esc.level} — {ESCALATION_LABELS[esc.level]}
                      </span>
                      {esc.ticket && <SeverityBadge severity={esc.ticket.severity} />}
                      {esc.ticket && <StatusPill status={esc.ticket.status} />}
                    </div>
                    <div className="text-sm font-semibold text-[var(--text-primary)] truncate">
                      {esc.ticket?.title || 'Unknown ticket'}
                    </div>
                    <div className="text-xs text-[var(--text-muted)] mt-0.5">
                      {esc.reason.replace(/_/g, ' ')} · {formatDistanceToNow(new Date(esc.triggered_at), { addSuffix: true })}
                      {esc.ticket?.store && ` · ${esc.ticket.store.store_name}`}
                    </div>
                  </div>
                  <ArrowRight size={14} className="text-[var(--text-muted)]" />
                </article>
              </Link>
            )
          })}
        </div>
      )}
    </AppShell>
  )
}

