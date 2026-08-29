import { describe, expect, it } from "vitest"
import { supportsConstraintKindCategory } from "@/lib/scheduling-constraint-support"

describe("supportsConstraintKindCategory", () => {
  it.each([
    ["hard", "availability"],
    ["hard", "daily_load"],
    ["hard", "consecutive_items"],
    ["hard", "synchronization"],
    ["soft", "preferred_slot"],
    ["soft", "course_distribution"],
    ["soft", "teacher_gaps"],
    ["soft", "workload_balance"],
    ["soft", "consecutive_items"],
    ["soft", "spacing"],
    ["soft", "course_priority"],
  ] as const)("allows %s %s rules implemented by both execution paths", (kind, category) => {
    expect(supportsConstraintKindCategory(kind, category)).toBe(true)
  })

  it.each([
    ["soft", "daily_load"],
    ["soft", "weekly_load"],
    ["hard", "mutual_exclusion"],
  ] as const)("blocks %s %s rules not implemented by both execution paths", (kind, category) => {
    expect(supportsConstraintKindCategory(kind, category)).toBe(false)
  })
})
