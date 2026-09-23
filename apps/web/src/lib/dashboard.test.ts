import { describe, expect, it } from "vitest"
import { dashboardTasks } from "@/lib/dashboard"
import { calendarDaysBetween, schoolDate, semesterPhase } from "@/lib/semester-phase"
import type { DashboardSummary, Semester } from "@/lib/types"

const semester: Semester = {
  id: 17,
  academic_year_id: 2,
  name: "下学期",
  sequence: 2,
  start_date: "2027-02-22",
  end_date: "2027-07-09",
  status: "open",
  etag: "semester-17",
  timetable_revision: 1,
  input_revision: 1,
  assignment_revision: 1,
  constraint_revision: 1,
  current_timetable_version_id: 31,
}
const ready: DashboardSummary = {
  class_count: 24,
  template_ready: true,
  assignment_count: 360,
  confirmed_count: 360,
  scheduled: 840,
  required: 840,
  remaining: 0,
  current_version_id: 31,
  current_version_name: "均衡方案 A",
  current_version_status: "active",
  current_version_is_stale: false,
  current_version_quality_score: null,
  current_version_hard_conflict_count: 0,
  current_version_soft_warning_count: 0,
  working_draft_id: null,
  working_draft_name: null,
  working_draft_is_stale: false,
}

describe("dashboard next steps", () => {
  it("puts missing prerequisites ahead of generating a timetable", () => {
    const tasks = dashboardTasks(semester, {
      ...ready,
      class_count: 0,
      template_ready: false,
      current_version_id: null,
    })
    expect(tasks.map((task) => task.id)).toEqual(["classes", "template", "generate"])
    expect(tasks[0].href).toBe("/semesters/17/setup")
  })
  it("does not treat zero assignments as confirmed preparation", () => {
    expect(
      dashboardTasks(semester, { ...ready, assignment_count: 0, confirmed_count: 0 })[0].id,
    ).toBe("assignments")
  })
  it("does not present old conflict and remaining counts as current tasks", () => {
    const tasks = dashboardTasks(semester, {
      ...ready,
      current_version_is_stale: true,
      remaining: 560,
      current_version_hard_conflict_count: 6,
      current_version_soft_warning_count: 2,
    })
    expect(tasks.map((task) => task.id)).toEqual(["stale"])
    expect(tasks[0].href).toBe("/semesters/17/generate")
  })
  it("continues a fresh draft instead of asking for another generation", () => {
    const tasks = dashboardTasks(semester, {
      ...ready,
      current_version_is_stale: true,
      working_draft_id: 42,
    })
    expect(tasks.map((task) => task.id)).toEqual(["draft"])
    expect(tasks[0].href).toBe("/semesters/17/planning?version=42")
  })
  it("does not direct the user to an outdated working draft", () => {
    expect(
      dashboardTasks(semester, {
        ...ready,
        current_version_is_stale: true,
        working_draft_id: 42,
        working_draft_is_stale: true,
      })[0].id,
    ).toBe("stale")
  })
  it("prioritizes hard conflicts before missing periods and soft warnings", () => {
    expect(
      dashboardTasks(semester, {
        ...ready,
        remaining: 3,
        current_version_hard_conflict_count: 2,
        current_version_soft_warning_count: 1,
      }).map((task) => task.id),
    ).toEqual(["conflicts", "remaining", "warnings"])
  })
  it("does not invent tasks for a complete current timetable", () => {
    expect(dashboardTasks(semester, ready)).toEqual([])
  })
})

describe("semester calendar context", () => {
  it("separates temporal phase from whether the semester is editable", () => {
    expect(semesterPhase(semester, "2026-09-23").value).toBe("upcoming")
    expect(semesterPhase(semester, "2027-02-22").value).toBe("teaching")
    expect(semesterPhase(semester, "2027-07-09").value).toBe("teaching")
    expect(semesterPhase(semester, "2027-07-10").value).toBe("ended")
  })
  it("uses the school's date even when the browser is on another calendar day", () => {
    const instant = new Date("2027-02-21T17:30:00Z")
    expect(schoolDate("Asia/Shanghai", instant)).toBe("2027-02-22")
    expect(schoolDate("America/Los_Angeles", instant)).toBe("2027-02-21")
  })
  it("counts calendar days across daylight-saving and month boundaries", () => {
    expect(calendarDaysBetween("2027-03-13", "2027-03-15")).toBe(2)
    expect(calendarDaysBetween("2026-09-23", "2027-02-22")).toBe(152)
  })
})
