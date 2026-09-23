import { Link } from "react-router"
import { useQuery } from "@tanstack/react-query"
import {
  ArrowRightIcon,
  CalendarCheck2Icon,
  CalendarDaysIcon,
  FileClockIcon,
  UsersIcon,
} from "lucide-react"
import { api, apiMessage, type ApiResult } from "@/lib/api"
import { semesterPath } from "@/lib/semester"
import { adjustmentLabels } from "@/lib/daily-adjustments"
import type { LongTermRecord } from "@/lib/long-term-changes"
import type {
  CalendarException,
  DailyTimetable,
  DashboardSummary,
  Semester,
  TeacherLeave,
} from "@/lib/types"
import { Button } from "@/components/ui/button"

export function DashboardDaily({
  semester,
  summary,
  today,
  onOpenPlanning,
}: {
  semester: Semester
  summary: DashboardSummary
  today: string
  onOpenPlanning: () => void
}) {
  const path = (destination: Parameters<typeof semesterPath>[1]) =>
    semesterPath(semester.id, destination)
  const daily = useQuery({
    queryKey: ["daily-timetable", semester.id, "dashboard", today],
    queryFn: () =>
      api<DailyTimetable>(`/api/v1/semesters/${semester.id}/daily-timetable?date=${today}`),
    retry: false,
  })
  const leaves = useQuery({
    queryKey: ["teacher-leaves", semester.id, "dashboard", today],
    queryFn: () =>
      api<TeacherLeave[]>(
        `/api/v1/semesters/${semester.id}/teacher-leaves?status=active&date_from=${today}&date_to=${today}&per_page=20`,
      ),
  })
  const adjustments = useQuery({
    queryKey: ["calendar-exceptions", semester.id, "dashboard", today],
    queryFn: () =>
      api<CalendarException[]>(
        `/api/v1/semesters/${semester.id}/calendar-exceptions?status=active&date_from=${today}&date_to=${today}&per_page=20`,
      ),
  })
  const changes = useQuery({
    queryKey: ["long-term-changes", semester.id, "dashboard", "upcoming", today],
    queryFn: () =>
      api<LongTermRecord[]>(`/api/v1/semesters/${semester.id}/long-term-changes?status=upcoming`),
  })
  const needsReview = summary.current_version_is_stale || !summary.current_version_id
  const data = daily.data?.data
  const leavesHref = `${path("leaves")}?status=active&from=${today}&to=${today}`
  const dailyHref = `${path("adjustments")}?step=source&date=${today}`
  const recordsHref = `${path("adjustments")}?date=${today}`
  return (
    <div className="space-y-8">
      <section
        className="grid overflow-hidden rounded-xl border bg-muted/20 lg:grid-cols-[1.25fr_1fr]"
        aria-label="今日教务概览"
      >
        <div className="p-6 md:p-7">
          <CalendarCheck2Icon className="mb-5 size-6 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-xl font-semibold md:text-2xl">掌握今天的教学安排</h2>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">
            查看今日请假和课程变更，核对代课安排与实际执行课表。
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button
              nativeButton={false}
              render={<Link to={leaves.data && total(leaves.data) > 0 ? leavesHref : dailyHref} />}
            >
              {leaves.data && total(leaves.data) > 0 ? "核对今日请假与代课" : "发起临时调课"}
              <ArrowRightIcon />
            </Button>
            <Button variant="ghost" nativeButton={false} render={<Link to={path("long-term")} />}>
              长期调课
            </Button>
          </div>
        </div>
        <div className="border-t bg-background p-6 md:p-7 lg:border-t-0 lg:border-l">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium text-muted-foreground">今天执行的课表</h3>
            <time className="text-xs text-muted-foreground" dateTime={today}>
              {today}
            </time>
          </div>
          {daily.isLoading ? (
            <p className="mt-5 text-sm text-muted-foreground" role="status">
              正在读取当天安排…
            </p>
          ) : daily.isError ? (
            <div className="mt-4">
              <p className="text-sm font-medium">当天课表暂不可用</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {apiMessage(daily.error)}
              </p>
              <Button
                className="mt-3"
                variant="outline"
                size="sm"
                onClick={() => void daily.refetch()}
              >
                重新读取
              </Button>
            </div>
          ) : (
            data && (
              <>
                <p className="mt-3 break-words text-lg font-semibold">{data.version.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  第 {data.week_number} 教学周 · 已合并当天调课与代课
                </p>
                <dl className="mt-5 grid grid-cols-3 gap-3 text-sm">
                  <DailyNumber label="代课" value={data.summary.substitutions} />
                  <DailyNumber label="临时变更" value={data.summary.temporary} />
                  <DailyNumber label="停课" value={data.summary.cancelled} />
                </dl>
              </>
            )
          )}
        </div>
      </section>
      {needsReview && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-[var(--timetable-notice-background)] px-4 py-3 text-sm text-[var(--timetable-notice-foreground)]">
          <FileClockIcon className="size-4 shrink-0" aria-hidden="true" />
          <p className="min-w-0 flex-1">
            {summary.current_version_is_stale
              ? "当前选定课表的资料已变化，需要重新复核编排。"
              : "本学期尚未设置当前课表，请先完成编排。"}
          </p>
          <Button variant="ghost" size="sm" onClick={onOpenPlanning}>
            检查学期编排
            <ArrowRightIcon />
          </Button>
        </div>
      )}
      <div className="grid gap-8 lg:grid-cols-[1.25fr_1fr] lg:gap-12">
        <section>
          <div className="mb-1 flex items-center justify-between border-b pb-4">
            <h2 className="text-base font-semibold">今日请假与变更</h2>
            <span className="text-xs text-muted-foreground">按实际日期查看</span>
          </div>
          <DailyList
            title="今日请假"
            count={leaves.data ? total(leaves.data) : undefined}
            loading={leaves.isLoading}
            error={leaves.isError}
            retry={() => void leaves.refetch()}
            href={leavesHref}
            icon={UsersIcon}
          >
            {leaves.data?.data.slice(0, 3).map((leave) => (
              <li key={leave.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
                <span>{leave.teacher.name}</span>
                <span className="text-xs text-muted-foreground">
                  已安排 {leave.substitutions_count ?? 0} 节代课
                </span>
              </li>
            ))}
          </DailyList>
          <DailyList
            title="今日临时调课"
            count={adjustments.data ? total(adjustments.data) : undefined}
            loading={adjustments.isLoading}
            error={adjustments.isError}
            retry={() => void adjustments.refetch()}
            href={recordsHref}
            icon={CalendarDaysIcon}
          >
            {adjustments.data?.data.slice(0, 3).map((item) => (
              <li key={item.id} className="py-2 text-sm">
                <span>
                  {item.original_entry?.school_class?.name ??
                    item.original_entry?.teaching_group?.name ??
                    item.title ??
                    "课程安排"}{" "}
                  · {adjustmentLabels[item.type]}
                </span>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.reason}</p>
              </li>
            ))}
          </DailyList>
        </section>
        <section>
          <div className="flex items-center justify-between border-b pb-4">
            <h2 className="text-base font-semibold">即将生效的长期调整</h2>
            {changes.data && (
              <span className="text-xs text-muted-foreground">{total(changes.data)} 条</span>
            )}
          </div>
          {changes.isLoading ? (
            <p className="py-5 text-sm text-muted-foreground" role="status">
              正在载入调整记录…
            </p>
          ) : changes.isError ? (
            <Button variant="ghost" className="mt-3" onClick={() => void changes.refetch()}>
              载入失败，点击重试
            </Button>
          ) : changes.data?.data.length ? (
            <ul className="divide-y">
              {changes.data.data.slice(0, 4).map((change) => (
                <li key={change.id} className="py-4">
                  <p className="text-sm font-medium">{change.effective_from} 起生效</p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">{change.reason}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {change.creator.name} · 至 {change.effective_to}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-6 text-sm text-muted-foreground">暂无即将生效的长期调整</p>
          )}
          <Link
            to={path("long-term")}
            className="mt-2 inline-flex items-center gap-2 rounded text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            查看调整记录
            <ArrowRightIcon className="size-3.5" />
          </Link>
        </section>
      </div>
    </div>
  )
}
function total(data: ApiResult<unknown[]>) {
  const pagination = data.meta?.pagination as { total?: number } | undefined
  return pagination?.total ?? data.data.length
}
function DailyNumber({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-medium tabular-nums">{value} 节</dd>
    </div>
  )
}
function DailyList({
  title,
  count,
  loading,
  error,
  retry,
  href,
  icon: Icon,
  children,
}: {
  title: string
  count?: number
  loading: boolean
  error: boolean
  retry: () => void
  href: string
  icon: typeof UsersIcon
  children: React.ReactNode
}) {
  return (
    <div className="border-b py-4">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
        <h3 className="flex-1 text-sm font-medium">
          {title}
          {count !== undefined && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">{count} 条</span>
          )}
        </h3>
        <Link
          to={href}
          className="rounded text-xs underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          查看
          <ArrowRightIcon className="ml-1 inline size-3" />
        </Link>
      </div>
      {loading ? (
        <p className="mt-3 text-xs text-muted-foreground" role="status">
          正在载入…
        </p>
      ) : error ? (
        <Button variant="ghost" size="sm" className="mt-2" onClick={retry}>
          载入失败，点击重试
        </Button>
      ) : count === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">暂无记录</p>
      ) : (
        <ul className="mt-3">{children}</ul>
      )}
    </div>
  )
}
