import type { PreparationCheckItem } from "@/lib/types"

export type WorkflowStepState = "complete" | "warning" | "blocking" | "pending"

const stepCheckKeys: Record<number, readonly string[]> = {
  1: ["schedule_template", "class_settings"],
  2: ["confirmed_assignments", "assignment_resources", "theoretical_capacity"],
  3: ["fixed_placements", "active_constraints"],
  4: ["current_version"],
}

export function workflowStepState(
  stepNumber: number,
  checks: PreparationCheckItem[] | undefined,
): WorkflowStepState {
  const keys = stepCheckKeys[stepNumber]
  if (!keys || !checks) return "pending"

  const related = keys.map((key) => checks.find((check) => check.key === key))
  if (related.some((check) => !check)) return "pending"
  if (related.some((check) => check?.status === "blocking")) return "blocking"

  // 没有当前课表是生成前的正常状态，不应提前显示成警告。
  if (stepNumber === 4) {
    return related.every((check) => check?.status === "passed") ? "complete" : "pending"
  }

  if (related.some((check) => check?.status === "warning")) return "warning"
  return "complete"
}
