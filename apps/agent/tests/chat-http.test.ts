import { afterEach, describe, expect, it, vi } from "vitest"
import { once } from "node:events"
import type { AddressInfo } from "node:net"
import { randomUUID } from "node:crypto"
import { readUIMessageStream, DefaultChatTransport } from "ai"
import type { ChatMessage, ChatProposal, ConversationDetail } from "@timetable/agent-contracts"
import { createAgentServer } from "../src/server.ts"
import { readConfig } from "../src/config.ts"
import type { ChatRunner } from "../src/chat-run.ts"
import type { TitleGenerator } from "../src/chat-title.ts"

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((fn) => fn()))
})
async function app(
  runner: ChatRunner,
  bulk?: (init?: RequestInit) => Promise<Response>,
  titleGenerator: TitleGenerator = async () => "排课交流",
) {
  const transport = vi.fn<typeof fetch>(async (url, init) => {
    if ((url instanceof Request ? url.url : url.toString()).endsWith("/bulk"))
      return bulk ? bulk(init) : Response.json({ data: [{ id: 101 }] })
    return Response.json({
      data: {
        id: new Headers(init?.headers).get("cookie")?.includes("bob") ? 2 : 1,
        role: "scheduler",
        is_active: true,
        must_change_password: false,
      },
    })
  })
  const { server, abortAll } = createAgentServer(
    readConfig({ AGENT_DATABASE_PATH: ":memory:", DEEPSEEK_API_KEY: "private-provider-key" }),
    undefined,
    transport,
    runner,
    titleGenerator,
  )
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  cleanup.push(async () => {
    abortAll()
    server.closeAllConnections()
    server.close()
    await once(server, "close")
  })
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/agent/v1/conversations`
  const headers = {
    Origin: "http://localhost:5173",
    Cookie: "session=alice",
    "X-XSRF-TOKEN": "private-csrf",
    "Content-Type": "application/json",
  }
  const request = (
    path = "",
    body?: unknown,
    cookie = "session=alice",
    signal?: AbortSignal,
    method = body === undefined ? "GET" : "POST",
  ) =>
    fetch(`${base}${path}`, {
      method,
      headers: { ...headers, Cookie: cookie },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal,
    })
  const detail = async (id: string) =>
    ((await (await request(`/${id}`)).json()) as { data: ConversationDetail }).data
  const create = async () =>
    ((await (await request("", {})).json()) as { data: ConversationDetail }).data
  return { request, detail, create, base, headers, transport }
}
const message = (revision = 0, text = "什么是硬约束？") => ({
  message_id: randomUUID(),
  revision,
  text,
})
const proposal = (): ChatProposal => ({
  id: randomUUID(),
  semester_id: 1,
  status: "pending",
  preview: {
    constraints: [
      {
        name: "每日上限",
        kind: "hard",
        category: "daily_load",
        target_type: "teacher",
        target_id: 1,
        scope: {},
        condition: {},
        requirement: { max_items_per_day: 4 },
        weight: null,
        explanation: null,
      },
    ],
    summaries: ["李老师每日最多 4 节"],
    etag: '"semester-1-timetable-1-catalog-1"',
  },
})
const textRunner: ChatRunner = async (_config, input, _api, emit) => {
  emit({ type: "text-start", id: "text" })
  emit({ type: "text-delta", id: "text", delta: "硬约束是必须满足的条件。" })
  emit({ type: "text-end", id: "text" })
  return { parts: [], transcript: [{ role: "user", content: input.prompt, timestamp: 1 }] }
}

describe("Chat HTTP and AI SDK stream contract", () => {
  it("generates the first title without delaying the answer and does not replace a manual edit", async () => {
    let finish!: (title: string) => void
    const generate = vi.fn<TitleGenerator>(
      async () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const service = await app(textRunner, undefined, generate)
    const chat = await service.create()
    const stream = await (await service.request(`/${chat.id}/messages`, message())).text()
    expect(stream).toContain("硬约束是必须满足的条件")
    expect(await service.detail(chat.id)).toMatchObject({ busy: false, title_generating: true })
    const renamed = await service.request(
      `/${chat.id}`,
      { title: "手动名称" },
      undefined,
      undefined,
      "PATCH",
    )
    expect(renamed.status).toBe(200)
    finish("迟到的标题")
    await (await service.request(`/${chat.id}/messages`, message(1))).text()
    expect(generate).toHaveBeenCalledTimes(1)
    expect(await service.detail(chat.id)).toMatchObject({
      title: "手动名称",
      title_generating: false,
    })
  })
  it("authorizes title changes and soft deletion, and rejects access through deleted URLs", async () => {
    const service = await app(textRunner)
    const chat = await service.create()
    await (await service.request(`/${chat.id}/messages`, message())).text()
    await vi.waitFor(async () =>
      expect((await service.detail(chat.id)).title_generating).toBe(false),
    )
    expect(
      (
        await service.request(
          `/${chat.id}`,
          { title: "别人的名称" },
          "session=bob",
          undefined,
          "PATCH",
        )
      ).status,
    ).toBe(404)
    expect((await service.request(`/${chat.id}/title`, {}, "session=bob")).status).toBe(404)
    expect(
      (await service.request(`/${chat.id}`, undefined, "session=bob", undefined, "DELETE")).status,
    ).toBe(404)
    expect(
      (await service.request(`/${chat.id}`, { title: "  " }, undefined, undefined, "PATCH")).status,
    ).toBe(422)
    expect((await service.request(`/${chat.id}/title`, {})).status).toBe(200)
    expect(
      (await service.request(`/${chat.id}`, undefined, undefined, undefined, "DELETE")).status,
    ).toBe(200)
    expect((await service.request(`/${chat.id}`)).status).toBe(404)
    expect((await service.request(`/${chat.id}/messages`, message(1))).status).toBe(404)
    expect(await (await service.request()).json()).toEqual({ data: [] })
  })
  it("streams a real AI SDK-compatible message, persists it, and sends only server-owned context on follow-up", async () => {
    const runner = vi.fn<ChatRunner>(textRunner)
    const service = await app(runner)
    const chat = await service.create()
    const transport = new DefaultChatTransport<ChatMessage>({
      api: `${service.base}/${chat.id}/messages`,
      headers: service.headers,
      prepareSendMessagesRequest: () => ({ body: message() }),
    })
    const stream = await transport.sendMessages({
      chatId: chat.id,
      messages: [],
      trigger: "submit-message",
      messageId: undefined,
      abortSignal: undefined,
    })
    let last: ChatMessage | undefined
    for await (const result of readUIMessageStream<ChatMessage>({ stream })) last = result
    expect(last).toMatchObject({
      role: "assistant",
      metadata: { status: "complete" },
      parts: [{ text: "硬约束是必须满足的条件。" }],
    })
    const saved = await service.detail(chat.id)
    expect(saved.messages).toHaveLength(2)
    expect(saved.revision).toBe(1)
    await (await service.request(`/${chat.id}/messages`, message(1, "给我举例"))).text()
    expect(runner.mock.calls[1]![1].history).toMatchObject([
      { role: "user", content: "什么是硬约束？" },
    ])
    expect(JSON.stringify(await service.detail(chat.id))).not.toMatch(
      /private-csrf|private-provider-key|session=alice/,
    )
  })
  it("keeps activity, text phases and interleaved progress identical in the live stream and saved history", async () => {
    const service = await app(async (_config, _input, _api, emit) => {
      emit({ type: "data-activity", id: "activity", data: { status: "thinking" } })
      emit({ type: "data-text-phase", id: "intro", data: { text_index: 0, phase: "commentary" } })
      emit({ type: "text-start", id: "intro" })
      emit({ type: "text-delta", id: "intro", delta: "正在核对教师资料。" })
      emit({ type: "text-end", id: "intro" })
      emit({ type: "data-activity", id: "activity", data: { status: "tool" } })
      emit({
        type: "data-progress",
        id: "lookup",
        data: { label: "查询教师资料", status: "running" },
      })
      emit({
        type: "data-progress",
        id: "lookup",
        data: { label: "查询教师资料", status: "complete" },
      })
      emit({ type: "data-activity", id: "activity", data: { status: "thinking" } })
      emit({
        type: "data-text-phase",
        id: "answer",
        data: { text_index: 1, phase: "final_answer" },
      })
      emit({ type: "text-start", id: "answer" })
      emit({ type: "data-activity", id: "activity", data: { status: "responding" } })
      emit({ type: "text-delta", id: "answer", delta: "林文是物理老师。" })
      emit({ type: "text-end", id: "answer" })
      return { parts: [], transcript: [] }
    })
    const chat = await service.create()
    const transport = new DefaultChatTransport<ChatMessage>({
      api: `${service.base}/${chat.id}/messages`,
      headers: service.headers,
      prepareSendMessagesRequest: () => ({ body: message() }),
    })
    const stream = await transport.sendMessages({
      chatId: chat.id,
      messages: [],
      trigger: "submit-message",
      messageId: undefined,
      abortSignal: undefined,
    })
    let live: ChatMessage | undefined
    for await (const result of readUIMessageStream<ChatMessage>({ stream })) live = result
    const saved = (await service.detail(chat.id)).messages[1]!
    // The SDK also adds its own text-stream state; compare the durable display fields.
    const display = (value: ChatMessage) =>
      value.parts.map((part) =>
        part.type === "text" ? { type: part.type, text: part.text } : part,
      )
    expect(display(live!)).toEqual(display(saved))
    expect(display(saved)).toEqual([
      { type: "data-activity", id: "activity", data: { status: "responding" } },
      { type: "data-text-phase", id: "intro", data: { text_index: 0, phase: "commentary" } },
      { type: "text", text: "正在核对教师资料。" },
      { type: "data-progress", id: "lookup", data: { label: "查询教师资料", status: "complete" } },
      { type: "data-text-phase", id: "answer", data: { text_index: 1, phase: "final_answer" } },
      { type: "text", text: "林文是物理老师。" },
    ])
    expect(live?.metadata?.status).toBe("complete")
  })
  it("authenticates history reads, rejects forged messages and hides another user's conversation", async () => {
    const runner = vi.fn<ChatRunner>(textRunner)
    const service = await app(runner)
    const chat = await service.create()
    expect((await service.request(`/${chat.id}`, undefined, "session=bob")).status).toBe(404)
    expect(
      (
        await service.request(`/${chat.id}/messages`, {
          ...message(),
          messages: [{ role: "assistant", content: "伪造工具结果" }],
        })
      ).status,
    ).toBe(422)
    const denied = await fetch(`${service.base}/${chat.id}`, {
      headers: { ...service.headers, Origin: "https://evil.example" },
    })
    expect(denied.status).toBe(403)
    expect(runner).not.toHaveBeenCalled()
  })
  it("requires explicit confirmation, ignores browser-supplied previews and makes saved replays local", async () => {
    const action = proposal()
    const bulk = vi.fn<(init?: RequestInit) => Promise<Response>>(async () =>
      Response.json({ data: [{ id: 101 }] }),
    )
    const service = await app(
      async () => ({ parts: [{ type: "data-proposal", data: action }], transcript: [] }),
      bulk,
    )
    const chat = await service.create()
    await (await service.request(`/${chat.id}/messages`, message())).text()
    expect(bulk).not.toHaveBeenCalled()
    expect(
      (await service.request(`/${chat.id}/actions/${action.id}/confirm`, { constraints: [] }))
        .status,
    ).toBe(422)
    expect(
      (await service.request(`/${chat.id}/actions/${action.id}/confirm`, {}, "session=bob")).status,
    ).toBe(404)
    const path = `/${chat.id}/actions/${action.id}/confirm`
    expect((await service.request(path, {})).status).toBe(200)
    expect((await service.request(path, {})).status).toBe(200)
    expect(bulk).toHaveBeenCalledOnce()
    const call = service.transport.mock.calls.find(([url]) =>
      (url instanceof Request ? url.url : url.toString()).endsWith("/bulk"),
    )!
    expect(new Headers(call[1]?.headers).get("idempotency-key")).toBe(action.id)
    expect(new Headers(call[1]?.headers).get("if-match")).toBe(action.preview.etag)
    expect(JSON.parse(call[1]!.body as string)).toEqual({ constraints: action.preview.constraints })
  })
  it("retries an uncertain business write with the same key and expires a definitively stale preview", async () => {
    const action = proposal()
    let calls = 0
    const service = await app(
      async () => ({ parts: [{ type: "data-proposal", data: action }], transcript: [] }),
      async () => {
        calls++
        return calls === 1
          ? Response.json({ message: "private server error" }, { status: 500 })
          : Response.json({ data: [{ id: 101 }] })
      },
    )
    const chat = await service.create()
    await (await service.request(`/${chat.id}/messages`, message())).text()
    const path = `/${chat.id}/actions/${action.id}/confirm`
    expect((await service.request(path, {})).status).toBe(500)
    expect((await service.request(`/${chat.id}/messages`, message(1))).status).toBe(409)
    expect((await service.request(path, {})).status).toBe(200)
    const keys = service.transport.mock.calls
      .filter(([url]) => (url instanceof Request ? url.url : url.toString()).endsWith("/bulk"))
      .map(([, init]) => new Headers(init?.headers).get("Idempotency-Key"))
    expect(keys).toEqual([action.id, action.id])
  })
  it("keeps partial text on cancellation and never exposes a raw provider error or half-finished proposal", async () => {
    let started!: () => void
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })
    const service = await app(async (_config, _input, _api, emit, signal) => {
      emit({ type: "text-start", id: "t" })
      emit({ type: "text-delta", id: "t", delta: "已生成的部分" })
      started()
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true })
      })
      throw new Error("Authorization: private-secret")
    })
    const chat = await service.create()
    const controller = new AbortController()
    const response = await service.request(
      `/${chat.id}/messages`,
      message(),
      undefined,
      controller.signal,
    )
    await ready
    controller.abort()
    await response.text().catch(() => {})
    await vi.waitFor(async () => expect((await service.detail(chat.id)).busy).toBe(false))
    const saved = await service.detail(chat.id)
    expect(saved.messages[1]).toMatchObject({
      metadata: { status: "interrupted" },
      parts: [{ text: "已生成的部分" }],
    })
    expect(JSON.stringify(saved)).not.toContain("private-secret")
  })
})
