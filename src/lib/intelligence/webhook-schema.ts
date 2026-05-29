import { z } from 'zod'

export const FailedQuestionSchema = z.object({
  questionId: z.string(),
  questionText: z.string(),
  weightMax: z.number(),
  scoreEarned: z.number(),
  deducted: z.number(),
  isCritical: z.boolean(),
  response: z.unknown().optional(),
  comment: z.string().optional(),
})

export const AIAnalysisSchema = z.object({
  shouldCreateTicket: z.boolean(),
  noTicketReason: z.string().optional(),
  department: z.enum(['Operations', 'HR', 'IT', 'SCM', 'QA']),
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  title: z.string().max(120),
  summary: z.string(),
  patternFlag: z.boolean(),
  patternNote: z.string().optional(),
  suggestedAssigneeRole: z.string(),
  aiConfidence: z.number().min(0).max(1),
})

export const SectionDeductionSchema = z.object({
  sectionId: z.string(),
  sectionTitle: z.string(),
  sectionDepartment: z.string().nullable().optional(),
  isCritical: z.boolean(),
  totalDeducted: z.number(),
  sectionMaxScore: z.number(),
  deductionPct: z.number(),
  failedQuestions: z.array(FailedQuestionSchema),
  ai: AIAnalysisSchema.optional(),
})

export const IntelligenceWebhookPayloadSchema = z.object({
  submissionId: z.string().min(1),
  submittedAt: z.number().optional(),
  programId: z.string(),
  programName: z.string(),
  programDepartment: z.string().nullable().optional(),
  score: z.number().nullable().optional(),
  maxScore: z.number().nullable().optional(),
  percentage: z.number().nullable().optional(),
  storeName: z.string(),
  storeCode: z.string().nullable().optional(),
  amName: z.string().nullable().optional(),
  city: z.string().optional(),
  deductions: z.array(SectionDeductionSchema),
})

export type IntelligenceWebhookPayload = z.infer<typeof IntelligenceWebhookPayloadSchema>
