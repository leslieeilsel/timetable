import type { CalendarExceptionType, DailyTimetableRow } from "@/lib/types"

export const adjustmentLabels: Record<CalendarExceptionType, string> = {
  swap: "换课",
  move: "移动时间",
  teacher_change: "换老师",
  room_change: "换教室",
  cancel: "停课",
  activity: "安排活动",
  makeup: "补课",
}
export const dailyStatusLabels: Record<DailyTimetableRow["status"], string> = {
  base: "正常",
  moved_out: "已移出",
  moved_in: "调入",
  swap: "已换课",
  teacher_change: "已换老师",
  room_change: "已换教室",
  cancel: "已停课",
  makeup: "补课",
  activity: "活动",
  substitution: "代课",
}
export type ObjectKind = "class" | "teacher" | "room"
export type DailyFilters = {
  courses: string[]
  period: "all" | "am" | "pm"
  status: "all" | "changed"
  q: string
}
export const emptyDailyFilters: DailyFilters = { courses: [], period: "all", status: "all", q: "" }

export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}
export function validDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T12:00:00`)
  return !Number.isNaN(parsed.getTime()) && localDate(parsed) === value
}
export function addDays(value: string, amount: number) {
  const day = new Date(`${value}T12:00:00`)
  day.setDate(day.getDate() + amount)
  return localDate(day)
}
export function weekDates(date: string, min: string, max: string) {
  const weekday = new Date(`${date}T12:00:00`).getDay() || 7
  const monday = addDays(date, 1 - weekday)
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index)).filter(
    (day) => day >= min && day <= max,
  )
}
export function clampDate(date: string, min: string, max: string) {
  return date < min ? min : date > max ? max : date
}
export function dateLabel(date: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).format(new Date(`${date}T12:00:00`))
}
export function shortTime(value: string) {
  return value.slice(0, 5)
}
export function rowIdentity(row: DailyTimetableRow) {
  return `${row.date}:${row.key}`
}
export function matchesObject(row: DailyTimetableRow, kind: ObjectKind, id: string) {
  if (!id) return false
  const value = Number(id)
  return kind === "class"
    ? row.class_ids.includes(value)
    : kind === "teacher"
      ? row.teacher_ids.includes(value)
      : row.room_id === value
}
export function matchesDailyFilters(row: DailyTimetableRow, filters: DailyFilters) {
  return (
    (!filters.courses.length || filters.courses.includes(String(row.course_id))) &&
    (filters.period === "all" ||
      (filters.period === "am" ? row.start_time < "12:00" : row.start_time >= "12:00")) &&
    (filters.status === "all" || row.status !== "base") &&
    (!filters.q.trim() ||
      `${row.course_name} ${row.target_name} ${row.teacher_names.join(" ")} ${row.room_name} ${row.title ?? ""}`
        .toLocaleLowerCase()
        .includes(filters.q.trim().toLocaleLowerCase()))
  )
}
export function filterCount(filters: DailyFilters) {
  return (
    filters.courses.length +
    Number(filters.period !== "all") +
    Number(filters.status !== "all") +
    Number(Boolean(filters.q.trim()))
  )
}
export type AdjustmentForm = {
  type: CalendarExceptionType
  effective_date: string
  replacement_date: string
  original_entry_id: string
  related_entry_id: string
  replacement_item_id: string
  replacement_teacher_id: string
  replacement_room_id: string
  replacement_assignment_id: string
  title: string
  reason: string
  notify_teachers: boolean
}
export function newAdjustment(
  date: string,
  source?: DailyTimetableRow,
  itemId?: number,
): AdjustmentForm {
  return {
    type: source ? "swap" : "makeup",
    effective_date: source?.date ?? date,
    replacement_date: source?.date ?? date,
    original_entry_id: String(source?.original_entry_id ?? ""),
    related_entry_id: "",
    replacement_item_id: String(itemId ?? ""),
    replacement_teacher_id: "",
    replacement_room_id: "",
    replacement_assignment_id: "",
    title: "",
    reason: "",
    notify_teachers: true,
  }
}
export function adjustmentPayload(form: AdjustmentForm) {
  const body: Record<string, string | number | boolean> = {
    type: form.type,
    effective_date: form.effective_date,
    reason: form.reason.trim(),
    notify_teachers: form.notify_teachers,
  }
  if (form.type !== "makeup") body.original_entry_id = Number(form.original_entry_id)
  if (["swap", "move", "makeup"].includes(form.type)) body.replacement_date = form.replacement_date
  if (form.type === "swap") body.related_entry_id = Number(form.related_entry_id)
  if (["move", "makeup"].includes(form.type))
    body.replacement_item_id = Number(form.replacement_item_id)
  if (form.type === "makeup")
    body.replacement_assignment_id = Number(form.replacement_assignment_id)
  if (form.type === "teacher_change")
    body.replacement_teacher_id = Number(form.replacement_teacher_id)
  if (form.type === "room_change") body.replacement_room_id = Number(form.replacement_room_id)
  if (form.type === "activity") body.title = form.title.trim()
  return body
}
export function adjustmentReady(form: AdjustmentForm) {
  return (
    form.reason.trim().length >= 2 &&
    form.reason.trim().length <= 1000 &&
    validDate(form.effective_date) &&
    (form.type === "makeup" || Boolean(form.original_entry_id)) &&
    (form.type !== "swap" || Boolean(form.related_entry_id)) &&
    (form.type !== "teacher_change" || Boolean(form.replacement_teacher_id)) &&
    (form.type !== "room_change" || Boolean(form.replacement_room_id)) &&
    (form.type !== "makeup" || Boolean(form.replacement_assignment_id)) &&
    (form.type !== "activity" || Boolean(form.title.trim())) &&
    (!["move", "makeup", "swap"].includes(form.type) || validDate(form.replacement_date)) &&
    (!["move", "makeup"].includes(form.type) || Boolean(form.replacement_item_id))
  )
}

export function describeAdjustment(record: import("./types").CalendarException) {
  const original = record.original_entry
  const assignment = record.replacement_assignment
  const course = original?.course.name ?? assignment?.course.name ?? "课程"
  const target =
    original?.school_class?.name ??
    original?.teaching_group?.name ??
    assignment?.school_class?.name ??
    assignment?.teaching_group?.name ??
    ""
  const time = (date: string, item?: string) => `${dateLabel(date)} ${item ?? "课节待确认"}`
  const beforeTime = time(record.effective_date, original?.item?.name)
  const afterTime = time(
    record.replacement_date ?? record.effective_date,
    record.type === "swap" ? record.related_entry?.item?.name : record.replacement_item?.name,
  )
  let before = beforeTime
  let after = ""
  switch (record.type) {
    case "swap":
      after = `${afterTime} · 与${record.related_entry?.course.name ?? "另一节课"}互换`
      break
    case "move":
      after = afterTime
      break
    case "teacher_change":
      before = `${beforeTime} · ${original?.teacher?.name ?? "原老师"}`
      after = `${record.replacement_teacher?.name ?? "代课老师"}代课，时间不变`
      break
    case "room_change":
      before = `${beforeTime} · ${original?.actual_room?.name ?? "原教室"}`
      after = `${record.replacement_room?.name ?? "新教室"}，时间不变`
      break
    case "cancel":
      after = "停课，原时段空出"
      break
    case "activity":
      after = `活动：${record.title ?? "学校活动"}，原课程停上`
      break
    case "makeup":
      before = "新增一次课程"
      after = afterTime
      break
  }
  const names = original?.teachers?.length
    ? original.teachers.map((teacher) => teacher.name)
    : [original?.teacher?.name ?? assignment?.teacher?.name].filter(Boolean)
  return {
    title: [course, target].filter(Boolean).join(" · "),
    teacher: names.join("、"),
    before,
    after,
  }
}
