'use client'

import { STATUS_LABELS } from '@/lib/ticket-utils'

interface SeverityBadgeProps { severity: string; size?: 'sm' | 'md' }
interface StatusPillProps { status: string; size?: 'sm' | 'md' }

const SEVERITY_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  P0: { color: 'var(--color-danger)',   bg: 'rgba(239, 68, 68, 0.10)',   label: 'P0 · Critical' },
  P1: { color: 'var(--color-warning)',  bg: 'rgba(234, 179, 8, 0.10)',   label: 'P1 · High' },
  P2: { color: 'var(--color-info)',     bg: 'rgba(59, 130, 246, 0.10)',  label: 'P2 · Medium' },
  P3: { color: 'var(--text-tertiary)',  bg: 'rgba(122, 122, 136, 0.10)', label: 'P3 · Low' },
  // Legacy fallbacks
  critical: { color: 'var(--color-danger)',   bg: 'rgba(239, 68, 68, 0.10)',   label: 'P0 · Critical' },
  high:     { color: 'var(--color-warning)',  bg: 'rgba(234, 179, 8, 0.10)',   label: 'P1 · High' },
  medium:   { color: 'var(--color-info)',     bg: 'rgba(59, 130, 246, 0.10)',  label: 'P2 · Medium' },
  low:      { color: 'var(--text-tertiary)',  bg: 'rgba(122, 122, 136, 0.10)', label: 'P3 · Low' },
}

const STATUS_CONFIG: Record<string, { color: string; bg: string }> = {
  open:         { color: 'var(--accent)',         bg: 'var(--accent-dim)' },
  acknowledged: { color: 'var(--color-info)',     bg: 'rgba(59,130,246,0.10)' },
  accepted:     { color: 'var(--color-info)',     bg: 'rgba(59,130,246,0.10)' },
  in_progress:  { color: 'var(--color-info)',     bg: 'rgba(59,130,246,0.10)' },
  waiting:      { color: 'var(--color-warning)',  bg: 'rgba(234,179,8,0.10)' },
  snag:         { color: 'var(--color-danger)',   bg: 'rgba(239,68,68,0.10)' },
  resolved:     { color: 'var(--color-success)',  bg: 'rgba(34,197,94,0.10)' },
  verification: { color: 'var(--accent)',         bg: 'var(--accent-dim)' },
  closed:       { color: 'var(--text-muted)',     bg: 'rgba(122,122,136,0.10)' },
}

export function SeverityBadge({ severity, size = 'sm' }: SeverityBadgeProps) {
  const cfg = SEVERITY_CONFIG[severity] ?? SEVERITY_CONFIG.P2
  const fontSize = size === 'sm' ? 10 : 11
  return (
    <span
      className="badge-pill"
      style={{
        fontSize,
        color: cfg.color,
        background: cfg.bg,
        border: `1px solid ${cfg.color}33`,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        fontWeight: 700,
        padding: size === 'sm' ? '3px 8px' : '4px 12px',
      }}
    >
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: cfg.color }} />
      {cfg.label}
    </span>
  )
}

export function StatusPill({ status, size = 'sm' }: StatusPillProps) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.open
  const fontSize = size === 'sm' ? 10 : 11
  return (
    <span
      className="badge-pill"
      style={{
        fontSize,
        color: cfg.color,
        background: cfg.bg,
        fontWeight: 600,
        letterSpacing: '0.04em',
        padding: size === 'sm' ? '3px 10px' : '4px 14px',
      }}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  )
}

export function CategoryBadge({ category }: { category: string }) {
  return (
    <span
      className="text-[10px] font-bold uppercase tracking-[0.10em]"
      style={{ color: 'var(--text-tertiary)' }}
    >
      {category}
    </span>
  )
}

/** Badge shown on tickets auto-created by Prism Intelligence */
export function AutoSourceBadge({ confidence }: { confidence?: number | null }) {
  const pct = confidence != null ? Math.round(confidence * 100) : null
  return (
    <span
      className="badge-pill inline-flex items-center gap-1"
      style={{
        fontSize: 10,
        color: '#a78bfa',
        background: 'rgba(139,92,246,0.12)',
        border: '1px solid rgba(139,92,246,0.30)',
        fontWeight: 600,
        letterSpacing: '0.04em',
        padding: '3px 8px',
      }}
    >
      {/* Sparkle icon via unicode */}
      <span style={{ fontSize: 9 }}>✦</span>
      Auto · AI{pct != null ? ` ${pct}%` : ''}
    </span>
  )
}

/** Warning badge for recurring/pattern failures */
export function PatternBadge() {
  return (
    <span
      className="badge-pill inline-flex items-center gap-1"
      style={{
        fontSize: 10,
        color: 'var(--color-warning)',
        background: 'rgba(234,179,8,0.10)',
        border: '1px solid rgba(234,179,8,0.25)',
        fontWeight: 600,
        letterSpacing: '0.04em',
        padding: '3px 8px',
      }}
    >
      ↻ Recurring
    </span>
  )
}

