import { useState } from "react"
import { useQueries } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { dateLabel, emptyDailyFilters, rowIdentity, weekDates } from "@/lib/daily-adjustments"
import type { DailyTimetable, DailyTimetableRow, Item, Semester } from "@/lib/types"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { SimpleSelect } from "@/components/simple-select"
import { ErrorState, LoadingState } from "@/components/page"
import { DailyGrid } from "./daily-grid"

export function AdjustmentComparison({
  semester,
  source,
  target,
  items,
}: {
  semester: Semester
  source: DailyTimetableRow
  target: DailyTimetableRow | null
  items: Item[]
}) {
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState(source.date)
  const [classId, setClassId] = useState(String(source.class_ids[0]))
  const classOptions = [
    ...new Map(
      [source, target]
        .filter((row): row is DailyTimetableRow => Boolean(row))
        .flatMap((row) =>
          row.class_ids.map(
            (id, index) => [String(id), row.class_names[index] ?? row.target_name] as const,
          ),
        ),
    ).entries(),
  ]
  const sourceWeek = weekDates(source.date, semester.start_date, semester.end_date)
  const targetWeek = target
    ? weekDates(target.date, semester.start_date, semester.end_date)
    : sourceWeek
  const dates = weekDates(anchor, semester.start_date, semester.end_date)
  const queries = useQueries({
    queries: dates.map((date) => ({
      queryKey: ["daily-timetable", semester.id, date],
      queryFn: () =>
        api<DailyTimetable>(`/api/v1/semesters/${semester.id}/daily-timetable?date=${date}`),
      enabled: open,
      staleTime: 15_000,
    })),
  })
  const days = queries.flatMap((query) => (query.data ? [query.data.data] : []))
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="shrink-0 text-xs font-normal text-muted-foreground"
        onClick={() => {
          setAnchor(source.date)
          setClassId(String(source.class_ids[0]))
          setOpen(true)
        }}
      >
        查看周课表
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[90svh] max-h-[900px] flex-col gap-3 sm:max-w-[min(1100px,95vw)]">
          <DialogHeader>
            <DialogTitle>周课表</DialogTitle>
            <DialogDescription>
              蓝色描边为原课，绿色描边为已选交换课程。这里显示调整前的实际安排。
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <SimpleSelect label="对照班级" value={classId} onValueChange={setClassId}>
              {classOptions.map(([id, name]) => (
                <option value={id} key={id}>
                  {name}
                </option>
              ))}
            </SimpleSelect>
            {sourceWeek[0] !== targetWeek[0] && (
              <SimpleSelect label="对照周次" value={anchor} onValueChange={setAnchor}>
                <option value={source.date}>原课所在周 · {dateLabel(source.date)}</option>
                <option value={target!.date}>目标所在周 · {dateLabel(target!.date)}</option>
              </SimpleSelect>
            )}
          </div>
          {queries.some((query) => query.isLoading) ? (
            <LoadingState />
          ) : queries.some((query) => query.isError) ? (
            <ErrorState retry={() => queries.forEach((query) => void query.refetch())} />
          ) : (
            <DailyGrid
              days={days.filter(
                (day) =>
                  day.weekday <= 5 ||
                  day.rows.some((row) => row.class_ids.includes(Number(classId))),
              )}
              rows={days
                .flatMap((day) => day.rows)
                .filter((row) => row.class_ids.includes(Number(classId)))}
              items={items}
              filters={emptyDailyFilters}
              selected={rowIdentity(source)}
              target={target ? rowIdentity(target) : undefined}
              objectKind="class"
              canEdit={false}
              readOnly
              onSelect={() => {}}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
