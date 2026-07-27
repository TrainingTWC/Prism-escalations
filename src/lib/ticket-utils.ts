import type { Profile, Ticket } from '@/lib/supabase/database.types'

// ─── Severity (P-notation; legacy strings tolerated on read) ────────────────

export const SLA_MINUTES: Record<string, number> = {
  P0: 240,
  P1: 1440,
  P2: 4320,
  P3: 10080,
  // Legacy fallbacks
  critical: 240,
  high: 1440,
  medium: 4320,
  low: 10080,
}

export interface SeverityOption {
  value: 'P0' | 'P1' | 'P2' | 'P3'
  label: string
  short: string
  desc: string
  color: string
}

export const SEVERITY_OPTIONS: SeverityOption[] = [
  { value: 'P0', label: 'P0 · Critical', short: 'Critical', desc: '4 hr SLA',  color: 'var(--color-danger)' },
  { value: 'P1', label: 'P1 · High',     short: 'High',     desc: '24 hr SLA', color: 'var(--color-warning)' },
  { value: 'P2', label: 'P2 · Medium',   short: 'Medium',   desc: '3 day SLA', color: 'var(--color-info)' },
  { value: 'P3', label: 'P3 · Low',      short: 'Low',      desc: '7 day SLA', color: 'var(--text-tertiary)' },
]

export const SEVERITY_ORDER = ['P0', 'P1', 'P2', 'P3']

/** Normalise legacy severity strings to P-notation for display/sorting. */
export function normalizeSeverity(raw: string | null | undefined): 'P0' | 'P1' | 'P2' | 'P3' {
  switch ((raw ?? '').toLowerCase()) {
    case 'p0': case 'critical': return 'P0'
    case 'p1': case 'high':     return 'P1'
    case 'p3': case 'low':      return 'P3'
    default:                    return 'P2'
  }
}

export function getSlaDeadline(severity: string, createdAt: string): Date {
  const created = new Date(createdAt)
  const minutes = SLA_MINUTES[severity] ?? 1440
  return new Date(created.getTime() + minutes * 60 * 1000)
}

export function getSlaStatus(ticket: Ticket): 'safe' | 'warning' | 'breached' {
  if (!ticket.sla_deadline) return 'safe'
  const now = Date.now()
  const deadline = new Date(ticket.sla_deadline).getTime()
  const remaining = deadline - now

  if (remaining < 0) return 'breached'
  if (remaining < 30 * 60 * 1000) return 'warning' // < 30 min
  return 'safe'
}

export function formatSlaRemaining(sla_deadline: string | null): string {
  if (!sla_deadline) return '—'
  const remaining = new Date(sla_deadline).getTime() - Date.now()
  if (remaining <= 0) return 'BREACHED'

  const hours = Math.floor(remaining / (1000 * 60 * 60))
  const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60))

  if (hours > 24) {
    const days = Math.floor(hours / 24)
    return `${days}d ${hours % 24}h`
  }
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

export const ESCALATION_LABELS: Record<number, string> = {
  1: 'Department Owner',
  2: 'Area Manager',
  3: 'Regional Operations',
  4: 'Leadership',
}

/**
 * Human label for an escalation rung's timing. `afterMinutes` is measured from
 * the ticket's SLA deadline (the matrix is anchored on breach), so 0 = the
 * moment of breach and everything else is time past it.
 */
export function formatEscalationDelay(afterMinutes: number): string {
  if (afterMinutes <= 0) return 'At SLA breach'
  if (afterMinutes < 60) return `${afterMinutes}m after breach`
  const hours = afterMinutes / 60
  if (hours < 24) {
    return Number.isInteger(hours) ? `${hours}h after breach` : `${(afterMinutes / 60).toFixed(1)}h after breach`
  }
  const days = afterMinutes / 1440
  return Number.isInteger(days) ? `${days}d after breach` : `${days.toFixed(1)}d after breach`
}

/** Preset delays offered in the escalation matrix editor (minutes after breach). */
export const ESCALATION_DELAY_PRESETS: { minutes: number; label: string }[] = [
  { minutes: 0,    label: 'At SLA breach' },
  { minutes: 60,   label: '1 hour after breach' },
  { minutes: 120,  label: '2 hours after breach' },
  { minutes: 240,  label: '4 hours after breach' },
  { minutes: 480,  label: '8 hours after breach' },
  { minutes: 1440, label: '1 day after breach' },
  { minutes: 2880, label: '2 days after breach' },
]

// ─── Status flow: open → in_progress → resolved → closed (+ rejected) ───────
// "Blocked" is a flag on an in-progress ticket, not a status.

export const STATUS_FLOW: Record<string, string[]> = {
  open: ['in_progress', 'rejected'],
  in_progress: ['resolved'],
  resolved: ['closed', 'in_progress'],
  closed: [],
  rejected: [],
}

export const STATUS_ORDER = ['open', 'in_progress', 'resolved', 'closed']

