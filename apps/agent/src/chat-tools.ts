import { randomUUID } from "node:crypto"
import type { AgentTool } from "@earendil-works/pi-agent-core"
import { Type, type Static, type TSchema } from "@earendil-works/pi-ai"
import { questionsSchema, type ChatMessage, type ChatSource } from "@timetable/agent-contracts"
import { z } from "zod"
import type { BusinessApi } from "./business-api.ts"
import { AgentError } from "./errors.ts"
import { createTools, type ResultCollector } from "./tools.ts"
import {
  findCatalogResources,
  missingFields,
  paginationSchema,
  resourceRow,
} from "./resource-lookup.ts"

export interface ChatCollector {
  terminal: boolean
  parts: ChatMessage["parts"]
}
const id = Type.Integer({ minimum: 1 })
const page = Type.Optional(Type.Integer({ minimum: 1, maximum: 10000 }))
const statusFilter = Type.Optional(
  Type.Union([Type.Literal("active"), Type.Literal("inactive"), Type.Literal("all")]),
)
const str = (max = 100) => Type.String({ minLength: 1, maxLength: max })
const enumeration = <T extends string>(values: T[]) =>
  Type.Union(values.map((value) => Type.Literal(value)))
const object = <T extends Record<string, TSchema>>(properties: T) =>
  Type.Object(properties, { additionalProperties: false })
const query = (values: Record<string, string | number | undefined>) =>
  new URLSearchParams(
    Object.entries(values)
      .filter((entry) => entry[1] !== undefined)
      .map(([key, value]) => [key, String(value)]),
  )
const yearRow = z
  .object({
    id: z.number().int().positive(),
    name: z.string(),
    start_date: z.string(),
    end_date: z.string(),
    status: z.string(),
  })
  .passthrough()
const semesterRow = yearRow.extend({
  academic_year_id: z.number().int().positive(),
  sequence: z.number().int(),
  academic_year: yearRow.optional(),
})
const classSettingRow = z
  .object({
    school_class_id: z.number().int().positive(),
    status: z.enum(["active", "inactive"]),
    school_class: resourceRow,
    fixed_room: resourceRow.nullable().optional(),
    homeroom_teacher: resourceRow
      .extend({ employee_no: z.string().nullable().optional() })
      .nullable()
      .optional(),
  })
  .passthrough()
const rowsSchema = z.array(z.record(z.string(), z.unknown()))
const pageMetaSchema = z.object({ pagination: paginationSchema }).passthrough()
const contextSchema = z
  .object({
    timezone: z.string(),
    current_semester: z
      .object({
        id: z.number().int().positive(),
        name: z.string(),
        status: z.string(),
        academic_year: resourceRow,
      })
      .passthrough()
      .nullable(),
  })
  .passthrough()

