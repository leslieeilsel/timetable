import type { ConstraintKind } from "@/lib/types"

const supportedCategories: Record<ConstraintKind, readonly string[]> = {
  hard: [
    "availability",
    "forbidden_slot",
    "daily_load",
    "weekly_load",
    "consecutive_items",
    "synchronization",
    "workload_balance",
  ],
  soft: [
    "preferred_slot",
    "course_distribution",
    "spacing",
    "workload_balance",
    "consecutive_items",
    "teacher_gaps",
    "course_priority",
  ],
}

export const unsupportedConstraintReason = "当前排课求解器和手工诊断暂不支持此规则组合"

export function supportsConstraintKindCategory(kind: ConstraintKind, category: string) {
  return supportedCategories[kind].includes(category)
}
