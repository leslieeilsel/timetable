import { useState } from "react"
import { Link } from "react-router"
import { useQuery } from "@tanstack/react-query"
import {
  ArrowRightIcon,
  CalendarDaysIcon,
  CheckCircle2Icon,
  CheckIcon,
  ChevronDownIcon,
  CircleIcon,
  ClipboardListIcon,
  FileClockIcon,
  ListChecksIcon,
  SlidersHorizontalIcon,
} from "lucide-react"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { dashboardTasks, type DashboardTask } from "@/lib/dashboard"
import { calendarDaysBetween, semesterPhase, useSchoolToday } from "@/lib/semester-phase"
import type { DashboardSummary, Semester } from "@/lib/types"
import { semesterPath, useResolvedSemesterId } from "@/lib/semester"
import { ErrorState, LoadingState } from "@/components/page"
import { DashboardDaily } from "@/components/dashboard-daily"
import { SemesterSwitcher } from "@/components/semester-switcher"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

export function DashboardPage() {
  const { semesterId, context } = useResolvedSemesterId()
  const today = useSchoolToday(context.data?.timezone)
  const semester = useQuery({
    queryKey: ["semester", semesterId],
    queryFn: () => api<Semester>(`/api/v1/semesters/${semesterId}`),
    enabled: semesterId !== null,
  })
  const summary = useQuery({
    queryKey: ["dashboard-summary", semesterId],
    queryFn: () => api<DashboardSummary>(`/api/v1/semesters/${semesterId}/dashboard-summary`),
    enabled: semesterId !== null,
  })
  if (context.isLoading || semester.isLoading || summary.isLoading) return <LoadingState />
  if (context.isError || semester.isError || summary.isError)
    return (
      <div className="mx-auto w-full max-w-[1440px] px-5 py-7 md:px-8 md:py-8 lg:px-10">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold">学期工作台</h1>
          <SemesterSwitcher />
        </div>
        <ErrorState
          retry={() => {
            void context.refetch()
            void semester.refetch()
            void summary.refetch()
          }}
        />
      </div>
    )
  if (!semester.data || !summary.data) return <NoSemester />
  return (
    <SemesterDashboard
      key={semesterId}
      semester={semester.data.data}
      summary={summary.data.data}
      today={today}
    />
  )
}

