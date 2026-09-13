import { adjustmentLabels, dateLabel } from "./daily-adjustments"
import type { CalendarException, Item, TimetableEntry } from "./types"
import type { WeeklyChange, WeeklySnapshot } from "./long-term-changes"

export type DetailValue = {
  primary: string
  secondary?: string
  meta?: string
  secondaryFirst?: boolean
}
export type DetailRow = {
  id: string
  title: string
  context: string
  period?: string
  before: DetailValue
  after: DetailValue
}
export type AdjustmentDetail = {
  type: string
  title: string
  dimension: string
  beforeLabel: string
  afterLabel: string
  rows: DetailRow[]
  note?: string
  caution?: boolean
}
const join = (...parts: (string | undefined | null)[]) => parts.filter(Boolean).join(" · ")
const hours = (item?: Partial<Pick<Item, "start_time" | "end_time">> | null) =>
  item?.start_time && item.end_time
    ? `${item.start_time.slice(0, 5)}–${item.end_time.slice(0, 5)}`
    : undefined
const time = (date: string, item?: Item | null): DetailValue => ({
  secondaryFirst: true,
  primary: item?.name ?? "课节未记录",
  secondary: dateLabel(date),
  meta: hours(item),
})
const teachers = (entry?: TimetableEntry | null) =>
  entry?.teachers?.length ? entry.teachers.map((t) => t.name).join("、") : entry?.teacher?.name
const title = (entry?: TimetableEntry | null) =>
  join(
    entry?.course?.name ?? "课程未记录",
    entry?.school_classes?.map((c) => c.name).join("、") ||
      entry?.school_class?.name ||
      entry?.teaching_group?.name,
  )

export function temporaryDetail(record: CalendarException): AdjustmentDetail {
  const source = record.original_entry
  const other = record.related_entry
  const date = record.replacement_date ?? record.effective_date
  const row: DetailRow = {
    id: String(record.id),
    title: title(source),
    context: join(teachers(source), source?.actual_room?.name),
    before: time(record.effective_date, source?.item),
    after: time(date, record.replacement_item),
  }
  const detail: AdjustmentDetail = {
    type: record.type === "move" ? "改时间" : adjustmentLabels[record.type],
    title: row.title,
    dimension: "上课时间",
    beforeLabel: "原安排",
    afterLabel: "调整后",
    rows: [row],
  }
  if (record.type === "swap") {
    detail.title = "两节课互换时间"
    row.after = time(date, other?.item)
    detail.rows.push({
      id: `${record.id}-other`,
      title: title(other),
      context: join(teachers(other), other?.actual_room?.name),
      before: time(date, other?.item),
      after: time(record.effective_date, source?.item),
    })
    detail.note = "老师、班级和教室不变"
  } else if (record.type === "move") {
    const resourceChanges = [
      record.replacement_teacher_id && record.replacement_teacher_id !== source?.teacher_id
        ? `老师：${record.replacement_teacher?.name ?? "未记录"}`
        : undefined,
      record.replacement_room_id && record.replacement_room_id !== source?.actual_room_id
        ? `教室：${record.replacement_room?.name ?? "未记录"}`
        : undefined,
    ].filter(Boolean)
    if (resourceChanges.length) {
      detail.dimension = "时间与任课安排"
      row.after.meta = join(row.after.meta, ...resourceChanges)
    } else detail.note = "老师、班级和教室不变"
  } else {
    row.context = join(dateLabel(record.effective_date), source?.item?.name, hours(source?.item))
    if (record.type === "teacher_change") {
      detail.dimension = "主讲老师"
      detail.beforeLabel = "原老师"
      detail.afterLabel = "新老师"
      row.context = join(row.context, source?.actual_room?.name)
      row.before = { primary: source?.teacher?.name ?? "原老师未记录" }
      row.after = { primary: record.replacement_teacher?.name ?? "新老师未记录" }
      const collaborators = source?.teachers
        ?.filter((t) => t.id !== source.teacher_id)
        .map((t) => t.name)
        .join("、")
      detail.note = join(
        "上课时间和教室不变",
        collaborators ? `协同老师：${collaborators}（不变）` : undefined,
      )
    } else if (record.type === "room_change") {
      detail.dimension = "上课教室"
      detail.beforeLabel = "原教室"
      detail.afterLabel = "新教室"
      row.context = join(row.context, teachers(source))
      row.before = { primary: source?.actual_room?.name ?? "原教室未记录" }
      row.after = { primary: record.replacement_room?.name ?? "新教室未记录" }
      detail.note = "上课时间和老师不变"
    } else if (record.type === "cancel" || record.type === "activity") {
      detail.dimension = "课程安排"
      row.before = {
        primary: source?.course?.name ?? "原课程",
        secondary: teachers(source),
        meta: source?.actual_room?.name,
      }
      row.after =
        record.type === "cancel"
          ? { primary: "本节停课", secondary: "原时段空出" }
          : {
              primary: record.title || "活动",
              secondary: `本节${source?.course?.name ?? "原课程"}停上`,
            }
      detail.afterLabel = record.type === "activity" ? "活动" : "调整后"
      detail.note =
        record.type === "cancel" ? "未安排自习或看班老师" : "带队老师和活动场地未在此安排"
      detail.caution = true
    } else if (record.type === "makeup") {
      const assignment = record.replacement_assignment
      row.title = join(
        assignment?.course?.name ?? "补课",
        assignment?.school_class?.name || assignment?.teaching_group?.name,
      )
      detail.title = row.title
      detail.dimension = "课程安排"
      detail.afterLabel = "新增课程"
      row.context = join(
        dateLabel(date),
        record.replacement_item?.name,
        hours(record.replacement_item),
      )
      row.before = { primary: "无课" }
      row.after = {
        primary: assignment?.course?.name ?? "补课",
        secondary: [
          ...new Set(
            [
              record.replacement_teacher?.name ?? assignment?.teacher?.name,
              ...(assignment?.collaborators?.map((t) => t.name) ?? []),
            ].filter(Boolean),
          ),
        ].join("、"),
        meta: record.replacement_room?.name ?? assignment?.specified_room?.name ?? "教室未记录",
      }
      detail.note = "仅新增这一次课程"
    }
  }
  return detail
}

