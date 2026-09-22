import { afterEach, describe, expect, it, vi } from "vitest"
import {
  createAssistantMessageEventStream,
  getCurrentTools,
  type AssistantMessage,
  type Models,
} from "@earendil-works/pi-ai"
import type { AgentEvent } from "@timetable/agent-contracts"
import { BusinessApi } from "../src/business-api.ts"
import { readConfig } from "../src/config.ts"
import { runScenario } from "../src/run.ts"
import type { ChatChunk } from "../src/chat-run.ts"
import { finalAnswerToolName } from "../src/chat-text.ts"

const { modelStream } = vi.hoisted(() => ({ modelStream: vi.fn<Models["streamSimple"]>() }))
vi.mock("@earendil-works/pi-ai", async (importOriginal) => {
  const original = await importOriginal<typeof import("@earendil-works/pi-ai")>()
  return {
    ...original,
    createModels: () => {
      const models = original.createModels()
      models.streamSimple = modelStream
      return models
    },
  }
})
afterEach(() => modelStream.mockReset())

function answer(content: AssistantMessage["content"], toolUse = false) {
  const result = createAssistantMessageEventStream()
  const message: AssistantMessage = {
    role: "assistant",
    api: "openai-completions",
    provider: "deepseek",
    model: "deepseek-flash",
    content,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: toolUse ? "toolUse" : "stop",
    timestamp: Date.now(),
  }
  result.push({ type: "done", reason: toolUse ? "toolUse" : "stop", message })
  return result
}
function finalAnswer(text: string) {
  return answer(
    [{ type: "toolCall", id: "final", name: finalAnswerToolName, arguments: { answer: text } }],
    true,
  )
}
function api(respond?: typeof fetch) {
  return new BusinessApi(
    "http://localhost:8000",
    { cookie: "session=private-user", csrf: "private-csrf", origin: "http://localhost:5173" },
    new AbortController().signal,
    respond ??
      vi.fn<typeof fetch>(async () =>
        Response.json({
          data: { id: 1, role: "scheduler", is_active: true, must_change_password: false },
        }),
      ),
  )
}

describe("pi execution", () => {
  it("executes a real pi tool call and publishes only the validated result", async () => {
    modelStream.mockImplementation(() =>
      answer(
        [
          { type: "thinking", thinking: "private reasoning" },
          {
            type: "toolCall",
            id: "call_1",
            name: "ask_clarification",
            arguments: { question: "请提供教师的完整姓名。" },
          },
        ],
        true,
      ),
    )
    const events: AgentEvent[] = []
    await runScenario(
      readConfig({ DEEPSEEK_API_KEY: "server-only-probe" }),
      { feature: "constraint_draft", semester_id: 1, input: "李老师不排上午" },
      api(),
      (event) => events.push(event),
      new AbortController().signal,
    )
    expect(events.at(-1)).toEqual({ type: "clarification", question: "请提供教师的完整姓名。" })
    expect(modelStream).toHaveBeenCalledOnce()
    expect(modelStream.mock.calls[0]![2]).toMatchObject({
      apiKey: "server-only-probe",
      maxRetries: 0,
    })
    expect(JSON.stringify(modelStream.mock.calls[0]![1])).not.toMatch(
      /private-user|private-csrf|server-only-probe/,
    )
    expect(JSON.stringify(events)).not.toContain("private reasoning")
  })

  it("does not turn an agent_end without a result into success", async () => {
    modelStream.mockImplementation(() => answer([{ type: "text", text: "已帮你保存规则" }]))
    const events: AgentEvent[] = []
    await expect(
      runScenario(
        readConfig(),
        { feature: "constraint_draft", semester_id: 1, input: "添加规则" },
        api(),
        (event) => events.push(event),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "AI_OUTPUT_INVALID" })
    expect(events).toEqual([])
  })

  it("continues tool calls beyond the former limit until the workflow returns a result", async () => {
    let calls = 0
    modelStream.mockImplementation(() => {
      calls++
      return calls <= 25
        ? answer(
            [
              {
                type: "toolCall",
                id: `lookup-${calls}`,
                name: "get_constraint_capabilities",
                arguments: {},
              },
            ],
            true,
          )
        : answer(
            [
              {
                type: "toolCall",
                id: "question",
                name: "ask_clarification",
                arguments: { question: "请提供教师全名。" },
              },
            ],
            true,
          )
    })
    const events: AgentEvent[] = []
    await runScenario(
      readConfig({ AGENT_MAX_TURNS: "2" }),
      { feature: "constraint_draft", semester_id: 1, input: "添加规则" },
      api(),
      (event) => events.push(event),
      new AbortController().signal,
    )
    expect(modelStream).toHaveBeenCalledTimes(26)
    expect(events.at(-1)).toEqual({ type: "clarification", question: "请提供教师全名。" })
  })
})

