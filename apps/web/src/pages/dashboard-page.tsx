import { Link } from "react-router"
import { useQuery } from "@tanstack/react-query"
import { ArrowRightIcon, CalendarDaysIcon, CheckIcon, ClipboardCheckIcon } from "lucide-react"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import type { DashboardSummary, Semester } from "@/lib/types"
import { useSchoolContext } from "@/lib/queries"
import { semesterPath } from "@/lib/semester"
import { ErrorState, LoadingState, PageHeader } from "@/components/page"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/status-badge"

export function DashboardPage() {
  const { user } = useAuth()
  const context = useSchoolContext()
  const semesterId = context.data?.current_semester?.id ?? null
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
      <ErrorState
        retry={() => {
          void context.refetch()
          void semester.refetch()
          void summary.refetch()
        }}
      />
    )

  const current = semester.data?.data
  const dashboard = summary.data?.data
  const classCount = dashboard?.class_count ?? 0
  const assignmentCount = dashboard?.assignment_count ?? 0
  const confirmedCount = dashboard?.confirmed_count ?? 0
  const scheduled = dashboard?.scheduled ?? 0
  const required = dashboard?.required ?? 0
  const remaining = dashboard?.remaining ?? 0
  const templateReady = dashboard?.template_ready ?? false
  const currentVersionId = dashboard?.current_version_id ?? null
  const currentVersionIsStale = dashboard?.current_version_is_stale ?? false
  const workingDraftId = dashboard?.working_draft_id ?? null
  const hasFreshWorkingDraft =
    workingDraftId !== null && dashboard?.working_draft_is_stale === false
  const shouldContinueWorkingDraft =
    hasFreshWorkingDraft && (!currentVersionId || currentVersionIsStale)
  const timetablePath = current ? semesterPath(current.id, "timetable") : "/"
  const nextActionPath = shouldContinueWorkingDraft
    ? `${timetablePath}?version=${workingDraftId}`
    : current
      ? semesterPath(
          current.id,
          !currentVersionId || currentVersionIsStale ? "generate" : "timetable",
        )
      : "/"
  const nextActionLabel = shouldContinueWorkingDraft
    ? "继续编辑最新草稿"
    : !currentVersionId || currentVersionIsStale
      ? "前往方案生成"
      : remaining
        ? "继续完成排课"
        : "查看当前课表"
  const hardConflictCount = dashboard?.current_version_hard_conflict_count ?? 0
  const softWarningCount = dashboard?.current_version_soft_warning_count ?? 0
  const blocked =
    !classCount ||
    !templateReady ||
    confirmedCount !== assignmentCount ||
    remaining > 0 ||
    !currentVersionId ||
    currentVersionIsStale ||
    hardConflictCount > 0
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
                    <span className="font-medium text-emerald-700 dark:text-emerald-400">
                      距开学 {startDelta} 天
                    </span>
                  </>
                )}
              </p>
            </div>
            <div className="grid w-full grid-cols-2 gap-3 sm:flex sm:w-auto sm:flex-wrap">
              <Button
                className="col-span-2 sm:col-span-1"
                nativeButton={false}
                render={<Link to={nextActionPath} />}
              >
                {nextActionLabel}
                <ArrowRightIcon />
              </Button>
              {user?.role !== "viewer" && (
                <>
                  <Button
                    variant="outline"
                    nativeButton={false}
                    render={<Link to={semesterPath(current.id, "assignments")} />}
                  >
                    查看任课关系
                  </Button>
                  <Button
                    variant="outline"
                    nativeButton={false}
                    render={<Link to={semesterPath(current.id, "setup")} />}
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
            hasCurrentVersion={currentVersionId !== null}
            currentVersionIsStale={currentVersionIsStale}
            hasFreshWorkingDraft={hasFreshWorkingDraft}
            actionPath={nextActionPath}
          />

          <div className="grid gap-6 xl:grid-cols-[1.5fr_0.75fr]">
            <section className="surface-panel p-5">
              <h3 className="text-lg font-semibold">下一步工作</h3>
              <div className="mt-4 flex flex-col gap-4 rounded-xl border bg-muted/30 p-5 sm:flex-row sm:items-center">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <ClipboardCheckIcon className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {shouldContinueWorkingDraft
                      ? "继续复核最新草稿"
                      : !currentVersionId
                        ? "生成并确认当前课表"
                        : currentVersionIsStale
                          ? "基础数据已变化，需要重新生成"
                          : remaining
                            ? "继续完成排课"
                            : "开学前复核课表"}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {shouldContinueWorkingDraft
                      ? "已有基于最新资料生成的草稿，请完成复核后再设为当前课表。"
                      : !currentVersionId
                        ? "当前还没有已确认课表，请从完整候选方案中选择并设为当前课表。"
                        : currentVersionIsStale
                          ? "当前课表仍可查看，但已不能作为可靠的调整基线；请按最新规则和资料重新生成。"
                          : remaining
                            ? `还有 ${remaining} 节课程未安排，建议优先处理高周课时任务。`
                            : "课表已完整，建议分别从班级、教师和教室视角检查结果。"}
                  </p>
                </div>
                <Button
                  className="w-full sm:w-auto"
                  nativeButton={false}
                  render={<Link to={nextActionPath} />}
                >
                  {shouldContinueWorkingDraft
                    ? "进入草稿并继续编辑"
                    : !currentVersionId || currentVersionIsStale
                      ? "前往方案生成"
                      : "查看课表"}
                </Button>
              </div>
              <h3 className="mt-6 text-base font-semibold">需要关注</h3>
              <div className="mt-3 grid min-h-40 place-items-center rounded-xl border p-6 text-center">
                {blocked ? (
                  <div className="max-w-md">
                    <p className="font-medium">仍有需要处理的项目</p>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-left text-sm text-muted-foreground">
                      {!classCount && <li>尚未配置学期班级</li>}
                      {!templateReady && <li>尚未设置可用作息模板</li>}
                      {confirmedCount !== assignmentCount && <li>仍有任课关系未确认</li>}
                      {!currentVersionId && <li>尚未设置当前课表</li>}
                      {currentVersionIsStale && <li>当前课表依据的数据已变化</li>}
                      {remaining > 0 && <li>仍有 {remaining} 节课程未安排</li>}
                      {hardConflictCount > 0 && <li>当前课表仍有 {hardConflictCount} 个硬冲突</li>}
                    </ul>
                  </div>
                ) : (
                  <div>
                    <span className="mx-auto flex size-10 items-center justify-center rounded-full border border-emerald-600 text-emerald-700 dark:border-emerald-400 dark:text-emerald-400">
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
                <SummaryRow
                  label="当前课表"
                  value={
                    !currentVersionId
                      ? "未设置"
                      : currentVersionIsStale
                        ? `${dashboard?.current_version_name ?? "已设置"} · 数据已变化`
                        : (dashboard?.current_version_name ?? "已设置")
                  }
                />
                <SummaryRow
                  label="当前课表冲突与提醒"
                  value={`${hardConflictCount} 个硬冲突 · ${softWarningCount} 个软提醒`}
                />
                {dashboard?.working_draft_id && (
                  <SummaryRow
                    label="最近草稿"
                    value={`${dashboard.working_draft_name ?? "未命名草稿"}${dashboard.working_draft_is_stale ? " · 数据已变化" : " · 可继续编辑"}`}
                  />
                )}
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
  hasCurrentVersion,
  currentVersionIsStale,
  hasFreshWorkingDraft,
  actionPath,
}: {
  classCount: number
  templateReady: boolean
  assignmentCount: number
  confirmedCount: number
  scheduled: number
  required: number
  hasCurrentVersion: boolean
  currentVersionIsStale: boolean
  hasFreshWorkingDraft: boolean
  actionPath: string
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
      note:
        currentVersionIsStale && hasFreshWorkingDraft
          ? "继续编辑最新草稿"
          : currentVersionIsStale
            ? "前往重新生成"
            : !hasCurrentVersion
              ? "尚未确认当前课表"
              : `${scheduled}/${required} 节`,
      done: hasCurrentVersion && !currentVersionIsStale && required > 0 && scheduled === required,
      href: actionPath,
    },
  ]
  return (
    <section className="surface-panel grid gap-5 p-5 sm:grid-cols-2 xl:grid-cols-5">
      {steps.map((step, index) => {
        const content = (
          <>
            <span
              className={`row-span-2 flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold ${
                step.done
                  ? "border-emerald-600 text-emerald-700 dark:border-emerald-400 dark:text-emerald-400"
                  : "border-primary text-primary"
              }`}
            >
              {index + 1}
            </span>
            <p className="min-w-0 font-medium">{step.label}</p>
            <div className="min-w-0">
              <p
                className={`flex items-center gap-1 text-sm leading-5 ${
                  step.done ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700"
                }`}
              >
                <span>
                  {step.done ? "已完成" : index === 4 && hasFreshWorkingDraft ? "待确认" : "待处理"}
                  {" · "}
                  {step.note}
                </span>
                {step.href && (
                  <ArrowRightIcon
                    className="size-3.5 shrink-0 transition-transform group-hover/step:translate-x-0.5"
                    aria-hidden="true"
                  />
                )}
              </p>
            </div>
          </>
        )
        const className = "relative grid min-w-0 grid-cols-[2rem_minmax(0,1fr)] gap-x-3 gap-y-1"

        return step.href ? (
          <Link
            key={step.label}
            to={step.href}
            className={`${className} group/step -m-3 cursor-pointer rounded-xl p-3 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/30`}
            aria-label={`${step.label}：${step.note}`}
          >
            {content}
          </Link>
        ) : (
          <div key={step.label} className={className}>
            {content}
          </div>
        )
      })}
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
