import { useEffect, useState, type FormEvent } from "react"
import { Link, useSearchParams } from "react-router"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  Clock3Icon,
  EyeIcon,
  LoaderCircleIcon,
  RotateCcwIcon,
  Settings2Icon,
  SparklesIcon,
  SquareIcon,
} from "lucide-react"
import { toast } from "sonner"
import { api, apiAllPages, apiMessage, jsonBody } from "@/lib/api"
import { useResolvedSemesterId } from "@/lib/semester"
import type {
  ClassSetting,
  PaginationMeta,
  PreparationCheck,
  ScheduleCandidate,
  ScheduleCandidateEntry,
  ScheduleRun,
  TeachingAssignment,
} from "@/lib/types"
import { EmptyList, ErrorState, Field, LoadingState, PageHeader } from "@/components/page"
import { SchedulingWorkflow } from "@/components/scheduling-workflow"
import { TablePagination } from "@/components/table-pagination"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { mergeSearchParams, positiveIntegerParam } from "@/lib/url-state"

type ScopeType = "all" | "grade" | "class" | "assignment"
type StrategyProfile = "balanced" | "class_distribution" | "teacher_experience" | "room_utilization"
const terminal = new Set(["completed", "failed", "cancelled"])
const strategyOptions: Array<{ value: StrategyProfile; title: string; description: string }> = [
  { value: "balanced", title: "均衡质量", description: "课程分布、教师体验和主课时段整体平衡" },
  {
    value: "class_distribution",
    title: "班级分布优先",
    description: "减少同科同日重复，让课程更均匀",
  },
  { value: "teacher_experience", title: "教师体验优先", description: "减少空堂和过长连续授课" },
  { value: "room_utilization", title: "教室利用优先", description: "降低跨教室变化，保持场地稳定" },
]

