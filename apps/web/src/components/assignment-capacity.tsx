import { useState } from "react"
import { AlertCircleIcon, CheckCircle2Icon, Loader2Icon } from "lucide-react"
import { cn } from "@/lib/utils"
import { TeachingWeekPicker } from "@/components/teaching-week-picker"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

interface CapacityCourse {
  assignment_id: number | null
  course_name: string
  target_name: string
  weekly_items: number
  active_weeks: number[]
  is_current: boolean
}

interface CapacityResource {
  key: string
  type: "class" | "teacher" | "room"
  name: string
  weeks: { week: number; required: number; excess: number }[]
  courses: CapacityCourse[]
}

export interface CapacityPreview {
  capacity: number
  week_count: number
  active_weeks: number[]
  overloaded_weeks: number[]
  recommended_week: number
  resources: CapacityResource[]
}

export interface CapacityCheck {
  data?: CapacityPreview
  error?: string
  checking: boolean
}

export function AssignmentCapacityPanel({ preview }: { preview: CapacityCheck }) {
  const [chosenWeek, setChosenWeek] = useState<number | null>(null)
  const [chosenResource, setChosenResource] = useState<string | null>(null)
  const { data, error, checking } = preview
  const week = data
    ? chosenWeek !== null && chosenWeek <= data.week_count
      ? chosenWeek
      : data.recommended_week
    : 1
  const rows = data?.resources.map((resource) => ({
    ...resource,
    load: resource.weeks.find((item) => item.week === week)!,
  }))
  const selected =
    rows?.find((resource) => resource.key === chosenResource) ??
    rows?.find((resource) => resource.load.excess > 0) ??
    rows?.[0]
  const courses = selected?.courses.filter((course) => course.active_weeks.includes(week)) ?? []
  const overloadedResources = rows?.filter((resource) => resource.load.excess > 0) ?? []
  const mostOverloadedResource = overloadedResources.reduce<
    (typeof overloadedResources)[number] | undefined
  >(
    (largest, resource) =>
      !largest || resource.load.excess > largest.load.excess ? resource : largest,
    undefined,
  )
  const otherOverloadedWeeks = data?.overloaded_weeks.filter((item) => item !== week) ?? []

  return (
    <section
      aria-label="课时检查"
      aria-busy={checking}
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-3"
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          <Tooltip>
            <TooltipTrigger
              aria-label="课时检查，查看计算口径"
              className="cursor-help rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
            >
              课时检查
            </TooltipTrigger>
            <TooltipContent className="max-w-64 leading-relaxed">
              按作息表及已确认任课计算，包含本次填写。
            </TooltipContent>
          </Tooltip>
        </h3>
        {data && (
          <TeachingWeekPicker
            value={week}
            weekCount={data.week_count}
            overloadedWeeks={data.overloaded_weeks}
            onValueChange={setChosenWeek}
          />
        )}
      </div>
      {checking && (
        <div
          className="flex min-h-20 items-center gap-2 rounded-lg border bg-muted/20 px-3 text-xs text-muted-foreground"
          role="status"
        >
          <Loader2Icon className="size-3.5 animate-spin motion-reduce:animate-none" />
          正在检查课时…
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {data && rows && selected && (
        <>
          <div className="shrink-0 overflow-hidden rounded-lg border">
            <table className="w-full shrink-0 table-fixed text-xs sm:text-sm">
              <caption className="sr-only">
                第 {week} 教学周的需排节数与作息表上限，选择检查对象可查看课时组成
              </caption>
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="w-[37%] px-3 py-2 text-left font-normal">
                    检查对象
                  </th>
                  <th scope="col" className="px-1 py-2 text-right font-normal">
                    需排节数
                  </th>
                  <th scope="col" className="px-1 py-2 text-right font-normal">
                    最多可排
                  </th>
                  <th scope="col" className="w-[25%] px-2 py-2 text-right font-normal sm:px-3">
                    状态
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((resource) => (
                  <tr
                    key={resource.key}
                    className={cn("border-t", resource.load.excess > 0 && "bg-destructive/5")}
                  >
                    <th scope="row" className="px-3 py-2.5 text-left font-medium">
                      <button
                        type="button"
                        aria-pressed={selected.key === resource.key}
                        aria-label={`查看${resource.name}的课时组成`}
                        onClick={() => setChosenResource(resource.key)}
                        className="rounded-sm text-left underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        {resource.name}
                      </button>
                    </th>
                    <td
                      className={cn(
                        "px-1 py-2.5 text-right tabular-nums",
                        resource.load.excess > 0 && "font-semibold text-destructive",
                      )}
                    >
                      {resource.load.required} 节
                    </td>
                    <td className="px-1 py-2.5 text-right tabular-nums text-muted-foreground">
                      {data.capacity} 节
                    </td>
                    <td className="px-2 py-2.5 text-right sm:px-3">
                      <span
                        className={cn(
                          "inline-flex items-center justify-end gap-1 whitespace-nowrap text-xs",
                          resource.load.excess > 0
                            ? "text-destructive"
                            : "text-emerald-700 dark:text-emerald-400",
                        )}
                      >
                        {resource.load.excess > 0 ? (
                          <AlertCircleIcon
                            aria-hidden="true"
                            className="hidden size-3.5 sm:block"
                          />
                        ) : (
                          <CheckCircle2Icon
                            aria-hidden="true"
                            className="hidden size-3.5 sm:block"
                          />
                        )}
                        {resource.load.excess > 0 ? `超出 ${resource.load.excess} 节` : "正常"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            <h4 className="shrink-0 text-xs font-medium">{selected.name} · 课时组成</h4>
            <div
              tabIndex={0}
              role="region"
              aria-label={`${selected.name}的课时组成，可滚动查看`}
              className="mt-3 min-h-0 max-h-44 overflow-y-auto overscroll-contain rounded-md border bg-background focus-visible:outline-2 focus-visible:outline-ring lg:max-h-[clamp(4rem,calc(90dvh-28rem),11rem)]"
            >
              <table className="w-full border-separate border-spacing-0 text-xs">
                <caption className="sr-only">
                  {selected.name}第 {week} 教学周的课程明细
                </caption>
                <thead className="sticky top-0 z-10 bg-muted text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left font-normal">
                      课程
                    </th>
                    {selected.type !== "class" && (
                      <th scope="col" className="px-3 py-2 text-left font-normal">
                        授课对象
                      </th>
                    )}
                    <th scope="col" className="px-3 py-2 text-right font-normal whitespace-nowrap">
                      节数
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {courses.map((course, index) => (
                    <tr
                      key={course.assignment_id ?? `current-${index}`}
                      className={cn(
                        "[&>td]:border-t [&>th]:border-t",
                        course.is_current && "bg-muted/60",
                      )}
                    >
                      <th scope="row" className="px-3 py-2 text-left font-normal">
                        {course.course_name}
                        {course.is_current && <span className="sr-only">（本次填写）</span>}
                      </th>
                      {selected.type !== "class" && (
                        <td className="px-3 py-2 text-muted-foreground">{course.target_name}</td>
                      )}
                      <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                        {course.weekly_items} 节
                      </td>
                    </tr>
                  ))}
                  {!courses.length && (
                    <tr className="[&>td]:border-t">
                      <td
                        colSpan={selected.type === "class" ? 2 : 3}
                        className="px-3 py-4 text-center text-muted-foreground"
                      >
                        这一周没有需要安排的课程。
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot className="sticky bottom-0 z-10 bg-muted [&_td]:border-t [&_th]:border-t">
                  <tr>
                    <th
                      scope="row"
                      colSpan={selected.type === "class" ? 1 : 2}
                      className="px-3 py-2 text-left font-medium"
                    >
                      合计
                    </th>
                    <td
                      className={cn(
                        "px-3 py-2 text-right font-medium whitespace-nowrap tabular-nums",
                        selected.load.excess > 0 && "text-destructive",
                      )}
                    >
                      {selected.load.required} 节
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
          {(data.capacity === 0 ||
            !data.active_weeks.length ||
            data.overloaded_weeks.length > 0) && (
            <p className="shrink-0 text-xs leading-relaxed text-destructive" role="status">
              {data.capacity === 0 ? (
                "请先在作息表中设置可以上课的日期和课节。"
              ) : !data.active_weeks.length ? (
                "所选周次不在本学期内，请调整上课周次。"
              ) : (
                <>
                  {mostOverloadedResource && (
                    <button
                      type="button"
                      aria-label={`查看${mostOverloadedResource.name}的超限明细`}
                      className="rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
                      onClick={() => setChosenResource(mostOverloadedResource.key)}
                    >
                      {overloadedResources.length > 1
                        ? `本周 ${overloadedResources.length} 项超限，最多超出`
                        : "本周超出"}{" "}
                      {mostOverloadedResource.load.excess} 节
                    </button>
                  )}
                  {mostOverloadedResource && otherOverloadedWeeks.length > 0 && "，"}
                  {otherOverloadedWeeks.length > 0 && (
                    <button
                      type="button"
                      aria-label={`查看第 ${otherOverloadedWeeks[0]} 教学周的超限情况`}
                      className="rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
                      onClick={() => {
                        setChosenWeek(otherOverloadedWeeks[0])
                        setChosenResource(null)
                      }}
                    >
                      {mostOverloadedResource ? "另有" : "有"} {otherOverloadedWeeks.length} 周超限
                    </button>
                  )}
                </>
              )}
            </p>
          )}
        </>
      )}
    </section>
  )
}
