import { describe, expect, it } from "vitest"
import type {
  ClassSetting,
  Course,
  Grade,
  Room,
  SchoolClass,
  Teacher,
  TeachingAssignment,
  TeachingGroup,
} from "@/lib/types"
import { buildAssignmentGroups, filterAssignmentGroups } from "./grouped-assignments-view"

const grade: Grade = {
  id: 1,
  name: "七年级",
  sort_order: 7,
  is_active: true,
}

const roomA: Room = { id: 1, name: "博学楼101教室", type: "classroom", is_active: true }
const roomB: Room = { id: 2, name: "计算机教室1", type: "computer_room", is_active: true }

const classA = schoolClass(1, "七年级1班")
const classB = schoolClass(2, "七年级2班")

const settings: ClassSetting[] = [classSetting(classA, roomA), classSetting(classB, null)]

const chinese: Course = { id: 1, name: "语文", short_name: "语", is_active: true }
const information: Course = { id: 2, name: "信息技术", short_name: "信息", is_active: true }
const teacherA: Teacher = {
  id: 1,
  name: "王静",
  employee_no: "JS001",
  is_active: true,
}
const teacherB: Teacher = {
  id: 2,
  name: "周磊",
  employee_no: "JS002",
  is_active: true,
}

describe("buildAssignmentGroups", () => {
  it("duplicates a teaching-group assignment into each member class", () => {
    const direct = assignment({ id: 1, school_class: classA, school_class_id: classA.id })
    const group = teachingGroup([classA, classB])
    const combined = assignment({
      id: 2,
      school_class: null,
      school_class_id: null,
      teaching_group: group,
      teaching_group_id: group.id,
      course: information,
      course_id: information.id,
    })

    const groups = buildAssignmentGroups("class", [direct, combined], settings)

    expect(groups.map((item) => [item.name, item.entries.length])).toEqual([
      ["七年级1班", 2],
      ["七年级2班", 1],
    ])
    expect(groups[1].entries[0].contextLabel).toBe("教学组 · 七年级信息技术走班")
  })

  it("places primary and collaborating assignments under each teacher", () => {
    const item = assignment({ collaborators: [teacherB] })

    const groups = buildAssignmentGroups("teacher", [item], settings)

    expect(groups.map((group) => group.name)).toEqual(["王静", "周磊"])
    expect(groups[0].entries[0].contextLabel).toBe("主讲")
    expect(groups[1].entries[0].contextLabel).toBe("协同")
  })

  it("groups by course and keeps assignment totals", () => {
    const items = [
      assignment({ id: 1 }),
      assignment({ id: 2, course: information, course_id: information.id, weekly_items: 2 }),
    ]

    const groups = buildAssignmentGroups("course", items, settings)

    expect(groups.map((group) => [group.name, group.weeklyItems])).toEqual([
      ["信息技术", 2],
      ["语文", 5],
    ])
  })

  it("resolves fixed, specified, missing, and teaching-group classroom buckets", () => {
    const group = teachingGroup([classA, classB])
    const groups = buildAssignmentGroups(
      "room",
      [
        assignment({ id: 1, school_class: classA, school_class_id: classA.id }),
        assignment({
          id: 2,
          school_class: classB,
          school_class_id: classB.id,
        }),
        assignment({
          id: 3,
          room_mode: "specified",
          specified_room_id: roomB.id,
          specified_room: roomB,
        }),
        assignment({
          id: 4,
          school_class: null,
          school_class_id: null,
          teaching_group: group,
          teaching_group_id: group.id,
        }),
      ],
      settings,
    )

    expect(groups.map((item) => item.name)).toEqual([
      "博学楼101教室",
      "计算机教室1",
      "随班级固定教室",
      "未指定教室",
    ])
    expect(groups.slice(0, 2).map((item) => item.subtitle)).toEqual(["普通教室", "计算机教室"])
  })
})

describe("filterAssignmentGroups", () => {
  it("finds a group through group name or a child assignment", () => {
    const groups = buildAssignmentGroups(
      "class",
      [
        assignment({ id: 1, school_class: classA, school_class_id: classA.id }),
        assignment({
          id: 2,
          school_class: classB,
          school_class_id: classB.id,
          teacher: teacherB,
          teacher_id: teacherB.id,
          course: information,
          course_id: information.id,
        }),
      ],
      settings,
    )

    expect(filterAssignmentGroups(groups, "七年级1班").map((group) => group.name)).toEqual([
      "七年级1班",
    ])
    expect(filterAssignmentGroups(groups, "周磊").map((group) => group.name)).toEqual(["七年级2班"])
  })
})

function schoolClass(id: number, name: string): SchoolClass {
  return {
    id,
    academic_year_id: 1,
    grade_id: grade.id,
    name,
    code: null,
    status: "active",
    grade,
  }
}

function classSetting(schoolClassValue: SchoolClass, fixedRoom: Room | null): ClassSetting {
  return {
    id: schoolClassValue.id,
    semester_id: 1,
    school_class_id: schoolClassValue.id,
    fixed_room_id: fixedRoom?.id ?? null,
    homeroom_teacher_id: null,
    status: "active",
    school_class: schoolClassValue,
    fixed_room: fixedRoom,
    homeroom_teacher: null,
  }
}

function teachingGroup(classes: SchoolClass[]): TeachingGroup {
  return {
    id: 1,
    semester_id: 1,
    name: "七年级信息技术走班",
    mode: "roaming",
    status: "active",
    school_classes: classes,
  }
}

function assignment(overrides: Partial<TeachingAssignment> = {}): TeachingAssignment {
  return {
    id: 1,
    semester_id: 1,
    school_class_id: classA.id,
    teaching_group_id: null,
    course_id: chinese.id,
    teacher_id: teacherA.id,
    weekly_items: 5,
    items_per_session: 1,
    week_pattern: "all",
    active_weeks: null,
    room_mode: "class_default",
    specified_room_id: null,
    allows_substitution: true,
    status: "confirmed",
    scheduled: 5,
    school_class: classA,
    teaching_group: null,
    course: chinese,
    teacher: teacherA,
    collaborators: [],
    specified_room: null,
    ...overrides,
  }
}
