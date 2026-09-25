import { describe, expect, it } from "vitest"
import {
  applyOperations,
  changedEntries,
  effectiveTeacherIds,
  matchesObject,
  placementProblem,
  recordStatus,
  defaultStart,
  groupAssignments,
} from "./long-term-changes"
import type { ChangeOperation, LongTermEntry, LongTermRecord } from "./long-term-changes"
import type { Semester } from "./types"
const semester = { start_date: "2026-09-01", end_date: "2027-01-29" } as Semester
function entry(fields: Partial<LongTermEntry> = {}): LongTermEntry {
  return {
    id: 1,
    entry_key: "lesson-1",
    weekday: 1,
    item_id: 1,
    teacher_id: 3,
    actual_room_id: 4,
    teacher: { id: 3, name: "王老师" },
    teachers: [
      { id: 3, name: "王老师" },
      { id: 5, name: "李老师" },
    ],
    school_classes: [{ id: 6, name: "七1" }],
    week_pattern: "all",
    active_weeks: null,
    is_locked: false,
    ...fields,
  } as LongTermEntry
}
describe("long-term recurring adjustments", () => {
  it("keeps an assignment complete even when room or lesson filters only match one occurrence", () => {
    const first = entry({ teaching_assignment_id: 1 })
    const otherRoom = entry({
      id: 2,
      teaching_assignment_id: 1,
      actual_room_id: 20,
      week_pattern: "a",
    })
    const otherAssignment = entry({ id: 3, teaching_assignment_id: 2 })
    expect(groupAssignments([first, otherRoom, otherAssignment], [first])).toEqual([
      [first, otherRoom],
    ])
    expect(groupAssignments([first, otherRoom], [])).toEqual([])
  })
  it("submits only changed fields and reverses an atomic exchange together", () => {
    const before = [entry(), entry({ id: 2, entry_key: "lesson-2", item_id: 2 })]
    const swap: ChangeOperation = {
      id: 1,
      label: "互换",
      updates: { 1: { item_id: 2 }, 2: { item_id: 1 } },
    }
    expect(changedEntries(before, applyOperations(before, [swap]))).toEqual([
      { entry_id: 1, item_id: 2 },
      { entry_id: 2, item_id: 1 },
    ])
    expect(changedEntries(before, applyOperations(before, []))).toEqual([])
    expect(before[0].item_id).toBe(1)
  })
  it("checks replacement teachers while retaining collaborating teachers", () => {
    const changed = entry({ teacher_id: 9 })
    expect(effectiveTeacherIds(changed)).toEqual([9, 5])
    expect(matchesObject(changed, "teacher", "3")).toBe(false)
    expect(matchesObject(changed, "teacher", "5")).toBe(true)
    expect(matchesObject(changed, "teacher", "9")).toBe(true)
    const other = entry({
      id: 2,
      teacher_id: 9,
      teachers: [{ id: 9, name: "赵老师" }] as LongTermEntry["teachers"],
      teacher: { id: 9, name: "赵老师" } as LongTermEntry["teacher"],
      actual_room_id: 10,
      school_classes: [{ id: 12 }] as LongTermEntry["school_classes"],
    })
    expect(placementProblem([changed, other], [1], semester)).toContain("老师")
  })
  it("permits disjoint odd/even weeks and blocks intersecting specified weeks", () => {
    const odd = entry({ week_pattern: "a" })
    const even = entry({ id: 2, week_pattern: "b" })
    expect(placementProblem([odd, even], [1], semester)).toBeNull()
    expect(
      placementProblem(
        [odd, { ...even, week_pattern: "specified", active_weeks: [3] }],
        [1],
        semester,
      ),
    ).toContain("班级")
  })
  it("rejects locked lessons and a replacement already in the teaching team", () => {
    expect(placementProblem([entry({ is_locked: true })], [1], semester)).toContain("锁定")
    expect(placementProblem([entry({ teacher_id: 5 })], [1], semester)).toContain("合上")
  })
  it("distinguishes scheduled recovery from already restored history", () => {
    const record = {
      effective_from: "2026-09-07",
      effective_to: "2026-10-30",
      restored_from: "2026-09-21",
    } as LongTermRecord
    expect(recordStatus(record, "2026-09-14")).toBe("已安排恢复")
    expect(recordStatus(record, "2026-09-22")).toBe("已恢复")
    expect(recordStatus({ ...record, restored_from: record.effective_from }, "2026-09-14")).toBe(
      "已取消",
    )
  })
  it("starts a new adjustment next Monday and stays within the semester", () => {
    expect(defaultStart(semester, "2026-09-13")).toBe("2026-09-14")
    expect(defaultStart(semester, "2026-09-14")).toBe("2026-09-21")
    expect(defaultStart(semester, "2026-08-01")).toBe("2026-09-01")
  })
})