function weeklyFields({ before, after }: WeeklyChange) {
  return [
    (before.weekday !== after.weekday || before.item_id !== after.item_id) && "time",
    (before.teacher_id !== after.teacher_id ||
      [...before.teacher_ids].sort((a, b) => a - b).join() !==
        [...after.teacher_ids].sort((a, b) => a - b).join()) &&
      "teacher",
    before.room_id !== after.room_id && "room",
  ].filter(Boolean)
}
const weeklyTime = (s: WeeklySnapshot): DetailValue => ({
  secondaryFirst: true,
  primary: s.item_name,
  secondary: s.recurrence_label,
  meta: hours(s),
})
const fullWeekly = (s: WeeklySnapshot): DetailValue => ({
  primary: join(s.recurrence_label, s.item_name),
  secondary: s.teacher_names.join("、"),
  meta: s.room_name,
})
export function weeklyDetail(changes: WeeklyChange[]): AdjustmentDetail {
  const fields = [...new Set(changes.flatMap(weeklyFields))]
  const field = fields.length === 1 ? fields[0] : "mixed"
  // Classify only reciprocal moves in the same effective interval and recurrence pattern as swaps.
  const swap =
    field === "time" &&
    changes.length > 1 &&
    changes.every((a) =>
      changes.some(
        (b) =>
          a.before.entry_key !== b.before.entry_key &&
          a.before.effective_from === b.before.effective_from &&
          a.before.effective_to === b.before.effective_to &&
          a.before.recurrence_label.split(" · ")[0] === b.before.recurrence_label.split(" · ")[0] &&
          a.before.weekday === b.after.weekday &&
          a.before.item_id === b.after.item_id &&
          b.before.weekday === a.after.weekday &&
          b.before.item_id === a.after.item_id,
      ),
    )
  const count = new Set(changes.map((c) => c.before.entry_key)).size
  const type = swap
    ? "换课"
    : field === "time"
      ? "改时间"
      : field === "teacher"
        ? "换老师"
        : field === "room"
          ? "换教室"
          : "组合调整"
  const titles = [
    ...new Set(changes.map(({ before }) => join(before.course_name, before.target_name))),
  ]
  return {
    type,
    title: swap
      ? count === 2
        ? "两节固定课互换时间"
        : "固定课节互换时间"
      : titles.length === 1
        ? titles[0]
        : `${count} 节固定课程调整`,
    dimension:
      field === "time"
        ? "上课时间"
        : field === "teacher"
          ? "主讲老师"
          : field === "room"
            ? "上课教室"
            : "课程安排",
    beforeLabel: field === "teacher" ? "原老师" : field === "room" ? "原教室" : "原安排",
    afterLabel: field === "teacher" ? "新老师" : field === "room" ? "新教室" : "调整后",
    rows: changes.map(({ before, after }, index) => ({
      id: `${before.entry_key}-${before.effective_from}-${index}`,
      title: join(before.course_name, before.target_name),
      period: `${after.effective_from} 至 ${after.effective_to}`,
      context:
        field === "time"
          ? join(before.teacher_names.join("、"), before.room_name)
          : field === "teacher"
            ? join(before.recurrence_label, before.item_name, hours(before), before.room_name)
            : field === "room"
              ? join(
                  before.recurrence_label,
                  before.item_name,
                  hours(before),
                  before.teacher_names.join("、"),
                )
              : "",
      before:
        field === "time"
          ? weeklyTime(before)
          : field === "teacher"
            ? { primary: before.teacher_names.join("、") }
            : field === "room"
              ? { primary: before.room_name }
              : fullWeekly(before),
      after:
        field === "time"
          ? weeklyTime(after)
          : field === "teacher"
            ? { primary: after.teacher_names.join("、") }
            : field === "room"
              ? { primary: after.room_name }
              : fullWeekly(after),
    })),
    note:
      field === "time"
        ? "老师、班级和教室不变"
        : field === "teacher"
          ? "上课时间和教室不变；显示完整任课老师名单"
          : field === "room"
            ? "上课时间和老师不变"
            : undefined,
  }
}
