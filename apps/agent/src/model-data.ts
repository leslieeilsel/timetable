import { randomUUID } from "node:crypto"
import type { AgentMessage, AgentTool } from "@earendil-works/pi-agent-core"
import { Type, type Message, type TSchema } from "@earendil-works/pi-ai"
import { AgentError } from "./errors.ts"

type RecordValue = Record<string, unknown>
const record = (value: unknown): value is RecordValue =>
  value !== null && typeof value === "object" && !Array.isArray(value)

// Only objects that another tool can address receive a reference. Other database
// identifiers stay on the server; business attributes are retained recursively.
const entities: Record<string, string> = {
  teacher: "teacher",
  teachers: "teacher",
  collaborators: "teacher",
  homeroom_teacher: "teacher",
  replacement_teacher: "teacher",
  replaced_teacher: "teacher",
  course: "course",
  courses: "course",
  class: "class",
  classes: "class",
  school_class: "class",
  school_classes: "class",
  grade: "grade",
  grades: "grade",
  room: "room",
  rooms: "room",
  fixed_room: "room",
  specified_room: "room",
  actual_room: "room",
  replacement_room: "room",
  academic_year: "academic_year",
  academic_years: "academic_year",
  semester: "semester",
  semesters: "semester",
  current_semester: "semester",
  selected_semester: "semester",
  item: "item",
  items: "item",
  replacement_item: "item",
  teaching_group: "teaching_group",
  teaching_groups: "teaching_group",
  teaching_assignment: "teaching_assignment",
  teaching_assignments: "teaching_assignment",
  assignment: "teaching_assignment",
  assignments: "teaching_assignment",
  related_assignment: "teaching_assignment",
  with_assignment: "teaching_assignment",
  replacement_assignment: "teaching_assignment",
  schedule_run: "schedule_run",
  schedule_runs: "schedule_run",
  version: "version",
  timetable_version: "version",
  timetable_versions: "version",
  left_version: "version",
  right_version: "version",
  base_version: "version",
  source_version: "version",
  previous_version: "version",
  leave: "leave",
  teacher_leave: "leave",
  teacher_leaves: "leave",
}
const resultEntities: Record<string, string> = {
  list_academic_years: "academic_year",
  list_semesters: "semester",
  list_teaching_assignments: "teaching_assignment",
  list_teaching_groups: "teaching_group",
  list_schedule_runs: "schedule_run",
  list_timetable_versions: "version",
  list_teacher_leaves: "leave",
}
const internalFields = new Set([
  "etag",
  "pivot",
  "created_by",
  "updated_by",
  "deleted_at",
  "request_id",
  "idempotency_key",
  "input_hash",
  "input_snapshot",
  "diagnostics_hash",
  "fingerprint",
  "instruction",
  "recovery",
  "search_text",
])

function entityForId(key: string, owner: RecordValue, entity?: string): string | undefined {
  if (key === "id") return entity
  if (key === "ids") return entities[String(owner.type)]
  if (key === "resource_id") return entities[String(owner.resource ?? owner.view)]
  if (key === "target_id") return entities[String(owner.target_type)]
  return entities[key.replace(/_ids?$/, "")]
}

/** Model-facing data boundary. Reference mappings live in server-only transcript
 * details, and are explicitly removed by toMessages before any provider request. */
export class ModelData {
  private byRef = new Map<string, { entity: string; id: number }>()
  private byObject = new Map<string, string>()
  private touched = new Set<string>()
  private selectedSemesterId: number | null

  constructor(history: AgentMessage[], selectedSemesterId: number | null) {
    this.selectedSemesterId = selectedSemesterId
    for (const message of history) {
      if (message.role !== "toolResult" || !record(message.details)) continue
      const refs = message.details.objectReferences
      if (!Array.isArray(refs)) continue
      for (const entry of refs) {
        if (
          !record(entry) ||
          typeof entry.ref !== "string" ||
          typeof entry.entity !== "string" ||
          typeof entry.id !== "number" ||
          !Number.isSafeInteger(entry.id) ||
          entry.id <= 0 ||
          !Object.values(entities).includes(entry.entity) ||
          !entry.ref.startsWith(`${entry.entity}:`)
        )
          continue
        this.byRef.set(entry.ref, { entity: entry.entity, id: entry.id })
        this.byObject.set(`${entry.entity}:${entry.id}`, entry.ref)
      }
    }
  }

  private reference(entity: string, id: number) {
    const key = `${entity}:${id}`
    let ref = this.byObject.get(key)
    if (!ref) {
      ref = `${entity}:${randomUUID()}`
      this.byObject.set(key, ref)
      this.byRef.set(ref, { entity, id })
    }
    this.touched.add(ref)
    return ref
  }