export function ScheduleGenerationPage() {
  const { semesterId, context } = useResolvedSemesterId()
  const client = useQueryClient()
  const [params, setParams] = useSearchParams()
  const runId = Number(params.get("run")) || null
  const [scopeType, setScopeType] = useState<ScopeType>("all")
  const [scopeIds, setScopeIds] = useState<number[]>([])
  const [mode, setMode] = useState<"rebuild" | "fill">("rebuild")
  const [keepLocked, setKeepLocked] = useState(true)
  const [profile, setProfile] = useState<StrategyProfile>("balanced")
  const [candidateCount, setCandidateCount] = useState<1 | 3>(1)
  const [starting, setStarting] = useState(false)
  const [customOpen, setCustomOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [runsPage, setRunsPage] = useState(() => positiveIntegerParam(params, "page", 1))
  const [runsPageSize, setRunsPageSize] = useState(() =>
    positiveIntegerParam(params, "per_page", 20, [20, 50, 100]),
  )
  const [preview, setPreview] = useState<ScheduleCandidate | null>(null)
  const [adopting, setAdopting] = useState<{
    candidate: ScheduleCandidate
    activate: boolean
  } | null>(null)

  const preparation = useQuery({
    queryKey: ["preparation-check", semesterId],
    queryFn: () => api<PreparationCheck>(`/api/v1/semesters/${semesterId}/preparation-check`),
    enabled: semesterId !== null,
  })
  const assignments = useQuery({
    queryKey: ["teaching-assignments", semesterId, "confirmed"],
    queryFn: () =>
      apiAllPages<TeachingAssignment>(
        `/api/v1/semesters/${semesterId}/teaching-assignments?status=confirmed`,
      ),
    enabled: semesterId !== null,
  })
  const classSettings = useQuery({
    queryKey: ["class-settings", semesterId],
    queryFn: () => apiAllPages<ClassSetting>(`/api/v1/semesters/${semesterId}/class-settings`),
    enabled: semesterId !== null,
  })
  const runs = useQuery({
    queryKey: ["schedule-runs", semesterId, runsPage, runsPageSize],
    queryFn: () =>
      api<ScheduleRun[]>(
        `/api/v1/semesters/${semesterId}/schedule-runs?page=${runsPage}&per_page=${runsPageSize}`,
      ),
    enabled: semesterId !== null,
  })
  const activeRun = useQuery({
    queryKey: ["schedule-run", semesterId, runId],
    queryFn: () => api<ScheduleRun>(`/api/v1/semesters/${semesterId}/schedule-runs/${runId}`),
    enabled: semesterId !== null && runId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.data.status
      return status && !terminal.has(status) ? 2000 : false
    },
  })
  useEffect(() => {
    setParams(
      (current) =>
        mergeSearchParams(current, {
          page: runsPage === 1 ? null : runsPage,
          per_page: runsPageSize === 20 ? null : runsPageSize,
        }),
      { replace: true },
    )
  }, [runsPage, runsPageSize, setParams])
  useEffect(() => {
    if (activeRun.data?.data.status === "completed")
      void client.invalidateQueries({ queryKey: ["schedule-runs", semesterId] })
  }, [activeRun.data?.data.status, client, semesterId])
  const runsPagination = paginationOf(runs.data?.meta)
  const runsLastPage = runsPagination?.last_page
  useEffect(() => {
    if (runsLastPage && runsPage > Math.max(1, runsLastPage)) {
      setRunsPage(Math.max(1, runsLastPage))
    }
  }, [runsLastPage, runsPage])

  if (!semesterId && !context.isLoading)
    return (
      <>
        <PageHeader title="方案生成" />
        <EmptyList title="尚未设置当前学期" description="请先设置当前开放学期。" />
      </>
    )

  const start = async () => {
    if (!preparation.data?.etag || (scopeType !== "all" && scopeIds.length === 0)) return
    setStarting(true)
    try {
      const result = await api<ScheduleRun>(`/api/v1/semesters/${semesterId}/schedule-runs`, {
        method: "POST",
        etag: preparation.data.etag,
        body: jsonBody({
          scope: { type: scopeType, ids: scopeType === "all" ? [] : scopeIds },
          preservation: { keep_locked: keepLocked, keep_current: mode === "fill" },
          strategy: { profile },
          candidate_count: candidateCount,
        }),
      })
      setParams((current) => mergeSearchParams(current, { run: result.data.id }))
      setCustomOpen(false)
      toast.success("自动排课任务已开始，可以离开页面后再回来查看")
      await client.invalidateQueries({ queryKey: ["schedule-runs", semesterId] })
    } catch (error) {
      toast.error(apiMessage(error))
    } finally {
      setStarting(false)
    }
  }
  const cancel = async () => {
    if (!activeRun.data?.etag || !runId) return
    try {
      await api(`/api/v1/semesters/${semesterId}/schedule-runs/${runId}/cancel`, {
        method: "POST",
        etag: activeRun.data.etag,
      })
      toast.success("任务已取消")
      await activeRun.refetch()
    } catch (error) {
      toast.error(apiMessage(error))
    }
  }
  const options = scopeOptions(
    scopeType,
    assignments.data?.data ?? [],
    classSettings.data?.data ?? [],
  )
  const selectedEntryCount =
    scopeType === "all"
      ? (preparation.data?.data.summary.required_entries ?? 0)
      : (assignments.data?.data ?? [])
          .filter((assignment) => assignmentMatchesScope(assignment, scopeType, scopeIds))
          .reduce((sum, assignment) => sum + assignment.weekly_items, 0)
  const isRecommended =
    scopeType === "all" &&
    mode === "rebuild" &&
    keepLocked &&
    profile === "balanced" &&
    candidateCount === 1
  const resetRecommended = () => {
    setScopeType("all")
    setScopeIds([])
    setMode("rebuild")
    setKeepLocked(true)
    setProfile("balanced")
    setCandidateCount(1)
  }
  const runTotal = runsPagination?.total ?? runs.data?.data.length ?? 0
  const latestRun = runs.data?.data[0]
  return (
    <>
      <PageHeader
        title="方案生成"
        description="生成不会覆盖当前课表，候选方案由你选择后才会生效。"
      />
      <SchedulingWorkflow />
      <div className="space-y-4 p-4 md:p-7">
        {runId ? (
          activeRun.isLoading ? (
            <LoadingState label="正在恢复任务状态…" />
          ) : activeRun.isError || !activeRun.data ? (
            <ErrorState retry={() => void activeRun.refetch()} />
          ) : (
            <RunWorkspace
              run={activeRun.data.data}
              etag={activeRun.data.etag}
              onCancel={() => void cancel()}
              onBack={() => setParams((current) => mergeSearchParams(current, { run: null }))}
              onPreview={setPreview}
              onAdopt={(candidate, activate) => setAdopting({ candidate, activate })}
            />
          )
        ) : preparation.isLoading || assignments.isLoading || classSettings.isLoading ? (
          <LoadingState />
        ) : preparation.isError || !preparation.data ? (
          <ErrorState retry={() => void preparation.refetch()} />
        ) : (
          <>
            <section className="surface-panel overflow-hidden">
              <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:p-6">
                <div className="min-w-0">
                  <p
                    className={cn(
                      "flex items-center gap-2 text-sm font-medium",
                      preparation.data.data.ready ? "text-emerald-700" : "text-rose-700",
                    )}
                  >
                    {preparation.data.data.ready ? (
                      <CheckCircle2Icon className="size-4" />
                    ) : (
                      <AlertTriangleIcon className="size-4" />
                    )}
                    {preparation.data.data.ready
                      ? isRecommended
                        ? "准备完成 · 系统推荐"
                        : "准备完成 · 自定义配置"
                      : `还有 ${preparation.data.data.summary.blocking} 项阻塞`}
                  </p>
                  <h2 className="mt-2 text-xl font-semibold tracking-tight">
                    {isRecommended ? "全校均衡排课" : "按当前配置生成课表"}
                  </h2>
                  <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
                    <GenerationFact
                      label="范围"
                      value={
                        scopeType === "all"
                          ? "全校"
                          : `${scopeName(scopeType)} · ${scopeIds.length} 项`
                      }
                    />
                    <GenerationFact label="预计安排" value={`${selectedEntryCount} 节`} />
                    <GenerationFact label="优化目标" value={strategyName(profile)} />
                    <GenerationFact
                      label="预计用时"
                      value={candidateCount === 3 ? "约 1–3 分钟" : "约 10–60 秒"}
                    />
                  </dl>
                </div>
                <div className="flex shrink-0 flex-col gap-2 sm:flex-row lg:min-w-56 lg:flex-col">
                  {!preparation.data.data.ready ? (
                    <Button nativeButton={false} render={<Link to="/scheduling/preparation" />}>
                      先处理阻塞问题
                      <ArrowRightIcon />
                    </Button>
                  ) : !customOpen ? (
                    <Button
                      disabled={starting || (scopeType !== "all" && scopeIds.length === 0)}
                      onClick={() => void start()}
                    >
                      {starting ? <LoaderCircleIcon className="animate-spin" /> : <SparklesIcon />}
                      {starting ? "正在创建任务…" : "开始自动排课"}
                    </Button>
                  ) : null}
                  <Button variant="outline" onClick={() => setCustomOpen((value) => !value)}>
                    <Settings2Icon />
                    {customOpen ? "收起自定义设置" : isRecommended ? "自定义设置" : "修改设置"}
                  </Button>
                </div>
              </div>
            </section>

            {customOpen && (
              <section className="surface-panel overflow-hidden">
                <div className="border-b px-5 py-4">
                  <h2 className="font-semibold">自定义生成方案</h2>
                </div>
                <div className="grid lg:grid-cols-[minmax(0,1.2fr)_minmax(20rem,0.8fr)]">
                  <section className="grid content-start gap-4 border-b p-5 lg:border-r lg:border-b-0">
                    <div>
                      <h3 className="font-semibold">1. 生成范围</h3>
                    </div>
                    <Segmented
                      value={scopeType}
                      onChange={(value) => {
                        setScopeType(value as ScopeType)
                        setScopeIds([])
                      }}
                      options={[
                        { value: "all", label: "全校" },
                        { value: "grade", label: "按年级" },
                        { value: "class", label: "按班级" },
                        { value: "assignment", label: "按任课关系" },
                      ]}
                    />
                    {scopeType !== "all" && (
                      <ScopePicker options={options} selected={scopeIds} onChange={setScopeIds} />
                    )}
                    <div className="grid gap-3 sm:grid-cols-2">
                      <button
                        type="button"
                        aria-pressed={mode === "rebuild"}
                        className={cn(
                          "rounded-xl border p-4 text-left focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/20",
                          mode === "rebuild"
                            ? "border-primary bg-primary/[0.05]"
                            : "hover:bg-muted/40",
                        )}
                        onClick={() => setMode("rebuild")}
                      >
                        <span className="font-medium">全量重排</span>
                        <span className="mt-1 block text-sm text-muted-foreground">
                          重新寻找整体质量更好的课表。
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-pressed={mode === "fill"}
                        className={cn(
                          "rounded-xl border p-4 text-left focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/20",
                          mode === "fill"
                            ? "border-primary bg-primary/[0.05]"
                            : "hover:bg-muted/40",
                        )}
                        onClick={() => setMode("fill")}
                      >
                        <span className="font-medium">保留现有并补排</span>
                        <span className="mt-1 block text-sm text-muted-foreground">
                          尽量不动已有安排，只补齐未排课程。
                        </span>
                      </button>
                    </div>
                    <label className="flex items-start gap-3 rounded-xl border bg-muted/20 p-3 text-sm">
                      <Checkbox
                        checked={keepLocked}
                        onCheckedChange={(checked) => setKeepLocked(Boolean(checked))}
                      />
                      <span>
                        <strong className="block font-medium">保留已锁定课程</strong>
                      </span>
                    </label>
                  </section>

                  <div>
                    <section className="grid gap-4 border-b p-5">
                      <div>
                        <h3 className="font-semibold">2. 优化目标</h3>
                      </div>
                      <div className="grid gap-2">
                        {strategyOptions.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            aria-pressed={profile === option.value}
                            className={cn(
                              "rounded-xl border px-3 py-3 text-left focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/20",
                              profile === option.value
                                ? "border-primary bg-primary/[0.05]"
                                : "hover:bg-muted/40",
                            )}
                            onClick={() => setProfile(option.value)}
                          >
                            <span className="flex items-center gap-2 font-medium">
                              {profile === option.value && (
                                <CheckCircle2Icon className="size-4 text-primary" />
                              )}
                              {option.title}
                            </span>
                            <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                              {option.description}
                            </span>
                          </button>
                        ))}
                      </div>
                    </section>

                    <section className="grid gap-3 p-5">
                      <div>
                        <h3 className="font-semibold">3. 候选数量</h3>
                      </div>
                      <Segmented
                        value={String(candidateCount)}
                        onChange={(value) => setCandidateCount(Number(value) as 1 | 3)}
                        options={[
                          { value: "1", label: "1 个 · 推荐" },
                          { value: "3", label: "3 个 · 便于比较" },
                        ]}
                      />
                    </section>
                  </div>
                </div>
                <div className="flex flex-col gap-3 border-t bg-muted/20 p-4 sm:flex-row sm:items-center">
                  <Button variant="ghost" onClick={resetRecommended}>
                    <RotateCcwIcon />
                    恢复推荐配置
                  </Button>
                  <Button
                    className="sm:ml-auto"
                    disabled={
                      starting ||
                      !preparation.data.data.ready ||
                      (scopeType !== "all" && scopeIds.length === 0)
                    }
                    onClick={() => void start()}
                  >
                    {starting ? <LoaderCircleIcon className="animate-spin" /> : <SparklesIcon />}
                    {starting ? "正在创建任务…" : "使用此配置生成"}
                  </Button>
                </div>
              </section>
            )}
          </>
        )}

        <section className="surface-panel overflow-hidden">
          <button
            type="button"
            className="flex min-h-16 w-full items-center gap-3 px-4 text-left hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/20"
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen((value) => !value)}
          >
            <Clock3Icon className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0">
              <span className="block text-sm font-semibold">生成记录</span>
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                {latestRun
                  ? `最近任务 #${latestRun.id} · ${strategyName(latestRun.strategy.profile)} · ${runStatusName(latestRun.status)}`
                  : "还没有生成任务"}
              </span>
            </span>
            <span className="ml-auto text-xs text-muted-foreground">{runTotal} 条</span>
            <ChevronDownIcon
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform",
                historyOpen && "rotate-180",
              )}
            />
          </button>
          {historyOpen && (
            <div className="border-t">
              {runs.isLoading ? (
                <LoadingState />
              ) : runs.isError ? (
                <ErrorState retry={() => void runs.refetch()} />
              ) : !runs.data?.data.length ? (
                <EmptyList title="还没有生成任务" description="完成配置后开始第一次自动排课。" />
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>任务</TableHead>
                        <TableHead>范围</TableHead>
                        <TableHead>策略</TableHead>
                        <TableHead>进度</TableHead>
                        <TableHead>候选</TableHead>
                        <TableHead>创建时间</TableHead>
                        <TableHead className="text-right">操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {runs.data.data.map((run) => (
                        <TableRow key={run.id}>
                          <TableCell className="font-medium">#{run.id}</TableCell>
                          <TableCell>{scopeName(run.scope.type)}</TableCell>
                          <TableCell>{strategyName(run.strategy.profile)}</TableCell>
                          <TableCell>
                            <RunStatus status={run.status} percent={run.progress_percent} />
                          </TableCell>
                          <TableCell>{run.candidates_count ?? 0}</TableCell>
                          <TableCell>{formatDate(run.created_at)}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setParams({ run: String(run.id) })}
                            >
                              查看
                              <EyeIcon />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {runsPagination && (
                    <TablePagination
                      page={runsPagination.page}
                      pageSize={runsPagination.per_page}
                      totalItems={runsPagination.total}
                      totalPages={runsPagination.last_page}
                      onPageChange={setRunsPage}
                      onPageSizeChange={(value) => {
                        setRunsPageSize(value)
                        setRunsPage(1)
                      }}
                    />
                  )}
                </>
              )}
            </div>
          )}
        </section>
      </div>
      <CandidatePreview
        open={preview !== null}
        candidate={preview}
        semesterId={semesterId ?? 0}
        runId={activeRun.data?.data.id ?? 0}
        onClose={() => setPreview(null)}
      />
      <AdoptDialog
        value={adopting}
        semesterId={semesterId ?? 0}
        runId={activeRun.data?.data.id ?? 0}
        etag={activeRun.data?.etag ?? null}
        onClose={() => setAdopting(null)}
        onSaved={async () => {
          await Promise.all([
            client.invalidateQueries({ queryKey: ["semester", semesterId] }),
            client.invalidateQueries({ queryKey: ["timetable", semesterId] }),
            client.invalidateQueries({ queryKey: ["timetable-versions", semesterId] }),
          ])
        }}
      />
    </>
  )
}

