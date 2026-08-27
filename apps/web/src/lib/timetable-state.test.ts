import { describe, expect, it } from "vitest"
import type {
  ClassSetting,
  Course,
  Grade,
  Room,
  SchoolClass,
  Teacher,
  TeachingAssignment,
  TimetableVersion,
} from "@/lib/types"
import {
  assignmentMatchesResource,
  isTimetableVersionStale,
  pendingItemsForResource,
} from "./timetable-state"

const grade: Grade = { id: 1, name: "七年级", sort_order: 7, is_active: true }
const schoolClass: SchoolClass = {
  id: 10,
  academic_year_id: 1,
  grade_id: grade.id,
  name: "七年级1班",
  code: null,
  status: "active",
  grade,
}
const teacher: Teacher = { id: 20, name: "何敏", employee_no: null, is_active: true }
const course: Course = { id: 30, name: "化学", short_name: "化", is_active: true }
const room: Room = { id: 40, name: "博学楼101教室", type: "classroom", is_active: true }
const settings: ClassSetting[] = [
  {
    id: 1,
    semester_id: 1,
    school_class_id: schoolClass.id,
    fixed_room_id: room.id,
    homeroom_teacher_id: null,
    status: "active",
    school_class: schoolClass,
    fixed_room: room,
    homeroom_teacher: null,
  },
]

describe("timetable version state", () => {
  it("marks a version stale when the timetable inputs changed afterwards", () => {
    expect(
      isTimetableVersionStale({ input_revision: 20 }, { input_revision: 1 } as TimetableVersion),
    ).toBe(true)
    expect(
      isTimetableVersionStale({ input_revision: 20 }, { input_revision: 20 } as TimetableVersion),
    ).toBe(false)
  })

  it("counts only remaining items belonging to the current resource", () => {
    const assignment = teachingAssignment({ remaining: 1 })
    const completed = teachingAssignment({ id: 2, remaining: 0 })

    expect(
      pendingItemsForResource([assignment, completed], "class", schoolClass.id, settings),
    ).toBe(1)
    expect(pendingItemsForResource([assignment], "teacher", teacher.id, settings)).toBe(1)
    expect(pendingItemsForResource([assignment], "room", room.id, settings)).toBe(1)
    expect(pendingItemsForResource([assignment], "class", 999, settings)).toBe(0)
  })

  it("matches collaborating teachers as timetable resources", () => {
    const collaborator = { ...teacher, id: 21, name: "协同教师" }
    const assignment = teachingAssignment({ collaborators: [collaborator] })

    expect(assignmentMatchesResource(assignment, "teacher", collaborator.id, settings)).toBe(true)
  })
})

function teachingAssignment(overrides: Partial<TeachingAssignment> = {}): TeachingAssignment {
  return {
    id: 1,
    semester_id: 1,
    school_class_id: schoolClass.id,
    teaching_group_id: null,
    course_id: course.id,
    teacher_id: teacher.id,
    weekly_items: 1,
    items_per_session: 1,
    week_pattern: "all",
    active_weeks: null,
    room_mode: "class_default",
    specified_room_id: null,
    allows_substitution: true,
    status: "confirmed",
    scheduled: 0,
    remaining: 1,
    school_class: schoolClass,
    teaching_group: null,
    course,
    teacher,
    collaborators: [],
    specified_room: null,
    ...overrides,
  }
}
