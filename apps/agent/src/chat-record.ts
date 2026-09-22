import type { AgentMessage } from "@earendil-works/pi-agent-core"
import type { AssistantMessage, StopReason } from "@earendil-works/pi-ai"
import type { AgentConfig } from "./config.ts"

type TokenUsage = {
  input: number
  output: number
  cache_read: number
  cache_write: number
  reasoning: number | null
  total: number
}
type ModelRequest = {
  model: string
  phase: "research" | "delivery_repair"
  thinking_level: string
  max_tokens: number
  started_at: string
  finished_at?: string
  duration_ms?: number
  first_event_ms?: number
  http_status?: number
  response_id?: string
  stop_reason?: StopReason
  raw_stop_reason?: string
  error?: string
  usage: TokenUsage | null
}
type ToolExecution = {
  call_id: string
  name: string
  started_at?: string
  finished_at?: string
  duration_ms?: number
  status: "running" | "complete" | "error" | "interrupted"
}
export type ChatDiagnostics = {
  version: 1
  status: "running" | "complete" | "interrupted"
  started_at: string
  finished_at?: string
  error_code?: string
  stop_reason?: StopReason
  raw_stop_reason?: string
  requests: ModelRequest[]
  tools: ToolExecution[]
  // Sum only known provider usage. Reasoning is already included in output.
  usage: TokenUsage | null
  usage_complete: boolean
}
export type ChatRunRecord = { transcript: AgentMessage[]; diagnostics: ChatDiagnostics }

/** Server-only records. Never pass this callback through the UI event stream. */
export class ChatRecorder {
  readonly record: ChatRunRecord
  private config: AgentConfig
  private persist?: (record: ChatRunRecord) => void
  private current?: ModelRequest

  constructor(config: AgentConfig, persist?: (record: ChatRunRecord) => void) {
    this.config = config
    this.persist = persist
    this.record = {
      transcript: [],
      diagnostics: {
        version: 1,
        status: "running",
        started_at: new Date().toISOString(),
        requests: [],
        tools: [],
        usage: null,
        usage_complete: false,
      },
    }
  }

  private redact(message: string) {
    const text = this.config.apiKey ? message.replaceAll(this.config.apiKey, "[redacted]") : message
    return text.replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]").slice(0, 4000)
  }

  private save() {
    const requests = this.record.diagnostics.requests
    const known = requests.flatMap((request) => (request.usage ? [request.usage] : []))
    this.record.diagnostics.usage_complete =
      requests.length > 0 && requests.every((request) => request.usage !== null)
    this.record.diagnostics.usage = known.length
      ? {
          input: known.reduce((sum, usage) => sum + usage.input, 0),
          output: known.reduce((sum, usage) => sum + usage.output, 0),
          cache_read: known.reduce((sum, usage) => sum + usage.cache_read, 0),
          cache_write: known.reduce((sum, usage) => sum + usage.cache_write, 0),
          reasoning: known.every((usage) => usage.reasoning !== null)
            ? known.reduce((sum, usage) => sum + (usage.reasoning ?? 0), 0)
            : null,
          total: known.reduce((sum, usage) => sum + usage.total, 0),
        }
      : null
    this.persist?.(this.record)
  }

  modelStart(model: string, maxTokens: number, repair: boolean) {
    this.current = {
      model,
      phase: repair ? "delivery_repair" : "research",
      thinking_level: repair ? "off" : this.config.thinkingLevel,
      max_tokens: maxTokens,
      started_at: new Date().toISOString(),
      usage: null,
    }
    this.record.diagnostics.requests.push(this.current)
    this.save()
  }

  payload(value: unknown) {
    if (!this.current || !value || typeof value !== "object") return
    const payload = value as Record<string, unknown>
    if (typeof payload.max_tokens === "number") this.current.max_tokens = payload.max_tokens
    this.save()
  }

  response(status: number) {
    if (this.current) this.current.http_status = status
    this.save()
  }

  firstEvent() {
    if (this.current && this.current.first_event_ms === undefined)
      this.current.first_event_ms = Math.max(0, Date.now() - Date.parse(this.current.started_at))
  }

  messageEnd(message: AgentMessage) {
    if (message.role === "system") return
    this.record.transcript.push(
      message.role === "assistant" && message.errorMessage
        ? { ...message, errorMessage: this.redact(message.errorMessage) }
        : message,
    )
    if (message.role === "assistant") this.modelEnd(message)
    if (message.role === "toolResult") {
      let execution = this.record.diagnostics.tools.find(
        (tool) => tool.call_id === message.toolCallId,
      )
      if (!execution) {
        // pi can reject a malformed/blocked call without a tool_execution_start.
        execution = { call_id: message.toolCallId, name: message.toolName, status: "running" }
        this.record.diagnostics.tools.push(execution)
      }
      execution.finished_at = new Date().toISOString()
      execution.duration_ms = execution.started_at
        ? Math.max(0, Date.now() - Date.parse(execution.started_at))
        : undefined
      execution.status = message.isError ? "error" : "complete"
    }
    this.save()
  }

  private modelEnd(message: AssistantMessage) {
    // A loop failure may emit a synthetic assistant error outside a model request.
    const request = this.current
    if (request) {
      request.finished_at = new Date().toISOString()
      request.duration_ms = Math.max(0, Date.now() - Date.parse(request.started_at))
      request.stop_reason = message.stopReason
      request.raw_stop_reason = message.rawStopReason
      request.response_id = message.responseId
      request.error = message.errorMessage ? this.redact(message.errorMessage) : undefined
      // pi initializes usage to zeros even if the stream never reports usage.
      request.usage =
        message.usage.totalTokens > 0
          ? {
              input: message.usage.input,
              output: message.usage.output,
              cache_read: message.usage.cacheRead,
              cache_write: message.usage.cacheWrite,
              reasoning: message.usage.reasoning || (request.thinking_level === "off" ? 0 : null),
              total: message.usage.totalTokens,
            }
          : null
      this.current = undefined
    }
    this.record.diagnostics.stop_reason = message.stopReason
    this.record.diagnostics.raw_stop_reason = message.rawStopReason
  }

  toolStart(callId: string, name: string) {
    this.record.diagnostics.tools.push({
      call_id: callId,
      name,
      started_at: new Date().toISOString(),
      status: "running",
    })
    this.save()
  }

  finish(errorCode?: string) {
    this.record.diagnostics.status = errorCode ? "interrupted" : "complete"
    this.record.diagnostics.finished_at = new Date().toISOString()
    this.record.diagnostics.error_code = errorCode
    for (const tool of this.record.diagnostics.tools)
      if (tool.status === "running") tool.status = "interrupted"
    this.save()
  }
}
