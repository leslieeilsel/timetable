import type { AgentMessage } from "@earendil-works/pi-agent-core"
import type { AssistantMessage } from "@earendil-works/pi-ai"
import type { ChatMessage, ChatTextPhase } from "@timetable/agent-contracts"

export const finalAnswerToolName = "finish_answer"

export const chatTextPrefixes = {
  commentary: "[[phase:commentary]]",
  final_answer: "[[phase:final_answer]]",
} as const

type TextDelta = { phase: ChatTextPhase; delta: string }
const prefixes = Object.entries(chatTextPrefixes) as [keyof typeof chatTextPrefixes, string][]
const maxLeadingWhitespace = 16

function textPrefix(text: string) {
  const body = text.trimStart()
  const offset = text.length - body.length
  if (offset > maxLeadingWhitespace) return
  const match = prefixes.find(([, prefix]) => body.startsWith(prefix))
  if (match) return { phase: match[0], length: offset + match[1].length }
}

/** Buffer only a possible control prefix, never the reply body. */
export class ChatTextStream {
  private pending = ""
  private phase: ChatTextPhase | undefined

  push(delta: string): TextDelta | undefined {
    if (!delta) return
    if (this.phase !== undefined) return { phase: this.phase, delta }
    this.pending += delta
    const prefix = textPrefix(this.pending)
    if (prefix) {
      this.phase = prefix.phase
      const text = this.pending.slice(prefix.length)
      this.pending = ""
      return { phase: this.phase, delta: text }
    }
    const body = this.pending.trimStart()
    if (
      this.pending.length - body.length <= maxLeadingWhitespace &&
      prefixes.some(([, prefix]) => prefix.startsWith(body))
    )
      return
    return this.finish()
  }

  finish(): TextDelta | undefined {
    if (this.phase !== undefined) return
    this.phase = "unknown"
    const delta = this.pending
    this.pending = ""
    return delta ? { phase: this.phase, delta } : undefined
  }
}

export function rawAssistantText(message: AssistantMessage) {
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("")
}

export function assistantText(message: AssistantMessage) {
  const text = rawAssistantText(message)
  return text.slice(textPrefix(text)?.length ?? 0)
}

export function hasToolCalls(message: AssistantMessage) {
  return message.content.some((part) => part.type === "toolCall")
}

// A display prefix is not proof of completion. The pi response must finish
// normally without tool calls and include actual answer text.
export function isFinalText(message: AssistantMessage) {
  return message.stopReason === "stop" && !hasToolCalls(message) && !!assistantText(message).trim()
}

/** Recover old display metadata only when every text matches its durable pi message. */
export function restoreTextPhases(message: ChatMessage, transcript: AgentMessage[]) {
  if (
    message.metadata?.status !== "complete" ||
    message.parts.some((part) => part.type === "data-text-phase")
  )
    return
  const assistants = transcript.filter((entry) => entry.role === "assistant")
  const entries = assistants.filter((entry) => assistantText(entry).length > 0)
  const texts = message.parts.filter((part) => part.type === "text")
  if (
    !entries.length ||
    texts.length !== entries.length ||
    texts.some((part, index) => part.text !== assistantText(entries[index]!))
  )
    return
  const last = assistants.at(-1)
  message.parts.push(
    ...entries.map((entry, index) => {
      const phase: ChatTextPhase =
        entry === last && isFinalText(entry)
          ? "final_answer"
          : entry !== last || hasToolCalls(entry)
            ? "commentary"
            : "unknown"
      return {
        type: "data-text-phase" as const,
        id: `legacy-text-${index}`,
        data: { text_index: index, phase },
      }
    }),
  )
}
