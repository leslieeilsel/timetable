import {
  agentEventSchema,
  runInputSchema,
  type AgentEvent,
  type RunInput,
} from "@timetable/agent-contracts"
import { ApiError, csrfHeaders } from "@/lib/api"

function streamError() {
  return new ApiError("AI 响应不完整，请重试。", 502, "AI_STREAM_INVALID", {})
}

/** Decode framed events across arbitrary UTF-8/network chunk boundaries. */
export async function consumeAgentStream(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: AgentEvent) => void,
  signal: AbortSignal,
) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let sequence = 0
  let completed = false
  let resultReceived = false
  const cancel = () => {
    void reader.cancel()
  }
  signal.addEventListener("abort", cancel, { once: true })
  try {
    while (true) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      signal.throwIfAborted()
      buffer += decoder.decode(value, { stream: !done })
      // A single event is bounded; total output may span many progress events.
      if (buffer.length > 131072) throw streamError()
      let separator: RegExpExecArray | null
      while ((separator = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, separator.index)
        buffer = buffer.slice(separator.index + separator[0].length)
        const lines = frame.split(/\r?\n/)
        const data = lines
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n")
        if (!data) continue
        if (completed) throw streamError()
        const id = lines
          .find((line) => line.startsWith("id:"))
          ?.slice(3)
          .trim()
        if (id !== String(sequence + 1)) throw streamError()
        let raw: unknown
        try {
          raw = JSON.parse(data)
        } catch {
          throw streamError()
        }
        const parsed = agentEventSchema.safeParse(raw)
        if (!parsed.success) throw streamError()
        const event = parsed.data
        if ((sequence === 0) !== (event.type === "run.started")) throw streamError()
        sequence++
        if (event.type === "run.error") {
          if (["SESSION_INVALID", "SESSION_CHANGED", "SESSION_REQUIRED"].includes(event.code)) {
            window.dispatchEvent(new Event("auth:invalid"))
          }
          throw new ApiError(event.message, 502, event.code, {})
        }
        if (["proposal", "explanation", "clarification"].includes(event.type)) {
          if (resultReceived) throw streamError()
          resultReceived = true
        }
        if (event.type === "run.completed") {
          if (!resultReceived) throw streamError()
          completed = true
        }
        onEvent(event)
      }
      if (done) break
    }
    if (!completed || buffer.trim()) throw streamError()
  } finally {
    signal.removeEventListener("abort", cancel)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

export async function runAgent(
  input: RunInput,
  onEvent: (event: AgentEvent) => void,
  signal: AbortSignal,
) {
  const body = JSON.stringify(runInputSchema.parse(input))
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch("/agent/v1/runs", {
      method: "POST",
      credentials: "include",
      signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...(await csrfHeaders(attempt > 0)),
      },
      body,
    })
    if (response.status === 419 && attempt === 0) {
      await response.body?.cancel()
      continue
    }
    if (!response.ok) {
      if (response.status === 401) window.dispatchEvent(new Event("auth:invalid"))
      const payload = (await response.json().catch(() => null)) as {
        message?: string
        code?: string
      } | null
      throw new ApiError(
        payload?.message ?? "AI 服务暂时不可用，请稍后重试。",
        response.status,
        payload?.code ?? "AI_UNAVAILABLE",
        {},
      )
    }
    if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream"))
      throw streamError()
    await consumeAgentStream(response.body, onEvent, signal)
    return
  }
}
