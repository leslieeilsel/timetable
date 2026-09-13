import type { WeeklyChange } from "@/lib/long-term-changes"
import { arrangement } from "@/lib/long-term-changes"
import { AdjustmentComparisonItem } from "@/components/adjustments/workbench"

export function WeeklyComparison({ changes }: { changes: WeeklyChange[] }) {
  return (
    <div className="space-y-3" aria-label="调整前后对照">
      {changes.map(({ before, after }, index) => (
        <AdjustmentComparisonItem
          key={`${before.entry_key}:${before.effective_from}:${index}`}
          title={`${before.course_name} · ${before.target_name}`}
          date={`${after.effective_from} 至 ${after.effective_to}`}
          before={arrangement(before)}
          after={arrangement(after)}
        />
      ))}
    </div>
  )
}
