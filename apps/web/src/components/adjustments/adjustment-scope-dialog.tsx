import { useState } from "react"
import { useNavigate } from "react-router"
import type { DailyTimetableRow, Semester } from "@/lib/types"
import { dateLabel } from "@/lib/daily-adjustments"
import { semesterPath } from "@/lib/semester"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"

export function AdjustmentScopeDialog({
  semester,
  row,
  onClose,
  onSingle,
}: {
  semester: Semester
  row: DailyTimetableRow | null
  onClose: () => void
  onSingle?: (row: DailyTimetableRow) => void
}) {
  const navigate = useNavigate()
  const [scope, setScope] = useState("once")
  const proceed = () => {
    if (!row) return
    const query = new URLSearchParams({
      date: row.date,
      object: "class",
      resource: String(row.class_ids[0] ?? ""),
      entry: String(row.original_entry_id),
      step: "source",
    })
    onClose()
    if (scope === "once") {
      if (onSingle) onSingle(row)
      else void navigate(`${semesterPath(semester.id, "adjustments")}?${query}`)
    } else {
      query.set("scope", scope)
      void navigate(`${semesterPath(semester.id, "long-term")}?${query}`)
    }
  }
  return (
    <Dialog
      open={Boolean(row)}
      onOpenChange={(open) => {
        if (!open) onClose()
        else setScope("once")
      }}
    >
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>发起调课</DialogTitle>
          <DialogDescription>
            {row &&
              `${row.target_name} · ${row.course_name} · ${row.teacher_names.join("、")} · ${dateLabel(row.date)} ${row.item_name}`}
          </DialogDescription>
        </DialogHeader>
        <fieldset className="grid gap-2 py-2">
          <legend className="mb-3 text-sm font-medium">生效范围</legend>
          {(
            [
              ["once", "仅这一次", "只调整选中日期的这节课"],
              ["range", "指定日期范围", "在起止日期之间，每周按新安排上课"],
              ["ongoing", "从这天起持续生效", "每周按新安排上课，直到学期结束"],
            ] as const
          ).map(([value, title, description]) => (
            <label
              key={value}
              className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-checked:border-foreground/40 has-checked:bg-muted/40"
            >
              <input
                type="radio"
                name="adjustment-scope"
                className="mt-1 accent-foreground"
                value={value}
                checked={scope === value}
                onChange={() => setScope(value)}
              />
              <span>
                <span className="block text-sm font-medium">{title}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{description}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={proceed}>下一步</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
