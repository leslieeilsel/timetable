import { Link } from "react-router"
import { useQuery } from "@tanstack/react-query"
import { ArrowRightIcon, RefreshCwIcon } from "lucide-react"
import { toast } from "sonner"
import { api, apiAllPages, apiMessage } from "@/lib/api"
import {
  semesterPath,
  useResolvedSemesterId,
  withSemesterId,
  type SemesterDestination,
} from "@/lib/semester"
import type { PreparationCheck, PreparationCheckItem, TimetableVersion } from "@/lib/types"
import { EmptyList, ErrorState, LoadingState, PageHeader } from "@/components/page"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type CheckStatus = PreparationCheckItem["status"]
type PreparationCard = {
  title: string
  destination: SemesterDestination
  summary: string
  checks: PreparationCheckItem[]
  optional?: boolean
}

const statusStyle: Record<CheckStatus, { label: string; tone: string }> = {
  passed: { label: "已就绪", tone: "text-emerald-700 dark:text-emerald-400" },
  warning: { label: "有提醒", tone: "text-amber-700 dark:text-amber-400" },
  blocking: { label: "待处理", tone: "text-destructive" },
}

export function PreparationCheckPage() {
  const { semesterId, context } = useResolvedSemesterId()
  const check = useQuery({
    queryKey: ["preparation-check", semesterId],
    queryFn: () => api<PreparationCheck>(`/api/v1/semesters/${semesterId}/preparation-check`),
    enabled: semesterId !== null,
  })
  const versions = useQuery({
    queryKey: ["timetable-versions", semesterId],
    queryFn: () =>
      apiAllPages<TimetableVersion>(`/api/v1/semesters/${semesterId}/timetable-versions`),
    enabled: semesterId !== null,
  })
  const draft = versions.data?.data.find((version) => version.status === "draft")
  const refresh = async () => {
    const result = await check.refetch()
    if (result.isError) toast.error(`检查失败：${apiMessage(result.error)}`)
    else toast.success("排课准备检查已更新")
  }

  if (semesterId === null) {
    if (context.isLoading) return <LoadingState label="正在载入学期…" />
    return (
      <>
        <PageHeader title="排课准备" />
        <EmptyList title="尚未设置当前学期" description="请先创建并设置一个开放学期。" />
      </>
    )
  }

  const planningPath = semesterPath(semesterId, "planning")
  const data = check.data?.data
  const preparationChecks = data?.checks.filter((item) => item.key !== "current_version") ?? []
  const blocking = preparationChecks.filter((item) => item.status === "blocking").length
  const warnings = preparationChecks.filter((item) => item.status === "warning").length

  return (
    <>
      <PageHeader title="排课准备" />
      <div className="space-y-5 p-4 md:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            role="status"
            aria-live="polite"
            className="flex flex-wrap items-center gap-2 text-sm"
          >
            {check.isFetching ? (
              <span className="text-muted-foreground">正在检查排课准备…</span>
            ) : check.isError ? (
              <span className="text-destructive">
                {data ? "检查未更新，以下为上次结果" : "检查暂不可用"}
              </span>
            ) : data ? (
              <>
                <span
                  className={cn(
                    "font-medium",
                    data.ready ? statusStyle.passed.tone : statusStyle.blocking.tone,
                  )}
                >
                  {data.ready ? "准备就绪" : `${blocking} 项待处理`}
                </span>
                {warnings > 0 && <span className="text-muted-foreground">· {warnings} 项提醒</span>}
              </>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" disabled={check.isFetching} onClick={() => void refresh()}>
              <RefreshCwIcon className={check.isFetching ? "animate-spin" : undefined} />
              {check.isFetching ? "检查中…" : "重新检查"}
            </Button>
            {data && data.summary.current_version_count > 0 && (
              <Button
                variant="outline"
                nativeButton={false}
                render={<Link to={semesterPath(semesterId, "timetable")} />}
              >
                查看已发布课表
              </Button>
            )}
            <Button
              nativeButton={false}
              render={<Link to={draft ? `${planningPath}?version=${draft.id}` : planningPath} />}
            >
              {draft ? "继续编排" : "进入编排"}
              <ArrowRightIcon />
            </Button>
          </div>
        </div>
        {check.isLoading ? (
          <LoadingState label="正在载入准备事项…" />
        ) : !data ? (
          <ErrorState retry={() => void refresh()} />
        ) : (
          <div className="grid items-start gap-4 lg:grid-cols-2">
            {buildPreparationCards(data).map((card) => (
              <PreparationCardView
                key={card.destination}
                card={card}
                semesterId={semesterId}
                checking={check.isFetching}
                stale={check.isError}
              />
            ))}
          </div>
        )}
      </div>
    </>
  )
}

function PreparationCardView({
  card,
  semesterId,
  checking,
  stale,
}: {
  card: PreparationCard
  semesterId: number
  checking: boolean
  stale: boolean
}) {
  const status = card.checks.some((item) => item.status === "blocking")
    ? "blocking"
    : card.checks.some((item) => item.status === "warning")
      ? "warning"
      : "passed"
  const issues = card.checks.filter((item) => item.status !== "passed")
  const state = statusStyle[status]

  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <Link
        to={semesterPath(semesterId, card.destination)}
        className="group flex items-center justify-between gap-4 p-5 outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <div className="min-w-0">
          <h2 className="font-semibold">{card.title}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{card.summary}</p>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          <span
            className={cn(
              "text-xs",
              checking || stale || (card.optional && status === "passed")
                ? "text-muted-foreground"
                : state.tone,
            )}
          >
            {checking
              ? "检查中"
              : stale
                ? "待复核"
                : card.optional && status === "passed"
                  ? "可选"
                  : state.label}
          </span>
          <ArrowRightIcon
            className="size-4 text-muted-foreground group-hover:text-foreground"
            aria-hidden="true"
          />
        </div>
      </Link>
      {issues.length > 0 && (
        <ul className="space-y-2 px-5 pb-4">
          {issues.map((issue) => (
            <li key={issue.key}>
              <Link
                to={withSemesterId(semesterId, issue.fix_path)}
                title={issue.message}
                className={cn(
                  "inline-flex items-center gap-2 rounded-sm text-sm underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring",
                  stale || checking ? "text-muted-foreground" : statusStyle[issue.status].tone,
                )}
              >
                {issueLabel(issue)}
                <ArrowRightIcon className="size-3.5 shrink-0" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function buildPreparationCards(data: PreparationCheck): PreparationCard[] {
  const checks = (...keys: string[]) => data.checks.filter((item) => keys.includes(item.key))
  return [
    {
      title: "班级与作息",
      destination: "setup",
      summary: `${data.summary.active_class_settings} 个班级 · 每周 ${data.summary.active_days} 天 · ${data.summary.available_slots_per_resource} 个可排课节`,
      checks: checks("schedule_template", "class_settings"),
    },
    {
      title: "任课与课时",
      destination: "assignments",
      summary: `${data.summary.confirmed_assignments} 条已确认任课 · 每周 ${data.summary.required_entries} 节`,
      checks: checks("confirmed_assignments", "assignment_resources", "theoretical_capacity"),
    },
    {
      title: "排课规则",
      destination: "constraints",
      summary: `${data.summary.active_hard_constraints} 条硬约束 · ${data.summary.active_soft_constraints} 条排课偏好`,
      checks: checks("constraint_integrity", "active_constraints"),
    },
    {
      title: "固定安排",
      destination: "fixed-placements",
      summary:
        data.summary.fixed_placements > 0
          ? `${data.summary.fixed_placements} 条已启用`
          : "未设置固定安排",
      checks: checks("fixed_placements"),
      optional: data.summary.fixed_placements === 0,
    },
  ]
}

function issueLabel(check: PreparationCheckItem) {
  switch (check.key) {
    case "assignment_resources":
      return `${check.issue_count} 项资源异常`
    case "theoretical_capacity":
      return "查看课时容量问题"
    case "fixed_placements":
      return `${check.issue_count} 项固定安排冲突`
    case "constraint_integrity":
      return `${check.issue_count} 项规则需要修正`
    case "active_constraints":
      return "尚未设置排课偏好"
    default:
      return check.message
  }
}
