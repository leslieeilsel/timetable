import type { AgentMessage } from "@earendil-works/pi-agent-core"

/** Replay completed exchanges only. The durable transcript stays untouched. */
export function replayChatTranscript(transcript: AgentMessage[]): AgentMessage[] {
  const history: AgentMessage[] = []
  for (let index = 0; index < transcript.length; index++) {
    const message = transcript[index]!
    if (message.role === "user") {
      history.push(message)
      continue
    }
    if (message.role !== "assistant") continue
    if (message.stopReason !== "stop" && message.stopReason !== "toolUse") continue
    const results = []
    for (let next = index + 1; next < transcript.length; next++) {
      const result = transcript[next]!
      if (result.role !== "toolResult") break
      results.push(result)
    }
    const returned = new Set(results.map((result) => result.toolCallId))
    const content = message.content.filter(
      (part) => part.type !== "toolCall" || returned.has(part.id),
    )
    // A stopped batch may have returned only some calls. Keep those pairs and
    // never fabricate results or replay a truncated assistant's arguments.
    if (!content.some((part) => part.type !== "thinking")) continue
    const calls = new Set(content.flatMap((part) => (part.type === "toolCall" ? [part.id] : [])))
    history.push(
      { ...message, content },
      ...results.filter((result) => calls.has(result.toolCallId)),
    )
  }
  return history
}

/** Earlier rounds need their facts, not the large private reasoning trace.
 * Active tool/reasoning exchanges are never passed through this function. */
export function omitHistoricalThinking(transcript: AgentMessage[]): AgentMessage[] {
  return transcript.map((message) =>
    message.role === "assistant"
      ? { ...message, content: message.content.filter((part) => part.type !== "thinking") }
      : message,
  )
}
