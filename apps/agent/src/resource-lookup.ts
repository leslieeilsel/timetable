import { z } from "zod"
import type { BusinessApi } from "./business-api.ts"
import { AgentError } from "./errors.ts"

export const resourceRow = z
  .object({
    id: z.number().int().positive(),
    name: z.string(),
    code: z.string().nullable().optional(),
    is_active: z.boolean().optional(),
  })
  .passthrough()

const teacherRow = resourceRow.extend({
  employee_no: z.string().nullable().optional(),
  // Missing and empty have different meanings; report missing fields separately.
  courses: z.array(resourceRow).optional(),
})

export function missingFields(
  rows: Record<string, unknown>[],
  fields: string[],
  prefix = "matches",
) {
  return rows.flatMap((row, index) =>
    fields
      .filter((field) => {
        let value: unknown = row
        for (const key of field.split(".")) {
          // A null relation is explicitly unconfigured, not an omitted child field.
          if (value === null) return false
          if (typeof value !== "object" || !(key in value)) return true
          value = (value as Record<string, unknown>)[key]
        }
        return value === undefined
      })
      .map((field) => `${prefix}[${index}].${field}`),
  )
}

export const paginationSchema = z.object({
  total: z.number().int().nonnegative(),
  page: z.number().int().positive().optional(),
  per_page: z.number().int().positive().optional(),
  last_page: z.number().int().nonnegative().optional(),
  from: z.number().nullable().optional(),
  to: z.number().nullable().optional(),
})

export async function findCatalogResources(
  api: BusinessApi,
  resource: "teacher" | "course" | "room" | "grade",
  search: string,
  page = 1,
  filters: { status?: "active" | "inactive" | "all"; course_id?: number; room_type?: string } = {},
) {
  const collection = { teacher: "teachers", course: "courses", room: "rooms", grade: "grades" }[
    resource
  ]
  const params = new URLSearchParams({
    per_page: "20",
    page: String(page),
  })
  const status = filters.status ?? "active"
  if (search.trim()) params.set("search", search.trim())
  if (status !== "all") params.set("status", status)
  if (resource === "teacher" && filters.course_id)
    params.set("course_id", String(filters.course_id))
  if (resource === "room" && filters.room_type) params.set("type", filters.room_type)
  const response = await api.request(`/api/v1/${collection}?${params}`)
  const parsed = (resource === "teacher" ? z.array(teacherRow) : z.array(resourceRow)).safeParse(
    response.data,
  )
  if (!parsed.success) {
    throw new AgentError(
      "RESOURCE_DATA_INCOMPLETE",
      "基础资料返回格式不完整，本次未能读取有效记录。",
    )
  }
  const matches = parsed.data
  const { pagination } = z.object({ pagination: paginationSchema }).parse(response.meta)
  return {
    resource,
    scope: "catalog",
    filters: { search: search.trim(), ...filters, status },
    matches,
    total: pagination.total,
    unique: pagination.total === 1 && matches.length === 1,
    meta: { pagination },
    missing_fields: missingFields(
      matches,
      {
        teacher: ["courses", "is_active"],
        course: ["short_name", "is_active"],
        room: ["type", "is_active"],
        grade: ["sort_order", "is_active"],
      }[resource],
    ),
    field_meanings:
      resource === "teacher"
        ? { courses: "基础资料中登记的任教课程，不依赖学期；空数组表示未登记。" }
        : resource === "room"
          ? { type: "教室用途类型；教室名称不表示班级归属。" }
          : resource === "course"
            ? { short_name: "课程简称。" }
            : {},
  }
}
