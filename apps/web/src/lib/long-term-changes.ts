import type { ChangeMessageReceipt, Item, ScheduleDay, Semester, TimetableEntry } from "@/lib/types"

export type LongTermEntry = TimetableEntry & { entry_key: string }

export type LongTermSelection = {
  entryId: number
  scope: "entry" | "assignment"
  action: "swap" | "move" | "teacher" | "room"
}

// A resource filter locates assignments; it must not silently narrow a whole-assignment change.
export function groupAssignments(entries: LongTermEntry[], visible: LongTermEntry[]) {
  const ids = new Set(visible.map((entry) => entry.teaching_assignment_id))
  const groups = new Map<number, LongTermEntry[]>()
  for (const entry of entries) {
    if (!ids.has(entry.teaching_assignment_id)) continue
    const group = groups.get(entry.teaching_assignment_id) ?? []
    group.push(entry)
    groups.set(entry.teaching_assignment_id, group)
  }
  return [...groups.values()]
}

export type ChangeFields = Pick<
  LongTermEntry,
  "weekday" | "item_id" | "teacher_id" | "actual_room_id"
>
export type ChangeOperation = {
  id: number
  label: string
  updates: Record<number, Partial<ChangeFields>>
}
export type LongTermSource = {
  version_id: number
  date: string
  today: string
  days: ScheduleDay[]
  items: Item[]
  entries: LongTermEntry[]
}
export type WeeklySnapshot = {
  entry_key: string
  date: string
  effective_from: string
  effective_to: string
  recurrence_label: string
  weekday: number
  item_id: number
  item_name: string
  start_time?: string
  end_time?: string
  course_id: number
  course_name: string
  target_name: string
  class_ids: number[]
  teacher_id: number
  teacher_ids: number[]
  teacher_names: string[]
  room_id: number
  room_name: string
}
export type WeeklyChange = { before: WeeklySnapshot; after: WeeklySnapshot }
export type LongTermRecord = {
  id: number
  effective_from: string
  effective_to: string
  restored_from: string | null
  reason: string
  changes: WeeklyChange[]
  creator: { id: number; name: string }
  created_at: string
  messages?: ChangeMessageReceipt[]
}
export type LongTermPreview = {
  allowed: boolean
  changes: WeeklyChange[]
  checked_temporary_count?: number
  following?: WeeklySnapshot[]
  effective_from?: string
  effective_to?: string
  record: LongTermRecord
}
export const changeFields = ["weekday", "item_id", "teacher_id", "actual_room_id"] as const
export const weekdays = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"]
export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}
export function defaultStart(semester: Semester, today = localDate()) {
  const date = new Date(`${today}T12:00:00`)
  date.setDate(date.getDate() + ((8 - date.getDay()) % 7 || 7))
  const next = localDate(date)
  return next < semester.start_date
    ? semester.start_date
    : next > semester.end_date
      ? semester.end_date
      : next
}
export function applyOperations(entries: LongTermEntry[], operations: ChangeOperation[]) {
  const updates = new Map<number, Partial<ChangeFields>>()
  for (const operation of operations)
    for (const [id, fields] of Object.entries(operation.updates)) {
      updates.set(Number(id), { ...updates.get(Number(id)), ...fields })
    }
  return entries.map((entry) => ({ ...entry, ...updates.get(entry.id) }))
}
export function changedEntries(before: LongTermEntry[], after: LongTermEntry[]) {
  const originals = new Map(before.map((entry) => [entry.id, entry]))
  return after.flatMap((entry) => {
    const original = originals.get(entry.id)!
    const fields: Partial<ChangeFields> = {}
    for (const field of changeFields)
      if (entry[field] !== original[field]) fields[field] = entry[field]
    return Object.keys(fields).length ? [{ entry_id: entry.id, ...fields }] : []
  })
}
export function effectiveTeacherIds(entry: LongTermEntry) {
  const originalPrimary = entry.teacher.id
  return (
    entry.teachers.length ? entry.teachers.map((teacher) => teacher.id) : [originalPrimary]
  ).map((id) => (id === originalPrimary ? entry.teacher_id : id))
}
export function matchesObject(entry: LongTermEntry, view: string, resourceId: string) {
  const id = Number(resourceId)
  if (view === "teacher") return effectiveTeacherIds(entry).includes(id)
  if (view === "room") return entry.actual_room_id === id
  return entry.school_classes.some((schoolClass) => schoolClass.id === id)
}
export function activeWeeks(
  entry: LongTermEntry,
  semester: Pick<Semester, "start_date" | "end_date">,
) {
  const days = Math.round(
    (Date.parse(`${semester.end_date}T00:00:00Z`) -
      Date.parse(`${semester.start_date}T00:00:00Z`)) /
      86400000,
  )
  return Array.from({ length: Math.floor(days / 7) + 1 }, (_, index) => index + 1).filter(
    (week) =>
      entry.week_pattern === "all" ||
      (entry.week_pattern === "a" && week % 2 === 1) ||
      (entry.week_pattern === "b" && week % 2 === 0) ||
      (entry.week_pattern === "specified" && entry.active_weeks?.includes(week)),
  )
}
export function placementProblem(
  entries: LongTermEntry[],
  affectedIds: number[],
  semester: Semester,
) {
  const affected = entries.filter((entry) => affectedIds.includes(entry.id))
  for (const entry of affected) {
    if (entry.is_locked) return "课程已锁定"
    const weeks = new Set(activeWeeks(entry, semester))
    const teachers = effectiveTeacherIds(entry)
    if (new Set(teachers).size !== teachers.length) return "老师已参与这节合上课程"
    for (const other of entries) {
      if (
        other.id === entry.id ||
        other.weekday !== entry.weekday ||
        other.item_id !== entry.item_id ||
        !activeWeeks(other, semester).some((week) => weeks.has(week))
      )
        continue
      if (
        entry.school_classes.some((schoolClass) =>
          other.school_classes.some((candidate) => candidate.id === schoolClass.id),
        )
      )
        return "班级在这个课节已有课"
      if (teachers.some((id) => effectiveTeacherIds(other).includes(id)))
        return "老师在这个课节已有课"
      if (entry.actual_room_id === other.actual_room_id) return "教室在这个课节已被占用"
    }
  }
  return null
}
export function recordStatus(record: LongTermRecord, today: string) {
  if (record.restored_from)
    return record.restored_from === record.effective_from
      ? "已取消"
      : record.restored_from > today
        ? "已安排恢复"
        : "已恢复"
  if (record.effective_from > today) return "尚未生效"
  return record.effective_to < today ? "已结束" : "正在生效"
}
export function arrangement(row: WeeklySnapshot) {
  return `${row.recurrence_label} ${row.item_name} · ${row.teacher_names.join("、")} · ${row.room_name}`
}
export function recordSummary(record: LongTermRecord) {
  const teachers = record.changes.some(
    ({ before, after }) => before.teacher_id !== after.teacher_id,
  )
  const rooms = record.changes.some(({ before, after }) => before.room_id !== after.room_id)
  const time = record.changes.some(
    ({ before, after }) => before.weekday !== after.weekday || before.item_id !== after.item_id,
  )
  const first = record.changes[0]
  if (first && teachers && !rooms && !time)
    return `${first.before.teacher_names.join("、")} → ${first.after.teacher_names.join("、")} · 更换任课老师`
  if (first && rooms && !teachers && !time)
    return `${first.before.room_name} → ${first.after.room_name} · 更换教室`
  if (first && time && !teachers && !rooms)
    return `${weekdays[first.before.weekday]}${first.before.item_name} → ${weekdays[first.after.weekday]}${first.after.item_name} · 调整每周时间`
  return [time && "调整每周时间", teachers && "更换任课老师", rooms && "更换教室"]
    .filter(Boolean)
    .join("、")
}
