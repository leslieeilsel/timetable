import { describe, expect, it, vi } from "vitest"
import { BusinessApi } from "../src/business-api.ts"
import { createTools, type ResultCollector } from "../src/tools.ts"

const etag = '"semester-7-timetable-1-catalog-1"'
const draft = {
  name: "李明周二禁排",
  kind: "hard",
  category: "forbidden_slot",
  target_type: "teacher",
  target_id: 1,
  scope: { weekdays: [2] },
  requirement: { available: false },
  weight: null,
}
function fixture(total = 1, explanation = false) {
  const calls: string[] = []
  const transport = vi.fn<typeof fetch>(async (url, request) => {
    const path = new URL(url instanceof Request ? url.url : url).pathname
    calls.push(path)
    if (path.endsWith("session-check"))
      return Response.json({
        data: { id: 1, role: "scheduler", is_active: true, must_change_password: false },
      })
    if (path.endsWith("teachers"))
      return Response.json({
        data: [{ id: 1, name: "李明", employee_no: "T001", courses: [{ id: 2, name: "语文" }] }],
        meta: { pagination: { total } },
      })
    if (path.endsWith("schedule-template"))
      return Response.json({ data: { days: [{ weekday: 2, is_enabled: true }], items: [] } })
    if (path.endsWith("capabilities")) return Response.json({ data: [] })
    if (path.endsWith("preview")) {
      const body = JSON.parse(request?.body as string) as { constraints: unknown[] }
      return Response.json(
        { data: { ...body, summaries: ["李明 · 每周二 · 不安排课程 · 必须满足"], etag } },
        { headers: { ETag: etag } },
      )
    }
    if (path.endsWith("schedule-runs/9"))
      return Response.json({
        data: {
          id: 9,
          status: "failed",
          error_code: "NO_FEASIBLE_SOLUTION",
          error_message: "搜索失败",
          diagnostics: { bottleneck: { available_slots: 2, required_slots: 4 } },
        },
      })
    throw new Error(`Unexpected business endpoint: ${path}`)
  })
  const api = new BusinessApi(
    "http://127.0.0.1:8000",
    { cookie: "session=test", csrf: "test", origin: "http://localhost:5173" },
    new AbortController().signal,
    transport,
  )
  const collector: ResultCollector = { result: null, evidence: new Map(), headline: "" }
  const tools = createTools(
    explanation
      ? { feature: "schedule_run_explanation", semester_id: 7, schedule_run_id: 9 }
      : { feature: "constraint_draft", semester_id: 7, input: "李明周二不排课" },
    api,
    collector,
  )
  async function execute(name: string, args: Record<string, unknown> = {}) {
    return tools.find((tool) => tool.name === name)!.execute("call", args)
  }
  async function prepare() {
    await execute("get_schedule_template")
    await execute("get_constraint_capabilities")
    await execute("find_resources", { resource: "teacher", query: "李明" })
  }
  return { tools, collector, calls, execute, prepare }
}

describe("Business tools", () => {
  it("requires unique resource resolution and validates a draft through Laravel without saving", async () => {
    const context = fixture()
    await expect(
      context.execute("prepare_rule_drafts", { constraints: [draft], unhandled_requirements: [] }),
    ).rejects.toThrow("先读取")
    await context.prepare()
    await context.execute("prepare_rule_drafts", {
      constraints: [draft],
      unhandled_requirements: [],
    })
    expect(context.collector.result).toMatchObject({ type: "proposal", preview: { etag } })
    expect(context.calls).toContain("/api/v1/semesters/7/scheduling-constraints/preview")
    expect(context.calls.some((path) => path.endsWith("bulk"))).toBe(false)
  })

  it("refuses to silently choose one of multiple matching teachers", async () => {
    const context = fixture(2)
    await context.prepare()
    await expect(
      context.execute("prepare_rule_drafts", { constraints: [draft], unhandled_requirements: [] }),
    ).rejects.toThrow("尚未唯一确认")
    expect(context.collector.result).toBeNull()
    expect(context.calls.some((path) => path.endsWith("preview"))).toBe(false)
  })

  it("does not present a partial proposal when some requirements are unsupported", async () => {
    const context = fixture()
    const result = await context.execute("prepare_rule_drafts", {
      constraints: [draft],
      unhandled_requirements: ["下周临时调课"],
    })
    expect(result.content).toEqual([
      {
        type: "text",
        text: JSON.stringify({ prepared: false, unsupported_requirements: ["下周临时调课"] }),
      },
    ])
    expect(context.collector.result).toBeNull()
    expect(context.calls.some((path) => path.endsWith("preview"))).toBe(false)
  })

  it("binds explanations to the requested failed run and rejects fabricated evidence or counts", async () => {
    const context = fixture(1, true)
    await context.execute("get_schedule_run")
    await expect(
      context.execute("present_explanation", {
        findings: [{ evidence_id: "other.run", explanation: "无解" }],
        suggestions: [],
      }),
    ).rejects.toThrow("真实诊断")
    await expect(
      context.execute("present_explanation", {
        findings: [{ evidence_id: "diagnostics", explanation: "还缺 99 节" }],
        suggestions: [],
      }),
    ).rejects.toThrow("没有的数字")
    await context.execute("present_explanation", {
      headline: "该任务可用位置不足，需要核对限制条件。",
      findings: [
        {
          evidence_id: "diagnostics",
          explanation: "该任务需要 4 个位置，目前只有 2 个可用位置。",
        },
      ],
      suggestions: ["检查该任务涉及的禁排规则。"],
    })
    expect(context.collector.result).toMatchObject({
      type: "explanation",
      explanation: { headline: "该任务可用位置不足，需要核对限制条件。" },
    })
    expect(context.calls).toContain("/api/v1/semesters/7/schedule-runs/9")
  })
})