export function createChatTools(
  api: BusinessApi,
  collector: ChatCollector,
  source: (source: ChatSource) => void,
  selectedSemesterId: number | null = null,
): AgentTool[] {
  // Teacher/course IDs belong to the global catalog. Share only trusted, unique
  // lookups within this turn; semester-specific template/preview guards remain separate.
  const resolved = new Set<string>()
  const rules = new Map<number, { tools: AgentTool[]; collector: ResultCollector }>()
  const explanations = new Map<string, { tools: AgentTool[]; collector: ResultCollector }>()
  const root = (semester: number) => `/api/v1/semesters/${semester}`
  function sourced(label: string, href: string) {
    source({ id: randomUUID(), label, href, retrieved_at: new Date().toISOString() })
  }
  function ruleTools(semester: number) {
    let state = rules.get(semester)
    if (!state) {
      const result: ResultCollector = { result: null, evidence: new Map(), headline: "" }
      state = {
        tools: createTools(
          { feature: "constraint_draft", semester_id: semester, input: "chat" },
          api,
          result,
          resolved,
        ),
        collector: result,
      }
      rules.set(semester, state)
    }
    return state
  }
  function tool<T extends TSchema>(
    name: string,
    label: string,
    parameters: T,
    execute: (args: Static<T>) => Promise<unknown>,
    description = label,
  ): AgentTool<T> {
    return {
      name,
      label,
      description,
      parameters,
      executionMode: "sequential",
      async execute(_callId, args) {
        if (collector.terminal)
          return {
            content: [{ type: "text", text: JSON.stringify({ waiting_for_user: true }) }],
            details: {},
            terminate: true,
          }
        await api.authenticate()
        try {
          const result = await execute(args)
          const content = JSON.stringify(result)
          return {
            content: [
              {
                type: "text",
                text: content,
              },
            ],
            details: {},
            terminate: collector.terminal,
          }
        } catch (error) {
          if (error instanceof AgentError && [401, 403, 419].includes(error.status)) throw error
          // Never let transport/provider exception objects enter the model context.
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  ok: false,
                  error: {
                    code: error instanceof AgentError ? error.code : "TOOL_DATA_INVALID",
                    message:
                      error instanceof AgentError
                        ? error.message
                        : "查询参数或返回数据不完整，无法据此判断业务状态。",
                  },
                }),
              },
            ],
            details: { status: "error" },
          }
        }
      },
    }
  }
  function readList(
    name: string,
    label: string,
    path: string,
    filters: Record<string, TSchema>,
    description: string,
    dataSchema: z.ZodType = rowsSchema,
  ) {
    return tool(
      name,
      label,
      object({ semester_id: id, page, ...filters }),
      async (args) => {
        const { semester_id, ...values } = args as { semester_id: number } & Record<
          string,
          string | number | undefined
        >
        const response = await api.request(
          `${root(semester_id)}/${path}?${query({ ...values, per_page: 20 })}`,
        )
        return {
          scope: path,
          semester_id,
          filters: values,
          data: dataSchema.parse(response.data),
          meta: pageMetaSchema.parse(response.meta),
        }
      },
      description,
    )
  }
  const date = Type.Optional(Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }))
  const operationalStatus = Type.Optional(enumeration(["draft", "active", "cancelled"]))
  const list: AgentTool[] = [
    tool(
      "get_context",
      "读取学期与当前日期",
      object({ semester_id: Type.Optional(id) }),
      async ({ semester_id }) => {
        const context = contextSchema.parse((await api.request("/api/v1/context")).data)
        const semesterId = semester_id ?? selectedSemesterId ?? context.current_semester?.id
        let semester = null
        if (semesterId) {
          try {
            semester = semesterRow.parse((await api.request(root(semesterId))).data)
          } catch (error) {
            if (error instanceof AgentError && error.status === 404)
              throw new AgentError(
                "SEMESTER_NOT_FOUND",
                "所选学期不存在，未能取得该学期资料。",
                404,
              )
            throw error
          }
        }
        sourced("学年与学期", "/years")
        return {
          context,
          selected_semester: semester,
          now: new Intl.DateTimeFormat("sv-SE", {
            timeZone: "Asia/Shanghai",
            dateStyle: "short",
            timeStyle: "medium",
          }).format(new Date()),
          timezone: "Asia/Shanghai",
        }
      },
      "当前日期、Asia/Shanghai 时区、系统当前学期以及对话选定学期的名称、日期、状态与所属学年。未指定范围时采用对话所选学期，其次系统当前学期。",
    ),
    tool(
      "list_academic_years",
      "查询学年",
      object({}),
      async () => {
        const response = await api.request("/api/v1/academic-years")
        sourced("学年", "/years")
        return { academic_years: z.array(yearRow).parse(response.data) }
      },
      "全部学年的名称、起止日期、状态和可用于进一步查询的对象引用。",
    ),
    tool(
      "list_semesters",
      "查询学年的学期",
      object({ academic_year_id: id }),
      async ({ academic_year_id }) => {
        const response = await api.request(`/api/v1/academic-years/${academic_year_id}/semesters`)
        sourced("学期", "/years")
        return { semesters: z.array(semesterRow).parse(response.data) }
      },
      "指定学年下的全部学期，包含名称、顺序、日期和状态。",
    ),
    tool(
      "find_resources",
      "查询基础资料",
      object({
        semester_id: Type.Optional(id),
        resource: enumeration(["teacher", "course", "class", "room", "grade"]),
        query: Type.Optional(str()),
        status: statusFilter,
        course_id: Type.Optional(id),
        grade_id: Type.Optional(id),
        room_type: Type.Optional(
          enumeration([
            "classroom",
            "playground",
            "music_room",
            "art_room",
            "laboratory",
            "computer_room",
            "other",
          ]),
        ),
        page,
      }),
      async ({
        semester_id,
        resource,
        query: term = "",
        page: requestedPage,
        status = "active",
        course_id,
        grade_id,
        room_type,
      }) => {
        if (resource !== "class") {
          const result = await findCatalogResources(api, resource, term, requestedPage, {
            status,
            course_id,
            room_type,
          })
          if (result.unique) resolved.add(`${result.resource}:${result.matches[0]!.id}`)
          const collection = {
            teacher: "teachers",
            room: "rooms",
            course: "courses",
            grade: "grades",
          }[result.resource]
          sourced(
            { teacher: "教师资料", course: "课程资料", room: "教室资料", grade: "年级资料" }[
              result.resource
            ],
            `/resources/${collection}`,
          )
          return result
        }
        const semesterId =
          semester_id ??
          selectedSemesterId ??
          contextSchema.parse((await api.request("/api/v1/context")).data).current_semester?.id
        if (!semesterId)
          throw new AgentError(
            "SEMESTER_REQUIRED",
            "班级属于学年，请先查询学年和学期并确认范围。",
            422,
          )
        const semester = await api.request(root(semesterId))
        const { academic_year_id } = z.object({ academic_year_id: z.number() }).parse(semester.data)
        const result = await api.request(
          `/api/v1/academic-years/${academic_year_id}/classes?${query({ search: term || undefined, status: status === "all" ? undefined : status, grade_id, per_page: 20, page: requestedPage ?? 1 })}`,
        )
        const matches = z.array(resourceRow).parse(result.data)
        const { pagination } = z.object({ pagination: paginationSchema }).parse(result.meta)
        sourced("班级资料", "/years")
        return {
          resource,
          academic_year_id,
          scope: "academic_year_classes",
          filters: { search: term, status, grade_id },
          matches,
          missing_fields: missingFields(matches, ["grade", "status"]),
          meta: { pagination },
          total: pagination.total,
          unique: pagination.total === 1 && matches.length === 1,
        }
      },
      "教师、课程、教室、年级的全校基础资料，以及所选学期所属学年的班级。教师包含登记的任教课程，课程包含简称，教室包含用途类型，班级包含年级和状态。query 是名称或业务编号的文本检索，省略可分页列出资料。status 默认 active，all 包含停用资料；可按课程筛选教师、按用途筛选教室、按年级筛选班级。",
    ),
    tool(
      "list_class_settings",
      "查询班级教室与班主任",
      object({
        semester_id: Type.Optional(id),
        query: Type.Optional(str()),
        grade_id: Type.Optional(id),
        status: statusFilter,
        page,
      }),
      async ({ semester_id, query: term, page: requestedPage, grade_id, status = "active" }) => {
        const semesterId =
          semester_id ??
          selectedSemesterId ??
          contextSchema.parse((await api.request("/api/v1/context")).data).current_semester?.id
        if (!semesterId)
          throw new AgentError("SEMESTER_REQUIRED", "请先确认要查询哪个学期的班级配置。", 422)
        const response = await api.request(
          `${root(semesterId)}/class-settings?${query({ search: term, grade_id, status: status === "all" ? undefined : status, per_page: 20, page: requestedPage ?? 1 })}`,
        )
        const matches = z.array(classSettingRow).parse(response.data)
        const { pagination } = z.object({ pagination: paginationSchema }).parse(response.meta)
        sourced("班级教室与班主任", `/semesters/${semesterId}/setup`)
        return {
          scope: "semester_class_settings",
          semester_id: semesterId,
          filters: { search: term, grade_id, status },
          matches,
          missing_fields: missingFields(matches, [
            "school_class.grade",
            "fixed_room",
            "fixed_room.type",
            "homeroom_teacher",
          ]),
          total: pagination.total,
          unique: pagination.total === 1 && matches.length === 1,
          meta: { pagination },
          field_meanings:
            "school_class 是班级；fixed_room 是本学期登记的固定教室，homeroom_teacher 是班主任。对应字段为 null 仅表示该项未配置；空列表仅表示该学期及筛选条件下没有匹配的配置。固定教室不是某日某节课的实际教室。",
        }
      },
      "学期班级配置：班级及年级、固定教室的名称与类型、班主任、启用状态。query 按登记的班级名称做文本搜索，可按年级筛选或省略 query 分页列出；status 默认 active，all 包含停用配置。固定教室与班主任属于学期配置，独立于是否已排课。",
    ),
    tool(
      "query_timetable",
      "查询课表",
      object({
        semester_id: id,
        mode: enumeration(["daily", "weekly"]),
        resource: enumeration(["teacher", "class", "room"]),
        resource_id: id,
        date: Type.Optional(Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" })),
      }),
      async ({ semester_id, mode, resource, resource_id, date }) => {
        if (mode === "daily" && !date)
          throw new AgentError("DATE_REQUIRED", "请提供确切日期。", 422)
        const result = await api.request(
          mode === "daily"
            ? `${root(semester_id)}/daily-timetable?${query({ date })}`
            : `${root(semester_id)}/timetable?${query({ view: resource, resource_id, mode: "official" })}`,
        )
        sourced(
          mode === "daily" ? `${date} 实际课表` : "普通周课表",
          `/semesters/${semester_id}/${mode === "daily" ? "adjustments" : "timetable"}`,
        )
        if (mode === "weekly")
          return {
            ...z.object({ entries: rowsSchema }).passthrough().parse(result.data),
            meta: result.meta,
            etag: result.etag,
            kind: "weekly",
            warning: "普通周课表不反映某日的调课、请假与代课。",
          }
        const data = z
          .object({
            rows: z.array(
              z
                .object({
                  class_ids: z.array(z.number()),
                  teacher_ids: z.array(z.number()),
                  room_id: z.number().nullable(),
                  is_cancelled: z.boolean(),
                })
                .passthrough(),
            ),
          })
          .passthrough()
          .parse(result.data)
        const rows = data.rows.filter((row) =>
          resource === "room"
            ? row.room_id === resource_id
            : (resource === "teacher" ? row.teacher_ids : row.class_ids).includes(resource_id),
        )
        const { summary: _wholeSchoolSummary, ...rest } = data
        return {
          ...rest,
          rows,
          summary: {
            matching_rows: rows.length,
            active_rows: rows.filter((row) => !row.is_cancelled).length,
          },
          meta: result.meta,
          etag: result.etag,
          kind: "daily",
          resource,
          resource_id,
          field_meanings: { is_cancelled: "取消课节不占用实际课时。" },
        }
      },
      "教师、班级或教室的课表。weekly 为正式普通周计划；daily 为指定日期的实际安排，包含调课、请假和代课，需提供 date。普通周计划不表示某日实际安排。",
    ),
    tool(
      "list_teaching_assignments",
      "查询学期任课安排",
      object({
        semester_id: id,
        school_class_id: Type.Optional(id),
        teacher_id: Type.Optional(id),
        course_id: Type.Optional(id),
        teaching_group_id: Type.Optional(id),
        grade_id: Type.Optional(id),
        room_id: Type.Optional(id),
        search: Type.Optional(str()),
        status: Type.Optional(enumeration(["draft", "confirmed", "inactive"])),
        page,
      }),
      async ({ semester_id, ...filters }) => {
        const response = await api.request(
          `${root(semester_id)}/teaching-assignments?${query({ ...filters, per_page: 20 })}`,
        )
        sourced("课程与任课安排", `/semesters/${semester_id}/assignments`)
        return {
          scope: "semester_assignments",
          data: rowsSchema.parse(response.data),
          meta: pageMetaSchema.parse(response.meta),
          filters,
          field_meanings:
            "指定学期的班级或教学组、课程、教师、协作教师、课时和教室要求。与教师基础资料登记的任教课程是不同关系。",
        }
      },
      "学期任课安排，包含班级或教学组、课程、教师及协作教师、每周课时、教室要求、已排与剩余课时。支持姓名文本和班级、教师、课程、年级、教室、教学组、状态筛选，默认包含各状态，按页返回。",
    ),
    tool(
      "list_constraints",
      "查询排课规则",
      object({ semester_id: id, page }),
      async ({ semester_id, page }) => {
        const response = await api.request(
          `${root(semester_id)}/scheduling-constraints?${query({ page, per_page: 20 })}`,
        )
        sourced("规则与约束", `/semesters/${semester_id}/constraints`)
        return {
          data: rowsSchema.parse(response.data),
          meta: pageMetaSchema.parse(response.meta),
          etag: response.etag,
        }
      },
    ),
    readList(
      "list_teaching_groups",
      "查询教学组",
      "teaching-groups",
      { search: Type.Optional(str()), status: Type.Optional(enumeration(["active", "inactive"])) },
      "教学组的名称、合班或分组方式、组成班级与年级、任课数量及状态。按名称或班级名称检索，默认包含各状态，分页返回。",
    ),
    readList(
      "list_fixed_placements",
      "查询固定排课",
      "fixed-placements",
      {
        teaching_assignment_id: Type.Optional(id),
        weekday: Type.Optional(Type.Integer({ minimum: 1, maximum: 7 })),
        status: Type.Optional(enumeration(["active", "inactive"])),
      },
      "已设置的固定排课要求，包含任课对象、星期、课节、教室、周次和锁定状态；这表示排课要求，不等于某日实际课表。",
    ),
    readList(
      "list_teacher_leaves",
      "查询教师请假",
      "teacher-leaves",
      { teacher_id: Type.Optional(id), status: operationalStatus, date_from: date, date_to: date },
      "学期内教师请假记录，包含教师、起止时间、原因、状态和代课数量，可按教师、日期范围及状态筛选。默认包含取消记录。",
    ),
    tool(
      "get_teacher_leave",
      "查询请假与代课明细",
      object({ semester_id: id, leave_id: id }),
      async ({ semester_id, leave_id }) => {
        const response = await api.request(`${root(semester_id)}/teacher-leaves/${leave_id}`)
        return { scope: "teacher_leave_detail", data: response.data, meta: response.meta }
      },
      "一条请假记录及其代课安排、受影响课节和教师信息。",
    ),
    readList(
      "list_calendar_exceptions",
      "查询日常调整",
      "calendar-exceptions",
      {
        q: Type.Optional(str()),
        status: operationalStatus,
        date_from: date,
        date_to: date,
        type: Type.Optional(
          enumeration([
            "move",
            "swap",
            "teacher_change",
            "room_change",
            "cancel",
            "activity",
          ]),
        ),
      },
      "指定日期范围的临时调课、互换、换教师、换教室、停课和活动记录，包含原安排、调整后的安排、原因及状态。q 检索相关班级、教师、课程或说明，默认包含取消记录。",
    ),
    readList(
      "list_long_term_changes",
      "查询长期调整记录",
      "long-term-changes",
      {
        q: Type.Optional(str()),
        status: Type.Optional(enumeration(["all", "upcoming", "active", "ended", "restored"])),
        date_from: date,
        date_to: date,
      },
      "长期调整记录及生效范围，包含调整内容、原因、恢复状态和通知回执，可检索业务名称及说明。",
    ),
    tool(
      "list_effective_timetables",
      "查询课表生效区间",
      object({ semester_id: id }),
      async ({ semester_id }) => {
        const response = await api.request(`${root(semester_id)}/long-term-adjustments`)
        return { scope: "effective_timetable_periods", data: response.data, meta: response.meta }
      },
      "学期内有效的课表生效区间及对应版本，用于了解不同日期采用哪份课表。",
    ),
    readList(
      "list_timetable_versions",
      "查询课表版本",
      "timetable-versions",
      { status: Type.Optional(enumeration(["draft", "active", "historical"])) },
      "课表版本名称、业务版本序号、状态、来源、创建与启用时间及课节数量，按最新版本优先分页返回。",
    ),
    readList(
      "compare_timetable_versions",
      "比较课表版本",
      "timetable-versions/compare",
      {
        left_version_id: id,
        right_version_id: id,
        change_type: Type.Optional(
          enumeration([
            "added",
            "removed",
            "moved",
            "teacher_changed",
            "room_changed",
            "week_pattern_changed",
            "lock_changed",
          ]),
        ),
      },
      "比较两份已查询的课表版本，返回差异汇总与分页明细，包括增删课节、时间、教师、教室、周次和锁定变化。",
      z.object({ changes: rowsSchema }).passthrough(),
    ),
    tool(
      "get_school_settings",
      "读取学校信息",
      object({}),
      async () => {
        const response = await api.request("/api/v1/school-settings")
        return { scope: "school_settings", data: response.data }
      },
      "系统登记的学校信息与业务设置。",
    ),
    tool(
      "get_semester_summary",
      "读取学期概况",
      object({ semester_id: id }),
      async ({ semester_id }) => {
        const response = await api.request(`${root(semester_id)}/dashboard-summary`)
        return { scope: "semester_summary", data: response.data, meta: response.meta }
      },
      "学期准备进度、业务数量及排课概况，统计范围为指定学期。",
    ),
    tool(
      "get_preparation_check",
      "读取排课准备检查",
      object({ semester_id: id }),
      async ({ semester_id }) => {
        const response = await api.request(`${root(semester_id)}/preparation-check`)
        sourced("排课准备检查", `/semesters/${semester_id}/preparation`)
        return { data: response.data, meta: response.meta }
      },
    ),
    tool(
      "list_schedule_runs",
      "查询排课任务",
      object({
        semester_id: id,
        status: Type.Optional(
          enumeration([
            "queued",
            "checking",
            "solving",
            "optimizing",
            "building_candidates",
            "completed",
            "failed",
            "cancelled",
          ]),
        ),
        page,
      }),
      async ({ semester_id, ...filters }) => {
        const response = await api.request(
          `${root(semester_id)}/schedule-runs?${query({ ...filters, per_page: 20 })}`,
        )
        sourced("排课任务", `/semesters/${semester_id}/generate`)
        const rows = rowsSchema
          .parse(response.data)
          .map(({ diagnostics, constraint_snapshot, ...summary }) => ({
            ...summary,
            detail_sections: {
              diagnostics: diagnostics != null,
              constraint_snapshot: constraint_snapshot != null,
            },
          }))
        const deferred = rows.some(
          (row) => row.detail_sections.diagnostics || row.detail_sections.constraint_snapshot,
        )
        return {
          data: rows,
          meta: pageMetaSchema.parse(response.meta),
          coverage: {
            complete: !deferred,
            deferred_fields: deferred ? ["diagnostics", "constraint_snapshot"] : [],
            detail_tool: "get_schedule_run",
          },
        }
      },
      "排课任务概况，按最新优先分页返回，包含运行状态、范围、时间和结果概况；可按状态筛选。detail_sections 标明是否有诊断和历史规则快照，这些大块详情由 get_schedule_run 分页读取。",
    ),
    tool(
      "get_schedule_run",
      "读取排课任务详情",
      object({ semester_id: id, schedule_run_id: id, page }),
      async ({ semester_id, schedule_run_id, page }) => {
        const key = `${semester_id}:${schedule_run_id}`
        let state = explanations.get(key)
        if (!state) {
          const result: ResultCollector = { result: null, evidence: new Map(), headline: "" }
          state = {
            tools: createTools(
              { feature: "schedule_run_explanation", semester_id, schedule_run_id },
              api,
              result,
              resolved,
              { allowNonFailedRun: true },
            ),
            collector: result,
          }
          explanations.set(key, state)
        }
        const response = await state.tools
          .find((tool) => tool.name === "get_schedule_run")!
          .execute(randomUUID(), { page })
        sourced("排课诊断", `/semesters/${semester_id}/generate`)
        return JSON.parse(
          response.content
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join(""),
        ) as unknown
      },
      "指定排课任务的状态、运行信息、数据是否已过时，以及分页的诊断和历史规则快照。大块数据会分段并标明覆盖范围；已读取证据可用于说明卡片。",
    ),
    tool(
      "ask_user",
      "请补充信息",
      object({
        questions: Type.Array(
          object({
            id: str(40),
            prompt: str(500),
            multiple: Type.Boolean(),
            choices: Type.Array(object({ value: str(100), label: str(200) }), { maxItems: 12 }),
            allow_text: Type.Boolean(),
          }),
          { minItems: 1, maxItems: 3 },
        ),
      }),
      async ({ questions }) => {
        const items = questionsSchema.parse(questions)
        collector.parts.push({
          type: "data-question",
          id: randomUUID(),
          data: { id: randomUUID(), items, status: "pending" },
        })
        collector.terminal = true
        return { waiting_for_user: true }
      },
      "向用户提出 1–3 个结构化问题，支持选项和自由填写；结束本轮等待答案。问题与选项由你根据实际缺口生成。",
    ),
  ]
  // Reuse Laravel-validated rule schemas and evidence checks from the existing workflows.
  for (const name of [
    "get_schedule_template",
    "get_constraint_capabilities",
    "prepare_rule_drafts",
    "present_explanation",
  ]) {
    const isExplanation = name === "present_explanation"
    const template = isExplanation
      ? createTools(
          { feature: "schedule_run_explanation", semester_id: 1, schedule_run_id: 1 },
          api,
          { result: null, evidence: new Map(), headline: "" },
        ).find((tool) => tool.name === name)!
      : ruleTools(1).tools.find((tool) => tool.name === name)!
    const parameters = object({
      ...(template.parameters as unknown as { properties: Record<string, TSchema> }).properties,
      semester_id: id,
      ...(isExplanation ? { schedule_run_id: id } : {}),
    })
    list.push(
      tool(
        name,
        template.label,
        parameters,
        async (args) => {
          const { semester_id, schedule_run_id, ...payload } = args as Record<string, unknown> & {
            semester_id: number
            schedule_run_id?: number
          }
          const state = isExplanation
            ? explanations.get(`${semester_id}:${schedule_run_id}`)
            : ruleTools(semester_id)
          if (!state) throw new AgentError("EVIDENCE_REQUIRED", "请先读取这次任务的诊断。", 422)
          const result = await state.tools
            .find((tool) => tool.name === name)!
            .execute(randomUUID(), payload)
          const final = state.collector.result
          if (final?.type === "proposal")
            collector.parts.push({
              type: "data-proposal",
              id: randomUUID(),
              data: { id: randomUUID(), semester_id, preview: final.preview, status: "pending" },
            })
          else if (final?.type === "explanation")
            collector.parts.push({
              type: "data-explanation",
              id: randomUUID(),
              data: final.explanation,
            })
          else if (final?.type === "clarification")
            collector.parts.push({
              type: "data-question",
              id: randomUUID(),
              data: {
                id: randomUUID(),
                status: "pending",
                items: [
                  {
                    id: "details",
                    prompt: final.question,
                    multiple: false,
                    choices: [],
                    allow_text: true,
                  },
                ],
              },
            })
          if (final) collector.terminal = true
          sourced(
            template.label,
            `/semesters/${semester_id}/${isExplanation ? "generate" : "constraints"}`,
          )
          return JSON.parse(
            result.content
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join(""),
          ) as unknown
        },
        template.description,
      ),
    )
  }
  return list
}
