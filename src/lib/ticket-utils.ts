import type { Ticket } from '@/lib/supabase/database.types'

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

export const STATUS_FLOW: Record<string, string[]> = {
  open: ['accepted', 'rejected'],
  acknowledged: ['accepted'],           // legacy — existing acknowledged tickets can still move forward
  accepted: ['in_progress'],
  in_progress: ['waiting', 'snag', 'resolved'],
  waiting: ['in_progress', 'snag'],
  snag: ['in_progress'],
  resolved: ['verification'],
  verification: ['closed', 'in_progress'],
  closed: [],
  rejected: [],
}

export const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  acknowledged: 'Acknowledged',
  accepted: 'Accepted',
  rejected: 'Rejected',
  in_progress: 'In Progress',
  waiting: 'Waiting',
  snag: 'SNAG',
  resolved: 'Resolved',
  verification: 'Verified',
  closed: 'Closed',
}

export const CATEGORIES = {
  Operations: ['Equipment', 'Utilities', 'Cleaning'],
  HR: ['Staffing', 'Grooming', 'Conduct'],
  IT: ['POS', 'Printer', 'WiFi'],
  SCM: ['Inventory', 'Delivery', 'Packaging'],
  QA: ['Hygiene', 'Food Safety'],
}

export const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low']

export const ROLE_LABELS: Record<string, string> = {
  auditor: 'Auditor',
  store_team: 'Store Team',
  store_manager: 'Store Manager',
  area_manager: 'Area Manager',
  dept_owner: 'Dept. Owner',
  leadership: 'Leadership',
}
