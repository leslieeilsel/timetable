import { useEffect, useRef, useState } from "react"
import { Link } from "react-router"
import { useQuery } from "@tanstack/react-query"
import { ArrowRightIcon, CheckIcon, RefreshCwIcon } from "lucide-react"
import { toast } from "sonner"
import { api, apiMessage } from "@/lib/api"
import { semesterPath, useResolvedSemesterId, withSemesterId } from "@/lib/semester"
import type { PreparationCheck, PreparationCheckItem } from "@/lib/types"
import { EmptyList, ErrorState, LoadingState, PageHeader } from "@/components/page"
import { SchedulingWorkflow } from "@/components/scheduling-workflow"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

const statusStyle = {
  passed: {
    label: "通过",
    tone: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  warning: {
    label: "提醒",
    tone: "border-amber-200 bg-amber-50 text-amber-700",
  },
  blocking: {
    label: "阻塞",
    tone: "border-rose-200 bg-rose-50 text-rose-700",
  },
} as const

type CheckStatus = PreparationCheckItem["status"]

type PreparationCard = {
  key: string
  title: string
  value: string
  status: CheckStatus
  fixPath: string
}

const statusPriority: Record<CheckStatus, number> = {
  passed: 0,
  warning: 1,
  blocking: 2,
}

export function PreparationCheckPage() {
  const { semesterId, context } = useResolvedSemesterId()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [refreshState, setRefreshState] = useState<"idle" | "checking" | "success">("idle")
  const successTimer = useRef<number | null>(null)
  const check = useQuery({
    queryKey: ["preparation-check", semesterId],
    queryFn: () => api<PreparationCheck>(`/api/v1/semesters/${semesterId}/preparation-check`),
    enabled: semesterId !== null,
  })
  useEffect(
    () => () => {
      if (successTimer.current !== null) window.clearTimeout(successTimer.current)
    },
    [],
  )
  const refresh = async () => {
    if (refreshState === "checking") return
    if (successTimer.current !== null) window.clearTimeout(successTimer.current)
    setConfirmOpen(false)
    setRefreshState("checking")
    const [result] = await Promise.all([
      check.refetch(),
      new Promise<void>((resolve) => window.setTimeout(resolve, 900)),
    ])
    if (result.isError) {
      setRefreshState("idle")
      toast.error(`检查失败，仍显示上一次结果：${apiMessage(result.error)}`)
      return
    }
    setRefreshState("success")
    const refreshed = result.data?.data
    const summary = refreshed ? summarizeCards(buildPreparationCards(refreshed)) : null
    toast.success(
      summary ? `检查完成：${summary.passed} 项通过 · ${summary.warnings} 项提醒` : "检查完成",
    )
    successTimer.current = window.setTimeout(() => {
      setRefreshState("idle")
      successTimer.current = null
    }, 1600)
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

  return (
    <>
      <PageHeader title="排课准备" description="确认关键数据和规则已就绪，再进入自动排课。" />
      <SchedulingWorkflow />
      {check.isLoading ? (
        <LoadingState label="正在检查排课输入…" />
      ) : !check.data ? (
        <ErrorState retry={() => void check.refetch()} />
      ) : (
        <PreparationContent
          data={check.data.data}
          semesterId={semesterId}
          refreshState={refreshState}
          onRefresh={() => setConfirmOpen(true)}
        />
      )}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重新检查排课条件？</DialogTitle>
            <DialogDescription>
              将重新检查当前学期的 {check.data?.data.checks.length ?? 0}{" "}
              项排课条件，不会修改任何数据。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              取消
            </Button>
            <Button onClick={() => void refresh()}>
              <RefreshCwIcon />
              开始检查
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function PreparationContent({
  data,
  semesterId,
  refreshState,
  onRefresh,
}: {
  data: PreparationCheck
  semesterId: number
  refreshState: "idle" | "checking" | "success"
  onRefresh: () => void
}) {
  const checking = refreshState === "checking"
  const generationPath = semesterPath(semesterId, "generate")
  const cards = buildPreparationCards(data)
  const cardSummary = summarizeCards(cards)
  const groups = buildPreparationGroups(cards)
  const readinessText = data.ready ? "可以生成" : "暂不可生成"
  const summaryText = checking
    ? `正在检查 ${cards.length} 项准备数据`
    : [
        `${cardSummary.passed} 项正常`,
        cardSummary.warnings > 0 ? `${cardSummary.warnings} 项提醒` : null,
        cardSummary.blocking > 0 ? `${cardSummary.blocking} 项阻塞` : null,
      ]
        .filter(Boolean)
        .join(" · ")

  return (
    <div className="mx-auto w-full max-w-[1480px] p-4 md:p-6" aria-busy={checking}>
      <section>
        <div className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "size-2 rounded-full",
                  checking
                    ? "bg-muted-foreground motion-safe:animate-pulse"
                    : data.ready
                      ? "bg-emerald-500"
                      : "bg-rose-500",
                )}
                aria-hidden="true"
              />
              <h2 className="text-base font-semibold">检查结果</h2>
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground" aria-live="polite">
              {checking ? (
                summaryText
              ) : (
                <>
                  {refreshState === "success" && "刚刚完成 · "}
                  <span
                    className={cn("font-medium", data.ready ? "text-emerald-700" : "text-rose-700")}
                  >
                    {readinessText}
                  </span>
                  {` · ${summaryText}`}
                </>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className={refreshState === "success" ? "text-emerald-700" : undefined}
              disabled={checking}
              onClick={onRefresh}
            >
              {refreshState === "success" ? (
                <CheckIcon />
              ) : (
                <RefreshCwIcon className={checking ? "motion-safe:animate-spin" : undefined} />
              )}
              {checking ? "检查中…" : refreshState === "success" ? "已更新" : "重新检查"}
            </Button>
            <Button
              size="sm"
              disabled={checking || !data.ready}
              aria-disabled={checking || !data.ready}
              className={checking || !data.ready ? "pointer-events-none opacity-50" : undefined}
              nativeButton={false}
              render={<Link to={generationPath} />}
            >
              进入方案生成
              <ArrowRightIcon />
            </Button>
          </div>
        </div>

        {checking && (
          <div
            className="h-px overflow-hidden bg-muted"
            role="progressbar"
            aria-label="正在重新检查排课条件"
          >
            <div className="preparation-progress-indicator h-full w-1/3 bg-primary/70" />
          </div>
        )}

        <div className="grid gap-6 pt-5 xl:grid-cols-3 xl:gap-5">
          {groups.map((group) => (
            <PreparationGroup
              key={group.title}
              title={group.title}
              items={group.items}
              semesterId={semesterId}
              checking={checking}
            />
          ))}
        </div>
      </section>
    </div>
  )
}

function PreparationGroup({
  title,
  items,
  semesterId,
  checking,
}: {
  title: string
  items: PreparationCard[]
  semesterId: number
  checking: boolean
}) {
  return (
    <section>
      <div className="mb-2 flex min-h-6 items-center px-1">
        <h3 className="text-sm font-semibold text-foreground/90">{title}</h3>
      </div>
      <div className="space-y-2">
        {items.map((item) => (
          <PreparationRow key={item.key} item={item} semesterId={semesterId} checking={checking} />
        ))}
      </div>
    </section>
  )
}

function PreparationRow({
  item,
  semesterId,
  checking,
}: {
  item: PreparationCard
  semesterId: number
  checking: boolean
}) {
  const state = statusStyle[item.status]
  const targetPath = withSemesterId(semesterId, item.fixPath)

  return (
    <Link
      to={targetPath}
      className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto_auto_1rem] items-center gap-x-3 rounded-lg border bg-card px-3.5 py-2.5 outline-none transition-colors hover:border-foreground/20 hover:bg-muted/20 focus-visible:border-ring/50 focus-visible:ring-2 focus-visible:ring-ring/20 sm:grid-cols-[minmax(0,1fr)_7rem_3.25rem_1rem]"
    >
      <span className="min-w-0 truncate text-sm font-medium">{item.title}</span>
      <span className="whitespace-nowrap text-right text-sm font-semibold tabular-nums">
        {item.value}
      </span>
      <span
        className={cn(
          "justify-self-end whitespace-nowrap rounded-md border px-1.5 py-px text-[10px] font-medium leading-4",
          checking ? "border-border bg-muted text-muted-foreground" : state.tone,
        )}
      >
        {checking ? "检查中" : state.label}
      </span>
      <ArrowRightIcon className="size-4 text-muted-foreground" aria-hidden="true" />
    </Link>
  )
}

function buildPreparationGroups(cards: PreparationCard[]) {
  const byKey = new Map(cards.map((card) => [card.key, card]))
  const pick = (...keys: string[]) =>
    keys.map((key) => byKey.get(key)).filter((card): card is PreparationCard => card !== undefined)

  return [
    { title: "基础配置", items: pick("schedule_template", "class_settings") },
    {
      title: "教学数据",
      items: pick("confirmed_assignments", "assignment_resources", "theoretical_capacity"),
    },
    { title: "规则与课表", items: pick("fixed_placements", "constraints", "current_version") },
  ]
}

function buildPreparationCards(data: PreparationCheck): PreparationCard[] {
  const checks = new Map(data.checks.map((item) => [item.key, item]))
  const getCheck = (key: string) => checks.get(key)
  const status = (key: string): CheckStatus => getCheck(key)?.status ?? "blocking"
  const fixPath = (key: string, fallback: string) => getCheck(key)?.fix_path ?? fallback
  const ruleStatus = worstStatus(status("constraint_integrity"), status("active_constraints"))

  return [
    {
      key: "schedule_template",
      title: "学期作息",
      value: `${data.summary.active_days} 天`,
      status: status("schedule_template"),
      fixPath: fixPath("schedule_template", "/semester/setup?section=schedule-template"),
    },
    {
      key: "class_settings",
      title: "学期班级",
      value: `${data.summary.active_class_settings} 个班级`,
      status: status("class_settings"),
      fixPath: fixPath("class_settings", "/semester/setup?section=classes"),
    },
    {
      key: "confirmed_assignments",
      title: "任课关系",
      value: `${data.summary.confirmed_assignments} 条`,
      status: status("confirmed_assignments"),
      fixPath: fixPath("confirmed_assignments", "/scheduling/assignments"),
    },
    {
      key: "assignment_resources",
      title: "授课资源",
      value: `${data.summary.assignment_resource_issues} 项异常`,
      status: status("assignment_resources"),
      fixPath: fixPath("assignment_resources", "/scheduling/assignments?filter=issues"),
    },
    {
      key: "theoretical_capacity",
      title: "理论容量",
      value: `${data.summary.available_slots_per_resource} 个槽位`,
      status: status("theoretical_capacity"),
      fixPath: fixPath("theoretical_capacity", "/scheduling/assignments?filter=capacity"),
    },
    {
      key: "fixed_placements",
      title: "固定安排",
      value: `${data.summary.fixed_placements} 条`,
      status: status("fixed_placements"),
      fixPath: fixPath("fixed_placements", "/scheduling/constraints?tab=fixed"),
    },
    {
      key: "constraints",
      title: "规则与约束",
      value: `${data.summary.active_constraints} 条`,
      status: ruleStatus,
      fixPath:
        ruleStatus === status("constraint_integrity")
          ? fixPath("constraint_integrity", "/scheduling/constraints")
          : fixPath("active_constraints", "/scheduling/constraints"),
    },
    {
      key: "current_version",
      title: "当前课表",
      value: `${data.summary.current_version_count} 个基线`,
      status: status("current_version"),
      fixPath: fixPath("current_version", "/scheduling/timetable"),
    },
  ]
}

function worstStatus(...statuses: CheckStatus[]): CheckStatus {
  return statuses.reduce((worst, current) =>
    statusPriority[current] > statusPriority[worst] ? current : worst,
  )
}

function summarizeCards(cards: PreparationCard[]) {
  return cards.reduce(
    (summary, card) => {
      if (card.status === "passed") summary.passed += 1
      if (card.status === "warning") summary.warnings += 1
      if (card.status === "blocking") summary.blocking += 1
      return summary
    },
    { passed: 0, warnings: 0, blocking: 0 },
  )
}
