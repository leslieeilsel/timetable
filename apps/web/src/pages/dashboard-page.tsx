import { Link } from "react-router"
import { useQuery } from "@tanstack/react-query"
import { ArrowRightIcon, CalendarDaysIcon, CheckIcon, ClipboardCheckIcon } from "lucide-react"
import { api, apiAllPages } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import type { ClassSetting, ScheduleTemplate, Semester, TeachingAssignment } from "@/lib/types"
import { useSchoolContext } from "@/lib/queries"
import { ErrorState, LoadingState, PageHeader } from "@/components/page"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/status-badge"

interface CompletenessItem {
  required: number
  scheduled: number
  remaining: number
  completed: boolean
}

export function DashboardPage() {
  const { user } = useAuth()
  const context = useSchoolContext()
  const semesterId = context.data?.current_semester?.id ?? null
  const semester = useQuery({
    queryKey: ["semester", semesterId],
    queryFn: () => api<Semester>(`/api/v1/semesters/${semesterId}`),
    enabled: semesterId !== null,
  })
  const settings = useQuery({
    queryKey: ["class-settings", semesterId],
    queryFn: () => apiAllPages<ClassSetting>(`/api/v1/semesters/${semesterId}/class-settings`),
    enabled: semesterId !== null,
  })
  const template = useQuery({
    queryKey: ["schedule-template", semesterId],
    queryFn: () =>
      api<ScheduleTemplate | null>(`/api/v1/semesters/${semesterId}/schedule-template`),
    enabled: semesterId !== null,
  })
  const assignments = useQuery({
    queryKey: ["teaching-assignments", semesterId],
    queryFn: () =>
      apiAllPages<TeachingAssignment>(`/api/v1/semesters/${semesterId}/teaching-assignments`),
    enabled: semesterId !== null,
  })
  const completeness = useQuery({
    queryKey: ["completeness", semesterId],
    queryFn: async () =>
      (await api<CompletenessItem[]>(`/api/v1/semesters/${semesterId}/timetable/completeness`))
        .data,
    enabled: semesterId !== null,
  })

  if (
    context.isLoading ||
    semester.isLoading ||
    settings.isLoading ||
    template.isLoading ||
    assignments.isLoading ||
    completeness.isLoading
  )
    return <LoadingState />
  if (context.isError) return <ErrorState retry={() => void context.refetch()} />

  const current = semester.data?.data
  const classCount = settings.data?.data.length ?? 0
  const assignmentCount = assignments.data?.data.length ?? 0
  const confirmedCount =
    assignments.data?.data.filter((assignment) => assignment.status === "confirmed").length ?? 0
  const scheduled = completeness.data?.reduce((sum, item) => sum + item.scheduled, 0) ?? 0
  const required = completeness.data?.reduce((sum, item) => sum + item.required, 0) ?? 0
  const remaining = completeness.data?.reduce((sum, item) => sum + item.remaining, 0) ?? 0
  const templateReady = Boolean(template.data?.data)
  const blocked =
    !classCount || !templateReady || confirmedCount !== assignmentCount || remaining > 0
  const startDelta = current
    ? daysBetween(new Date(), new Date(`${current.start_date}T00:00:00`))
    : null

  return (
    <>
      <PageHeader title="工作台" description="掌握学期准备与排课状态，快速进入下一项教务工作。" />
      {!current ? (
        <div className="p-5 md:p-7">
          <div className="surface-panel flex min-h-72 flex-col items-start justify-center p-8">
            <p className="text-xl font-semibold">尚未设置当前学期</p>
            <p className="mt-2 text-sm text-muted-foreground">
              请先创建学年、配置学期，并将开放学期设为当前工作上下文。
            </p>
            <Button className="mt-6" nativeButton={false} render={<Link to="/years" />}>
              前往学年与班级
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-7 p-5 md:p-7">
          <section className="flex flex-col gap-5 border-b pb-7 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
                  {current.academic_year?.name} · {current.name}
                </h2>
                <StatusBadge value={current.status} />
              </div>
              <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <CalendarDaysIcon className="size-4" />
                {current.start_date} 至 {current.end_date}
                {startDelta !== null && startDelta >= 0 && (
                  <>
                    <span className="h-4 w-px bg-border" aria-hidden="true" />
                    <span className="font-medium text-emerald-600">距开学 {startDelta} 天</span>
                  </>
                )}
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button nativeButton={false} render={<Link to="/semester/timetable" />}>
                进入排课工作台
                <ArrowRightIcon />
              </Button>
              {user?.role !== "viewer" && (
                <>
                  <Button
                    variant="outline"
                    nativeButton={false}
                    render={<Link to="/semester/assignments" />}
                  >
                    查看任课关系
                  </Button>
                  <Button
                    variant="outline"
                    nativeButton={false}
                    render={<Link to="/semester/setup" />}
                  >
                    学期配置
                  </Button>
                </>
              )}
            </div>
          </section>

          <Workflow
            classCount={classCount}
            templateReady={templateReady}
            assignmentCount={assignmentCount}
            confirmedCount={confirmedCount}
            scheduled={scheduled}
            required={required}
          />

          <div className="grid gap-6 xl:grid-cols-[1.5fr_0.75fr]">
            <section className="surface-panel p-5">
              <h3 className="text-lg font-semibold">下一步工作</h3>
              <div className="mt-4 flex flex-col gap-4 rounded-xl border p-5 sm:flex-row sm:items-center">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <ClipboardCheckIcon className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{remaining ? "继续完成排课" : "开学前复核课表"}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {remaining
                      ? `还有 ${remaining} 节课程未安排，建议优先处理高周课时任务。`
                      : "课表已完整，建议分别从班级、教师和教室视角检查结果。"}
                  </p>
                </div>
                <Button
                  variant="outline"
                  nativeButton={false}
                  render={<Link to="/semester/timetable" />}
                >
                  查看课表
                </Button>
              </div>
              <h3 className="mt-6 text-base font-semibold">需要关注</h3>
              <div className="mt-3 grid min-h-40 place-items-center rounded-xl border p-6 text-center">
                {blocked ? (
                  <div>
                    <p className="font-medium">仍有准备项未完成</p>
                  </div>
                ) : (
                  <div>
                    <span className="mx-auto flex size-10 items-center justify-center rounded-full border border-emerald-500 text-emerald-600">
                      <CheckIcon className="size-5" />
                    </span>
                    <p className="mt-4 font-medium">暂无阻塞项</p>
                  </div>
                )}
              </div>
            </section>

            <section className="surface-panel p-5">
              <h3 className="text-lg font-semibold">准备状态</h3>
              <dl className="mt-4 divide-y border-y">
                <SummaryRow label="班级配置" value={`${classCount} 个班级`} />
                <SummaryRow label="作息模板" value={templateReady ? "已设置" : "未设置"} />
                <SummaryRow
                  label="任课关系"
                  value={`${assignmentCount} 条 · 已确认 ${confirmedCount} 条`}
                />
                <SummaryRow label="已排课时" value={`${scheduled} / ${required}`} />
                <SummaryRow label="冲突" value="0 个冲突" />
              </dl>
            </section>
          </div>
        </div>
      )}
    </>
  )
}