// The chat runtime uses pi for free text and follow-ups; UI transport is not a second agent loop.
describe("pi conversational execution", () => {
  it("provides model identity and uses maximum reasoning without exposing reasoning or credentials", async () => {
    const { runChat } = await import("../src/chat-run.ts")
    modelStream.mockImplementation(() =>
      answer(
        [
          { type: "thinking", thinking: "private internal reasoning" },
          {
            type: "toolCall",
            id: "final",
            name: finalAnswerToolName,
            arguments: { answer: "当前使用 DeepSeek deepseek-flash。" },
          },
        ],
        true,
      ),
    )
    const chunks: unknown[] = []
    await runChat(
      readConfig({ DEEPSEEK_API_KEY: "server-only-probe" }),
      { prompt: "你是什么模型", semesterId: 4, history: [] },
      api(),
      (chunk) => chunks.push(chunk),
      new AbortController().signal,
    )
    const context = modelStream.mock.calls[0]![1]
    const system = context.messages.filter((message) => message.role === "system")
    expect(JSON.stringify(system)).toContain("deepseek-flash")
    expect(JSON.stringify(context)).not.toMatch(/server-only-probe|private-csrf|private-user/)
    expect(modelStream.mock.calls[0]![2]).toMatchObject({ reasoning: "max", maxTokens: 393216 })
    expect(JSON.stringify(chunks)).not.toMatch(/private internal reasoning|server-only-probe/)
  })

  it("delivers fresh teacher courses through the real pi loop after a corrected question", async () => {
    const { runChat } = await import("../src/chat-run.ts")
    const history = [
      { role: "user" as const, content: "林文负责什么课程", timestamp: 1 },
      await answer([{ type: "text", text: "林文本学期没有任课安排。" }]).result(),
    ]
    const calls: string[] = []
    const business = api(async (url) => {
      const path = new URL(url instanceof Request ? url.url : url.toString()).pathname
      calls.push(path)
      return Response.json({
        data: path.endsWith("session-check")
          ? { id: 1, role: "scheduler", is_active: true, must_change_password: false }
          : [{ id: 37, name: "林文", employee_no: null, courses: [{ id: 3, name: "物理" }] }],
        meta: { pagination: { total: 1 } },
      })
    })
    modelStream
      .mockImplementationOnce(() =>
        answer(
          [
            { type: "text", text: "我先查看教师资料。" },
            {
              type: "toolCall",
              id: "teacher",
              name: "find_resources",
              arguments: { resource: "teacher", query: "林文" },
            },
          ],
          true,
        ),
      )
      .mockImplementationOnce((_model, context) => {
        const fact = context.messages.findLast((message) => message.role === "toolResult")
        const text = fact?.content.find((part) => part.type === "text")?.text ?? ""
        expect(JSON.parse(text)).toMatchObject({
          matches: [{ courses: [{ ref: expect.stringMatching(/^course:/), name: "物理" }] }],
        })
        expect(text).not.toMatch(/"(?:id|teacher_id|course_id)":/)
        return finalAnswer("林文是物理老师。")
      })
    const chunks: unknown[] = []
    const result = await runChat(
      readConfig(),
      { prompt: "我问的是基础资料，他是什么老师？", semesterId: 4, history },
      business,
      (chunk) => chunks.push(chunk),
      new AbortController().signal,
    )
    expect(modelStream).toHaveBeenCalledTimes(2)
    expect(calls.filter((path) => !path.endsWith("session-check"))).toEqual(["/api/v1/teachers"])
    expect(result.transcript.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "toolResult",
      "assistant",
      "toolResult",
    ])
    expect(chunks).toContainEqual({
      type: "data-text-phase",
      id: "text-1",
      data: { text_index: 0, phase: "commentary" },
    })
    expect(chunks).toContainEqual({
      type: "data-text-phase",
      id: "text-2",
      data: { text_index: 1, phase: "final_answer" },
    })
  })

  it("marks failed queries as errors in both pi history and UI progress", async () => {
    const { runChat } = await import("../src/chat-run.ts")
    const business = api(async (url) => {
      const path = new URL(url instanceof Request ? url.url : url.toString()).pathname
      if (path.endsWith("session-check"))
        return Response.json({
          data: { id: 1, role: "scheduler", is_active: true, must_change_password: false },
        })
      if (path.endsWith("context"))
        return Response.json({ data: { timezone: "Asia/Shanghai", current_semester: null } })
      return Response.json(
        { message: "No query results for model [App\\Models\\Semester] 4" },
        { status: 404 },
      )
    })
    modelStream
      .mockImplementationOnce(() =>
        answer([{ type: "toolCall", id: "ctx", name: "get_context", arguments: {} }], true),
      )
      .mockImplementationOnce((_model, context) => {
        const fact = context.messages.findLast((message) => message.role === "toolResult")
        expect(fact).toMatchObject({ isError: true })
        expect(JSON.stringify(fact)).toContain("SEMESTER_NOT_FOUND")
        expect(JSON.stringify(fact)).not.toContain("App")
        return finalAnswer("所选学期不存在。")
      })
    const chunks: unknown[] = []
    await runChat(
      readConfig(),
      { prompt: "查一下当前学期", semesterId: 4, history: [] },
      business,
      (chunk) => chunks.push(chunk),
      new AbortController().signal,
    )
    expect(chunks).toContainEqual({
      type: "data-progress",
      id: "ctx",
      data: { label: "读取学期与当前日期", status: "error" },
    })
  })
  it("delivers free-form answers and keeps only the new turn in the durable transcript", async () => {
    const { runChat } = await import("../src/chat-run.ts")
    const history = [{ role: "user" as const, content: "上一轮问题", timestamp: 1 }]
    modelStream.mockImplementation(() => finalAnswer("可以，我们继续讨论。"))
    const chunks: unknown[] = []
    const result = await runChat(
      readConfig(),
      { prompt: "请举例", semesterId: null, history },
      api(),
      (chunk) => chunks.push(chunk),
      new AbortController().signal,
    )
    expect(result.transcript.map((m) => m.role)).toEqual(["user", "assistant", "toolResult"])
    expect(result.transcript[0]).toMatchObject({ content: [{ type: "text", text: "请举例" }] })
    expect(chunks).toContainEqual({
      type: "text-delta",
      id: "text-1",
      delta: "可以，我们继续讨论。",
    })
    expect(
      modelStream.mock.calls[0]![1].messages.some(
        (message) => message.role === "user" && message.content === "上一轮问题",
      ),
    ).toBe(true)
  })
  it("keeps tools available beyond the former limit until the model finishes its answer", async () => {
    const { runChat } = await import("../src/chat-run.ts")
    const business = api(async (url) =>
      Response.json({
        data: new URL(url instanceof Request ? url.url : url.toString()).pathname.endsWith(
          "session-check",
        )
          ? { id: 1, role: "scheduler", is_active: true, must_change_password: false }
          : { system_name: "示例学校", timezone: "Asia/Shanghai", catalog_revision: 17 },
      }),
    )
    let calls = 0
    modelStream.mockImplementation((_model, context) => {
      calls++
      expect(getCurrentTools(context.messages).map((tool) => tool.name)).toContain(
        "get_school_settings",
      )
      if (calls <= 25)
        return answer(
          [{ type: "toolCall", id: `lookup-${calls}`, name: "get_school_settings", arguments: {} }],
          true,
        )
      expect(JSON.stringify(context.messages)).toContain("示例学校")
      expect(JSON.stringify(context.messages)).not.toContain("catalog_revision")
      return finalAnswer("系统登记的名称是示例学校。")
    })
    const config = readConfig({ AGENT_MAX_TURNS: "2" })
    const result = await runChat(
      config,
      { prompt: "学校叫什么", semesterId: 4, history: [] },
      business,
      () => {},
      new AbortController().signal,
    )
    expect(modelStream).toHaveBeenCalledTimes(26)
    expect(result.transcript.some((message) => message.role === "system")).toBe(false)
    expect(JSON.stringify(result.transcript)).not.toContain("本轮查询预算")

    modelStream.mockImplementationOnce((_model, context) => {
      expect(getCurrentTools(context.messages).map((tool) => tool.name)).toContain("find_resources")
      expect(JSON.stringify(context.messages)).not.toContain("本轮查询预算")
      return finalAnswer("可以继续查询。")
    })
    await runChat(
      config,
      { prompt: "继续", semesterId: 4, history: result.transcript },
      business,
      () => {},
      new AbortController().signal,
    )
    expect(modelStream).toHaveBeenCalledTimes(27)
  })
  it.each(["commentary", "final_answer"] as const)(
    "streams %s before the upstream response finishes",
    async (phase) => {
      const { runChat } = await import("../src/chat-run.ts")
      const isAnswer = phase === "final_answer"
      const final = await (
        isAnswer
          ? finalAnswer("林文是物理老师。")
          : answer([{ type: "text", text: "林文是物理老师。" }])
      ).result()
      const stream = createAssistantMessageEventStream()
      modelStream
        .mockImplementationOnce(() => stream)
        .mockImplementationOnce(() => finalAnswer("林文是物理老师。"))
      const chunks: ChatChunk[] = []
      const business = api()
      const authenticate = vi.spyOn(business, "authenticate")
      let resolveFirstText = () => {}
      const firstText = new Promise<void>((resolve) => {
        resolveFirstText = resolve
      })
      const pending = runChat(
        readConfig(),
        { prompt: "林文是什么老师？", semesterId: 1, history: [] },
        business,
        (chunk) => {
          chunks.push(chunk)
          if (chunk.type === "text-delta") resolveFirstText()
        },
        new AbortController().signal,
      )
      const partial = (text: string): AssistantMessage => ({
        ...final,
        content: isAnswer
          ? [
              {
                type: "toolCall",
                id: "final",
                name: finalAnswerToolName,
                arguments: text ? { answer: text } : {},
              },
            ]
          : [{ type: "text", text }],
      })
      stream.push({ type: "start", partial: partial("") })
      stream.push({
        type: isAnswer ? "toolcall_start" : "text_start",
        contentIndex: 0,
        partial: partial(""),
      })
      stream.push({
        type: isAnswer ? "toolcall_delta" : "text_delta",
        contentIndex: 0,
        delta: isAnswer ? '{"answer":"林文' : "林文",
        partial: partial("林文"),
      })
      await firstText
      // The upstream stream is open: no complete-response buffering or tool execution yet.
      expect(authenticate).not.toHaveBeenCalled()
      expect(chunks.filter((chunk) => chunk.type === "text-delta")).toEqual([
        { type: "text-delta", id: "text-1", delta: "林文" },
      ])
      const phaseIndex = chunks.findIndex(
        (chunk) => chunk.type === "data-text-phase" && chunk.data.phase === phase,
      )
      expect(phaseIndex).toBeGreaterThanOrEqual(0)
      expect(chunks.findIndex((chunk) => chunk.type === "text-start")).toBeGreaterThan(phaseIndex)
      expect(chunks).not.toContainEqual({
        type: "data-activity",
        id: "activity",
        data: { status: "thinking" },
      })
      stream.push({
        type: isAnswer ? "toolcall_delta" : "text_delta",
        contentIndex: 0,
        delta: isAnswer ? '是物理老师。"}' : "是物理老师。",
        partial: final,
      })
      stream.push({ type: "done", reason: isAnswer ? "toolUse" : "stop", message: final })
      await pending
      expect(
        chunks.filter((chunk) => chunk.type === "text-delta" && chunk.id === "text-1"),
      ).toEqual([
        { type: "text-delta", id: "text-1", delta: "林文" },
        { type: "text-delta", id: "text-1", delta: "是物理老师。" },
      ])
      expect(chunks.filter((chunk) => chunk.type === "data-progress")).toEqual([])
    },
  )
  it("repairs a missing delivery tool without imposing a query budget", async () => {
    const { runChat } = await import("../src/chat-run.ts")
    modelStream
      .mockImplementationOnce(() => answer([{ type: "text", text: "可以继续讨论。" }]))
      .mockImplementationOnce((_model, _context, options) => {
        expect(options?.onPayload?.({ thinking: { type: "enabled" } }, _model)).toMatchObject({
          thinking: { type: "disabled" },
          tool_choice: { type: "function", function: { name: finalAnswerToolName } },
        })
        return finalAnswer("可以继续讨论。")
      })
    const result = await runChat(
      readConfig(),
      { prompt: "继续", semesterId: null, history: [] },
      api(),
      () => {},
      new AbortController().signal,
    )
    expect(modelStream).toHaveBeenCalledTimes(2)
    expect(result.transcript.some((message) => message.role === "system")).toBe(false)
  })
  it("revokes a truncated final answer instead of completing it", async () => {
    const { runChat } = await import("../src/chat-run.ts")
    const truncated = await finalAnswer("已核实的结果有").result()
    truncated.stopReason = "length"
    modelStream
      .mockImplementationOnce(() => {
        const stream = createAssistantMessageEventStream()
        stream.push({ type: "done", reason: "length", message: truncated })
        return stream
      })
      .mockImplementationOnce(() => answer([]))
    const chunks: ChatChunk[] = []
    await expect(
      runChat(
        readConfig(),
        { prompt: "帮我查询", semesterId: 1, history: [] },
        api(),
        (chunk) => chunks.push(chunk),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "AI_OUTPUT_INCOMPLETE" })
    expect(chunks.findLast((chunk) => chunk.type === "data-text-phase")?.data.phase).toBe("unknown")
    expect(chunks.filter((chunk) => chunk.type === "text-delta")).toEqual([
      { type: "text-delta", id: "text-1", delta: "已核实的结果有" },
    ])
  })
  it("ends the turn with a structured question without leaving a live model call waiting", async () => {
    const { runChat } = await import("../src/chat-run.ts")
    modelStream.mockImplementation(() =>
      answer(
        [
          {
            type: "toolCall",
            id: "q1",
            name: "ask_user",
            arguments: {
              questions: [
                {
                  id: "teacher",
                  prompt: "请提供教师全名。",
                  multiple: false,
                  choices: [],
                  allow_text: true,
                },
              ],
            },
          },
        ],
        true,
      ),
    )
    const result = await runChat(
      readConfig(),
      { prompt: "李老师周三几节课", semesterId: 1, history: [] },
      api(),
      () => {},
      new AbortController().signal,
    )
    expect(modelStream).toHaveBeenCalledOnce()
    expect(result.parts[0]).toMatchObject({
      type: "data-question",
      data: { status: "pending", items: [{ id: "teacher" }] },
    })
    expect(result.transcript.map((m) => m.role)).toEqual(["user", "assistant", "toolResult"])
  })
})
