import { z } from "zod"
import type { UIMessage } from "ai"

export const runInputSchema = z.discriminatedUnion("feature", [
  z.strictObject({
    feature: z.literal("constraint_draft"),
    semester_id: z.number().int().positive(),
    input: z.string().trim().min(1).max(4000),
  }),
  z.strictObject({
    feature: z.literal("schedule_run_explanation"),
    semester_id: z.number().int().positive(),
    schedule_run_id: z.number().int().positive(),
  }),
])

export const ruleDraftSchema = z.strictObject({
  name: z.string().min(1).max(120),
  kind: z.enum(["hard", "soft"]),
  category: z.enum(["forbidden_slot", "preferred_slot", "daily_load"]),
  target_type: z.enum(["teacher", "course"]),
  target_id: z.number().int().positive(),
  scope: z.strictObject({
    weekdays: z.array(z.number().int().min(1).max(7)).optional(),
    item_ids: z.array(z.number().int().positive()).optional(),
  }),
  condition: z.record(z.string(), z.never()).default({}),
  requirement: z.strictObject({
    available: z.literal(false).optional(),
    preference: z.enum(["prefer", "avoid"]).optional(),
    max_items_per_day: z.number().int().min(1).max(20).optional(),
  }),
  weight: z.number().int().min(1).max(100).nullable().default(null),
  explanation: z.string().max(1000).nullable().default(null),
})

export const previewSchema = z.strictObject({
  constraints: z.array(ruleDraftSchema).min(1).max(10),
  summaries: z.array(z.string().max(2000)).min(1).max(10),
  etag: z.string().regex(/^"semester-\d+-timetable-\d+-catalog-\d+"$/),
})

export const explanationSchema = z.strictObject({
  headline: z.string().max(1000),
  findings: z
    .array(
      z.strictObject({
        evidence_id: z.string().max(80),
        fact: z.string().max(4000),
        explanation: z.string().max(1500),
      }),
    )
    .max(12),
  suggestions: z.array(z.string().max(500)).max(6),
})

export const agentEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("run.started"), run_id: z.string().uuid() }),
  z.strictObject({ type: z.literal("progress"), message: z.string().max(200) }),
  z.strictObject({ type: z.literal("clarification"), question: z.string().max(1500) }),
  z.strictObject({ type: z.literal("proposal"), preview: previewSchema }),
  z.strictObject({ type: z.literal("explanation"), explanation: explanationSchema }),
  z.strictObject({ type: z.literal("run.completed") }),
  z.strictObject({
    type: z.literal("run.error"),
    code: z.string().max(80),
    message: z.string().max(500),
  }),
])

export type RunInput = z.infer<typeof runInputSchema>
export type RuleDraft = z.infer<typeof ruleDraftSchema>
export type RulePreview = z.infer<typeof previewSchema>
export type Explanation = z.infer<typeof explanationSchema>
export type AgentEvent = z.infer<typeof agentEventSchema>

const questionItemSchema = z
  .strictObject({
    id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/),
    prompt: z.string().trim().min(1).max(500),
    multiple: z.boolean().default(false),
    choices: z
      .array(
        z.strictObject({ value: z.string().min(1).max(100), label: z.string().min(1).max(200) }),
      )
      .max(12),
    allow_text: z.boolean().default(true),
  })
  .refine(
    (item) =>
      (item.allow_text || item.choices.length > 0) &&
      new Set(item.choices.map((choice) => choice.value)).size === item.choices.length,
  )
export const questionsSchema = z
  .array(questionItemSchema)
  .min(1)
  .max(3)
  .refine((items) => new Set(items.map((item) => item.id)).size === items.length)
export const answerSchema = z.strictObject({
  question_id: z.uuid(),
  values: z.record(z.string().max(40), z.array(z.string().trim().min(1).max(1000)).min(1).max(13)),
})
export const chatInputSchema = z.strictObject({
  message_id: z.uuid(),
  revision: z.number().int().nonnegative(),
  text: z.string().trim().min(1).max(4000),
  answer: answerSchema.optional(),
})
export const createConversationSchema = z.strictObject({
  semester_id: z.number().int().positive().nullable().default(null),
})
export const conversationTitleSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[^\p{Cc}\p{Zl}\p{Zp}]+$/u)
export const renameConversationSchema = z.strictObject({ title: conversationTitleSchema })
export type Questions = z.infer<typeof questionsSchema>
export type ChatInput = z.infer<typeof chatInputSchema>
export type ChatQuestion = {
  id: string
  items: Questions
  status: "pending" | "answered" | "cancelled"
}
export type ChatProposal = {
  id: string
  semester_id: number
  preview: RulePreview
  status: "pending" | "confirming" | "saved" | "expired"
  saved_count?: number
}
export type ChatSource = { id: string; label: string; href: string; retrieved_at: string }
// Display placement only; completion is authoritative in ChatMetadata.status.
export type ChatTextPhase = "unknown" | "commentary" | "final_answer"
export type ChatMetadata = {
  status: "running" | "complete" | "interrupted"
  started_at?: string
  duration_ms?: number
  sent_at?: string
  error_code?: string
  error?: string
}
export type ChatData = {
  conversation: Conversation
  "text-phase": { text_index: number; phase: ChatTextPhase }
  activity: { status: "waiting" | "thinking" | "responding" | "tool" }
  progress: { label: string; status: "running" | "complete" | "error" }
  question: ChatQuestion
  proposal: ChatProposal
  source: ChatSource
  explanation: Explanation
}
export type ChatMessage = UIMessage<ChatMetadata, ChatData>
export type Conversation = {
  id: string
  title: string
  title_generating: boolean
  semester_id: number | null
  revision: number
  busy: boolean
  updated_at: string
}
export type ConversationDetail = Conversation & {
  messages: ChatMessage[]
  has_earlier: boolean
  before: number | null
}
