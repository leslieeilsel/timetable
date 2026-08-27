import { describe, expect, it } from "vitest"
import type { PreparationCheckItem } from "@/lib/types"
import { workflowStepState } from "@/lib/scheduling-workflow"

function check(key: string, status: PreparationCheckItem["status"]): PreparationCheckItem {
  return { key, status, label: key, issue_count: 0, message: "", fix_path: "", items: [] }
}

describe("workflowStepState", () => {
  it("keeps the assignment step blocked when any assignment is waiting for confirmation", () => {
    expect(
      workflowStepState(2, [
        check("confirmed_assignments", "blocking"),
        check("assignment_resources", "passed"),
        check("theoretical_capacity", "passed"),
      ]),
    ).toBe("blocking")
  })

  it("marks a step complete only when all of its checks pass", () => {
    expect(
      workflowStepState(2, [
        check("confirmed_assignments", "passed"),
        check("assignment_resources", "passed"),
        check("theoretical_capacity", "passed"),
      ]),
    ).toBe("complete")
  })

  it("shows rule warnings without pretending the step is complete", () => {
    expect(
      workflowStepState(3, [
        check("fixed_placements", "passed"),
        check("active_constraints", "warning"),
      ]),
    ).toBe("warning")
  })

  it("treats a missing current timetable as pending instead of warning", () => {
    expect(workflowStepState(4, [check("current_version", "warning")])).toBe("pending")
  })
})
