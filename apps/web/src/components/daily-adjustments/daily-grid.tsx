import { CalendarDays, Plus } from "lucide-react"
import type { DailyTimetable, DailyTimetableRow, Item } from "@/lib/types"
import {
  dailyStatusLabels,
  dateLabel,
  filterCount,
  matchesDailyFilters,
  rowIdentity,
  shortTime,
  type DailyFilters,
  type ObjectKind,
} from "@/lib/daily-adjustments"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

export function DailyGrid({
  days,
  rows,
  items,
  filters,
  selected,
  target,
  onSelect,
  onEmpty,
  canEdit,
  objectKind,
  readOnly = false,
}: {
  days: DailyTimetable[]
  rows: DailyTimetableRow[]
  items: Item[]
  filters: DailyFilters
  selected?: string
  target?: string
  onSelect: (row: DailyTimetableRow) => void
  onEmpty: (date: string, item: Item) => void
  canEdit: boolean
  objectKind: ObjectKind
  readOnly?: boolean
}) {
  const periods = items
    .filter((item) => item.is_active && item.allows_course)
    .sort((a, b) => a.sort_order - b.sort_order)
  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-card">
      <table
        className="h-full w-full table-fixed border-collapse text-left"
        style={{ minWidth: days.length > 1 ? days.length * 138 + 72 : 0 }}
      >
        <caption className="sr-only">
          {readOnly
            ? "调整前的实际课表，仅供对照。"
            : "按具体日期生效的实际课表。选择一节原课开始调整。"}
        </caption>
        <thead className="sticky top-0 z-10 bg-card">
          <tr>
            <th className="sticky left-0 z-20 w-[72px] border-r bg-card px-2 py-2 text-xs font-normal text-muted-foreground">
              课节
            </th>
            {days.map((day) => (
              <th key={day.date} scope="col" className="border-r px-3 py-2.5 last:border-r-0">
                <div className="text-sm font-medium">{dateLabel(day.date)}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {periods.map((item) => (
            <tr key={item.id}>
              <th
                scope="row"
                className="sticky left-0 z-1 border-t border-r bg-card px-2 py-2 align-middle"
              >
                <div className="text-xs font-medium">{item.name}</div>
                <div className="mt-1 text-[11px] font-normal text-muted-foreground">
                  {shortTime(item.start_time)}
                  <br />
                  {shortTime(item.end_time)}
                </div>
              </th>
              {days.map((day) => {
                const actual = rows.filter(
                  (row) => row.date === day.date && row.item_id === item.id,
                )
                const visible = actual.filter((row) => matchesDailyFilters(row, filters))
                return (
                  <td
                    key={day.date}
                    className="border-t border-r p-1.5 align-middle last:border-r-0"
                  >
                    <div className="space-y-1">
                      {visible.map((row) => (
                        <LessonCard
                          key={rowIdentity(row)}
                          row={row}
                          selected={selected === rowIdentity(row)}
                          target={target === rowIdentity(row)}
                          onClick={() => onSelect(row)}
                          objectKind={objectKind}
                          disabled={
                            readOnly ||
                            !canEdit ||
                            Boolean(
                              row.exception_id ||
                              row.substitution_id ||
                              row.is_cancelled ||
                              !row.original_entry_id,
                            )
                          }
                        />
                      ))}
                      {!visible.length &&
                        (actual.length ? (
                          <div className="px-2 py-5 text-center text-[11px] text-muted-foreground">
                            {actual.length} 节被筛选隐藏
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={readOnly || !canEdit || filterCount(filters) > 0}
                            onClick={() => onEmpty(day.date, item)}
                            className="group flex min-h-12 w-full items-center justify-center rounded text-xs text-muted-foreground/50 hover:enabled:bg-muted hover:enabled:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                            aria-label={`${dateLabel(day.date)} ${item.name} 空课节${canEdit && !readOnly ? "，安排补课" : ""}`}
                          >
                            <span
                              className={
                                canEdit && !readOnly
                                  ? "group-hover:hidden group-focus-visible:hidden"
                                  : undefined
                              }
                            >
                              —
                            </span>
                            {canEdit && !readOnly && (
                              <Plus
                                aria-hidden="true"
                                className="hidden size-4 group-hover:block group-focus-visible:block"
                              />
                            )}
                          </button>
                        ))}
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {!periods.length && (
        <div className="flex items-center justify-center gap-2 p-12 text-muted-foreground">
          <CalendarDays className="size-5" />
          当前作息中没有可排课节
        </div>
      )}
    </div>
  )
}
function LessonCard({
  row,
  selected,
  target,
  onClick,
  objectKind,
  disabled,
}: {
  row: DailyTimetableRow
  selected: boolean
  target: boolean
  onClick: () => void
  objectKind: ObjectKind
  disabled: boolean
}) {
  const temporary = row.status !== "base"
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      aria-label={`${dateLabel(row.date)} ${row.item_name} ${row.course_name} ${row.target_name} ${row.teacher_names.join("、")} ${dailyStatusLabels[row.status]}`}
      className={cn(
        "block w-full rounded-md border border-transparent px-2 py-1.5 text-left transition-colors hover:enabled:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        temporary &&
          "border-[var(--timetable-amber-border)] bg-[var(--timetable-amber-background)]",
        row.is_cancelled && "border-dashed bg-muted/30",
        selected &&
          "border-[var(--timetable-blue-border)] bg-[var(--timetable-blue-background)] ring-1 ring-[var(--timetable-blue-border)]",
        target &&
          "border-[var(--timetable-success-border)] bg-[var(--timetable-success-background)] ring-2 ring-[var(--timetable-success-accent)]",
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <strong
          className={cn(
            "text-sm font-medium",
            row.is_cancelled && "text-muted-foreground line-through",
          )}
        >
          {row.course_name}
        </strong>
        {temporary && (
          <span className="rounded border bg-background/80 px-1 text-[10px]">
            {dailyStatusLabels[row.status]}
          </span>
        )}
      </div>
      {objectKind !== "class" && (
        <div className="mt-0.5 truncate text-xs" title={row.target_name}>
          {row.target_name}
        </div>
      )}
      {(objectKind !== "teacher" || row.teacher_names.length > 1) && (
        <div
          className="mt-0.5 truncate text-xs text-muted-foreground"
          title={row.teacher_names.join("、")}
        >
          {row.teacher_names.join("、")}
        </div>
      )}
      {objectKind !== "room" && (
        <div className="mt-0.5 truncate text-xs text-muted-foreground" title={row.room_name}>
          {row.room_name}
        </div>
      )}
      {row.title && <div className="mt-1 text-xs">{row.title}</div>}
    </button>
  )
}
export function NoFilterResults({ count, onReset }: { count: number; onReset: () => void }) {
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 p-4"
      role="status"
    >
      <div>
        <p className="font-medium">没有同时满足这些条件的课程</p>
        <p className="mt-1 text-sm text-muted-foreground">
          当前对象原有 {count} 节课，移除上方条件即可重新显示。
        </p>
      </div>
      <Button variant="outline" onClick={onReset}>
        清空条件，查看 {count} 节课
      </Button>
    </div>
  )
}
