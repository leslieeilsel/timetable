import { useEffect, useMemo, useState, type FormEvent } from "react"
import { Link, useNavigate } from "react-router"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  CheckCircle2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
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
import { api, apiAllPages, apiMessage } from "@/lib/api"
import { assessCandidateQuality } from "@/lib/candidate-quality"
import { semesterPath, useResolvedSemesterId } from "@/lib/semester"
import type {
  ClassSetting,
  PaginationMeta,
  PreparationCheck,
  Room,
  ScheduleCandidate,
  ScheduleCandidateEntry,
  ScheduleRun,
  ScheduleTemplate,
  TeachingAssignment,
  TimetableEntry,
  TimetablePublicationPreview,
  TimetableVersion,
} from "@/lib/types"
import { EmptyList, ErrorState, Field, LoadingState, PageHeader } from "@/components/page"
import {
  ClassPicker,
  RoomPicker,
  TeacherPicker,
  teachersWithAssignmentCourses,
} from "@/components/resource-picker"
import { SchedulingWorkflow } from "@/components/scheduling-workflow"
import { TablePagination } from "@/components/table-pagination"
import { TimetableGrid, type TimetableView } from "@/components/timetable-grid"
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"
import {
  mergeSearchParams,
  positiveIntegerParam,
  useHashPreservingSearchParams,
} from "@/lib/url-state"

type ScopeType = "all" | "grade" | "class" | "assignment"
type StrategyProfile = "balanced" | "class_distribution" | "teacher_experience" | "room_utilization"
const terminal = new Set(["completed", "failed", "cancelled"])
const strategyOptions: Array<{ value: StrategyProfile; title: string; description: string }> = [
  { value: "balanced", title: "综合均衡", description: "同时兼顾班级课表、教师课表和教室使用" },
  {
    value: "class_distribution",
    title: "班级课表优先",
    description: "优先让班级每天的课程分布更均匀",
  },
  {
    value: "teacher_experience",
    title: "教师课表优先",
    description: "优先减少教师空堂和过长连续授课",
  },
  {
    value: "room_utilization",
    title: "教室稳定优先",
    description: "优先减少教室切换，保持上课场地稳定",
  },
]