  private resolve(value: unknown, entity?: string): number {
    const found = typeof value === "string" ? this.byRef.get(value) : undefined
    if (!found || (entity && found.entity !== entity))
      throw new AgentError(
        "REFERENCE_UNAVAILABLE",
        "对象引用无效或已失效，需要重新查询该对象。",
        422,
      )
    this.touched.add(value as string)
    return found.id
  }

  private project(value: unknown, entity?: string): unknown {
    if (Array.isArray(value)) return value.map((entry) => this.project(entry, entity))
    if (!record(value)) return value
    const output: RecordValue = Object.create(null)
    for (const [key, entry] of Object.entries(value)) {
      if (
        internalFields.has(key) ||
        key.endsWith("_revision") ||
        key.endsWith("_etag") ||
        key.endsWith("_fingerprint")
      )
        continue
      // Evidence sometimes contains JSON encoded as text; it follows the same boundary.
      if (key === "fact" && typeof entry === "string") {
        try {
          output[key] = JSON.stringify(this.project(JSON.parse(entry)))
          continue
        } catch {
          /* Plain-text evidence. */
        }
      }
      if (key === "scope_keys" && Array.isArray(entry)) {
        output[key] = entry.map((field) =>
          typeof field === "string"
            ? field.replace(/_ids$/, "_refs").replace(/_id$/, "_ref")
            : field,
        )
        continue
      }
      if ((key === "id" || key === "ids" || /_ids?$/.test(key)) && key !== "evidence_id") {
        const kind = entityForId(key, value, entity)
        if (!kind) continue
        const convert = (id: unknown) => {
          if (id === null) return null
          const number = typeof id === "number" ? id : typeof id === "string" ? Number(id) : NaN
          return Number.isSafeInteger(number) && number > 0
            ? this.reference(kind, number)
            : undefined
        }
        const field =
          key === "id"
            ? "ref"
            : key === "ids"
              ? "refs"
              : key.replace(/_ids$/, "_refs").replace(/_id$/, "_ref")
        output[field] = Array.isArray(entry)
          ? entry.map(convert).filter((ref) => ref !== undefined)
          : convert(entry)
        continue
      }
      output[key] = this.project(
        entry,
        entities[key] ?? (["data", "matches"].includes(key) ? entity : undefined),
      )
    }
    return output
  }

  private parameters(schema: RecordValue): RecordValue {
    const output = { ...schema }
    if (record(schema.properties)) {
      const properties: RecordValue = {}
      const rename = (key: string) =>
        key !== "evidence_id" && /_ids?$/.test(key)
          ? key.replace(/_ids$/, "_refs").replace(/_id$/, "_ref")
          : key
      for (const [key, property] of Object.entries(schema.properties)) {
        if (!record(property)) continue
        const field = rename(key)
        properties[field] =
          field === key
            ? this.parameters(property)
            : key.endsWith("_ids")
              ? Type.Array(Type.String({ minLength: 1 }), {
                  description: "查询结果中的对象引用。",
                })
              : Type.String({
                  minLength: 1,
                  description:
                    key === "semester_id" && this.selectedSemesterId !== null
                      ? "可省略，默认使用对话所选学期；指定其他学期时使用查询返回的引用。"
                      : "查询结果中的对象引用。",
                })
      }
      output.properties = properties
      if (Array.isArray(schema.required))
        output.required = schema.required
          .filter((key) => key !== "semester_id" || this.selectedSemesterId === null)
          .map((key) => rename(String(key)))
    }
    if (record(schema.items)) output.items = this.parameters(schema.items)
    for (const key of ["anyOf", "oneOf", "allOf"])
      if (Array.isArray(schema[key]))
        output[key] = schema[key].map((part) => (record(part) ? this.parameters(part) : part))
    return output
  }

  private arguments(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((entry) => this.arguments(entry))
    if (!record(value)) return value
    const output: RecordValue = Object.create(null)
    for (const [key, entry] of Object.entries(value)) {
      if (/_refs?$/.test(key)) {
        const field = key.replace(/_refs$/, "_ids").replace(/_ref$/, "_id")
        const entity = entityForId(field, value)
        output[field] = Array.isArray(entry)
          ? entry.map((ref) => this.resolve(ref, entity))
          : this.resolve(entry, entity)
      } else output[key] = this.arguments(entry)
    }
    return output
  }