function Workflow({
  classCount,
  templateReady,
  assignmentCount,
  confirmedCount,
  scheduled,
  required,
}: {
  classCount: number
  templateReady: boolean
  assignmentCount: number
  confirmedCount: number
  scheduled: number
  required: number
}) {
  const steps = [
    { label: "基础资料", note: "年级、教师、课程、教室", done: true },
    { label: "学年与班级", note: `${classCount} 个班级`, done: classCount > 0 },
    {
      label: "学期配置",
      note: templateReady ? "班级与作息" : "待设置作息",
      done: classCount > 0 && templateReady,
    },
    {
      label: "任课关系",
      note: `${assignmentCount} 条任务`,
      done: assignmentCount > 0 && confirmedCount === assignmentCount,
    },
    {
      label: "排课",
      note: `${scheduled}/${required} 节`,
      done: required > 0 && scheduled === required,
    },
  ]
  return (
    <section className="surface-panel grid gap-5 p-5 sm:grid-cols-2 xl:grid-cols-5">
      {steps.map((step, index) => (
        <div key={step.label} className="relative flex gap-3 xl:block">
          <div className="flex items-center gap-3">
            <span
              className={`flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold ${
                step.done ? "border-emerald-500 text-emerald-600" : "border-primary text-primary"
              }`}
            >
              {index + 1}
            </span>
            <p className="font-medium">{step.label}</p>
          </div>
          <div className="ml-11 xl:mt-3 xl:ml-0">
            <p className={`text-sm ${step.done ? "text-emerald-600" : "text-amber-700"}`}>
              {step.done ? "已完成" : "待处理"} · {step.note}
            </p>
          </div>
        </div>
      ))}
    </section>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-4 text-sm">
      <dt className="font-medium">{label}</dt>
      <dd className="text-right text-muted-foreground">{value}</dd>
    </div>
  )
}

function daysBetween(from: Date, to: Date) {
  const fromDay = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime()
  const toDay = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime()
  return Math.round((toDay - fromDay) / 86_400_000)
}
