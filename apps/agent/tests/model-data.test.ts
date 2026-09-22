import { describe, expect, it, vi } from "vitest"
import type { AgentMessage, AgentTool } from "@earendil-works/pi-agent-core"
import { Type, validateToolArguments, type TSchema } from "@earendil-works/pi-ai"
import { ModelData } from "../src/model-data.ts"

function tool(name: string, parameters: TSchema, value: unknown): AgentTool {
  return {
    name,
    label: name,
    description: name,
    parameters,
    execute: vi.fn<AgentTool["execute"]>(async () => ({
      content: [{ type: "text" as const, text: JSON.stringify(value) }],
      details: {},
    })),
  }
}
function data(result: Awaited<ReturnType<AgentTool["execute"]>>) {
  return JSON.parse(
    result.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join(""),
  )
}
const teacherData = {
  resource: "teacher",
  matches: [
    {
      id: 37,
      name: "林文",
      employee_no: "T037",
      is_active: true,
      courses: [{ id: 3, name: "物理", short_name: "物" }],
    },
  ],
  meta: { catalog_revision: 18, pagination: { total: 1, page: 1, last_page: 1 } },
  etag: "private-version",
  missing_fields: [],
}

describe("model-facing business data", () => {
  it("retains business attributes, removes internal metadata and restores typed references across turns", async () => {
    const boundary = new ModelData([], 4)
    const [find] = boundary.tools([
      tool("find_resources", Type.Object({ resource: Type.String() }), teacherData),
    ])
    const result = await find!.execute("teacher", { resource: "teacher" })
    const fact = data(result)
    expect(fact).toMatchObject({
      data_state: "available",
      coverage: { complete: true },
      matches: [
        { name: "林文", employee_no: "T037", courses: [{ name: "物理", short_name: "物" }] },
      ],
    })
    expect(fact.matches[0].ref).toMatch(/^teacher:/)
    expect(fact.matches[0].courses[0].ref).toMatch(/^course:/)
    expect(JSON.stringify(fact)).not.toMatch(/"id":|revision|etag|private-version/)

    const transcript: AgentMessage[] = [
      {
        ...result,
        role: "toolResult",
        toolCallId: "teacher",
        toolName: "find_resources",
        isError: false,
        timestamp: 1,
      },
    ]
    const restored = new ModelData(transcript, 4)
    const lookup = tool(
      "list_teaching_assignments",
      Type.Object({ semester_id: Type.Integer(), teacher_id: Type.Integer() }),
      { data: [] },
    )
    const [query, findAgain] = restored.tools([
      lookup,
      tool("find_resources", Type.Object({ resource: Type.String() }), teacherData),
    ])
    expect(query!.parameters).toMatchObject({
      required: ["teacher_ref"],
      properties: { teacher_ref: { type: "string" }, semester_ref: { type: "string" } },
    })
    const args = validateToolArguments(query!, {
      type: "toolCall",
      id: "assignments",
      name: query!.name,
      arguments: { teacher_ref: fact.matches[0].ref },
    })
    await query!.execute("assignments", args)
    expect(lookup.execute).toHaveBeenCalledWith(
      "assignments",
      { semester_id: 4, teacher_id: 37 },
      undefined,
    )
    const again = data(await findAgain!.execute("teacher-again", { resource: "teacher" }))
    expect(again.matches[0].ref).toBe(fact.matches[0].ref)
    expect(restored.toMessages(transcript)[0]).not.toHaveProperty("details")
    expect(JSON.stringify(restored.toMessages(transcript))).not.toContain("objectReferences")

    await query!.execute("wrong-kind", { teacher_ref: fact.matches[0].courses[0].ref })
    const expired = data(await query!.execute("unknown", { teacher_ref: "teacher:unknown" }))
    expect(expired).toMatchObject({
      data_state: "unavailable",
      error: { code: "REFERENCE_UNAVAILABLE" },
    })
    expect(lookup.execute).toHaveBeenCalledTimes(1)
  })

  it.each([
    { value: { matches: [], meta: { pagination: { total: 0 } } }, state: "empty", complete: true },
    {
      value: { matches: [{ name: "林文" }], missing_fields: ["matches[0].courses"] },
      state: "partial",
      complete: false,
    },
    { value: { matches: [{ name: "林文", courses: [] }] }, state: "available", complete: true },
    { value: { matches: [{ fixed_room: null }] }, state: "available", complete: true },
    {
      value: {
        data: [{ name: "林文" }],
        meta: { pagination: { total: 42, page: 3, last_page: 3 } },
      },
      state: "partial",
      complete: false,
    },
    {
      value: { data: { changes: [] }, meta: { pagination: { total: 40, page: 5, last_page: 2 } } },
      state: "partial",
      complete: false,
    },
    {
      value: { ok: false, error: { code: "BUSINESS_API_UNAVAILABLE" } },
      state: "unavailable",
      complete: false,
    },
  ])(
    "distinguishes missing, empty, partial and unavailable results: $state",
    async ({ value, state, complete }) => {
      const [query] = new ModelData([], null).tools([tool("query", Type.Object({}), value)])
      expect(data(await query!.execute("query", {}))).toMatchObject({
        data_state: state,
        coverage: { complete },
      })
    },
  )

  it("translates nested rule references without exposing server IDs or changing unrelated question IDs", async () => {
    const boundary = new ModelData([], null)
    const [find, template] = boundary.tools([
      tool("find_resources", Type.Object({ resource: Type.String() }), teacherData),
      tool("get_schedule_template", Type.Object({}), {
        items: [{ id: 7, name: "第一节", start_time: "08:00", end_time: "08:40" }],
      }),
    ])
    const teacherRef = data(await find!.execute("find", { resource: "teacher" })).matches[0].ref
    const itemRef = data(await template!.execute("template", {})).items[0].ref
    const prepare = tool(
      "prepare_rule_drafts",
      Type.Object({
        constraints: Type.Array(
          Type.Object({
            target_type: Type.String(),
            target_id: Type.Integer(),
            scope: Type.Object({ item_ids: Type.Array(Type.Integer()) }),
          }),
        ),
      }),
      { ready: true },
    )
    const [preview] = boundary.tools([prepare])
    await preview!.execute("preview", {
      constraints: [
        { target_type: "teacher", target_ref: teacherRef, scope: { item_refs: [itemRef] } },
      ],
    })
    expect(prepare.execute).toHaveBeenCalledWith(
      "preview",
      { constraints: [{ target_type: "teacher", target_id: 37, scope: { item_ids: [7] } }] },
      undefined,
    )

    const ask = tool(
      "ask_user",
      Type.Object({ questions: Type.Array(Type.Object({ id: Type.String() })) }),
      { waiting_for_user: true },
    )
    const [question] = boundary.tools([ask])
    await question!.execute("question", { questions: [{ id: "teacher" }] })
    expect(ask.execute).toHaveBeenCalledWith(
      "question",
      { questions: [{ id: "teacher" }] },
      undefined,
    )
  })

  it("projects old structured tool evidence without mutating persisted history", () => {
    const original = JSON.stringify({
      evidence: [
        {
          evidence_id: "diagnostics",
          fact: JSON.stringify({
            teacher_id: 37,
            teacher: { id: 37, name: "林文" },
            required_slots: 4,
            assignment_revision: 10,
          }),
        },
      ],
    })
    const history: AgentMessage[] = [
      {
        role: "toolResult",
        toolCallId: "old",
        toolName: "get_schedule_run",
        content: [{ type: "text", text: original }],
        details: { private: true },
        isError: false,
        timestamp: 1,
      },
    ]
    const context = new ModelData(history, null).toMessages(history)
    expect(JSON.stringify(context)).not.toMatch(/assignment_revision|teacher_id|private/)
    expect(JSON.stringify(context)).toContain("林文")
    expect(JSON.stringify(context)).toContain("required_slots")
    expect(JSON.stringify(history)).toContain("assignment_revision")
  })
})
