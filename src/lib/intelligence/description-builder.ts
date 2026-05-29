import type { SectionDeduction } from './types'

interface SubmissionContext {
  storeName: string
  city?: string | null
  amName?: string | null
  programName: string
  submittedAt?: number | null
  percentage?: number | null
  score?: number | null
  maxScore?: number | null
}

/**
 * Builds the full markdown description for an auto-created ticket.
 * Used when AI summary is absent or as the expanded detail section.
 */
export function buildTicketDescription(
  ctx: SubmissionContext,
  section: SectionDeduction,
  submissionId: string,
): string {
  const submittedDate = ctx.submittedAt
    ? new Date(ctx.submittedAt).toLocaleString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : 'Unknown'

  const checkpoints = section.failedQuestions
    .map((q) => {
      const critTag = q.isCritical ? ' ⚠️ **Critical Checkpoint**' : ''
      const commentLine = q.comment ? `\n  > Auditor note: "${q.comment}"` : ''
      return `- **${q.questionText}**${critTag}\n  Scored **${q.scoreEarned}/${q.weightMax}** (deducted ${q.deducted} pts)${commentLine}`
    })
    .join('\n')

  return [
    `**Auto-generated from Prism Intelligence audit submission**`,
    ``,
    `| Field | Value |`,
    `|---|---|`,
    `| Store | ${ctx.storeName}${ctx.city ? ` — ${ctx.city}` : ''} |`,
    `| Audit Program | ${ctx.programName} |`,
    `| Section | ${section.sectionTitle}${section.isCritical ? ' *(Critical)*' : ''} |`,
    `| Overall Audit Score | ${ctx.percentage != null ? `${ctx.percentage.toFixed(1)}%` : 'N/A'} |`,
    `| Section Deduction | ${section.deductionPct.toFixed(1)}% (${section.totalDeducted} of ${section.sectionMaxScore} pts lost) |`,
    `| Area Manager | ${ctx.amName ?? '—'} |`,
    `| Submitted | ${submittedDate} |`,
    ``,
    `### Failed Checkpoints`,
    checkpoints,
    ``,
    `---`,
    `*Intelligence Ref: \`${submissionId}\`*`,
  ].join('\n')
}
