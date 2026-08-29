import { LockIcon, PlusIcon } from "lucide-react"
import type { Item, ScheduleDay, TimetableEntry } from "@/lib/types"
import { Badge } from "@/components/ui/badge"

export type TimetableView = "class" | "teacher" | "room"

export interface TimetableGridData {
  view: TimetableView
  days: ScheduleDay[]
  items: Item[]
  entries: TimetableEntry[]
}

export const weekdayName = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"]

export function TimetableGrid({
  data,
  editable = false,
  pendingCount = 0,
  onSlot,
}: {
  data: TimetableGridData
  editable?: boolean
  pendingCount?: number
  onSlot?: (slot: { weekday: number; itemId: number; entry?: TimetableEntry }) => void
}) {
  return (
    <div className="overflow-auto rounded-xl border bg-background">
      <table className="w-full min-w-[920px] border-collapse text-sm">
        <thead>
          <tr className="bg-muted/50">
            <th
              scope="col"
              className="sticky left-0 z-10 w-32 border-r border-b bg-muted/80 p-3 text-center font-medium"
            >
              课节
            </th>
            {data.days.map((day) => (
              <th
                key={day.weekday}
                scope="col"
                className="min-w-40 border-b p-3 text-center font-medium"
              >
                {weekdayName[day.weekday]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.items.map((item) => (
            <tr key={item.id}>
              <th
                scope="row"
                className="sticky left-0 z-10 border-r border-b bg-background p-3 text-center align-middle"
              >
                <p className="font-medium">{item.name}</p>
                <p className="mt-1 text-xs font-normal text-muted-foreground">
                  {item.start_time.slice(0, 5)}–{item.end_time.slice(0, 5)}
                </p>
              </th>
              {data.days.map((day) => {
                const entries = data.entries.filter(
                  (entry) => entry.weekday === day.weekday && entry.item_id === item.id,
                )
                return (
                  <td
                    key={day.weekday}
                    className="h-24 border-r border-b p-1.5 align-top last:border-r-0"
                  >
                    {entries.length > 0 ? (
                      <div className="grid h-full gap-1.5">
                        {entries.map((entry) => {
                          const content = (
                            <>
                              <div className="flex items-start justify-between gap-1">
                                <span className="font-medium">{entry.course.name}</span>
                                <span className="flex shrink-0 items-center gap-1">
                                  {entry.week_pattern !== "all" && (
                                    <Badge
                                      variant="outline"
                                      className="h-4 border-current/20 bg-white/55 px-1 text-[10px] dark:bg-background/45"
                                    >
                                      {weekPatternName(entry)}
                                    </Badge>
                                  )}
                                  {entry.is_locked && (
                                    <LockIcon className="size-3 text-muted-foreground" />
                                  )}
                                </span>
                              </div>
                              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                {entrySecondary(entry, data.view)}
                              </p>
                            </>
                          )
                          const className = `min-h-10 w-full rounded-lg border p-2 text-left ${courseTone(entry.course.name)}`
                          return onSlot ? (
                            <button
                              key={entry.id}
                              type="button"
                              className={`${className} transition hover:border-primary/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30`}
                              onClick={() =>
                                onSlot({ weekday: day.weekday, itemId: item.id, entry })
                              }
                            >
                              {content}
                            </button>
                          ) : (
                            <div key={entry.id} className={className}>
                              {content}
                            </div>
                          )
                        })}
                      </div>
                    ) : editable && item.allows_course && pendingCount > 0 && onSlot ? (
                      <button
                        type="button"
                        aria-label={`${weekdayName[day.weekday]}${item.name}安排待排课程`}
                        className="group flex h-full min-h-20 w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-[var(--timetable-notice-border)] bg-[var(--timetable-notice-background)] text-[var(--timetable-notice-foreground)] transition-colors hover:bg-[var(--timetable-notice-background-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--timetable-notice-border)]/40"
                        onClick={() => onSlot({ weekday: day.weekday, itemId: item.id })}
                      >
                        <PlusIcon className="size-4" />
                        <span className="text-xs font-medium">可安排</span>
                      </button>
                    ) : null}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function weekPatternName(entry: TimetableEntry) {
  if (entry.week_pattern === "a") return "单周"
  if (entry.week_pattern === "b") return "双周"
  if (entry.week_pattern === "specified") {
    const weeks = entry.active_weeks ?? []
    return weeks.length > 3 ? `${weeks.slice(0, 3).join("/")}…周` : `${weeks.join("/")}周`
  }
  return "每周"
}

export function entryTargetName(entry: TimetableEntry) {
  return entry.school_class?.name ?? entry.teaching_group?.name ?? "未设置授课对象"
}

function entrySecondary(entry: TimetableEntry, view: TimetableView) {
  const teachers = entry.teachers?.length
    ? entry.teachers.map((teacher) => teacher.name).join("、")
    : entry.teacher.name
  if (view === "teacher") return `${entryTargetName(entry)} · ${entry.actual_room.name}`
  if (view === "room") return `${entryTargetName(entry)} · ${teachers}`
  return `${teachers} · ${entry.actual_room.name}`
}

function courseTone(course: string) {
  const tones = [
    "border-[var(--timetable-blue-border)] bg-[var(--timetable-blue-background)]",
    "border-[var(--timetable-green-border)] bg-[var(--timetable-green-background)]",
    "border-[var(--timetable-amber-border)] bg-[var(--timetable-amber-background)]",
    "border-[var(--timetable-violet-border)] bg-[var(--timetable-violet-background)]",
    "border-[var(--timetable-rose-border)] bg-[var(--timetable-rose-background)]",
    "border-[var(--timetable-cyan-border)] bg-[var(--timetable-cyan-background)]",
  ]
  const index = Array.from(course).reduce((sum, character) => sum + character.charCodeAt(0), 0)
  return tones[index % tones.length]
}