function SemesterDashboard({
  semester,
  summary,
  today,
}: {
  semester: Semester
  summary: DashboardSummary
  today: string
}) {
  const { user } = useAuth()
  const isEditor = user?.role === "admin" || user?.role === "scheduler"
  const phase = semesterPhase(semester, today)
  const [mode, setMode] = useState(phase.value === "teaching" && isEditor ? "daily" : "planning")
  const week = Math.floor(calendarDaysBetween(semester.start_date, today) / 7) + 1
  const canEdit = isEditor && semester.status === "open"
  const allTasks = dashboardTasks(semester, summary)
  const timetableHref = semesterPath(semester.id, "timetable")
  const review: DashboardTask = {
    id: "review",
    title: "课表已排完，进入最后复核",
    description: "分别从班级、教师和教室视角检查课表，确认安排符合教学需要。",
    action: "复核当前课表",
    href: timetableHref,
  }
  const primary: DashboardTask = !isEditor
    ? {
        id: "view",
        title: summary.current_version_id ? "查看本学期的课表" : "本学期暂未设置当前课表",
        description: summary.current_version_is_stale
          ? "课表依据的资料已变化，请以教务复核后的安排为准。"
          : "按班级、教师或教室查看课程安排。",
        action: "查看当前课表",
        href: timetableHref,
      }
    : semester.status !== "open"
      ? {
          id: "closed",
          title: semester.status === "closed" ? "本学期已关闭" : "本学期尚未开放",
          description:
            semester.status === "closed"
              ? "可以查阅本学期的课表和历史安排；如需继续编排，请在学期配置中重新开放。"
              : "先完成学期配置并开放学期，再维护任课关系和生成课表。",
          action:
            semester.status === "closed" && summary.current_version_id
              ? "查看学期课表"
              : "前往学期配置",
          href:
            semester.status === "closed" && summary.current_version_id
              ? timetableHref
              : semesterPath(semester.id, "setup"),
        }
      : phase.value === "ended"
        ? {
            id: "ended",
            title: "本学期教学已结束",
            description: "查阅课表与调整记录，或切换到需要准备的学期。",
            action: "查看学期课表",
            href: timetableHref,
          }
        : (allTasks[0] ?? review)
  const tasks =
    canEdit && phase.value !== "ended" ? allTasks.filter((task) => task.id !== primary.id) : []
  const showDaily = phase.value === "teaching" && isEditor
  return (
    <section className="mx-auto w-full max-w-[1440px] space-y-7 px-5 py-7 md:px-8 md:py-8 lg:px-10">
      <header className="space-y-3">
        <p className="text-sm text-muted-foreground">学期工作台</p>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <h1 className="text-2xl leading-snug font-semibold tracking-tight">
            {semester.academic_year?.name}
            <span className="block whitespace-nowrap sm:inline">
              <span className="hidden sm:inline"> · </span>
              {semester.name}
            </span>
          </h1>
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
              {phase.label}
            </span>
            {semester.status !== "open" && (
              <span className="text-xs text-muted-foreground">
                {semester.status === "closed" ? "已关闭 · 只读" : "尚未开放"}
              </span>
            )}
            <SemesterSwitcher />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm leading-6 text-muted-foreground">
          <p className="flex items-center gap-2">
            <CalendarDaysIcon className="size-3.5" aria-hidden="true" />
            {semester.start_date} 至 {semester.end_date}
          </p>
          <span>
            {phase.value === "upcoming"
              ? `距开学 ${calendarDaysBetween(today, semester.start_date)} 天`
              : phase.value === "teaching"
                ? `第 ${week} 教学周`
                : "历史学期"}
          </span>
        </div>
      </header>
      <Tabs
        key={phase.value}
        value={showDaily ? mode : "planning"}
        onValueChange={(value) => setMode(String(value))}
        className="gap-6"
      >
        {showDaily && (
          <TabsList
            variant="line"
            className="w-full justify-start border-b pb-2"
            aria-label="工作台内容"
          >
            <TabsTrigger value="daily" className="flex-none px-4">
              今日教务
            </TabsTrigger>
            <TabsTrigger value="planning" className="flex-none px-4">
              学期编排
              {allTasks.length > 0 && (
                <span className="ml-1 text-xs text-muted-foreground">{allTasks.length}</span>
              )}
            </TabsTrigger>
          </TabsList>
        )}
        {showDaily && (
          <TabsContent value="daily">
            <DashboardDaily
              semester={semester}
              summary={summary}
              today={today}
              onOpenPlanning={() => setMode("planning")}
            />
          </TabsContent>
        )}
        <TabsContent value="planning" className="space-y-7">
          <section
            className="overflow-hidden rounded-xl border bg-muted/20"
            aria-label="当前课表与下一步工作"
          >
            <div className="grid lg:grid-cols-[1.25fr_1fr]">
              <div className="flex flex-col items-start p-6 md:p-7">
                {primary.id === "stale" || primary.id === "draft" ? (
                  <FileClockIcon
                    className="mb-5 size-6 text-[var(--timetable-notice-accent)]"
                    aria-hidden="true"
                  />
                ) : (
                  <ClipboardListIcon
                    className="mb-5 size-6 text-muted-foreground"
                    aria-hidden="true"
                  />
                )}
                <h2 className="text-xl font-semibold tracking-tight md:text-2xl">
                  {primary.title}
                </h2>
                <p className="mt-3 max-w-xl text-sm leading-7 text-muted-foreground">
                  {primary.description}
                </p>
                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <Button nativeButton={false} render={<Link to={primary.href} />}>
                    {primary.action}
                    <ArrowRightIcon />
                  </Button>
                  {summary.current_version_id && primary.href !== timetableHref && (
                    <Button
                      variant="ghost"
                      nativeButton={false}
                      render={<Link to={timetableHref} />}
                    >
                      查看现有课表
                    </Button>
                  )}
                </div>
              </div>
              <TimetableSummary summary={summary} />
            </div>
          </section>
          <div className="grid gap-8 lg:grid-cols-[1.25fr_1fr] lg:gap-12">
            <section aria-labelledby="dashboard-tasks">
              <div className="flex items-center justify-between border-b pb-4">
                <h2 id="dashboard-tasks" className="text-base font-semibold">
                  {canEdit && phase.value !== "ended" ? "其他待处理事项" : "课表查阅"}
                </h2>
                {tasks.length > 0 && (
                  <span className="text-xs text-muted-foreground">{tasks.length} 项</span>
                )}
              </div>
              {tasks.length ? (
                <div className="divide-y">
                  {tasks.map((task) => (
                    <TaskRow key={task.id} task={task} />
                  ))}
                </div>
              ) : (
                <div className="flex gap-3 py-6">
                  <CheckCircle2Icon
                    className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <div>
                    <p className="text-sm font-medium">
                      {canEdit && phase.value !== "ended"
                        ? "没有其他待处理事项"
                        : "保留本学期的课程安排"}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {primary.id === "stale" || primary.id === "draft"
                        ? "新方案完成后，再统一复核未排课程与课表冲突。"
                        : "可随时从班级、教师和教室视角查看课表。"}
                    </p>
                  </div>
                </div>
              )}
              <div className="mt-3 border-t pt-4">
                <Link
                  to={timetableHref}
                  className="inline-flex items-center gap-2 rounded text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  查看班级、教师与教室课表
                  <ArrowRightIcon className="size-3.5" />
                </Link>
              </div>
            </section>
            {isEditor && (
              <aside className="space-y-6">
                <PreparationSummary
                  key={`${semester.id}:${summary.class_count > 0}:${summary.template_ready}:${summary.assignment_count === summary.confirmed_count}`}
                  semester={semester}
                  summary={summary}
                />
                <section aria-labelledby="dashboard-shortcuts">
                  <h2 id="dashboard-shortcuts" className="mb-2 text-sm font-semibold">
                    常用工作
                  </h2>
                  <div className="divide-y">
                    <Shortcut
                      to={semesterPath(semester.id, "assignments")}
                      title="任课与课时"
                      description="维护教师、课程与周课时"
                      icon={ClipboardListIcon}
                    />
                    <Shortcut
                      to={semesterPath(semester.id, "constraints")}
                      title="排课规则"
                      description="设置课程安排偏好与限制"
                      icon={SlidersHorizontalIcon}
                    />
                    <Shortcut
                      to={semesterPath(semester.id, "preparation")}
                      title="排课准备检查"
                      description="检查资料完整性和规则可行性"
                      icon={ListChecksIcon}
                    />
                  </div>
                </section>
              </aside>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </section>
  )
}

function TimetableSummary({ summary }: { summary: DashboardSummary }) {
  const stale = summary.current_version_is_stale
  const hasVersion = summary.current_version_id !== null
  const percent = summary.required
    ? Math.min(100, Math.round((summary.scheduled / summary.required) * 100))
    : 0
  return (
    <div className="border-t bg-background p-6 md:p-7 lg:border-t-0 lg:border-l">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-muted-foreground">当前选定课表</h3>
        <span
          className={`text-xs ${stale ? "text-[var(--timetable-notice-foreground)]" : "text-muted-foreground"}`}
        >
          {!hasVersion ? "尚未设置" : stale ? "资料已变化" : "资料版本一致"}
        </span>
      </div>
      <p className="mt-3 break-words text-lg font-semibold">
        {summary.current_version_name ?? "等待第一份课表"}
      </p>
      {stale ? (
        <>
          <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-muted-foreground">现有已排记录</dt>
              <dd className="mt-1 font-medium tabular-nums">{summary.scheduled} 节</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">最新任课需求</dt>
              <dd className="mt-1 font-medium tabular-nums">{summary.required} 节 / 周</dd>
            </div>
          </dl>
          <p className="mt-5 flex items-start gap-2 rounded-lg bg-[var(--timetable-notice-background)] px-3 py-2.5 text-xs leading-6 text-[var(--timetable-notice-foreground)]">
            <FileClockIcon className="mt-1 size-3.5 shrink-0" aria-hidden="true" />
            这些记录来自旧方案，更新后需重新校验排课进度与冲突。
          </p>
        </>
      ) : (
        <>
          <div className="mt-5 flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span className="text-muted-foreground">排课进度</span>
            <span className="tabular-nums">
              <strong className="text-lg font-semibold">{summary.scheduled}</strong>
              <span className="text-muted-foreground"> / {summary.required} 节</span>
            </span>
          </div>
          <div
            role="progressbar"
            aria-label="排课完成率"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"
          >
            <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
            {hasVersion ? (
              <>
                <span>{summary.remaining > 0 ? `待排 ${summary.remaining} 节` : "课时已排完"}</span>
                <span>{summary.current_version_hard_conflict_count} 个硬冲突</span>
                <span>{summary.current_version_soft_warning_count} 项提醒</span>
              </>
            ) : (
              <span>设置当前课表后显示校验结果</span>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function PreparationSummary({
  semester,
  summary,
}: {
  semester: Semester
  summary: DashboardSummary
}) {
  const items = [
    {
      label: "学期班级",
      note: `${summary.class_count} 个班级`,
      done: summary.class_count > 0,
      to: semesterPath(semester.id, "setup"),
    },
    {
      label: "作息设置",
      note: summary.template_ready ? "已设置" : "未设置",
      done: summary.template_ready,
      to: semesterPath(semester.id, "setup"),
    },
    {
      label: "任课关系",
      note: `${summary.confirmed_count} / ${summary.assignment_count} 条已确认`,
      done: summary.assignment_count > 0 && summary.assignment_count === summary.confirmed_count,
      to: semesterPath(semester.id, "assignments"),
    },
  ]
  const complete = items.filter((item) => item.done).length
  return (
    <details className="group border-b pb-4" open={complete !== items.length}>
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded py-1 text-sm focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <h2 className="flex-1 text-base font-semibold">排课准备</h2>
        <span className="text-xs text-muted-foreground">
          {complete} / {items.length} 项已就绪
        </span>
        <ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="mt-3 divide-y">
        {items.map((item) => (
          <Link
            key={item.label}
            to={item.to}
            className="flex items-center gap-3 rounded py-3 text-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            {item.done ? (
              <CheckIcon
                className="size-4 text-emerald-700 dark:text-emerald-400"
                aria-label="已就绪"
              />
            ) : (
              <CircleIcon className="size-4 text-muted-foreground" aria-label="待完成" />
            )}
            <span>{item.label}</span>
            <span className="ml-auto text-xs text-muted-foreground">{item.note}</span>
          </Link>
        ))}
      </div>
    </details>
  )
}

function TaskRow({ task }: { task: DashboardTask }) {
  return (
    <Link
      to={task.href}
      className="group/task flex items-center gap-4 rounded py-5 outline-none hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-medium">{task.title}</h3>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{task.description}</p>
        <span className="mt-2 inline-block text-xs font-medium">{task.action}</span>
      </div>
      <ArrowRightIcon
        className="size-4 shrink-0 text-muted-foreground group-hover/task:text-foreground"
        aria-hidden="true"
      />
    </Link>
  )
}
function Shortcut({
  to,
  title,
  description,
  icon: Icon,
}: {
  to: string
  title: string
  description: string
  icon: typeof ListChecksIcon
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded py-3 outline-none hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="flex-1">
        <span className="text-sm font-medium">{title}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
      </span>
      <ArrowRightIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
    </Link>
  )
}
function NoSemester() {
  const { user } = useAuth()
  return (
    <section className="mx-auto max-w-4xl px-6 py-12">
      <CalendarDaysIcon className="mb-6 size-8 text-muted-foreground" />
      <h1 className="text-2xl font-semibold">开始准备一个学期</h1>
      <p className="mt-3 text-sm leading-7 text-muted-foreground">
        {user?.role === "viewer"
          ? "尚未设置当前学期，请联系教务管理员。"
          : "选择已有学期，或创建学年和学期，再配置班级、作息与任课关系。"}
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <SemesterSwitcher />
        {user?.role !== "viewer" && (
          <Button nativeButton={false} render={<Link to="/years" />}>
            管理学年学期
            <ArrowRightIcon />
          </Button>
        )}
      </div>
    </section>
  )
}
