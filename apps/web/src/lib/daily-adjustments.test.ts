import { describe, expect, it } from "vitest"
import {
  adjustmentPayload,
  adjustmentReady,
  describeAdjustment,
  emptyDailyFilters,
  matchesDailyFilters,
  matchesObject,
  newAdjustment,
  validDate,
  weekDates,
} from "./daily-adjustments"
import type { CalendarException, DailyTimetableRow } from "./types"
const row = {
  key: "base-1",
  date: "2026-09-16",
  original_entry_id: 1,
  course_id: 2,
  course_name: "数学",
  class_ids: [3, 4],
  target_name: "七年级1班",
  teacher_ids: [5, 6],
  teacher_names: ["张伟", "王静"],
  room_id: 7,
  room_name: "教学楼101",
  start_time: "10:10:00",
  status: "base",
} as DailyTimetableRow

describe("temporary adjustment filtering and payloads", () => {
  it("combines course choices with OR and categories with AND", () => {
    expect(
      matchesDailyFilters(row, { ...emptyDailyFilters, courses: ["1", "2"], period: "am" }),
    ).toBe(true)
    expect(
      matchesDailyFilters(row, { ...emptyDailyFilters, courses: ["1", "2"], period: "pm" }),
    ).toBe(false)
    expect(matchesDailyFilters(row, { ...emptyDailyFilters, status: "changed" })).toBe(false)
    expect(
      matchesDailyFilters(
        { ...row, status: "swap" },
        { ...emptyDailyFilters, status: "changed", q: "王静" },
      ),
    ).toBe(true)
  })
  it("supports merged classes and collaborating teachers without mixing object kinds", () => {
    expect(matchesObject(row, "class", "4")).toBe(true)
    expect(matchesObject(row, "teacher", "6")).toBe(true)
    expect(matchesObject(row, "room", "6")).toBe(false)
    expect(matchesObject(row, "class", "")).toBe(false)
  })
  it("clamps week ranges at semester boundaries and rejects impossible dates", () => {
    expect(weekDates("2026-09-01", "2026-09-01", "2027-01-20")).toEqual([
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
      "2026-09-06",
    ])
    expect(validDate("2026-02-30")).toBe(false)
    expect(validDate("2026-02-28")).toBe(true)
  })
  it("sends cross-date swaps as a single action and drops stale type-specific fields", () => {
    const form = {
      ...newAdjustment(row.date, row),
      related_entry_id: "9",
      replacement_date: "2026-09-17",
      reason: "教研活动",
      replacement_teacher_id: "8",
    }
    expect(adjustmentReady(form)).toBe(true)
    expect(adjustmentPayload(form)).toEqual({
      type: "swap",
      effective_date: row.date,
      replacement_date: "2026-09-17",
      original_entry_id: 1,
      related_entry_id: 9,
      reason: "教研活动",
      notify_teachers: true,
    })
    const cancel = { ...form, type: "cancel" as const }
    expect(adjustmentPayload(cancel)).not.toHaveProperty("related_entry_id")
    expect(adjustmentPayload(cancel)).not.toHaveProperty("replacement_date")
  })
  it("requires a target and meaningful reason before review", () => {
    expect(adjustmentReady(newAdjustment(row.date, row))).toBe(false)
    expect(
      adjustmentReady({ ...newAdjustment(row.date, row), related_entry_id: "9", reason: " " }),
    ).toBe(false)
    expect(
      adjustmentReady({
        ...newAdjustment(row.date),
        replacement_assignment_id: "1",
        replacement_item_id: "2",
        reason: "补上课程",
      }),
    ).toBe(true)
  })
})

describe("adjustment record summaries", () => {
  const record = {
    type: "swap",
    effective_date: "2026-09-14",
    replacement_date: "2026-09-17",
    original_entry: {
      course: { name: "语文" },
      school_class: { name: "七年级1班" },
      item: { name: "第7节" },
      teacher: { name: "王老师" },
      teachers: [{ name: "王老师" }, { name: "李老师" }],
      actual_room: { name: "101" },
    },
    related_entry: { course: { name: "数学" }, item: { name: "第4节" } },
    replacement_item: { name: "第2节" },
    replacement_teacher: { name: "张老师" },
    replacement_room: { name: "实验室" },
  } as CalendarException
  it("uses each side's actual date and lesson, including collaborating teachers", () => {
    expect(describeAdjustment(record)).toEqual({
      title: "语文 · 七年级1班",
      teacher: "王老师、李老师",
      before: "9/14周一 第7节",
      after: "9/17周四 第4节 · 与数学互换",
    })
  })
  it("distinguishes moving a lesson from changing its teacher or room", () => {
    expect(describeAdjustment({ ...record, type: "move" }).after).toBe("9/17周四 第2节")
    expect(describeAdjustment({ ...record, type: "teacher_change" })).toMatchObject({
      before: "9/14周一 第7节 · 王老师",
      after: "张老师代课，时间不变",
    })
    expect(describeAdjustment({ ...record, type: "room_change" })).toMatchObject({
      before: "9/14周一 第7节 · 101",
      after: "实验室，时间不变",
    })
  })
  it("shows the occupied time for makeup and the emptied time for cancellation", () => {
    expect(
      describeAdjustment({
        ...record,
        type: "makeup",
        original_entry: null,
        replacement_assignment: {
          course: { name: "语文" },
          school_class: { name: "七年级1班" },
          teacher: { name: "王老师" },
        } as CalendarException["replacement_assignment"],
      }),
    ).toMatchObject({ before: "新增一次课程", after: "9/17周四 第2节", teacher: "王老师" })
    expect(describeAdjustment({ ...record, type: "cancel" }).after).toBe("停课，原时段空出")
    expect(describeAdjustment({ ...record, type: "activity", title: "运动会" }).after).toBe(
      "活动：运动会，原课程停上",
    )
  })
})
