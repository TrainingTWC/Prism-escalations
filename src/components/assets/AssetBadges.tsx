'use client'

import { ASSET_STATUS_META, COVERAGE_META, coverageState } from '@/lib/asset-utils'
import type { Asset } from '@/lib/supabase/database.types'
import { ShieldCheck, ShieldAlert, ShieldX, Shield } from 'lucide-react'

export function AssetStatusBadge({ status }: { status: string }) {
  const meta = ASSET_STATUS_META[status] ?? ASSET_STATUS_META.active
  return (
    <span
      className="badge-pill"
      style={{
        fontSize: 10,
        color: meta.color,
        background: meta.bg,
        fontWeight: 700,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        padding: '3px 9px',
      }}
    >
      {meta.label}
    </span>
  )
}

const COVERAGE_ICON = {
  covered: ShieldCheck,
  expiring: ShieldAlert,
  expired: ShieldX,
  none: Shield,
} as const

/** Warranty / AMC coverage pill — AMC wins over warranty when both exist. */
export function CoverageBadge({ asset, showKind = true }: { asset: Asset; showKind?: boolean }) {
  const { kind, state } = coverageState(asset)
  const meta = COVERAGE_META[state]
  const Icon = COVERAGE_ICON[state]
  const kindLabel = kind === 'amc' ? 'AMC' : kind === 'warranty' ? 'Warranty' : ''
  return (
    <span
      className="badge-pill inline-flex items-center gap-1"
      style={{
        fontSize: 10,
        color: meta.color,
        background: meta.bg,
        border: `1px solid ${meta.color}33`,
        fontWeight: 600,
        letterSpacing: '0.03em',
        padding: '3px 8px',
      }}
    >
      <Icon size={10} />
      {showKind && kindLabel ? `${kindLabel} · ` : ''}{meta.label}
    </span>
  )
}