function RunWorkspace({
  run,
  onCancel,
  onBack,
  onPreview,
  onAdopt,
}: {
  run: ScheduleRun
  etag: string | null
  onCancel: () => void
  onBack: () => void
  onPreview: (candidate: ScheduleCandidate) => void
  onAdopt: (candidate: ScheduleCandidate, activate: boolean) => void
}) {
  const active = !terminal.has(run.status)
  const bottleneck =
    run.diagnostics?.bottleneck && typeof run.diagnostics.bottleneck === "object"
      ? (run.diagnostics.bottleneck as Record<string, unknown>)
      : null
  const blockedReasonCounts =
    bottleneck?.blocked_reason_counts && typeof bottleneck.blocked_reason_counts === "object"
      ? (bottleneck.blocked_reason_counts as Record<string, unknown>)
      : null
  const bottleneckCourse =
    typeof bottleneck?.course === "string" || typeof bottleneck?.course === "number"
      ? String(bottleneck.course)
      : ""
  const bottleneckReason =
    typeof bottleneck?.reason === "string" ? bottleneck.reason : "可用课节不足"
  return (
    <section className="surface-panel overflow-hidden">
      <div className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center">
        <div>
          <p className="font-semibold">自动排课任务 #{run.id}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            输入修订 #{run.input_revision} · {strategyName(run.strategy.profile)} ·{" "}
            {run.candidate_count} 个候选
          </p>
        </div>
        <div className="flex gap-2 sm:ml-auto">
          <Button variant="outline" onClick={onBack}>
            <RotateCcwIcon />
            新建任务
          </Button>
          {active && (
            <Button variant="destructive" onClick={onCancel}>
              <SquareIcon />
              取消任务
            </Button>
          )}
        </div>
      </div>
      {active && (
        <div className="p-5">
          <div className="flex items-center gap-3">
            <LoaderCircleIcon className="size-5 animate-spin text-primary" />
            <div>
              <p className="font-medium">{stageName(run.progress_stage)}</p>
              <p className="text-sm text-muted-foreground">可以离开此页面，任务会在后台继续。</p>
            </div>
            <span className="ml-auto text-lg font-semibold tabular-nums">
              {run.progress_percent}%
            </span>
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]"
              style={{ width: `${run.progress_percent}%` }}
            />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs text-muted-foreground sm:grid-cols-6">
            {["检查输入", "构建约束", "寻找可行解", "优化质量", "生成候选", "完成"].map(
              (label, index) => (
                <span
                  key={label}
                  className={
                    index <= progressStage(run.progress_stage) ? "font-medium text-primary" : ""
                  }
                >
                  {label}
                </span>
              ),
            )}
          </div>
        </div>
      )}
      {run.status === "failed" && (
        <div className="m-4 rounded-xl border border-rose-200 bg-rose-50 p-4">
          <p className="flex items-center gap-2 font-semibold text-rose-800">
            <AlertTriangleIcon className="size-4" />
            未找到完整可行方案
          </p>
          <p className="mt-2 text-sm leading-6 text-rose-800/80">{run.error_message}</p>
          {bottleneck && (
            <div className="mt-3 rounded-lg border border-rose-200 bg-white/55 p-3 text-sm text-rose-900">
              <p className="font-medium">
                主要卡点
                {bottleneckCourse ? `：${bottleneckCourse}` : ""}
              </p>
              <p className="mt-1 leading-6">{bottleneckReason}</p>
              {blockedReasonCounts && (
                <ul className="mt-2 space-y-1 text-xs text-rose-800/80">
                  {Object.entries(blockedReasonCounts)
                    .slice(0, 4)
                    .map(([reason, count]) => (
                      <li key={reason}>
                        {reason}（排除了 {String(count)} 个位置）
                      </li>
                    ))}
                </ul>
              )}
            </div>
          )}
          {Array.isArray(run.diagnostics?.suggestions) && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-rose-800/80">
              {run.diagnostics.suggestions.map((item) => (
                <li key={String(item)}>{String(item)}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {run.status === "cancelled" && (
        <div className="p-8 text-center text-muted-foreground">任务已取消，没有产生部分课表。</div>
      )}
      {run.status === "completed" && (
        <div className="p-4">
          <div className="mb-4">
            <h2 className="font-semibold">候选方案对比</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              硬冲突为 0 才可采用；展开分项可以看清方案差异。
            </p>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            {run.candidates?.map((candidate) => (
              <CandidateCard
                key={candidate.id}
                candidate={candidate}
                best={candidate.rank === 1}
                onPreview={() => onPreview(candidate)}
                onAdopt={onAdopt}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function CandidateCard({
  candidate,
  best,
  onPreview,
  onAdopt,
}: {
  candidate: ScheduleCandidate
  best: boolean
  onPreview: () => void
  onAdopt: (candidate: ScheduleCandidate, activate: boolean) => void
}) {
  const score = Number(candidate.quality_score ?? 0)
  return (
    <article
      className={cn(
        "rounded-2xl border bg-background p-4",
        best &&
          "border-primary/40 shadow-[0_8px_30px_color-mix(in_oklch,var(--primary)_8%,transparent)]",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">{candidate.name}</h3>
            {best && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                推荐
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            完整排满 · 硬冲突 {candidate.hard_conflict_count}
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-semibold tabular-nums">{score.toFixed(1)}</p>
          <p className="text-xs text-muted-foreground">综合质量</p>
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
        <Score label="课程分布" value={candidate.score_breakdown.course_distribution} />
        <Score label="教师体验" value={candidate.score_breakdown.teacher_experience} />
        <Score label="班级负荷" value={candidate.score_breakdown.class_load} />
        <Score label="连排与间隔" value={candidate.score_breakdown.session_spacing} />
        <Score label="教室稳定" value={candidate.score_breakdown.room_stability} />
        <Score label="学校规则" value={candidate.score_breakdown.custom_rules} />
      </dl>
      <details className="mt-3 rounded-lg bg-muted/40 px-3 py-2 text-xs">
        <summary className="cursor-pointer font-medium">查看扣分明细</summary>
        <div className="mt-2 grid gap-1 text-muted-foreground">
          <span>教师空堂 {candidate.score_breakdown.teacher_gaps}</span>
          <span>同科同日重复 {candidate.score_breakdown.same_course_same_day_repeats}</span>
          <span>连续授课提醒 {candidate.score_breakdown.consecutive_over_preference}</span>
          <span>班级日负荷差 {candidate.score_breakdown.class_daily_imbalance}</span>
          <span>教室变化 {candidate.score_breakdown.room_changes}</span>
          <span>主课优先分 {candidate.score_breakdown.core_course_priority}</span>
          <span>相对当前变化 {candidate.score_breakdown.changes_from_current}</span>
          {candidate.score_breakdown.rule_results
            .filter((item) => item.violations > 0)
            .slice(0, 4)
            .map((item) => (
              <span key={item.constraint_id}>
                {item.name}：{item.violations} 处未满足
              </span>
            ))}
        </div>
      </details>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button variant="outline" onClick={onPreview}>
          <EyeIcon />
          查看课表
        </Button>
        <Button variant="outline" onClick={() => onAdopt(candidate, false)}>
          采用为草稿
        </Button>
        <Button className="col-span-2" onClick={() => onAdopt(candidate, true)}>
          <CheckCircle2Icon />
          设为当前课表
        </Button>
      </div>
    </article>
  )
}

function CandidatePreview({
  open,
  candidate,
  semesterId,
  runId,
  onClose,
}: {
  open: boolean
  candidate: ScheduleCandidate | null
  semesterId: number
  runId: number
  onClose: () => void
}) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [classId, setClassId] = useState("")
  useEffect(() => {
    if (open) {
      setPage(1)
      setClassId("")
    }
  }, [open, candidate?.id])
  const detail = useQuery({
    queryKey: ["schedule-candidate", semesterId, runId, candidate?.id, classId, page, pageSize],
    queryFn: () =>
      api<{ candidate: ScheduleCandidate; entries: ScheduleCandidateEntry[]; is_stale: boolean }>(
        `/api/v1/semesters/${semesterId}/schedule-runs/${runId}/candidates/${candidate?.id}?page=${page}&per_page=${pageSize}${classId ? `&school_class_id=${classId}` : ""}`,
      ),
    enabled: open && candidate !== null,
  })
  const pagination = paginationOf(detail.data?.meta)
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{candidate?.name} · 课程明细</DialogTitle>
          <DialogDescription>
            大规模明细按页加载；课表画布将在“课表调整与诊断”中按班级、教师或教室查看。
          </DialogDescription>
        </DialogHeader>
        {detail.isLoading ? (
          <LoadingState />
        ) : detail.isError || !detail.data ? (
          <ErrorState retry={() => void detail.refetch()} />
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Input
                value={classId}
                inputMode="numeric"
                onChange={(event) => {
                  setClassId(event.target.value)
                  setPage(1)
                }}
                placeholder="输入班级 ID 筛选（可选）"
                className="max-w-72"
              />
              {detail.data.data.is_stale && (
                <span className="text-sm text-amber-700">基于旧输入，仅可查看</span>
              )}
            </div>
            <div className="overflow-hidden rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>班级/教学组 · 课程</TableHead>
                    <TableHead>教师</TableHead>
                    <TableHead>时间</TableHead>
                    <TableHead>教室</TableHead>
                    <TableHead>周型</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.data.data.entries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="font-medium">
                        {entry.teaching_assignment.school_class?.name ??
                          `教学组 #${entry.teaching_assignment.id}`}{" "}
                        · {entry.teaching_assignment.course.name}
                      </TableCell>
                      <TableCell>{entry.teaching_assignment.teacher.name}</TableCell>
                      <TableCell>
                        周{["", "一", "二", "三", "四", "五", "六", "日"][entry.weekday]} ·{" "}
                        {entry.item.name}
                      </TableCell>
                      <TableCell>{entry.actual_room.name}</TableCell>
                      <TableCell>
                        {entry.week_pattern === "all" ? "每周" : entry.week_pattern.toUpperCase()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {pagination && (
                <TablePagination
                  page={pagination.page}
                  pageSize={pagination.per_page}
                  totalItems={pagination.total}
                  totalPages={pagination.last_page}
                  onPageChange={setPage}
                  onPageSizeChange={(value) => {
                    setPageSize(value)
                    setPage(1)
                  }}
                />
              )}
            </div>
          </>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AdoptDialog({
  value,
  semesterId,
  runId,
  etag,
  onClose,
  onSaved,
}: {
  value: { candidate: ScheduleCandidate; activate: boolean } | null
  semesterId: number
  runId: number
  etag: string | null
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [name, setName] = useState("")
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    setName(value ? `${value.candidate.name}${value.activate ? " · 当前课表" : " · 调整草稿"}` : "")
    setReason("")
  }, [value])
  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!value || !etag || (value.activate && reason.trim().length < 2)) return
    setSaving(true)
    try {
      await api(
        `/api/v1/semesters/${semesterId}/schedule-runs/${runId}/candidates/${value.candidate.id}/adopt`,
        {
          method: "POST",
          etag,
          body: jsonBody({
            name: name.trim() || null,
            activate: value.activate,
            reason: value.activate ? reason.trim() : null,
          }),
        },
      )
      toast.success(
        value.activate ? "已设为当前课表，原版本已保留在历史中" : "已创建可编辑课表草稿",
      )
      onClose()
      await onSaved()
    } catch (error) {
      toast.error(apiMessage(error))
    } finally {
      setSaving(false)
    }
  }
  return (
    <Dialog open={value !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{value?.activate ? "设为当前课表" : "采用为编辑草稿"}</DialogTitle>
          <DialogDescription>
            {value?.activate
              ? "无需审核。系统会再次检查输入修订和硬冲突，并将旧当前课表转为历史版本。"
              : "候选方案将复制成独立草稿，你可以继续手工调整。"}
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={(event) => void save(event)}>
          <Field label="版本名称">
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          {value?.activate && (
            <Field label="切换原因">
              <Input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="例如：采用综合质量最高方案"
                autoFocus
              />
            </Field>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "处理中…" : value?.activate ? "确认设为当前课表" : "创建草稿"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ScopePicker({
  options,
  selected,
  onChange,
}: {
  options: Array<{ id: number; label: string; secondary?: string }>
  selected: number[]
  onChange: (ids: number[]) => void
}) {
  const [search, setSearch] = useState("")
  const filtered = options.filter((item) =>
    `${item.label} ${item.secondary ?? ""}`
      .toLocaleLowerCase("zh-CN")
      .includes(search.trim().toLocaleLowerCase("zh-CN")),
  )
  return (
    <div className="overflow-hidden rounded-xl border">
      <div className="flex items-center gap-2 border-b p-2">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜索范围对象"
          className="h-9"
        />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() =>
            onChange(selected.length === options.length ? [] : options.map((item) => item.id))
          }
        >
          {selected.length === options.length ? "清空" : "全选"}
        </Button>
      </div>
      <div className="grid max-h-56 overflow-y-auto p-2 sm:grid-cols-2">
        {filtered.map((item) => (
          <label
            key={item.id}
            className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-muted"
          >
            <Checkbox
              checked={selected.includes(item.id)}
              onCheckedChange={(checked) =>
                onChange(checked ? [...selected, item.id] : selected.filter((id) => id !== item.id))
              }
            />
            <span className="truncate">{item.label}</span>
            {item.secondary && (
              <span className="ml-auto truncate text-xs text-muted-foreground">
                {item.secondary}
              </span>
            )}
          </label>
        ))}
      </div>
      <div className="border-t px-3 py-2 text-xs text-muted-foreground">
        已选择 {selected.length} 项
      </div>
    </div>
  )
}
function Segmented({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <div className="inline-flex w-fit max-w-full overflow-x-auto rounded-lg border bg-background p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={cn(
            "h-9 rounded-md px-3 text-sm font-medium whitespace-nowrap transition-colors",
            value === option.value
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
function GenerationFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  )
}
function Score({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-muted/50 p-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-semibold tabular-nums">{Number(value).toFixed(1)}</dd>
    </div>
  )
}
function RunStatus({ status, percent }: { status: string; percent: number }) {
  const complete = status === "completed"
  const failed = status === "failed"
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-sm font-medium",
        complete && "text-emerald-700",
        failed && "text-rose-700",
        status === "cancelled" && "text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "size-2 rounded-full",
          complete
            ? "bg-emerald-500"
            : failed
              ? "bg-rose-500"
              : status === "cancelled"
                ? "bg-slate-400"
                : "bg-blue-500",
        )}
      />
      {runStatusName(status)}
      {!terminal.has(status) && ` ${percent}%`}
    </span>
  )
}
function scopeOptions(
  type: ScopeType,
  assignments: TeachingAssignment[],
  settings: ClassSetting[],
) {
  if (type === "grade")
    return Array.from(
      new Map(
        settings.map((item) => [
          item.school_class.grade.id,
          { id: item.school_class.grade.id, label: item.school_class.grade.name },
        ]),
      ).values(),
    )
  if (type === "class")
    return settings.map((item) => ({
      id: item.school_class_id,
      label: item.school_class.name,
      secondary: item.school_class.grade.name,
    }))
  if (type === "assignment")
    return assignments.map((item) => ({
      id: item.id,
      label: `${item.school_class?.name ?? `教学组 #${item.id}`} · ${item.course.name}`,
      secondary: `${item.teacher.name} · ${item.weekly_items} 节`,
    }))
  return []
}
function assignmentMatchesScope(assignment: TeachingAssignment, type: ScopeType, ids: number[]) {
  if (type === "assignment") return ids.includes(assignment.id)
  if (type === "class")
    return assignment.school_class_id !== null && ids.includes(assignment.school_class_id)
  if (type === "grade")
    return assignment.school_class
      ? ids.includes(assignment.school_class.grade_id)
      : (assignment.teaching_group?.school_classes.some((item) => ids.includes(item.grade_id)) ??
          false)
  return true
}
function paginationOf(meta?: Record<string, unknown>): PaginationMeta | null {
  const value = meta?.pagination
  return value && typeof value === "object" ? (value as PaginationMeta) : null
}
function scopeName(value: string) {
  return { all: "全校", grade: "年级", class: "班级", assignment: "任课关系" }[value] ?? value
}
function strategyName(value: string) {
  return strategyOptions.find((item) => item.value === value)?.title ?? value
}
function runStatusName(value: string) {
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
    }[value] ?? value
  )
}
function stageName(value: string) {
  return (
    {
      queued: "等待求解资源",
      checking_input: "正在检查输入",
      building_problem: "正在构建约束问题",
      searching_feasible_solution: "正在寻找完整可行解",
      building_candidates: "正在生成候选方案",
      completed: "已完成",
    }[value] ??
    (value.startsWith("optimizing_candidate_") ? `正在优化候选方案 ${value.at(-1)}` : value)
  )
}
function progressStage(value: string) {
  if (value === "completed") return 5
  if (value === "building_candidates") return 4
  if (value.startsWith("optimizing")) return 3
  if (value === "searching_feasible_solution") return 2
  if (value === "building_problem") return 1
  return 0
}
function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value))
}