export const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  resolved: 'Resolved',
  closed: 'Closed',
  rejected: 'Rejected',
  // Legacy statuses (should be gone after migration, kept for safety)
  acknowledged: 'In Progress',
  accepted: 'In Progress',
  waiting: 'In Progress',
  snag: 'In Progress',
  verification: 'Resolved',
}

export const ACTIVE_STATUSES = ['open', 'in_progress']

/** Normalise legacy statuses to the 4-status model for display/filtering. */
export function normalizeStatus(raw: string | null | undefined): string {
  switch (raw) {
    case 'acknowledged':
    case 'accepted':
    case 'waiting':
    case 'snag':
      return 'in_progress'
    case 'verification':
      return 'resolved'
    default:
      return raw ?? 'open'
  }
}

// ─── Departments (mirror the DB check constraint) ───────────────────────────

export const CATEGORIES: Record<string, string[]> = {
  Operations:  ['Store Upkeep', 'Customer Experience', 'Process', 'Utilities'],
  Maintenance: ['Equipment', 'Electrical', 'Plumbing', 'HVAC', 'Furniture'],
  HR:          ['Staffing', 'Grooming', 'Conduct', 'Payroll'],
  IT:          ['POS', 'Printer', 'WiFi', 'App / Software'],
  SCM:         ['Inventory', 'Delivery', 'Packaging', 'Vendor'],
  QA:          ['Hygiene', 'Food Safety', 'Compliance'],
  Finance:     ['Billing', 'Cash Handling', 'Vendor Payments'],
  'L&D':       ['Training', 'Certification'],
}

export const CATEGORY_LIST = Object.keys(CATEGORIES)

// ─── Roles ───────────────────────────────────────────────────────────────────

export type Role =
  | 'store_team'
  | 'store_manager'
  | 'area_manager'
  | 'dept_owner'
  | 'auditor'
  | 'leadership'
  | 'super_admin'

export const ROLE_LABELS: Record<string, string> = {
  store_team: 'Store Team',
  store_manager: 'Store Manager',
  area_manager: 'Area Manager',
  dept_owner: 'Dept. Owner',
  auditor: 'Auditor',
  leadership: 'Leadership',
  super_admin: 'Super Admin',
}

/** Roles allowed to verify a fix and close a ticket (mirrors the DB guard). */
export const VERIFIER_ROLES: Role[] = ['store_manager', 'area_manager', 'auditor', 'leadership', 'super_admin']

const ADMIN_ROLES: Role[] = ['leadership', 'super_admin']

/** Can this user work the ticket (start / mark fixed / flag blocked)? */
export function isFixer(ticket: Ticket, profile: Profile | null): boolean {
  if (!profile) return false
  if (ADMIN_ROLES.includes(profile.role as Role)) return true
  if (ticket.assigned_to === profile.id) return true
  return profile.role === 'dept_owner' && profile.department === ticket.category
}

/** Can this user verify + close this ticket? */
export function isVerifier(ticket: Ticket, profile: Profile | null): boolean {
  if (!profile) return false
  if (!VERIFIER_ROLES.includes(profile.role as Role)) return false
  if (ADMIN_ROLES.includes(profile.role as Role)) return true
  if (profile.role === 'store_manager') return !!profile.store_id && ticket.store_id === profile.store_id
  if (profile.role === 'area_manager') return true // region scoping already applied by RLS
  if (profile.role === 'auditor') return ticket.source_type === 'audit'
  return false
}

export interface TicketAction {
  key: 'start' | 'resolve' | 'verify' | 'reopen' | 'reject'
  label: string
  nextStatus: string
  tone: 'primary' | 'success' | 'danger'
}

/**
 * The ONE next action this user should take on this ticket (drives the
 * mobile sticky action bar and the "Needs your action" inbox).
 */
export function getPrimaryAction(ticket: Ticket, profile: Profile | null): TicketAction | null {
  if (!profile) return null
  const status = normalizeStatus(ticket.status)

  if (status === 'open' && isFixer(ticket, profile)) {
    return { key: 'start', label: 'Start work', nextStatus: 'in_progress', tone: 'primary' }
  }
  if (status === 'in_progress' && isFixer(ticket, profile)) {
    return { key: 'resolve', label: 'Mark fixed', nextStatus: 'resolved', tone: 'success' }
  }
  if (status === 'resolved' && isVerifier(ticket, profile)) {
    return { key: 'verify', label: 'Verify & close', nextStatus: 'closed', tone: 'success' }
  }
  return null
}

/** Secondary action shown next to the primary one (reject / reopen). */
export function getSecondaryAction(ticket: Ticket, profile: Profile | null): TicketAction | null {
  if (!profile) return null
  const status = normalizeStatus(ticket.status)

  if (status === 'open' && isFixer(ticket, profile)) {
    return { key: 'reject', label: 'Reject', nextStatus: 'rejected', tone: 'danger' }
  }
  if (status === 'resolved' && isVerifier(ticket, profile)) {
    return { key: 'reopen', label: 'Not fixed — reopen', nextStatus: 'in_progress', tone: 'danger' }
  }
  return null
}
