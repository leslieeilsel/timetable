import { describe, expect, it, vi } from "vitest"
import { BusinessApi } from "../src/business-api.ts"
import { createChatTools } from "../src/chat-tools.ts"
import type { ChatSource } from "@timetable/agent-contracts"

function setup(
  data: unknown,
  options: {
    semesterId?: number
    respond?: (url: URL, request?: RequestInit) => Response
  } = {},
) {
  const paths: string[] = []
  const transport = vi.fn<typeof fetch>(async (url, request) => {
    const parsed = new URL(url instanceof Request ? url.url : url.toString())
    const path = parsed.pathname
    paths.push(path)
    if (!path.endsWith("session-check") && options.respond) return options.respond(parsed, request)
    return Response.json({
      data: path.endsWith("session-check")
        ? { id: 1, role: "scheduler", is_active: true, must_change_password: false }
        : data,
      meta: { pagination: { total: 42, page: 2, last_page: 3 } },
    })
  })
  const api = new BusinessApi(
    "http://localhost:8000",
    { cookie: "private-session", csrf: "private-csrf", origin: "http://localhost:5173" },
    new AbortController().signal,
    transport,
  )
  const sources: ChatSource[] = []
  const collector = { terminal: false, parts: [] }
  const tools = createChatTools(
    api,
    collector,
    (source) => sources.push(source),
    options.semesterId,
  )
  const execute = async (name: string, args: Record<string, unknown>) => {
    const result = await tools.find((tool) => tool.name === name)!.execute("call", args)
    return JSON.parse(
      result.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join(""),
    ) as Record<string, unknown>
  }
  return { paths, transport, sources, execute, tools, collector }
}

