import { useEffect, useRef, useState } from "react"
import { Link } from "react-router"
import { useQuery } from "@tanstack/react-query"
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  CheckIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  CircleDashedIcon,
  Clock3Icon,
  RefreshCwIcon,
  ShieldCheckIcon,
} from "lucide-react"
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
    icon: CheckCircle2Icon,
    label: "通过",
    tone: "border-emerald-200 bg-emerald-50 text-emerald-700",
    iconTone: "text-emerald-600",
  },
  warning: {
    icon: AlertTriangleIcon,
    label: "提醒",
    tone: "border-amber-200 bg-amber-50 text-amber-700",
    iconTone: "text-amber-600",
  },
  blocking: {
    icon: CircleAlertIcon,
    label: "阻塞",
    tone: "border-rose-200 bg-rose-50 text-rose-700",
    iconTone: "text-rose-600",
  },
} as const

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
    const summary = result.data?.data.summary
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
        <PageHeader title="准备检查" />
        <EmptyList title="尚未设置当前学期" description="请先创建并设置一个开放学期。" />
      </>
    )
  }

  return (
    <>
      <PageHeader title="准备检查" description="先发现阻塞问题，再进入自动排课。" />
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
  const state = statusStyle[data.status]
  const checking = refreshState === "checking"
  const HeaderIcon = checking ? CircleDashedIcon : state.icon
  const generationPath = semesterPath(semesterId, "generate")
  return (
    <div className="space-y-4 p-4 md:p-7">
      <div className="surface-panel overflow-hidden" aria-busy={checking}>
        <div className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-full border",
                checking ? "border-border bg-muted text-muted-foreground" : state.tone,
              )}
            >
              <HeaderIcon className={cn("size-4.5", checking && "motion-safe:animate-spin")} />
            </span>
            <div className="min-w-0">
              <p className="font-semibold">
                {checking
                  ? "正在重新检查排课条件"
                  : data.ready
                    ? "已具备自动排课条件"
                    : `还有 ${data.summary.blocking} 项必须处理`}
              </p>
              <p className="truncate text-sm text-muted-foreground" aria-live="polite">
                {checking
                  ? `${data.checks.length} 项结果将在完成后统一更新`
                  : refreshState === "success"
                    ? `刚刚完成 · ${data.summary.passed} 项通过 · ${data.summary.warnings} 项提醒`
                    : `${data.summary.passed} 项通过 · ${data.summary.warnings} 项提醒`}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            <Button
              variant="outline"
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
            className="h-1 overflow-hidden bg-muted"
            role="progressbar"
            aria-label="正在重新检查排课条件"
          >
            <div className="preparation-progress-indicator h-full w-1/3 bg-primary" />
          </div>
        )}

        <div className="grid lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="divide-y">
            {data.checks.map((item) => (
              <CheckRow key={item.key} item={item} semesterId={semesterId} checking={checking} />
            ))}
          </div>
          <aside className="border-t bg-muted/30 p-4 lg:border-t-0 lg:border-l">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground">
              本次排课规模
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-1">
              <Metric label="已确认任课关系" value={data.summary.confirmed_assignments} />
              <Metric label="待安排课节" value={data.summary.required_entries} />
              <Metric label="单资源可用槽位" value={data.summary.available_slots_per_resource} />
              <Metric label="固定安排" value={data.summary.fixed_placements} />
              <Metric label="启用硬约束" value={data.summary.active_hard_constraints} />
              <Metric label="启用软规则" value={data.summary.active_soft_constraints} />
            </dl>
            <div className="mt-4 rounded-xl border bg-background p-3 text-sm text-muted-foreground">
              <p className="flex items-center gap-2 font-medium text-foreground">
                <ShieldCheckIcon className="size-4 text-primary" />
                生成不会覆盖当前课表
              </p>
            </div>
          </aside>
        </div>
      </div>

      {data.recent_runs.length > 0 && (
        <section className="surface-panel overflow-hidden">
          <div className="flex min-h-12 items-center border-b px-4">
            <Clock3Icon className="mr-2 size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">最近生成任务</h2>
          </div>
          <div className="divide-y">
            {data.recent_runs.map((run) => (
              <Link
                key={run.id}
                to={`${generationPath}?run=${run.id}`}
                className="flex min-h-12 items-center gap-3 px-4 text-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/20"
              >
                <span className="font-medium">任务 #{run.id}</span>
                <span className="text-muted-foreground">{runStatus(run.status)}</span>
                <span className="ml-auto tabular-nums text-muted-foreground">
                  {run.progress_percent}%
                </span>
                <ArrowRightIcon className="size-4 text-muted-foreground" />
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function CheckRow({
  item,
  semesterId,
  checking,
}: {
  item: PreparationCheckItem
  semesterId: number
  checking: boolean
}) {
  const state = statusStyle[item.status]
  return (
    <div className="grid gap-3 px-4 py-4 sm:grid-cols-[2rem_minmax(0,1fr)_auto] sm:items-start">
      {checking ? (
        <CircleDashedIcon className="mt-0.5 size-5 text-muted-foreground" aria-hidden="true" />
      ) : (
        <state.icon className={cn("mt-0.5 size-5", state.iconTone)} aria-hidden="true" />
      )}
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-medium">{item.label}</h2>
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-xs font-medium",
              checking ? "border-border bg-muted text-muted-foreground" : state.tone,
            )}
          >
            {checking ? "检查中" : state.label}
            {!checking && item.issue_count > 0 ? ` ${item.issue_count}` : ""}
          </span>
        </div>
        {!checking && (
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{item.message}</p>
        )}
        {!checking && item.items.length > 0 && (
          <details className="mt-2 text-sm">
            <summary className="cursor-pointer select-none text-primary">查看问题示例</summary>
            <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-muted p-3 text-xs leading-5">
              {JSON.stringify(item.items, null, 2)}
            </pre>
          </details>
        )}
      </div>
      {!checking && item.status !== "passed" && (
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link to={withSemesterId(semesterId, item.fix_path)} />}
        >
          去处理
          <ArrowRightIcon />
        </Button>
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border bg-background px-3 py-2.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  )
}

function runStatus(status: string) {
  return (
    {
      queued: "等待中",
      checking: "检查输入",
      solving: "寻找可行解",
      optimizing: "优化质量",
      building_candidates: "生成候选",
      completed: "已完成",
      failed: "失败",
      cancelled: "已取消",
    }[status] ?? status
  )
}
