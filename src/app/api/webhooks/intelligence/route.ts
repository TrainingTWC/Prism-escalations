import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { IntelligenceWebhookPayloadSchema } from '@/lib/intelligence/webhook-schema'
import { mapDepartment } from '@/lib/intelligence/department-map'
import { computeSeverity } from '@/lib/intelligence/types'
import { buildTicketDescription } from '@/lib/intelligence/description-builder'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  // ── 1. Authenticate via shared secret ─────────────────────────────
  const secret = req.headers.get('x-prism-webhook-secret')
  if (!secret || secret !== process.env.PRISM_INTELLIGENCE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── 2. Parse + validate payload ───────────────────────────────────
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parse = IntelligenceWebhookPayloadSchema.safeParse(body)
  if (!parse.success) {
    return NextResponse.json(
      { error: 'Payload validation failed', issues: parse.error.issues },
      { status: 400 },
    )
  }
  const payload = parse.data

  const supabase = createServiceClient()
  const results: { action: string; ticketId?: string; sectionId: string; reason?: string }[] = []

  // ── 3. Resolve store_id from store_code ───────────────────────────
  let storeId: string | null = null
  if (payload.storeCode) {
    const { data: store } = await supabase
      .from('stores')
      .select('id')
      .eq('store_code', payload.storeCode)
      .maybeSingle()
    storeId = store?.id ?? null
  }

  // ── 4. Process each failing section ───────────────────────────────
  for (const section of payload.deductions) {
    // AI decided this section is not worth a ticket
    if (section.ai && !section.ai.shouldCreateTicket) {
      results.push({
        action: 'filtered_by_ai',
        sectionId: section.sectionId,
        reason: section.ai.noTicketReason,
      })
      continue
    }

    // ── 4a. Dedup check ─────────────────────────────────────────────
    const { data: existing } = await supabase
      .from('tickets')
      .select('id, status, reopen_count')
      .eq('intelligence_submission_id', payload.submissionId)
      .eq('intelligence_section_id', section.sectionId)
      .eq('intelligence_source', true)
      .maybeSingle()

    if (existing) {
      // Re-open if resolved/closed/verification, otherwise leave untouched
      if (['resolved', 'closed', 'verification'].includes(existing.status as string)) {
        await supabase
          .from('tickets')
          .update({ status: 'open', reopen_count: (existing.reopen_count as number) + 1 } as never)
          .eq('id', existing.id)
        results.push({ action: 'reopened', ticketId: existing.id as string, sectionId: section.sectionId })
      } else {
        results.push({ action: 'skipped_already_open', ticketId: existing.id as string, sectionId: section.sectionId })
      }
      continue
    }

    // ── 4b. Resolve fields — prefer AI, fall back to rule-based ─────
    const category = section.ai?.department
      ?? mapDepartment(section.sectionDepartment ?? payload.programDepartment)

    const severity = section.ai?.severity
      ?? computeSeverity(section)

    const title = section.ai?.title
      ?? `[${payload.storeName}] ${payload.programName} — ${section.sectionTitle}`

    const description = section.ai
      ? `${section.ai.summary}\n\n---\n\n${buildTicketDescription(
          {
            storeName: payload.storeName,
            city: payload.city,
            amName: payload.amName,
            programName: payload.programName,
            submittedAt: payload.submittedAt,
            percentage: payload.percentage,
            score: payload.score,
            maxScore: payload.maxScore,
          },
          section,
          payload.submissionId,
        )}`
      : buildTicketDescription(
          {
            storeName: payload.storeName,
            city: payload.city,
            amName: payload.amName,
            programName: payload.programName,
            submittedAt: payload.submittedAt,
            percentage: payload.percentage,
            score: payload.score,
            maxScore: payload.maxScore,
          },
          section,
          payload.submissionId,
        )

    // ── 4c. Generate ticket code ─────────────────────────────────────
    const { count } = await supabase
      .from('tickets')
      .select('*', { count: 'exact', head: true })
    const ticketCode = `TKT-${String((count ?? 0) + 1).padStart(5, '0')}`

    // ── 4d. Insert ticket ────────────────────────────────────────────
    const { data: ticket, error } = await supabase
      .from('tickets')
      .insert({
        ticket_code: ticketCode,
        title: title.slice(0, 255),
        description,
        category,
        severity,
        status: 'open',
        source_type: 'audit',
        store_id: storeId,
        // Intelligence metadata
        intelligence_source: true,
        intelligence_submission_id: payload.submissionId,
        intelligence_section_id: section.sectionId,
        intelligence_program_id: payload.programId,
        intelligence_program_name: payload.programName,
        intelligence_store_code: payload.storeCode ?? null,
        intelligence_deductions: section.failedQuestions as never,
        intelligence_audit_score: payload.score ?? null,
        intelligence_audit_pct: payload.percentage ?? null,
        intelligence_ai_confidence: section.ai?.aiConfidence ?? null,
        intelligence_pattern_flag: section.ai?.patternFlag ?? false,
        intelligence_pattern_note: section.ai?.patternNote ?? null,
        intelligence_suggested_role: section.ai?.suggestedAssigneeRole ?? null,
      } as never)
      .select('id')
      .single()

    if (error) {
      console.error('[intelligence webhook] insert error:', error)
      results.push({ action: 'error', sectionId: section.sectionId, reason: error.message })
    } else {
      results.push({ action: 'created', ticketId: ticket.id as string, sectionId: section.sectionId })
    }
  }

  return NextResponse.json({ ok: true, results })
}
