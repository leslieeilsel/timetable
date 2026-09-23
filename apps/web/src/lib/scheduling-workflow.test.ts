import { describe, expect, it } from "vitest"
import type { PreparationCheckItem } from "@/lib/types"
import { workflowStepState } from "@/lib/scheduling-workflow"

function check(key: string, status: PreparationCheckItem["status"]): PreparationCheckItem {
  return { key, status, label: key, issue_count: 0, message: "", fix_path: "", items: [] }
}

describe("workflowStepState", () => {
  it("keeps the preparation step blocked when any required input is blocked", () => {
    expect(
      workflowStepState(1, [
        check("schedule_template", "passed"),
        check("class_settings", "passed"),
        check("confirmed_assignments", "blocking"),
        check("assignment_resources", "passed"),
        check("theoretical_capacity", "passed"),
        check("fixed_placements", "passed"),
        check("constraint_integrity", "passed"),
        check("active_constraints", "passed"),
      ]),
    ).toBe("blocking")
  })

  it("marks preparation complete only when all preparation checks pass", () => {
    expect(
      workflowStepState(1, [
        check("schedule_template", "passed"),
        check("class_settings", "passed"),
        check("confirmed_assignments", "passed"),
        check("assignment_resources", "passed"),
        check("theoretical_capacity", "passed"),
        check("fixed_placements", "passed"),
        check("constraint_integrity", "passed"),
        check("active_constraints", "passed"),
      ]),
    ).toBe("complete")
  })

  it("shows preparation warnings without pretending the step is complete", () => {
    expect(
      workflowStepState(1, [
        check("schedule_template", "passed"),
        check("class_settings", "passed"),
        check("confirmed_assignments", "passed"),
        check("assignment_resources", "passed"),
        check("theoretical_capacity", "passed"),
        check("fixed_placements", "passed"),
        check("constraint_integrity", "passed"),
        check("active_constraints", "warning"),
      ]),
    ).toBe("warning")
  })

  it("treats a missing current timetable as pending instead of warning", () => {
    expect(workflowStepState(2, [check("current_version", "warning")])).toBe("pending")
  })

  it("shows a stale or missing current timetable as a warning in the adjustment step", () => {
    expect(workflowStepState(3, [check("current_version", "warning")])).toBe("warning")
    expect(workflowStepState(3, [check("current_version", "passed")])).toBe("complete")
  })
})
