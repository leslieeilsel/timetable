import { describe, expect, it } from "vitest"
import { randomUUID } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import type { AssistantMessage } from "@earendil-works/pi-ai"
import { ChatRecorder } from "../src/chat-record.ts"
import { replayChatTranscript } from "../src/chat-history.ts"
import { ChatStore } from "../src/chat-store.ts"
import { modelOutputLimit, readConfig } from "../src/config.ts"

const response = (overrides: Partial<AssistantMessage> = {}): AssistantMessage => ({
  role: "assistant",
  api: "openai-completions",
  provider: "deepseek",
  model: "deepseek-flash",
  content: [],
  stopReason: "toolUse",
  timestamp: Date.now(),
  usage: {
    input: 80,
    output: 20,
    reasoning: 10,
    cacheRead: 5,
    cacheWrite: 0,
    totalTokens: 105,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  ...overrides,
})

describe("durable chat diagnostics", () => {
  it("uses the documented DeepSeek ceiling and rejects invalid environment limits", () => {
    const config = readConfig({})
    expect(config).toMatchObject({ thinkingLevel: "max", maxTokens: 393216 })
    expect(modelOutputLimit({ id: "deepseek-flash", maxTokens: 384000 }, config.maxTokens)).toBe(
      393216,
    )
    expect(readConfig({ DEEPSEEK_MAX_TOKENS: "65536" }).maxTokens).toBe(65536)
    for (const value of ["0", "-1", "393217", "NaN"])
      expect(() => readConfig({ DEEPSEEK_MAX_TOKENS: value })).toThrow()
  })

  it("records cutoff reasons and reported usage without double-counting reasoning", () => {
    const recorder = new ChatRecorder(readConfig({ DEEPSEEK_API_KEY: "private-key" }))
    recorder.modelStart("deepseek-flash", 393216, false)
    recorder.messageEnd(response())
    recorder.modelStart("deepseek-flash", 393216, false)
    recorder.payload({ max_tokens: 12345 })
    recorder.messageEnd(
      response({ stopReason: "length", rawStopReason: "length", errorMessage: "private-key" }),
    )
    recorder.finish("MODEL_OUTPUT_LIMIT")
    expect(recorder.record.diagnostics).toMatchObject({
      error_code: "MODEL_OUTPUT_LIMIT",
      stop_reason: "length",
      raw_stop_reason: "length",
      usage: { input: 160, output: 40, reasoning: 20, cache_read: 10, total: 210 },
      usage_complete: true,
    })
    expect(recorder.record.diagnostics.requests[1]?.max_tokens).toBe(12345)
    expect(JSON.stringify(recorder.record)).not.toContain("private-key")
  })

  it("retains completed tool facts when a later request dies, including after process restart", () => {
    const directory = mkdtempSync(join(tmpdir(), "chat-record-"))
    const path = join(directory, "chat.sqlite")
    let store = new ChatStore(path)
    try {
      const chat = store.create(1, null)
      const turn = store.begin(1, chat.id, {
        message_id: randomUUID(),
        revision: 0,
        text: "继续查询",
      })
      const recorder = new ChatRecorder(readConfig({}), (record) =>
        store.checkpointRecord(turn.seq, record),
      )
      recorder.messageEnd({ role: "user", content: "继续查询", timestamp: Date.now() })
      recorder.modelStart("deepseek-flash", 393216, false)
      recorder.messageEnd(
        response({
          content: [
            { type: "toolCall", id: "returned", name: "get_context", arguments: {} },
            { type: "toolCall", id: "unreturned", name: "get_school", arguments: {} },
          ],
        }),
      )
      recorder.toolStart("returned", "get_context")
      recorder.messageEnd({
        role: "toolResult",
        toolCallId: "returned",
        toolName: "get_context",
        content: [{ type: "text", text: '{"semester":"下学期"}' }],
        isError: false,
        timestamp: Date.now(),
      })
      recorder.modelStart("deepseek-flash", 393216, false)
      // Simulate a process dying before the next provider response; do not finish the turn.
      store.close()
      store = new ChatStore(path)
      const reader = new DatabaseSync(path, { readOnly: true })
      try {
        const row = reader
          .prepare("SELECT transcript_json,diagnostics_json FROM turns WHERE seq=?")
          .get(turn.seq) as { transcript_json: string; diagnostics_json: string }
        expect(row.transcript_json).toContain("下学期")
        expect(JSON.parse(row.diagnostics_json)).toMatchObject({
          error_code: "AGENT_RESTARTED",
          status: "interrupted",
          usage_complete: false,
        })
      } finally {
        reader.close()
      }
      const history = JSON.stringify(store.history(1, chat.id))
      expect(history).toContain("下学期")
      expect(history).not.toContain("unreturned")
      expect(history).not.toContain("未完成任何操作")
      expect(store.detail(1, chat.id).messages[1]?.metadata?.error_code).toBe("AGENT_RESTARTED")
    } finally {
      store.close()
      rmSync(directory, { recursive: true })
    }
  })

  it("marks missing provider usage as unknown and never replays truncated tool arguments", () => {
    const recorder = new ChatRecorder(readConfig({}))
    recorder.modelStart("deepseek-flash", 393216, false)
    const message = response({
      stopReason: "aborted",
      usage: { ...response().usage, input: 0, output: 0, totalTokens: 0 },
      content: [{ type: "toolCall", id: "partial", name: "get_context", arguments: {} }],
    })
    recorder.messageEnd(message)
    recorder.finish("RUN_INTERRUPTED")
    expect(recorder.record.diagnostics.usage).toBeNull()
    expect(recorder.record.diagnostics.usage_complete).toBe(false)
    expect(replayChatTranscript([message])).toEqual([])
  })
})
