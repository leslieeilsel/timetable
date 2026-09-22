import { afterEach, describe, expect, it, vi } from "vitest"
import { once } from "node:events"
import type { AddressInfo } from "node:net"
import { createAgentServer } from "../src/server.ts"
import { readConfig } from "../src/config.ts"
import type { RunScenario } from "../src/run.ts"

const close: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(close.splice(0).map((stop) => stop()))
})
const identity = { id: 1, role: "scheduler", is_active: true, must_change_password: false }
const business = (status = 200) =>
  vi.fn<typeof fetch>(async () => Response.json({ data: identity }, { status }))
async function start(runner: RunScenario, transport = business(), key = "test-only-key") {
  const config = readConfig({ DEEPSEEK_API_KEY: key, PUBLIC_ORIGINS: "http://localhost:5173" })
  const { server, abortAll } = createAgentServer(config, runner, transport)
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  close.push(async () => {
    abortAll()
    server.closeAllConnections()
    server.close()
    await once(server, "close")
  })
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/agent/v1/runs`
  const post = (
    overrides: Record<string, string> = {},
    body: unknown = { feature: "constraint_draft", semester_id: 7, input: "李老师周二不排课" },
    signal?: AbortSignal,
  ) =>
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:5173",
        Cookie: "session=alice",
        "X-XSRF-TOKEN": "csrf-alice",
        ...overrides,
      },
      body: JSON.stringify(body),
      signal,
    })
  return { post, transport }
}

describe("Agent HTTP boundary", () => {
  it("validates origin and CSRF through Laravel before calling the model", async () => {
    const runner = vi.fn<RunScenario>()
    const app = await start(runner, business(419))
    expect((await app.post({ Origin: "https://untrusted.example" })).status).toBe(403)
    expect(app.transport).not.toHaveBeenCalled()
    expect((await app.post()).status).toBe(419)
    expect(runner).not.toHaveBeenCalled()
    const [url, request] = app.transport.mock.calls[0]!
    expect(url instanceof Request ? url.url : url.toString()).toBe(
      "http://127.0.0.1:8000/api/v1/auth/session-check",
    )
    expect(new Headers(request?.headers).get("X-XSRF-TOKEN")).toBe("csrf-alice")
  })

  it("does not accept tool targets or credentials in user input", async () => {
    const runner = vi.fn<RunScenario>()
    const app = await start(runner)
    const response = await app.post(
      {},
      {
        feature: "constraint_draft",
        semester_id: 1,
        input: "规则",
        base_url: "https://other.example",
        api_key: "unsafe",
      },
    )
    expect(response.status).toBe(422)
    expect(runner).not.toHaveBeenCalled()
    expect(app.transport).not.toHaveBeenCalled()
  })

  it("reports an unconfigured server without attempting a model call", async () => {
    const runner = vi.fn<RunScenario>()
    const { post } = await start(runner, business(), "")
    expect((await post()).status).toBe(503)
    expect(runner).not.toHaveBeenCalled()
  })

  it("keeps concurrent users and their cookies isolated", async () => {
    const seen: string[] = []
    const transport = vi.fn<typeof fetch>(async (_url, request) => {
      const cookie = new Headers(request?.headers).get("Cookie")!
      seen.push(cookie)
      return Response.json({ data: { ...identity, id: cookie.includes("bob") ? 2 : 1 } })
    })
    const { post } = await start(async (_config, _input, api, emit) => {
      await api.authenticate()
      emit({ type: "clarification", question: "请补充姓名。" })
    }, transport)
    const responses = await Promise.all([
      post(),
      post({ Cookie: "session=bob", "X-XSRF-TOKEN": "csrf-bob" }),
    ])
    const streams = await Promise.all(responses.map((response) => response.text()))
    expect(seen.filter((cookie) => cookie === "session=alice")).toHaveLength(2)
    expect(seen.filter((cookie) => cookie === "session=bob")).toHaveLength(2)
    for (const value of streams) {
      expect(value).toContain('"type":"run.completed"')
      expect(value).not.toMatch(/session=|csrf-|test-only-key/)
    }
  })

  it("redacts provider exceptions and aborts work when the browser disconnects", async () => {
    const first = await start(async () => {
      throw new Error("provider Authorization: secret")
    })
    const response = await first.post()
    const value = await response.text()
    expect(value).toContain('"code":"AGENT_FAILED"')
    expect(value).not.toContain("secret")
    let aborted!: () => void
    const stopped = new Promise<void>((resolve) => {
      aborted = resolve
    })
    const second = await start(async (_config, _input, _api, _emit, signal) => {
      await new Promise<void>((resolve) =>
        signal.addEventListener(
          "abort",
          () => {
            aborted()
            resolve()
          },
          { once: true },
        ),
      )
    })
    const controller = new AbortController()
    const stream = await second.post({}, undefined, controller.signal)
    expect(stream.status).toBe(200)
    controller.abort()
    await stopped
  })
})
