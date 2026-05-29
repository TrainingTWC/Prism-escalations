export interface SectionDeduction {
  sectionId: string
  sectionTitle: string
  sectionDepartment: string | null
  isCritical: boolean
  totalDeducted: number
  sectionMaxScore: number
  deductionPct: number
  failedQuestions: FailedQuestion[]
  ai?: AIAnalysis
}

export interface FailedQuestion {
  questionId: string
  questionText: string
  weightMax: number
  scoreEarned: number
  deducted: number
  isCritical: boolean
  response?: unknown
  comment?: string
}

export interface AIAnalysis {
  shouldCreateTicket: boolean
  noTicketReason?: string
  department: 'Operations' | 'HR' | 'IT' | 'SCM' | 'QA'
  severity: 'critical' | 'high' | 'medium' | 'low'
  title: string
  summary: string
  patternFlag: boolean
  patternNote?: string
  suggestedAssigneeRole: string
  aiConfidence: number
}

export type TicketSeverity = 'critical' | 'high' | 'medium' | 'low'

/**
 * Fallback rule-based severity when AI is not available.
 */
export function computeSeverity(section: Pick<SectionDeduction, 'isCritical' | 'deductionPct'>): TicketSeverity {
  if (section.isCritical) return 'critical'
  if (section.deductionPct >= 60) return 'high'
  if (section.deductionPct >= 30) return 'medium'
  return 'low'
}
