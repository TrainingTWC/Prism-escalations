'use client'

import { supabase } from '@/lib/supabase/client'
import { STATUS_LABELS, type TicketAction } from '@/lib/ticket-utils'
import type { Profile, Ticket } from '@/lib/supabase/database.types'

/**
 * Apply a one-tap workflow action (start / resolve / verify / reopen / reject).
 * Timestamps (first_response_at, resolved_at, closed_at, reopen_count) are
 * stamped by the DB trigger `tickets_guard_transition`; notifications fan out
 * from `notify_ticket_event`. The client only flips the status + logs a comment.
 */
export async function applyTicketAction(
  ticket: Ticket,
  profile: Profile,
  action: TicketAction,
  note?: string,
): Promise<{ error?: string }> {
  const { error } = await supabase
    .from('tickets')
    .update({ status: action.nextStatus, updated_at: new Date().toISOString() } as never)
    .eq('id', ticket.id)

  if (error) return { error: error.message }

  const base = `Status changed from ${STATUS_LABELS[ticket.status] ?? ticket.status} to ${STATUS_LABELS[action.nextStatus] ?? action.nextStatus}`
  await supabase.from('comments').insert({
    ticket_id: ticket.id,
    author_id: profile.id,
    content: note?.trim() ? `${base} — ${note.trim()}` : base,
    is_status_change: true,
    old_status: ticket.status,
    new_status: action.nextStatus,
  } as never)

  return {}
}

/** Flag / unflag a ticket as blocked (snag) with a reason. */
export async function setTicketBlocked(
  ticket: Ticket,
  profile: Profile,
  blocked: boolean,
  reason?: string,
): Promise<{ error?: string }> {
  const { error } = await supabase
    .from('tickets')
    .update({
      blocked,
      blocked_reason: blocked ? (reason?.trim() || 'No reason given') : null,
      updated_at: new Date().toISOString(),
    } as never)
    .eq('id', ticket.id)

  if (error) return { error: error.message }

  await supabase.from('comments').insert({
    ticket_id: ticket.id,
    author_id: profile.id,
    content: blocked
      ? `⛔ Flagged as blocked: ${reason?.trim() || 'no reason given'}`
      : '✅ Unblocked — work can continue',
    is_status_change: false,
  } as never)

  return {}
}