describe("conversational read tools", () => {
  it.each([1, 2])(
    "preserves teacher courses and nullable employee numbers on page %i without needing a semester",
    async (page) => {
      const courses = [
        { id: 5, name: "语文" },
        { id: 6, name: "历史" },
      ]
      const app = setup([{ id: 37, name: "林文", employee_no: null, courses }])
      const result = await app.execute("find_resources", {
        resource: "teacher",
        query: "林文",
        page,
      })
      expect(result).toMatchObject({
        scope: "catalog",
        matches: [{ id: 37, employee_no: null, courses }],
        total: 42,
        unique: false,
        meta: { pagination: { last_page: 3 } },
      })
      expect(app.paths.filter((path) => !path.endsWith("session-check"))).toEqual([
        "/api/v1/teachers",
      ])
      expect((app.transport.mock.calls[1]![0] as URL).searchParams.get("page")).toBe(String(page))
    },
  )

  it("distinguishes unregistered courses from an API response missing the courses relation", async () => {
    const empty = setup([{ id: 1, name: "林文", courses: [] }])
    expect(
      await empty.execute("find_resources", { resource: "teacher", query: "林文" }),
    ).toMatchObject({ matches: [{ courses: [] }] })
    const missing = setup([{ id: 1, name: "林文" }])
    const result = await missing.execute("find_resources", { resource: "teacher", query: "林文" })
    expect(result).toMatchObject({ matches: [{ name: "林文" }] })
    expect(result.missing_fields).toContain("matches[0].courses")
    expect((result.matches as Record<string, unknown>[])[0]).not.toHaveProperty("courses")
  })

  const year = {
    id: 2,
    name: "2026–2027",
    start_date: "2026-09-01",
    end_date: "2027-08-31",
    status: "active",
  }
  const semester = {
    id: 4,
    academic_year_id: 2,
    name: "上学期",
    sequence: 1,
    start_date: "2026-09-01",
    end_date: "2027-01-31",
    status: "active",
    academic_year: year,
  }
  const context = {
    timezone: "Asia/Shanghai",
    current_semester: {
      id: 8,
      name: "下学期",
      status: "active",
      academic_year: { id: 5, name: "2027–2028" },
    },
  }

  it.each([
    { selected: 4, requested: undefined, expected: 4 },
    { selected: 4, requested: 9, expected: 9 },
    { selected: undefined, requested: undefined, expected: 8 },
  ])(
    "resolves a semester from explicit, selected, or current context: $expected",
    async ({ selected, requested, expected }) => {
      const app = setup(null, {
        semesterId: selected,
        respond: (url) => {
          if (url.pathname === "/api/v1/context") return Response.json({ data: context })
          if (url.pathname === `/api/v1/semesters/${expected}`)
            return Response.json({ data: { ...semester, id: expected } })
          throw new Error("Unexpected path")
        },
      })
      expect(
        await app.execute("get_context", requested ? { semester_id: requested } : {}),
      ).toMatchObject({ selected_semester: { id: expected, academic_year_id: 2 } })
      expect(app.paths.filter((path) => path.includes("academic-years"))).toEqual([])
    },
  )

  it("reports no selected semester without inventing one when the system also has none", async () => {
    const app = setup({ timezone: "Asia/Shanghai", current_semester: null })
    expect(await app.execute("get_context", {})).toMatchObject({ selected_semester: null })
    expect(app.paths).toEqual(["/api/v1/auth/session-check", "/api/v1/context"])
  })

  it("sanitizes a missing semester and allows recovery by listing actual years and semesters", async () => {
    const app = setup(null, {
      semesterId: 99,
      respond: (url) => {
        if (url.pathname === "/api/v1/context") return Response.json({ data: context })
        if (url.pathname === "/api/v1/academic-years") return Response.json({ data: [year] })
        if (url.pathname === "/api/v1/academic-years/2/semesters")
          return Response.json({ data: [semester] })
        return Response.json(
          { message: "No query results for model [App\\Models\\Semester] 99" },
          { status: 404 },
        )
      },
    })
    const result = await app.tools
      .find((tool) => tool.name === "get_context")!
      .execute("context", {})
    expect(result.details).toEqual({ status: "error" })
    expect(JSON.stringify(result)).toContain("SEMESTER_NOT_FOUND")
    expect(JSON.stringify(result)).not.toMatch(/App|No query results/)
    expect(await app.execute("list_academic_years", {})).toEqual({ academic_years: [year] })
    expect(await app.execute("list_semesters", { academic_year_id: 2 })).toEqual({
      semesters: [semester],
    })
  })

  it("uses the semester's actual academic year to look up classes", async () => {
    const app = setup(null, {
      semesterId: 4,
      respond: (url) => {
        if (url.pathname === "/api/v1/semesters/4") return Response.json({ data: semester })
        if (url.pathname === "/api/v1/academic-years/2/classes")
          return Response.json({
            data: [{ id: 11, name: "七一班" }],
            meta: { pagination: { total: 1 } },
          })
        throw new Error("Unexpected path")
      },
    })
    expect(
      await app.execute("find_resources", { resource: "class", query: "七一班" }),
    ).toMatchObject({ academic_year_id: 2, unique: true, matches: [{ id: 11 }] })
    expect(app.paths).toContain("/api/v1/academic-years/2/classes")
  })

  it("shares unique catalog resolution with rule drafts without bypassing per-semester checks or ambiguity", async () => {
    const etag = '"semester-4-timetable-1-catalog-1"'
    const draft = {
      name: "林文每天最多四节",
      kind: "hard",
      category: "daily_load",
      target_type: "teacher",
      target_id: 37,
      scope: {},
      requirement: { max_items_per_day: 4 },
      weight: null,
    }
    const app = setup(null, {
      semesterId: 4,
      respond: (url, request) => {
        if (url.pathname.endsWith("teachers"))
          return Response.json({
            data: [{ id: 37, name: "林文", courses: [] }],
            meta: { pagination: { total: url.searchParams.get("search") === "T037" ? 1 : 2 } },
          })
        if (url.pathname.endsWith("schedule-template"))
          return Response.json({ data: { days: [], items: [] } })
        if (url.pathname.endsWith("capabilities")) return Response.json({ data: [] })
        if (url.pathname.endsWith("preview"))
          return Response.json(
            {
              data: {
                ...JSON.parse(request?.body as string),
                summaries: ["林文 · 每天最多四节"],
                etag,
              },
            },
            { headers: { ETag: etag } },
          )
        throw new Error("Unexpected path")
      },
    })
    const args = { semester_id: 4, constraints: [draft], unhandled_requirements: [] }
    expect(await app.execute("prepare_rule_drafts", args)).toMatchObject({
      ok: false,
      error: { code: "RULE_CONTEXT_REQUIRED" },
    })
    await app.execute("get_schedule_template", { semester_id: 4 })
    await app.execute("get_constraint_capabilities", { semester_id: 4 })
    await app.execute("find_resources", { resource: "teacher", query: "林文" })
    expect(await app.execute("prepare_rule_drafts", args)).toMatchObject({
      ok: false,
      error: { code: "RESOURCE_NOT_RESOLVED" },
    })
    await app.execute("find_resources", { resource: "teacher", query: "T037" })
    expect(await app.execute("prepare_rule_drafts", { ...args, semester_id: 8 })).toMatchObject({
      ok: false,
      error: { code: "RULE_CONTEXT_REQUIRED" },
    })
    expect(app.paths.some((path) => path.endsWith("preview"))).toBe(false)
    await app.execute("prepare_rule_drafts", args)
    expect(app.collector).toMatchObject({
      terminal: true,
      parts: [{ type: "data-proposal", data: { semester_id: 4, status: "pending" } }],
    })
    expect(app.paths.filter((path) => path.endsWith("preview"))).toEqual([
      "/api/v1/semesters/4/scheduling-constraints/preview",
    ])
    expect(app.paths.some((path) => path.endsWith("bulk"))).toBe(false)
  })
  it("uses actual daily rows, filters by all participating teachers and does not reuse the whole-school totals", async () => {
    const fixture = {
      date: "2026-09-23",
      weekday: 3,
      summary: { total: 99 },
      version: { id: 4 },
      rows: [
        {
          item_id: 1,
          teacher_ids: [1, 7],
          class_ids: [3],
          room_id: 2,
          is_cancelled: false,
          status: "substitution",
        },
        { item_id: 2, teacher_ids: [1], class_ids: [3], room_id: 2, is_cancelled: true },
        { item_id: 3, teacher_ids: [8], class_ids: [4], room_id: 2, is_cancelled: false },
      ],
    }
    const app = setup(fixture)
    const result = await app.execute("query_timetable", {
      semester_id: 1,
      mode: "daily",
      resource: "teacher",
      resource_id: 1,
      date: "2026-09-23",
    })
    expect(app.paths).toContain("/api/v1/semesters/1/daily-timetable")
    expect(app.paths).not.toContain("/api/v1/semesters/1/timetable")
    expect(result).toMatchObject({
      rows: fixture.rows.slice(0, 2),
      summary: { matching_rows: 2, active_rows: 1 },
      kind: "daily",
      date: "2026-09-23",
    })
    expect(result.summary).not.toHaveProperty("total")
    expect(app.sources[0]).toMatchObject({
      label: "2026-09-23 实际课表",
      href: "/semesters/1/adjustments",
    })
  })
  it("preserves pagination and maps class/course filters to the documented API fields", async () => {
    const app = setup([{ id: 9, course_id: 3 }])
    const result = await app.execute("list_teaching_assignments", {
      semester_id: 1,
      school_class_id: 2,
      course_id: 3,
      page: 2,
    })
    const url = app.transport.mock.calls[1]![0] as URL
    expect(url.searchParams.get("school_class_id")).toBe("2")
    expect(url.searchParams.get("course_id")).toBe("3")
    expect(url.searchParams.get("page")).toBe("2")
    expect(result.meta).toMatchObject({ pagination: { total: 42, last_page: 3 } })
  })
  it("defers large run details explicitly and makes every evidence page and freshness flag readable", async () => {
    const run = {
      id: 9,
      status: "completed",
      error_code: null,
      error_message: null,
      completed_at: "2026-09-21T09:00:00+08:00",
      diagnostics: Object.fromEntries(
        Array.from({ length: 12 }, (_, index) => [
          `issue_${index}`,
          { description: "原始事实".repeat(100) },
        ]),
      ),
      constraint_snapshot: {
        constraints: [{ name: "历史规则", target_type: "teacher", target_id: 37 }],
      },
    }
    const app = setup(null, {
      respond: (url) =>
        Response.json({
          data: url.pathname.endsWith("schedule-runs") ? [run] : run,
          meta: { is_stale: true, pagination: { total: 1, page: 1, last_page: 1 } },
        }),
    })
    const list = await app.execute("list_schedule_runs", { semester_id: 4 })
    const summary = (list.data as Record<string, unknown>[])[0]!
    expect(summary).toMatchObject({
      status: "completed",
      detail_sections: { diagnostics: true, constraint_snapshot: true },
    })
    expect(summary).not.toHaveProperty("diagnostics")
    expect(summary).not.toHaveProperty("constraint_snapshot")
    expect(list.coverage).toMatchObject({ complete: false, detail_tool: "get_schedule_run" })
    const evidence: { evidence_id: string; fact: string }[] = []
    let pageCount = 1
    let total = 0
    for (let page = 1; page <= pageCount; page++) {
      const detail = await app.execute("get_schedule_run", {
        semester_id: 4,
        schedule_run_id: 9,
        page,
      })
      expect(detail).toMatchObject({
        schedule_run: { status: "completed", completed_at: run.completed_at },
        meta: { is_stale: true },
      })
      const meta = detail.meta as { pagination: { last_page: number; total: number } }
      pageCount = meta.pagination.last_page
      total = meta.pagination.total
      evidence.push(
        ...(detail.evidence as typeof evidence).filter((item) => item.evidence_id !== "run.error"),
      )
    }
    expect(pageCount).toBeGreaterThan(1)
    expect(evidence).toHaveLength(total)
    expect(JSON.stringify(evidence)).toContain("issue_11")
    expect(JSON.stringify(evidence)).toContain("历史规则")
  })
})
