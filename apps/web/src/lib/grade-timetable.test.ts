import { describe, expect, it } from "vitest"
import type { ClassSetting, TeachingAssignment, TimetableEntry } from "@/lib/types"
import {
  activeGradeClasses,
  entryClassIds,
  entryTeachers,
  gradeRows,
  timetableCsv,
} from "./grade-timetable"

const schoolClass = (id: number, gradeId = 1, name = `七年级${id}班`) => ({
  id,
  grade_id: gradeId,
  name,
  status: "active",
  grade: { id: gradeId, name: "七年级" },
})
const settings = [1, 2, 10].map((id) => ({
  status: "active",
  school_class: schoolClass(id),
})) as ClassSetting[]
const assignment = (id: number, classId: number | null, groupClasses: number[] = []) =>
  ({
    id,
    school_class_id: classId,
    teaching_group: { school_classes: groupClasses.map((value) => schoolClass(value)) },
  }) as TeachingAssignment
const entry = (id: number, classId: number | null, classIds: number[] = []) =>
  ({
    id,
    teaching_assignment_id: id,
    school_class_id: classId,
    school_classes: classIds.map((value) => schoolClass(value)),
  }) as TimetableEntry

describe("grade timetable", () => {
  it("uses only participating active classes and sorts class numbers naturally", () => {
    const inactive = { ...settings[0], status: "inactive" } as ClassSetting
    const archived = {
      ...settings[0],
      school_class: { ...settings[0].school_class, status: "inactive" },
    } as ClassSetting
    expect(
      activeGradeClasses([settings[2], inactive, settings[1], archived, settings[0]]).map(
        (item) => item.id,
      ),
    ).toEqual([1, 2, 10])
  })
  it("places a shared lesson into every member class without duplicate class membership", () => {
    const lesson = entry(1, 1, [1, 2])
    expect(entryClassIds(lesson)).toEqual([1, 2])
    const rows = gradeRows(settings, 1, [lesson], [])
    expect(rows.map((row) => row.entries.length)).toEqual([1, 1, 0])
    expect(gradeRows(settings, 2, [lesson], [])).toEqual([])
  })
  it("does not infer pending lessons from empty cells", () => {
    const rows = gradeRows(settings, 1, [], [], { hard_conflicts: [], incomplete_assignments: [] })
    expect(rows).toHaveLength(3)
    expect(rows.every((row) => !row.hasIssues && row.remaining === 0)).toBe(true)
  })
  it("assigns shared teaching-group requirements to every affected class", () => {
    const rows = gradeRows(settings, 1, [], [assignment(30, null, [1, 2])], {
      hard_conflicts: [],
      incomplete_assignments: [{ id: 30, required: 3, scheduled: 1 }],
    })
    expect(rows.map((row) => row.remaining)).toEqual([2, 2, 0])
  })
  it("includes a cross-grade teacher conflict reported against the other entry", () => {
    const rows = gradeRows(settings, 1, [entry(1, 1), entry(99, 99)], [], {
      incomplete_assignments: [],
      hard_conflicts: [
        { type: "teacher", entry_id: 99, existing_entry_id: 1, message: "教师在另一年级同时上课" },
      ],
    })
    expect(rows[0].conflicts).toHaveLength(1)
    expect(rows[1].conflicts).toHaveLength(0)
  })
  it("keeps missing fixed placements and over-scheduled requirements actionable", () => {
    const rows = gradeRows(settings, 1, [], [assignment(20, 2), assignment(21, 10)], {
      hard_conflicts: [{ type: "fixed_placement", assignment_id: 20, message: "固定安排缺失" }],
      incomplete_assignments: [{ id: 21, required: 2, scheduled: 3 }],
    })
    expect(rows.map((row) => row.hasIssues)).toEqual([false, true, true])
    expect(rows[2].remaining).toBe(0)
  })
  it("shows all collaborating teachers, with a primary-teacher fallback", () => {
    const primary = { id: 1, name: "王老师" }
    const collaborator = { id: 2, name: "陈老师" }
    expect(
      entryTeachers({ teacher: primary, teachers: [primary, collaborator] } as TimetableEntry),
    ).toEqual([primary, collaborator])
    expect(entryTeachers({ teacher: primary, teachers: [] } as unknown as TimetableEntry)).toEqual([
      primary,
    ])
  })
  it("quotes spreadsheet exports and neutralizes formula-like resource names", () => {
    const csv = timetableCsv([
      ["班级", "语文\n王老师"],
      ['七年级"1班', " =HYPERLINK(1)", "@SUM", "正常"],
    ])
    expect(csv).toBe(
      '\uFEFF"班级","语文\n王老师"\r\n"七年级""1班","\' =HYPERLINK(1)","\'@SUM","正常"',
    )
  })
})