export function ScheduleGenerationPage() {
  const { semesterId, context } = useResolvedSemesterId()
  const client = useQueryClient()
  const navigate = useNavigate()
  const [params, setParams] = useHashPreservingSearchParams()
  const runId = Number(params.get("run")) || null
  const [scopeType, setScopeType] = useState<ScopeType>("all")
  const [scopeIds, setScopeIds] = useState<number[]>([])
  const [mode, setMode] = useState<"rebuild" | "fill">("rebuild")
  const [keepLocked, setKeepLocked] = useState(true)
  const [candidateCount, setCandidateCount] = useState<1 | 3>(1)
  const [starting, setStarting] = useState(false)
  const [customOpen, setCustomOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(true)
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
    enabled: semesterId !== null && customOpen,
  })
  const classSettings = useQuery({
    queryKey: ["class-settings", semesterId],
    queryFn: () => apiAllPages<ClassSetting>(`/api/v1/semesters/${semesterId}/class-settings`),
    enabled: semesterId !== null && customOpen,
  })
  const runs = useQuery({
    queryKey: ["schedule-runs", semesterId, runsPage, runsPageSize],
    queryFn: () =>
      api<ScheduleRun[]>(
        `/api/v1/semesters/${semesterId}/schedule-runs?page=${runsPage}&per_page=${runsPageSize}`,
      ),
    enabled: semesterId !== null,
    refetchInterval: (query) => {
      const pageRuns = query.state.data?.data ?? []
      return pageRuns.some((run) => !terminal.has(run.status)) ? 2000 : false
    },
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
    const status = activeRun.data?.data.status
    if (status && terminal.has(status))
      void client.invalidateQueries({ queryKey: ["schedule-runs", semesterId] })
  }, [activeRun.data?.data.status, client, semesterId])
  const runsPagination = paginationOf(runs.data?.meta)
  const runsLastPage = runsPagination?.last_page
  useEffect(() => {
    if (runsLastPage && runsPage > Math.max(1, runsLastPage)) {
      setRunsPage(Math.max(1, runsLastPage))
    }
  }, [runsLastPage, runsPage])

  if (semesterId === null) {
    if (context.isLoading) return <LoadingState label="正在载入学期…" />
    return (
      <>
        <PageHeader title="自动排课" />
        <EmptyList title="尚未设置当前学期" description="请先设置当前开放学期。" />
      </>
    )
  }

  const start = async () => {
    if (!preparation.data?.etag || (scopeType !== "all" && scopeIds.length === 0)) return
    setStarting(true)
    try {
      const result = await api<ScheduleRun>(`/api/v1/semesters/${semesterId}/schedule-runs`, {
        method: "POST",
        etag: preparation.data.etag,
        body: JSON.stringify({
          scope: { type: scopeType, ids: scopeType === "all" ? [] : scopeIds },
          preservation: { keep_locked: keepLocked, keep_current: mode === "fill" },
          strategy: { profile: "balanced" },
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
    scopeType === "all" && mode === "rebuild" && keepLocked && candidateCount === 1
  const resetRecommended = () => {
    setScopeType("all")
    setScopeIds([])
    setMode("rebuild")
    setKeepLocked(true)
    setCandidateCount(1)
  }
  const runTotal = runsPagination?.total ?? runs.data?.data.length ?? 0
  const canStart =
    preparation.data?.data.ready === true && (scopeType === "all" || scopeIds.length > 0)
  const scopeSummary =
    scopeType === "all" ? "全校" : `${scopeName(scopeType)} · 已选 ${scopeIds.length} 项`
  return (
    <>
      <PageHeader
        title="自动排课"
        description="按本次排课需求生成候选课表。生成后先预览，确认采用后才会影响当前课表。"
      />
      <SchedulingWorkflow />
      <div className="flex justify-end px-4 pt-4 md:px-7">
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link to={semesterPath(semesterId, "planning")} />}
        >
          手工编排课表
        </Button>
      </div>
      <div className="mx-auto w-full max-w-[1480px] space-y-5 p-4 md:p-6">
        {runId ? (
          activeRun.isLoading ? (
            <LoadingState label="正在恢复任务状态…" />
          ) : activeRun.isError || !activeRun.data ? (
            <ErrorState retry={() => void activeRun.refetch()} />
          ) : (
            <RunWorkspace
              run={activeRun.data.data}
              stale={activeRun.data.meta?.is_stale === true}
              etag={activeRun.data.etag}
              onCancel={() => void cancel()}
              onBack={() => setParams((current) => mergeSearchParams(current, { run: null }))}
              onPreview={setPreview}
              onAdopt={(candidate, activate) => setAdopting({ candidate, activate })}
            />
          )
        ) : preparation.isLoading ? (
          <LoadingState />
        ) : preparation.isError || !preparation.data ? (
          <ErrorState retry={() => void preparation.refetch()} />
        ) : (
          <section className="surface-panel overflow-hidden">
            <div className="flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold">生成新方案</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  推荐设置适用于大多数排课场景。生成后先预览，确认采用后才会影响当前课表。
                </p>
              </div>
              <div
                className={cn(
                  "inline-flex w-fit items-center gap-2 text-sm font-medium",
                  preparation.data.data.ready ? "text-emerald-700" : "text-rose-700",
                )}
              >
                {preparation.data.data.ready ? (
                  <CheckCircle2Icon className="size-4" />
                ) : (
                  <AlertTriangleIcon className="size-4" />
                )}
                {preparation.data.data.ready
                  ? "可以开始生成"
                  : `${preparation.data.data.summary.blocking} 项阻塞`}
              </div>
            </div>

            <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold">{isRecommended ? "推荐设置" : "当前设置"}</p>
                  {isRecommended && (
                    <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                      推荐
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  {mode === "rebuild" ? "全部课程重新排" : "只安排未排课程"}
                  {` · ${scopeSummary} · ${candidateCount} 个方案`}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  本次涉及 {selectedEntryCount} 节课 · 预计
                  {candidateCount === 3 ? " 1–3 分钟" : " 10–60 秒"}
                  {keepLocked ? " · 锁定课程保持原位" : ""}
                </p>
              </div>

              <div className="flex flex-wrap gap-2 lg:justify-end">
                {preparation.data.data.ready ? (
                  <Button disabled={starting || !canStart} onClick={() => void start()}>
                    {starting ? <LoaderCircleIcon className="animate-spin" /> : <SparklesIcon />}
                    {starting ? "正在创建任务…" : "开始生成方案"}
                  </Button>
                ) : (
                  <Button
                    nativeButton={false}
                    render={<Link to={semesterPath(semesterId, "preparation")} />}
                  >
                    处理阻塞项
                    <ArrowRightIcon />
                  </Button>
                )}
                <Button variant="outline" onClick={() => setCustomOpen((value) => !value)}>
                  <Settings2Icon />
                  {customOpen ? "收起设置" : "调整设置"}
                </Button>
              </div>
            </div>

            {customOpen && (
              <div className="border-t bg-muted/10">
                <div className="divide-y">
                  <div className="grid gap-3 px-5 py-4 md:grid-cols-[9rem_minmax(0,1fr)] md:items-start">
                    <p className="pt-2 text-sm font-medium">排课方式</p>
                    <div className="min-w-0">
                      <Segmented
                        value={mode}
                        onChange={(value) => setMode(value as "rebuild" | "fill")}
                        options={[
                          { value: "rebuild", label: "全部重新排" },
                          { value: "fill", label: "只排未安排课程" },
                        ]}
                      />
                      <p className="mt-2 text-xs text-muted-foreground">
                        {mode === "rebuild"
                          ? "本次范围内的课程全部重新安排。"
                          : "保留已有课表，只安排还没有排上的课程。"}
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-3 px-5 py-4 md:grid-cols-[9rem_minmax(0,1fr)] md:items-start">
                    <p className="pt-2 text-sm font-medium">生成几个方案</p>
                    <div className="min-w-0">
                      <Segmented
                        value={String(candidateCount)}
                        onChange={(value) => setCandidateCount(Number(value) as 1 | 3)}
                        options={[
                          { value: "1", label: "生成 1 个" },
                          { value: "3", label: "生成 3 个" },
                        ]}
                      />
                      <p className="mt-2 text-xs text-muted-foreground">
                        {candidateCount === 1
                          ? "生成 1 个结果，速度更快。"
                          : "生成 3 个不同结果，完成后可以逐个比较。"}
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-3 px-5 py-4 md:grid-cols-[9rem_minmax(0,1fr)] md:items-start">
                    <p className="pt-2 text-sm font-medium">排课范围</p>
                    <div className="min-w-0">
                      <Segmented
                        value={scopeType}
                        onChange={(value) => {
                          setScopeType(value as ScopeType)
                          setScopeIds([])
                        }}
                        options={[
                          { value: "all", label: "全校" },
                          { value: "grade", label: "指定年级" },
                          { value: "class", label: "指定班级" },
                          { value: "assignment", label: "指定任课关系" },
                        ]}
                      />
                      <p className="mt-2 text-xs text-muted-foreground">
                        {scopeType === "all"
                          ? "全校所有已确认的任课关系参与本次排课。"
                          : scopeType === "grade"
                            ? "只为下方选中的年级进行本次排课。"
                            : scopeType === "class"
                              ? "只为下方选中的班级进行本次排课。"
                              : "只处理下方选中的任课关系。"}
                      </p>
                      {scopeType !== "all" && (
                        <div className="mt-3">
                          {assignments.isLoading || classSettings.isLoading ? (
                            <LoadingState label="正在载入可选范围…" />
                          ) : assignments.isError || classSettings.isError ? (
                            <ErrorState
                              retry={() => {
                                void assignments.refetch()
                                void classSettings.refetch()
                              }}
                            />
                          ) : (
                            <ScopePicker
                              options={options}
                              selected={scopeIds}
                              onChange={setScopeIds}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="grid gap-3 px-5 py-4 md:grid-cols-[9rem_minmax(0,1fr)] md:items-start">
                    <p className="pt-2 text-sm font-medium">保留锁定安排</p>
                    <div className="min-w-0 pt-1.5">
                      <label className="flex cursor-pointer items-center gap-2 text-sm">
                        <Checkbox
                          checked={keepLocked}
                          onCheckedChange={(checked) => setKeepLocked(Boolean(checked))}
                        />
                        保持锁定课程位置不变
                      </label>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {keepLocked
                          ? "已锁定课程保持原位置，不参与重新安排。"
                          : "已锁定课程也会参与本次重新安排。"}
                      </p>
                    </div>
                  </div>
                </div>

                {!isRecommended && (
                  <div className="flex justify-end border-t px-5 py-3">
                    <Button variant="ghost" size="sm" onClick={resetRecommended}>
                      <RotateCcwIcon />
                      恢复推荐设置
                    </Button>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        <section className="surface-panel overflow-hidden">
          <button
            type="button"
            className="flex min-h-14 w-full items-center gap-3 px-5 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/20"
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen((value) => !value)}
          >
            <Clock3Icon className="size-4 shrink-0 text-muted-foreground" />
            <span className="text-sm font-semibold">历史生成记录</span>
            <span className="text-xs text-muted-foreground">{runTotal} 条</span>
            <ChevronDownIcon
              className={cn(
                "ml-auto size-4 shrink-0 text-muted-foreground transition-transform",
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
                <EmptyList
                  title="还没有生成记录"
                  description="完成上方设置后开始第一次方案生成。"
                />
              ) : (
                <>
                  <Table responsive>
                    <TableHeader>
                      <TableRow>
                        <TableHead>任务</TableHead>
                        <TableHead>排课范围</TableHead>
                        <TableHead>排课偏好</TableHead>
                        <TableHead>进度</TableHead>
                        <TableHead>方案数</TableHead>
                        <TableHead>创建时间</TableHead>
                        <TableHead className="text-right">操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {runs.data.data.map((run) => (
                        <TableRow key={run.id}>
                          <TableCell data-label="任务" className="font-medium">
                            #{run.id}
                          </TableCell>
                          <TableCell data-label="排课范围">{scopeName(run.scope.type)}</TableCell>
                          <TableCell data-label="排课偏好">
                            {strategyName(run.strategy.profile)}
                          </TableCell>
                          <TableCell data-label="进度">
                            <RunStatus status={run.status} percent={run.progress_percent} />
                          </TableCell>
                          <TableCell data-label="方案数">{run.candidates_count ?? 0}</TableCell>
                          <TableCell data-label="创建时间">{formatDate(run.created_at)}</TableCell>
                          <TableCell data-label="操作" className="text-right">
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
        onSaved={async (version) => {
          await Promise.all([
            client.invalidateQueries({ queryKey: ["semester", semesterId] }),
            client.invalidateQueries({ queryKey: ["timetable", semesterId] }),
            client.invalidateQueries({ queryKey: ["timetable-versions", semesterId] }),
          ])
          void navigate(
            `${semesterPath(semesterId ?? 0, "planning")}?version=${version.id}&created=${version.status === "active" ? "current" : "draft"}`,
          )
        }}
      />
    </>
  )
}

function RunWorkspace({
  run,
  stale,
  onCancel,
  onBack,
  onPreview,
  onAdopt,
}: {
  run: ScheduleRun
  stale: boolean
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
              硬冲突和未排课程均为 0 才可采用；达到综合质量与关键分项底线后才会标记为推荐。
            </p>
            {stale && (
              <p role="status" className="mt-2 text-sm text-amber-700 dark:text-amber-300">
                排课输入或基础课表已变化，候选方案仅供查看，请新建任务重新生成。
              </p>
            )}
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            {run.candidates?.map((candidate) => (
              <CandidateCard
                key={candidate.id}
                candidate={candidate}
                best={candidate.rank === 1}
                stale={stale}
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
  stale,
  onPreview,
  onAdopt,
}: {
  candidate: ScheduleCandidate
  best: boolean
  stale: boolean
  onPreview: () => void
  onAdopt: (candidate: ScheduleCandidate, activate: boolean) => void
}) {
  const score = Number(candidate.quality_score ?? 0)
  const assessment = assessCandidateQuality(candidate)
  const feasible =
    !stale && candidate.hard_conflict_count === 0 && candidate.unscheduled_count === 0
  const recommended = best && assessment.eligible
  return (
    <article
      className={cn(
        "rounded-2xl border bg-background p-4",
        recommended &&
          "border-primary/40 shadow-[0_8px_30px_color-mix(in_oklch,var(--primary)_8%,transparent)]",
        best && !recommended && "border-amber-300 bg-amber-50/25 dark:border-amber-700",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">{candidate.name}</h3>
            {best && (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-medium",
                  recommended
                    ? "bg-primary/10 text-primary"
                    : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
                )}
              >
                {recommended ? "推荐" : "当前最高分 · 未达推荐线"}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {candidate.unscheduled_count === 0
              ? "完整排满"
              : `未排 ${candidate.unscheduled_count} 节`}{" "}
            · 硬冲突 {candidate.hard_conflict_count}
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
        <Score label="主课时段" value={candidate.score_breakdown.core_course_priority} />
        <Score
          label="连排与间隔"
          value={candidate.score_breakdown.session_spacing}
          active={candidate.score_breakdown.weights?.session_spacing !== 0}
        />
        <Score
          label="学校规则"
          value={candidate.score_breakdown.custom_rules}
          active={candidate.score_breakdown.weights?.custom_rules !== 0}
        />
      </dl>
      {!assessment.eligible && (
        <div
          role="note"
          className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 dark:border-amber-800 dark:bg-amber-950/45 dark:text-amber-200"
        >
          <p className="font-medium">未达到推荐质量线</p>
          <p>{assessment.reasons.join("；")}。建议调整生成策略或人工复核后再发布。</p>
        </div>
      )}
      <details className="mt-3 rounded-lg bg-muted/30 px-3 py-2 text-xs">
        <summary className="cursor-pointer font-medium">查看扣分明细</summary>
        <div className="mt-2 grid gap-1 text-muted-foreground">
          <span>教师空堂 {candidate.score_breakdown.teacher_gaps}</span>
          <span>同科同日重复 {candidate.score_breakdown.same_course_same_day_repeats}</span>
          <span>连续授课提醒 {candidate.score_breakdown.consecutive_over_preference}</span>
          <span>班级日负荷差 {candidate.score_breakdown.class_daily_imbalance}</span>
          <span>教室变化 {candidate.score_breakdown.room_changes}</span>
          <span>教室稳定分 {candidate.score_breakdown.room_stability}</span>
          <span>主课优先分 {candidate.score_breakdown.core_course_priority}</span>
          {candidate.score_breakdown.weights?.stability !== 0 && (
            <span>相对当前变化 {candidate.score_breakdown.changes_from_current}</span>
          )}
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
        <Button variant="outline" disabled={!feasible} onClick={() => onAdopt(candidate, false)}>
          采用为草稿
        </Button>
        <Button
          className="col-span-2"
          disabled={!feasible}
          onClick={() => onAdopt(candidate, true)}
        >
          <CheckCircle2Icon />
          发布课表
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
  const [view, setView] = useState<TimetableView>("class")
  const [resourceId, setResourceId] = useState("")
  const [full, setFull] = useState(false)
  const assignmentsQuery = useQuery({
    queryKey: ["teaching-assignments", semesterId, "confirmed"],
    queryFn: () =>
      apiAllPages<TeachingAssignment>(
        `/api/v1/semesters/${semesterId}/teaching-assignments?status=confirmed`,
      ),
    enabled: open,
  })
  const classSettingsQuery = useQuery({
    queryKey: ["class-settings", semesterId],
    queryFn: () => apiAllPages<ClassSetting>(`/api/v1/semesters/${semesterId}/class-settings`),
    enabled: open,
  })
  const assignments = useMemo(
    () => assignmentsQuery.data?.data ?? [],
    [assignmentsQuery.data?.data],
  )
  const classSettings = useMemo(
    () => classSettingsQuery.data?.data ?? [],
    [classSettingsQuery.data?.data],
  )
  const rooms = useQuery({
    queryKey: ["rooms"],
    queryFn: () => apiAllPages<Room>("/api/v1/rooms"),
    enabled: open,
  })
  const template = useQuery({
    queryKey: ["schedule-template", semesterId],
    queryFn: () => api<ScheduleTemplate>(`/api/v1/semesters/${semesterId}/schedule-template`),
    enabled: open,
  })
  const resources = useMemo(() => {
    if (view === "class")
      return classSettings.map((setting) => ({
        id: setting.school_class_id,
        name: setting.school_class.name,
      }))
    if (view === "teacher")
      return Array.from(
        new Map(
          assignments
            .flatMap((assignment) => [assignment.teacher, ...assignment.collaborators])
            .map((teacher) => [teacher.id, { id: teacher.id, name: teacher.name }]),
        ).values(),
      ).sort((left, right) => left.name.localeCompare(right.name, "zh-CN"))
    return (rooms.data?.data ?? []).map((room) => ({ id: room.id, name: room.name }))
  }, [assignments, classSettings, rooms.data?.data, view])
  const resourceIndex = resources.findIndex((resource) => String(resource.id) === resourceId)
  const resourceQuery =
    view === "class" ? classSettingsQuery : view === "teacher" ? assignmentsQuery : rooms
  useEffect(() => {
    if (open) {
      setView("class")
      setFull(false)
    }
  }, [open, candidate?.id])
  useEffect(() => {
    setResourceId((current) =>
      resources.some((resource) => String(resource.id) === current)
        ? current
        : String(resources[0]?.id ?? ""),
    )
  }, [resources])
  const resourceFilter =
    view === "class" ? "school_class_id" : view === "teacher" ? "teacher_id" : "room_id"
  const detail = useQuery({
    queryKey: ["schedule-candidate-grid", semesterId, runId, candidate?.id, view, resourceId],
    queryFn: () =>
      fetchCandidateEntries(
        `/api/v1/semesters/${semesterId}/schedule-runs/${runId}/candidates/${candidate?.id}`,
        resourceFilter,
        resourceId,
      ),
    enabled: open && candidate !== null && Boolean(resourceId),
  })
  const gridData = useMemo(() => {
    if (!template.data?.data || !detail.data?.data) return null
    return {
      view,
      days: template.data.data.days
        .filter((day) => day.is_enabled)
        .sort((left, right) => left.weekday - right.weekday),
      items: template.data.data.items
        .filter((item) => item.is_active && (full ? item.show_in_full : item.show_in_official))
        .sort((left, right) => left.sort_order - right.sort_order),
      entries: detail.data.data.entries.map(candidateEntryToTimetableEntry),
    }
  }, [detail.data?.data, full, template.data?.data, view])
  const moveResource = (offset: number) => {
    const next = resources[resourceIndex + offset]
    if (next) setResourceId(String(next.id))
  }
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex max-h-[calc(100svh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
        <DialogHeader className="border-b p-6 pr-16">
          <DialogTitle>{candidate?.name} · 课表预览</DialogTitle>
          <DialogDescription>
            与最终课表使用相同视图；可按班级、教师或教室检查候选方案。
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2 border-b px-6 py-4">
          <Tabs value={view} onValueChange={(value) => setView(value as TimetableView)}>
            <TabsList>
              <TabsTrigger value="class">班级</TabsTrigger>
              <TabsTrigger value="teacher">教师</TabsTrigger>
              <TabsTrigger value="room">教室</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button
            variant="outline"
            size="icon"
            aria-label="上一个资源"
            disabled={resourceIndex <= 0}
            onClick={() => moveResource(-1)}
          >
            <ChevronLeftIcon />
          </Button>
          {view === "class" ? (
            <ClassPicker
              className="min-w-64"
              classes={classSettings.map((setting) => setting.school_class)}
              value={resourceId}
              onValueChange={setResourceId}
            />
          ) : view === "teacher" ? (
            <TeacherPicker
              className="min-w-64"
              teachers={teachersWithAssignmentCourses(assignments)}
              value={resourceId}
              onValueChange={setResourceId}
            />
          ) : (
            <RoomPicker
              className="min-w-64"
              rooms={rooms.data?.data ?? []}
              value={resourceId}
              onValueChange={setResourceId}
            />
          )}
          <Button
            variant="outline"
            size="icon"
            aria-label="下一个资源"
            disabled={resourceIndex < 0 || resourceIndex >= resources.length - 1}
            onClick={() => moveResource(1)}
          >
            <ChevronRightIcon />
          </Button>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={full} onCheckedChange={(checked) => setFull(Boolean(checked))} />
            完整作息
          </label>
          {detail.data?.data.is_stale && (
            <span className="ml-auto text-sm text-amber-700 dark:text-amber-300">
              基于旧输入，仅可查看
            </span>
          )}
        </div>
        <div className="grid min-h-0 flex-1 p-6">
          <div className="min-h-0 overflow-auto pr-1">
            {resourceQuery.isLoading || (resources.length > 0 && !resourceId) ? (
              <LoadingState />
            ) : resourceQuery.isError ? (
              <ErrorState retry={() => void resourceQuery.refetch()} />
            ) : !resourceId ? (
              <EmptyList title="没有可查看的资源" description="请先配置班级、任课关系或教室。" />
            ) : detail.isLoading || template.isLoading ? (
              <LoadingState />
            ) : detail.isError || template.isError || !gridData ? (
              <ErrorState
                retry={() => {
                  void detail.refetch()
                  void template.refetch()
                }}
              />
            ) : (
              <TimetableGrid data={gridData} />
            )}
          </div>
        </div>
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
  onSaved: (version: TimetableVersion) => Promise<void>
}) {
  const [name, setName] = useState("")
  const [reason, setReason] = useState("")
  const [qualityAcknowledged, setQualityAcknowledged] = useState(false)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    setName(value ? `${value.candidate.name}${value.activate ? " · 当前课表" : " · 调整草稿"}` : "")
    setReason("")
    setQualityAcknowledged(false)
  }, [value])
  const quality = value ? assessCandidateQuality(value.candidate) : null
  const publicationPreview = useQuery({
    queryKey: ["candidate-publication-preview", semesterId, runId, value?.candidate.id],
    enabled: Boolean(value?.activate && value),
    queryFn: () =>
      api<TimetablePublicationPreview>(
        `/api/v1/semesters/${semesterId}/schedule-runs/${runId}/candidates/${value!.candidate.id}/adopt-preview`,
        {
          method: "POST",
          body: JSON.stringify({ name: value!.candidate.name }),
        },
      ),
  })
  const publication = publicationPreview.data?.data
  const publicationBlocked = Boolean(
    value?.activate &&
    (publicationPreview.isLoading || publicationPreview.isError || publication?.allowed === false),
  )
  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (
      !value ||
      !etag ||
      (value.activate && reason.trim().length < 2) ||
      (value.activate && quality && !quality.eligible && !qualityAcknowledged) ||
      publicationBlocked
    )
      return
    setSaving(true)
    try {
      const result = await api<TimetableVersion>(
        `/api/v1/semesters/${semesterId}/schedule-runs/${runId}/candidates/${value.candidate.id}/adopt`,
        {
          method: "POST",
          etag,
          body: JSON.stringify({
            name: name.trim() || null,
            activate: value.activate,
            reason: value.activate ? reason.trim() : null,
          }),
        },
      )
      toast.success(
        value.activate ? "课表已发布，原版本已保留在历史记录中" : "已创建可编辑课表草稿",
      )
      onClose()
      await onSaved(result.data)
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
          <DialogTitle>{value?.activate ? "发布课表" : "采用为编辑草稿"}</DialogTitle>
          <DialogDescription>
            {value?.activate
              ? "发布前会检查课表完整性，并确认现有临时调课和代课能否安全迁移。"
              : "候选方案将复制成独立草稿，你可以继续手工调整。"}
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={(event) => void save(event)}>
          <Field label="版本名称">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：当前课表 v2"
            />
          </Field>
          {value?.activate && (
            <Field
              label="发布说明（必填）"
              error={
                reason.length > 0 && reason.trim().length < 2 ? "请填写至少 2 个字" : undefined
              }
            >
              <Input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="例如：采用本次自动排课方案"
                autoFocus
                aria-invalid={reason.length > 0 && reason.trim().length < 2}
              />
            </Field>
          )}
          {value?.activate && (
            <div
              className={cn(
                "rounded-xl border p-3 text-sm",
                publication?.allowed === false
                  ? "border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/30"
                  : "bg-muted/20",
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium">发布影响</span>
                {publicationPreview.isLoading ? (
                  <span className="text-xs text-muted-foreground">检查中…</span>
                ) : publicationPreview.isError ? (
                  <span className="text-xs text-destructive">检查失败</span>
                ) : publication ? (
                  <span
                    className={cn(
                      "text-xs",
                      publication.allowed ? "text-emerald-600" : "text-amber-700",
                    )}
                  >
                    {publication.allowed ? "可以发布" : "需要先处理"}
                  </span>
                ) : null}
              </div>
              {publication && (
                <div className="mt-2 space-y-2 text-xs text-muted-foreground">
                  <p>
                    本学期 · 自动迁移 {publication.impact.preserved} 项
                    {publication.impact.needs_review + publication.impact.orphaned > 0
                      ? ` · 待处理 ${publication.impact.needs_review + publication.impact.orphaned} 项`
                      : ""}
                  </p>
                  {publication.impact.items
                    .filter((item) => item.status === "needs_review" || item.status === "orphaned")
                    .slice(0, 4)
                    .map((item) => (
                      <div
                        key={`${item.kind}:${item.id}`}
                        className="rounded-lg border bg-background px-2.5 py-2"
                      >
                        <p className="font-medium text-foreground">
                          {item.effective_date} · {item.summary}
                        </p>
                        <p className="mt-0.5 leading-5">{item.reason}</p>
                      </div>
                    ))}
                  {!publication.allowed && (
                    <p className="leading-5">
                      请先在
                      <Link
                        className="mx-1 font-medium text-foreground underline underline-offset-4"
                        to={semesterPath(semesterId, "adjustments")}
                      >
                        临时调课
                      </Link>
                      或
                      <Link
                        className="mx-1 font-medium text-foreground underline underline-offset-4"
                        to={semesterPath(semesterId, "leaves")}
                      >
                        请假与代课
                      </Link>
                      中处理，再重新发布。
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
          {value?.activate && quality && !quality.eligible && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/45 dark:text-amber-200">
              <p className="font-medium">该方案未达到推荐质量线</p>
              <p className="mt-1 text-xs leading-5">{quality.reasons.join("；")}。</p>
              <label className="mt-3 flex items-start gap-2">
                <Checkbox
                  checked={qualityAcknowledged}
                  onCheckedChange={(checked) => setQualityAcknowledged(checked === true)}
                />
                <span>我已了解上述质量风险，并会在切换后继续人工复核。</span>
              </label>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button
              type="submit"
              disabled={
                saving ||
                Boolean(value?.activate && reason.trim().length < 2) ||
                Boolean(value?.activate && quality && !quality.eligible && !qualityAcknowledged) ||
                publicationBlocked
              }
            >
              {saving ? "处理中…" : value?.activate ? "确认发布" : "创建草稿"}
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
  const filteredIds = filtered.map((item) => item.id)
  const allFilteredSelected =
    filteredIds.length > 0 && filteredIds.every((id) => selected.includes(id))
  return (
    <div className="overflow-hidden rounded-xl border">
      <div className="flex items-center gap-2 border-b p-2">
        <Input
          surface="filter"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜索范围对象"
        />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={filteredIds.length === 0}
          onClick={() =>
            onChange(
              allFilteredSelected
                ? selected.filter((id) => !filteredIds.includes(id))
                : [...new Set([...selected, ...filteredIds])],
            )
          }
        >
          {allFilteredSelected ? "取消全选" : "全选"}
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
function Score({
  label,
  value,
  active = true,
}: {
  label: string
  value: number
  active?: boolean
}) {
  return (
    <div className="rounded-lg bg-muted/30 p-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-semibold tabular-nums">
        {active ? Number(value).toFixed(1) : "未配置"}
      </dd>
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
      label: `${item.school_class?.name ?? item.teaching_group?.name ?? `教学组 #${item.teaching_group_id}`} · ${item.course.name}`,
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

interface CandidateDetail {
  candidate: ScheduleCandidate
  entries: ScheduleCandidateEntry[]
  is_stale: boolean
}

async function fetchCandidateEntries(path: string, filter: string, resourceId: string) {
  const fetchPage = (page: number) =>
    api<CandidateDetail>(
      `${path}?per_page=100&page=${page}&${filter}=${encodeURIComponent(resourceId)}`,
    )
  const first = await fetchPage(1)
  const entries = [...first.data.entries]
  const lastPage = paginationOf(first.meta)?.last_page ?? 1
  for (let page = 2; page <= lastPage; page += 1) {
    const result = await fetchPage(page)
    entries.push(...result.data.entries)
  }
  return { ...first, data: { ...first.data, entries } }
}

function candidateEntryToTimetableEntry(entry: ScheduleCandidateEntry): TimetableEntry {
  const assignment = entry.teaching_assignment
  const schoolClasses = assignment.school_class
    ? [assignment.school_class]
    : (assignment.teaching_group?.school_classes ?? [])
  return {
    id: entry.id,
    timetable_version_id: 0,
    teaching_assignment_id: entry.teaching_assignment_id,
    school_class_id: assignment.school_class_id,
    teaching_group_id: assignment.teaching_group_id,
    teacher_id: assignment.teacher_id,
    course_id: assignment.course_id,
    actual_room_id: entry.actual_room_id,
    week_pattern: entry.week_pattern,
    active_weeks: entry.active_weeks,
    weekday: entry.weekday,
    item_id: entry.item_id,
    is_locked: entry.is_locked,
    school_class: assignment.school_class,
    teaching_group: assignment.teaching_group,
    school_classes: schoolClasses,
    course: assignment.course,
    teacher: assignment.teacher,
    teachers: [assignment.teacher, ...assignment.collaborators],
    actual_room: entry.actual_room,
    item: entry.item,
  }
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
