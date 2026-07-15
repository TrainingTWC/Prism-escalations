import type { Asset, AssetPmTask, Profile } from '@/lib/supabase/database.types'

// ─── Status ──────────────────────────────────────────────────────────────────

export const ASSET_STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  active:    { label: 'Active',    color: 'var(--color-success)', bg: 'rgba(34,197,94,0.10)' },
  in_repair: { label: 'In Repair', color: 'var(--color-warning)', bg: 'rgba(234,179,8,0.10)' },
  retired:   { label: 'Retired',   color: 'var(--text-muted)',    bg: 'rgba(122,122,136,0.10)' },
}

// ─── Warranty / AMC coverage ─────────────────────────────────────────────────

export type CoverageState = 'covered' | 'expiring' | 'expired' | 'none'

const EXPIRING_WINDOW_DAYS = 30

function dateState(until: string | null): CoverageState {
  if (!until) return 'none'
  const end = new Date(until).getTime()
  const now = Date.now()
  if (end < now) return 'expired'
  if (end - now < EXPIRING_WINDOW_DAYS * 24 * 3600 * 1000) return 'expiring'
  return 'covered'
}

export function warrantyState(asset: Asset): CoverageState {
  return dateState(asset.warranty_until)
}

export function amcState(asset: Asset): CoverageState {
  return dateState(asset.amc_until)
}

/** The asset's best current coverage — AMC wins over warranty when both exist. */
export function coverageState(asset: Asset): { kind: 'amc' | 'warranty' | 'none'; state: CoverageState } {
  const amc = amcState(asset)
  if (amc === 'covered' || amc === 'expiring') return { kind: 'amc', state: amc }
  const warranty = warrantyState(asset)
  if (warranty !== 'none') return { kind: 'warranty', state: warranty }
  if (amc !== 'none') return { kind: 'amc', state: amc }
  return { kind: 'none', state: 'none' }
}

export const COVERAGE_META: Record<CoverageState, { label: string; color: string; bg: string }> = {
  covered:  { label: 'Covered',       color: 'var(--color-success)', bg: 'rgba(34,197,94,0.10)' },
  expiring: { label: 'Expiring soon', color: 'var(--color-warning)', bg: 'rgba(234,179,8,0.10)' },
  expired:  { label: 'Expired',       color: 'var(--color-danger)',  bg: 'rgba(239,68,68,0.10)' },
  none:     { label: 'No coverage',   color: 'var(--text-muted)',    bg: 'rgba(122,122,136,0.10)' },
}

// ─── QR URL ──────────────────────────────────────────────────────────────────

/**
 * The URL a printed QR label encodes. Scanning with any phone camera opens
 * the asset straight in the browser (login-gated by RLS).
 */
export function assetScanUrl(assetCode: string, origin?: string): string {
  const base = origin
    ?? (typeof window !== 'undefined' ? window.location.origin : 'https://escalations.prismintelligence.in')
  return `${base}/assets/view/?code=${encodeURIComponent(assetCode)}`
}

// ─── Permissions (mirror the DB can_manage_asset function) ──────────────────

export function canManageAssets(profile: Profile | null): boolean {
  if (!profile) return false
  return ['super_admin', 'leadership', 'area_manager', 'store_manager'].includes(profile.role)
}

// ─── Preventive maintenance ──────────────────────────────────────────────────

export type PmState = 'overdue' | 'due_soon' | 'scheduled' | 'no_schedule'

const PM_DUE_SOON_DAYS = 3

export function pmState(task: Pick<AssetPmTask, 'next_due_at'>): PmState {
  if (!task.next_due_at) return 'no_schedule'
  const due = new Date(task.next_due_at).getTime()
  const now = Date.now()
  if (due < now) return 'overdue'
  if (due - now < PM_DUE_SOON_DAYS * 24 * 3600 * 1000) return 'due_soon'
  return 'scheduled'
}

export const PM_STATE_META: Record<PmState, { label: string; color: string; bg: string }> = {
  overdue:     { label: 'Overdue',    color: 'var(--color-danger)',  bg: 'rgba(239,68,68,0.10)' },
  due_soon:    { label: 'Due soon',   color: 'var(--color-warning)', bg: 'rgba(234,179,8,0.10)' },
  scheduled:   { label: 'Scheduled',  color: 'var(--color-success)', bg: 'rgba(34,197,94,0.10)' },
  no_schedule: { label: 'One-off',    color: 'var(--text-muted)',    bg: 'rgba(122,122,136,0.10)' },
}

export const PM_DAYPARTS = ['opening', 'closing', 'anytime', 'weekly', 'monthly'] as const