  private legacyArguments(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((entry) => this.legacyArguments(entry))
    if (!record(value)) return value
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => {
        const entity =
          key !== "evidence_id" && /_ids?$/.test(key) ? entityForId(key, value) : undefined
        if (entity && (typeof entry === "number" || Array.isArray(entry))) {
          const convert = (id: unknown) =>
            typeof id === "number" && Number.isSafeInteger(id) && id > 0
              ? this.reference(entity, id)
              : id
          return [
            key.replace(/_ids$/, "_refs").replace(/_id$/, "_ref"),
            Array.isArray(entry) ? entry.map(convert) : convert(entry),
          ]
        }
        return [key, this.legacyArguments(entry)]
      }),
    )
  }

  private result(value: unknown, tool: string, args: RecordValue = {}): unknown {
    const raw = record(value) ? value : { data: value }
    const projected = this.project(
      raw,
      tool === "find_resources"
        ? entities[String(args.resource ?? raw.resource)]
        : resultEntities[tool],
    ) as RecordValue
    const meta = record(raw.meta) ? raw.meta : {}
    const pagination = record(meta.pagination) ? meta.pagination : undefined
    const existing = record(raw.coverage) ? raw.coverage : {}
    const unavailable = raw.ok === false || raw.data === null
    const missing = Array.isArray(raw.missing_fields) ? raw.missing_fields : []
    const rows = [
      raw.matches,
      raw.data,
      raw.academic_years,
      raw.semesters,
      raw.rows,
      raw.entries,
      record(raw.data) ? raw.data.changes : undefined,
    ].find((value): value is unknown[] => Array.isArray(value))
    const paginated = pagination
      ? typeof pagination.total === "number" && rows
        ? pagination.total > rows.length
        : typeof pagination.last_page === "number" && pagination.last_page > 1
      : false
    const complete =
      !unavailable && existing.complete !== false && missing.length === 0 && !paginated
    return {
      ...projected,
      data_state: unavailable
        ? "unavailable"
        : !complete
          ? "partial"
          : rows?.length === 0
            ? "empty"
            : "available",
      coverage: {
        ...existing,
        complete,
        missing_fields: missing,
        ...(pagination ? { pagination } : {}),
      },
    }
  }

  tools(tools: AgentTool[]): AgentTool[] {
    return tools.map((tool) => ({
      ...tool,
      parameters: this.parameters(tool.parameters as unknown as RecordValue) as unknown as TSchema,
      execute: async (callId, args, signal) => {
        this.touched.clear()
        try {
          const decoded = this.arguments(args) as RecordValue
          const properties = (tool.parameters as unknown as RecordValue).properties
          if (
            record(properties) &&
            "semester_id" in properties &&
            decoded.semester_id === undefined &&
            this.selectedSemesterId !== null
          )
            decoded.semester_id = this.selectedSemesterId
          const result = await tool.execute(callId, decoded, signal)
          const content = result.content.map((part) =>
            part.type === "text"
              ? {
                  ...part,
                  text: JSON.stringify(this.result(JSON.parse(part.text), tool.name, decoded)),
                }
              : part,
          )
          if (JSON.stringify(content).length > 48000)
            throw new AgentError(
              "RESULT_TOO_LARGE",
              "查询结果超过单次可读取范围，需要使用筛选条件或分页读取。",
              422,
            )
          return {
            ...result,
            content,
            details: {
              ...(record(result.details) ? result.details : {}),
              modelDataVersion: 1,
              objectReferences: [...this.touched].map((ref) => ({ ref, ...this.byRef.get(ref)! })),
            },
          }
        } catch (error) {
          if (
            signal?.aborted ||
            (error instanceof AgentError && [401, 403, 419].includes(error.status))
          )
            throw error
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  data_state: "unavailable",
                  coverage: { complete: false },
                  error: {
                    code: error instanceof AgentError ? error.code : "TOOL_DATA_INVALID",
                    message:
                      error instanceof AgentError ? error.message : "本次工具未能提供可用数据。",
                  },
                }),
              },
            ],
            details: { status: "error", modelDataVersion: 1 },
          }
        }
      },
    }))
  }

  toMessages = (messages: AgentMessage[]): Message[] =>
    messages
      .filter(
        (message): message is Message =>
          message.role === "system" ||
          message.role === "user" ||
          message.role === "assistant" ||
          message.role === "toolResult",
      )
      .map((message) => {
        if (message.role === "toolResult") {
          const { details, ...rest } = message
          if (record(details) && details.modelDataVersion === 1) return rest
          return {
            ...rest,
            content: rest.content.map((part) => {
              if (part.type !== "text") return part
              try {
                return {
                  ...part,
                  text: JSON.stringify(this.result(JSON.parse(part.text), message.toolName)),
                }
              } catch {
                return part
              }
            }),
          }
        }
        if (message.role === "assistant")
          return {
            ...message,
            content: message.content.map((part) =>
              part.type === "toolCall"
                ? {
                    ...part,
                    arguments: this.legacyArguments(part.arguments) as typeof part.arguments,
                  }
                : part,
            ),
          }
        return message
      })
}
