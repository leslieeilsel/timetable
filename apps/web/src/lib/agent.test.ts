import { afterEach, describe, expect, it, vi } from "vitest"
import { consumeAgentStream, runAgent } from "@/lib/agent"
import type { AgentEvent } from "@timetable/agent-contracts"

afterEach(() => vi.unstubAllGlobals())
const events: AgentEvent[] = [
  { type: "run.started", run_id: "9e81d203-3013-4a7c-a542-d8d3c654c410" },
  { type: "clarification", question: "请提供李老师的工号。" },
  { type: "run.completed" },
]
const encode = (values: AgentEvent[] = events) =>
  values.map((event, index) => `id: ${index + 1}\ndata: ${JSON.stringify(event)}\n\n`).join("")
function stream(value: string, chunkSize = 3) {
  const bytes = new TextEncoder().encode(value)
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += chunkSize)
        controller.enqueue(bytes.slice(offset, offset + chunkSize))
      controller.close()
    },
  })
}

describe("Agent stream", () => {
  it("handles Chinese UTF-8 split across chunks, CRLF and heartbeats", async () => {
    const received: AgentEvent[] = []
    await consumeAgentStream(
      stream((": heartbeat\n\n" + encode()).replaceAll("\n", "\r\n"), 1),
      (event) => received.push(event),
      new AbortController().signal,
    )
    expect(received).toEqual(events)
  })

  it.each([
    encode(events.slice(0, 2)),
    encode().replace("id: 2", "id: 5"),
    encode([events[0]!, { type: "run.completed" }]),
    encode() + "data: not-json\n\n",
  ])("rejects an interrupted or invalid protocol", async (value) => {
    await expect(
      consumeAgentStream(stream(value), () => {}, new AbortController().signal),
    ).rejects.toMatchObject({ code: "AI_STREAM_INVALID" })
  })

  it("cancels the reader on abort instead of accepting an unfinished result", async () => {
    const controller = new AbortController()
    const cancel = vi.fn<() => void>()
    const pending = consumeAgentStream(new ReadableStream({ cancel }), () => {}, controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it("refreshes CSRF once before starting a stream, with no automatic model retry", async () => {
    vi.stubGlobal("window", new EventTarget())
    vi.stubGlobal("document", { cookie: "XSRF-TOKEN=test" })
    const calls: string[] = []
    let runs = 0
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (url) => {
        const path = url instanceof Request ? url.url : url.toString()
        calls.push(path)
        if (path.includes("csrf-cookie")) return new Response(null, { status: 204 })
        if (++runs === 1) return new Response("{}", { status: 419 })
        return new Response(stream(encode()), { headers: { "Content-Type": "text/event-stream" } })
      }),
    )
    await runAgent(
      { feature: "constraint_draft", semester_id: 1, input: "李老师周二不排课" },
      () => {},
      new AbortController().signal,
    )
    expect(runs).toBe(2)
    expect(calls.at(-2)).toBe("/sanctum/csrf-cookie")
  })
})
