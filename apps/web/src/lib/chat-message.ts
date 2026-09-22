import type { ChatMessage } from "@timetable/agent-contracts"

export type ChatDisplayPart = Extract<
  ChatMessage["parts"][number],
  { type: "text" | "data-progress" | "data-question" | "data-proposal" | "data-explanation" }
>

/** Use server-owned phases, never sentence contents or the last visible paragraph. */
export function splitChatMessage(message: ChatMessage) {
  const phases = new Map(
    message.parts
      .filter((part) => part.type === "data-text-phase")
      .map((part) => [part.data.text_index, part.data.phase]),
  )
  const process: ChatDisplayPart[] = []
  const answer: ChatDisplayPart[] = []
  let textIndex = 0
  let hasUnknownText = false
  // The server announces the final phase before sending any of its text.
  let hasFinalAnswer = [...phases.values()].includes("final_answer")
  let waitingFor: "answer" | "confirmation" | undefined
  for (const part of message.parts) {
    if (part.type === "text") {
      const phase = phases.get(textIndex++) ?? "unknown"
      if (!part.text.trim()) continue
      if (phase === "final_answer") {
        answer.push(part)
        hasFinalAnswer = true
      } else {
        process.push(part)
        if (phase === "unknown") hasUnknownText = true
      }
    } else if (part.type === "data-progress") {
      process.push(part)
    } else if (part.type === "data-question") {
      answer.push(part)
      if (part.data.status === "pending") waitingFor = "answer"
    } else if (part.type === "data-proposal") {
      answer.push(part)
      if (part.data.status === "pending" || part.data.status === "confirming")
        waitingFor = "confirmation"
    } else if (part.type === "data-explanation") {
      answer.push(part)
      hasFinalAnswer = true
    }
  }
  const answerText = answer
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
  const activity = message.parts.findLast((part) => part.type === "data-activity")?.data.status
  const thinking =
    message.metadata?.status === "running" &&
    !hasFinalAnswer &&
    !waitingFor &&
    activity === "thinking"
  const activeTool = process.some(
    (part) => part.type === "data-progress" && part.data.status === "running",
  )
  const activityLabel =
    message.metadata?.status !== "running" ||
    waitingFor ||
    hasFinalAnswer ||
    activeTool ||
    activity === "responding"
      ? undefined
      : "正在思考"
  return {
    process,
    answer,
    answerText,
    hasFinalAnswer,
    hasUnknownText,
    waitingFor,
    thinking,
    activityLabel,
  }
}
