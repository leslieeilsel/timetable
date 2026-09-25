import { useAuth } from "@/lib/auth"
import {
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Navigate, useLocation } from "react-router"
import { CircleHelpIcon, PlusIcon } from "lucide-react"
import { toast } from "sonner"
import { api, apiAllPages, apiMessage } from "@/lib/api"
import { TEACHING_GROUPS_ENABLED } from "@/lib/features"
import {
  supportsConstraintKindCategory,
  unsupportedConstraintReason,
} from "@/lib/scheduling-constraint-support"
import { semesterPath, useResolvedSemesterId } from "@/lib/semester"
import type {
  ClassSetting,
  Course,
  FixedPlacement,
  PaginationMeta,
  Room,
  ScheduleTemplate,
  SchedulingConstraint,
  Teacher,
  TeachingAssignment,
  WeekPattern,
} from "@/lib/types"
import { EmptyList, ErrorState, Field, LoadingState, PageHeader } from "@/components/page"
import { GridSelectionOverlay } from "@/components/grid-selection-frame"
import { ListToolbar, ToolbarSelect } from "@/components/list-toolbar"
import { AssignmentPicker, RoomPicker } from "@/components/resource-picker"
import { SimpleSelect } from "@/components/simple-select"
import { StatusBadge } from "@/components/status-badge"
import {
  SearchableMultiPicker,
  SearchablePicker,
  type SearchableOption,
} from "@/components/searchable-picker"
import { TableActionButton } from "@/components/table-action-button"
import { TablePagination } from "@/components/table-pagination"
import {
  enumParam,
  mergeSearchParams,
  positiveIntegerParam,
  useHashPreservingSearchParams,
} from "@/lib/url-state"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"

const weekdayNames = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"]

export function SchedulingConstraintsPage() {
  const { semesterId } = useResolvedSemesterId()
  const { search, hash } = useLocation()
  const params = new URLSearchParams(search)
  if (semesterId && params.get("tab") === "fixed") {
    params.delete("tab")
    return (
      <Navigate
        to={{
          pathname: semesterPath(semesterId, "fixed-placements"),
          search: params.toString(),
          hash,
        }}
        replace
      />
    )
  }
  return <SchedulingConfigurationPage key="rules" section="rules" />
}

export function FixedPlacementsPage() {
  return <SchedulingConfigurationPage key="fixed" section="fixed" />
}

function SchedulingConfigurationPage({ section }: { section: "rules" | "fixed" }) {
  const { semesterId, context } = useResolvedSemesterId()
  const client = useQueryClient()
  const [urlParams, setUrlParams] = useHashPreservingSearchParams()
  const [search, setSearch] = useState(() => urlParams.get("q") ?? "")
  const deferredSearch = useDeferredValue(search)
  const [kind, setKind] = useState(() =>
    enumParam(urlParams, "kind", ["all", "hard", "soft"], "all"),
  )
  const [status, setStatus] = useState(() =>
    enumParam(urlParams, "status", ["all", "active", "draft", "inactive"], "all"),
  )
  const [rulePage, setRulePage] = useState(() => positiveIntegerParam(urlParams, "page", 1))
  const [rulePageSize, setRulePageSize] = useState(() =>
    positiveIntegerParam(urlParams, "per_page", 20, [20, 50, 100]),
  )
  const [placementPage, setPlacementPage] = useState(() =>
    positiveIntegerParam(urlParams, "fixed_page", 1),
  )
  const [placementPageSize, setPlacementPageSize] = useState(() =>
    positiveIntegerParam(urlParams, "fixed_per_page", 20, [20, 50, 100]),
  )
  const [editingRule, setEditingRule] = useState<SchedulingConstraint | null | undefined>(undefined)
  const [editingPlacement, setEditingPlacement] = useState<FixedPlacement | null | undefined>(
    undefined,
  )
  const [pendingDelete, setPendingDelete] = useState<
    | { type: "rule"; value: SchedulingConstraint }
    | { type: "placement"; value: FixedPlacement }
    | null
  >(null)
  const focusId = Number(urlParams.get("focus"))
  const openedFocus = useRef("")
  const focusedRecord = useQuery({
    queryKey: ["constraint-repair-focus", semesterId, section, focusId],
    enabled: semesterId !== null && Number.isSafeInteger(focusId) && focusId > 0,
    queryFn: async () =>
      (
        await apiAllPages<FixedPlacement | SchedulingConstraint>(
          `/api/v1/semesters/${semesterId}/${section === "fixed" ? "fixed-placements" : "scheduling-constraints"}`,
        )
      ).data,
  })
  useEffect(() => {
    const key = `${section}:${focusId}`
    if (!focusedRecord.data || openedFocus.current === key) return
    openedFocus.current = key
    const record = focusedRecord.data.find((item) => item.id === focusId)
    if (!record) {
      toast.error("该设置已不存在，请核对问题清单。")
      return
    }
    if (section === "fixed") setEditingPlacement(record as FixedPlacement)
    else setEditingRule(record as SchedulingConstraint)
  }, [focusedRecord.data, focusId, section])

  const didMountRuleFilters = useRef(false)
  useEffect(() => {
    if (!didMountRuleFilters.current) {
      didMountRuleFilters.current = true
      return
    }
    setRulePage(1)
  }, [deferredSearch, kind, status])
  useEffect(() => {
    setUrlParams(
      (current) =>
        mergeSearchParams(current, {
          tab: null,
          q: search.trim() || null,
          kind: kind === "all" ? null : kind,
          status: status === "all" ? null : status,
          page: rulePage === 1 ? null : rulePage,
          per_page: rulePageSize === 20 ? null : rulePageSize,
          fixed_page: placementPage === 1 ? null : placementPage,
          fixed_per_page: placementPageSize === 20 ? null : placementPageSize,
        }),
      { replace: true },
    )
  }, [kind, placementPage, placementPageSize, rulePage, rulePageSize, search, setUrlParams, status])
  const rules = useQuery({
    queryKey: [
      "scheduling-constraints",
      semesterId,
      deferredSearch,
      kind,
      status,
      rulePage,
      rulePageSize,
    ],
    queryFn: () => {
      const query = new URLSearchParams({ page: String(rulePage), per_page: String(rulePageSize) })
      if (deferredSearch.trim()) query.set("search", deferredSearch.trim())
      if (kind !== "all") query.set("kind", kind)
      if (status !== "all") query.set("status", status)
      return api<SchedulingConstraint[]>(
        `/api/v1/semesters/${semesterId}/scheduling-constraints?${query}`,
      )
    },
    enabled: semesterId !== null && section === "rules",
  })
  const placements = useQuery({
    queryKey: ["fixed-placements", semesterId, placementPage, placementPageSize],
    queryFn: () =>
      api<FixedPlacement[]>(
        `/api/v1/semesters/${semesterId}/fixed-placements?page=${placementPage}&per_page=${placementPageSize}`,
      ),
    enabled: semesterId !== null && section === "fixed",
  })
  const template = useQuery({
    queryKey: ["schedule-template", semesterId],
    queryFn: () => api<ScheduleTemplate>(`/api/v1/semesters/${semesterId}/schedule-template`),
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
  const teachers = useQuery({
    queryKey: ["teachers"],
    queryFn: () => apiAllPages<Teacher>("/api/v1/teachers"),
  })
  const courses = useQuery({
    queryKey: ["courses"],
    queryFn: () => apiAllPages<Course>("/api/v1/courses"),
  })
  const rooms = useQuery({
    queryKey: ["rooms", "all"],
    queryFn: () => apiAllPages<Room>("/api/v1/rooms"),
  })
  const rulePagination = paginationOf(rules.data?.meta)
  const placementPagination = paginationOf(placements.data?.meta)
  const ruleLastPage = rulePagination?.last_page
  const placementLastPage = placementPagination?.last_page
  useEffect(() => {
    if (ruleLastPage && rulePage > Math.max(1, ruleLastPage)) {
      setRulePage(Math.max(1, ruleLastPage))
    }
  }, [ruleLastPage, rulePage])
  useEffect(() => {
    if (placementLastPage && placementPage > Math.max(1, placementLastPage)) {
      setPlacementPage(Math.max(1, placementLastPage))
    }
  }, [placementLastPage, placementPage])

  const invalidate = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["scheduling-constraints", semesterId] }),
      client.invalidateQueries({ queryKey: ["fixed-placements", semesterId] }),
      client.invalidateQueries({ queryKey: ["preparation-check", semesterId] }),
      client.invalidateQueries({ queryKey: ["semester", semesterId] }),
      client.invalidateQueries({ queryKey: ["timetable-versions", semesterId] }),
    ])
  }
  const ruleAction = async (
    rule: SchedulingConstraint,
    action: "activate" | "deactivate" | "delete",
  ) => {
    if (!rules.data?.etag) return
    try {
      await api(
        `/api/v1/semesters/${semesterId}/scheduling-constraints/${rule.id}${action === "delete" ? "" : `/${action}`}`,
        {
          method: action === "delete" ? "DELETE" : "POST",
          etag: rules.data.etag,
        },
      )
      toast.success(
        action === "delete" ? "规则已删除" : action === "activate" ? "规则已启用" : "规则已停用",
      )
      await invalidate()
    } catch (error) {
      toast.error(apiMessage(error))
    }
  }
  const placementAction = async (
    placement: FixedPlacement,
    action: "activate" | "deactivate" | "delete",
  ) => {
    if (!placements.data?.etag) return
    try {
      await api(
        `/api/v1/semesters/${semesterId}/fixed-placements/${placement.id}${action === "delete" ? "" : `/${action}`}`,
        {
          method: action === "delete" ? "DELETE" : "POST",
          etag: placements.data.etag,
        },
      )
      toast.success(
        action === "delete"
          ? "固定安排已删除"
          : action === "activate"
            ? "固定安排已启用"
            : "固定安排已停用；现有课表及课节锁定仍保留",
      )
      await invalidate()
    } catch (error) {
      toast.error(apiMessage(error))
    }
  }
  const confirmDelete = async () => {
    const pending = pendingDelete
    if (!pending) return
    setPendingDelete(null)
    if (pending.type === "rule") {
      await ruleAction(pending.value, "delete")
      return
    }
    await placementAction(pending.value, "delete")
  }

  if (!semesterId && !context.isLoading)
    return (
      <>
        <PageHeader title={section === "rules" ? "排课规则" : "固定安排"} />
        <EmptyList title="尚未设置当前学期" description="请先设置当前开放学期。" />
      </>
    )

  return (
    <>
      <PageHeader title={section === "rules" ? "排课规则" : "固定安排"} />
      <div className="space-y-4 p-4 md:p-7">
        {focusedRecord.isError && (
          <div role="alert" className="rounded-lg border p-3 text-sm">
            无法载入待修复的设置。
            <Button
              className="ml-2"
              variant="outline"
              size="sm"
              onClick={() => void focusedRecord.refetch()}
            >
              重试
            </Button>
          </div>
        )}
        {section === "rules" ? (
          <section className="surface-panel overflow-hidden">
            <ListToolbar
              search={search}
              onSearchChange={setSearch}
              searchPlaceholder="搜索规则名称"
              summary={
                <span>共 {rulePagination?.total ?? rules.data?.data.length ?? 0} 条规则</span>
              }
              actions={
                <Button onClick={() => setEditingRule(null)}>
                  <PlusIcon />
                  新增规则
                </Button>
              }
            >
              <ToolbarSelect value={kind} onChange={setKind} label="规则类型">
                <option value="all">全部类型</option>
                <option value="hard">硬约束</option>
                <option value="soft">软规则</option>
              </ToolbarSelect>
              <ToolbarSelect value={status} onChange={setStatus} label="规则状态">
                <option value="all">全部状态</option>
                <option value="active">启用</option>
                <option value="draft">草稿</option>
                <option value="inactive">停用</option>
              </ToolbarSelect>
            </ListToolbar>
            {rules.isLoading ? (
              <LoadingState />
            ) : rules.isError ? (
              <ErrorState retry={() => void rules.refetch()} />
            ) : !rules.data?.data.length ? (
              <EmptyList title="没有匹配的规则" description="新增一条学校规则，或清空筛选条件。" />
            ) : (
              <>
                <Table responsive>
                  <TableHeader>
                    <TableRow>
                      <TableHead>名称</TableHead>
                      <TableHead>类型</TableHead>
                      <TableHead>作用对象</TableHead>
                      <TableHead>生效范围</TableHead>
                      <TableHead>权重</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rules.data.data.map((rule) => (
                      <TableRow key={rule.id}>
                        <TableCell data-label="名称">
                          <p className="font-medium">{rule.name}</p>
                        </TableCell>
                        <TableCell data-label="类型">
                          <span
                            className={
                              rule.kind === "hard"
                                ? "font-medium text-rose-700"
                                : "font-medium text-blue-700"
                            }
                          >
                            {rule.kind === "hard" ? "硬约束" : "软规则"}
                          </span>
                        </TableCell>
                        <TableCell data-label="作用对象">
                          {targetLabel(rule, {
                            teachers: teachers.data?.data ?? [],
                            courses: courses.data?.data ?? [],
                            rooms: rooms.data?.data ?? [],
                            classSettings: classSettings.data?.data ?? [],
                            assignments: assignments.data?.data ?? [],
                          })}
                        </TableCell>
                        <TableCell data-label="生效范围">{scopeLabel(rule.scope)}</TableCell>
                        <TableCell data-label="权重">{rule.weight ?? "—"}</TableCell>
                        <TableCell data-label="状态">
                          <StatusBadge value={rule.status} />
                          {rule.status !== "active" &&
                            !supportsConstraintKindCategory(rule.kind, rule.category) && (
                              <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                                <span>暂不支持启用</span>
                                <Tooltip>
                                  <TooltipTrigger
                                    delay={150}
                                    render={
                                      <button
                                        type="button"
                                        className="inline-flex size-4 items-center justify-center rounded-full outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                                        aria-label="查看暂不支持启用的原因"
                                      />
                                    }
                                  >
                                    <CircleHelpIcon className="size-3.5" aria-hidden="true" />
                                  </TooltipTrigger>
                                  <TooltipContent sideOffset={6}>
                                    {unsupportedConstraintReason}
                                  </TooltipContent>
                                </Tooltip>
                              </div>
                            )}
                        </TableCell>
                        <TableCell data-label="操作" className="text-right">
                          {rule.source === "system" ? (
                            <span className="text-xs text-muted-foreground">系统内置</span>
                          ) : (
                            <div className="flex items-center justify-end gap-0.5">
                              <TableActionButton intent="edit" onClick={() => setEditingRule(rule)}>
                                编辑
                              </TableActionButton>
                              <TableActionButton
                                intent={rule.status === "active" ? "deactivate" : "activate"}
                                disabled={
                                  rule.status !== "active" &&
                                  !supportsConstraintKindCategory(rule.kind, rule.category)
                                }
                                title={
                                  rule.status !== "active" &&
                                  !supportsConstraintKindCategory(rule.kind, rule.category)
                                    ? unsupportedConstraintReason
                                    : undefined
                                }
                                onClick={() =>
                                  void ruleAction(
                                    rule,
                                    rule.status === "active" ? "deactivate" : "activate",
                                  )
                                }
                              >
                                {rule.status === "active"
                                  ? "停用"
                                  : supportsConstraintKindCategory(rule.kind, rule.category)
                                    ? "启用"
                                    : "暂不支持"}
                              </TableActionButton>
                              <TableActionButton
                                intent="delete"
                                disabled={rule.status === "active"}
                                title={rule.status === "active" ? "请先停用规则" : "删除规则"}
                                onClick={() => setPendingDelete({ type: "rule", value: rule })}
                              >
                                删除
                              </TableActionButton>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {rulePagination && (
                  <TablePagination
                    page={rulePagination.page}
                    pageSize={rulePagination.per_page}
                    totalItems={rulePagination.total}
                    totalPages={rulePagination.last_page}
                    onPageChange={setRulePage}
                    onPageSizeChange={(value) => {
                      setRulePageSize(value)
                      setRulePage(1)
                    }}
                  />
                )}
              </>
            )}
          </section>
        ) : (
          <section className="surface-panel overflow-hidden">
            <ListToolbar
              summary={
                <span>
                  共 {placementPagination?.total ?? placements.data?.data.length ?? 0} 条固定安排
                </span>
              }
              actions={
                <Button onClick={() => setEditingPlacement(null)}>
                  <PlusIcon />
                  新增固定安排
                </Button>
              }
            />
            {placements.isLoading ? (
              <LoadingState />
            ) : placements.isError ? (
              <ErrorState retry={() => void placements.refetch()} />
            ) : !placements.data?.data.length ? (
              <EmptyList
                title="没有固定安排"
                description="为已确认的任课关系指定必须保留的课节。班会等活动请先建立相应课程与任课关系。"
              />
            ) : (
              <>
                <Table responsive>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        {TEACHING_GROUPS_ENABLED ? "班级/教学组 · 课程" : "班级 · 课程"}
                      </TableHead>
                      <TableHead>教师</TableHead>
                      <TableHead>时间</TableHead>
                      <TableHead>教室</TableHead>
                      <TableHead>周型</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {placements.data.data.map((placement) => (
                      <TableRow key={placement.id}>
                        <TableCell
                          data-label={
                            TEACHING_GROUPS_ENABLED ? "班级/教学组 · 课程" : "班级 · 课程"
                          }
                          className="font-medium"
                        >
                          {assignmentTarget(placement.teaching_assignment)} ·{" "}
                          {placement.teaching_assignment.course.name}
                        </TableCell>
                        <TableCell data-label="教师">
                          {placement.teaching_assignment.teacher.name}
                        </TableCell>
                        <TableCell data-label="时间">
                          {weekdayNames[placement.weekday]} · {placement.item.name}
                        </TableCell>
                        <TableCell data-label="教室">
                          {placement.room?.name ?? "按任课关系解析"}
                        </TableCell>
                        <TableCell data-label="周型">
                          {weekPatternLabel(placement.week_pattern)}
                        </TableCell>
                        <TableCell data-label="状态">
                          <StatusBadge value={placement.status} />
                        </TableCell>
                        <TableCell data-label="操作" className="text-right">
                          <div className="flex items-center justify-end gap-0.5">
                            <TableActionButton
                              intent="edit"
                              onClick={() => setEditingPlacement(placement)}
                            >
                              编辑
                            </TableActionButton>
                            <TableActionButton
                              intent={placement.status === "active" ? "deactivate" : "activate"}
                              onClick={() =>
                                void placementAction(
                                  placement,
                                  placement.status === "active" ? "deactivate" : "activate",
                                )
                              }
                            >
                              {placement.status === "active" ? "停用" : "启用"}
                            </TableActionButton>
                            <TableActionButton
                              intent="delete"
                              onClick={() =>
                                setPendingDelete({ type: "placement", value: placement })
                              }
                            >
                              删除
                            </TableActionButton>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {placementPagination && (
                  <TablePagination
                    page={placementPagination.page}
                    pageSize={placementPagination.per_page}
                    totalItems={placementPagination.total}
                    totalPages={placementPagination.last_page}
                    onPageChange={setPlacementPage}
                    onPageSizeChange={(value) => {
                      setPlacementPageSize(value)
                      setPlacementPage(1)
                    }}
                  />
                )}
              </>
            )}
          </section>
        )}
      </div>
      <RuleDialog
        open={editingRule !== undefined}
        value={editingRule ?? null}
        semesterId={semesterId ?? 0}
        etag={rules.data?.etag ?? null}
        template={template.data?.data}
        teachers={teachers.data?.data ?? []}
        courses={courses.data?.data ?? []}
        rooms={rooms.data?.data ?? []}
        classSettings={classSettings.data?.data ?? []}
        assignments={assignments.data?.data ?? []}
        onClose={() => setEditingRule(undefined)}
        onSaved={invalidate}
      />
      <PlacementDialog
        open={editingPlacement !== undefined}
        value={editingPlacement ?? null}
        semesterId={semesterId ?? 0}
        etag={placements.data?.etag ?? null}
        template={template.data?.data}
        assignments={assignments.data?.data ?? []}
        rooms={rooms.data?.data ?? []}
        onClose={() => setEditingPlacement(undefined)}
        onSaved={invalidate}
      />
      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>删除{pendingDelete?.type === "rule" ? "规则" : "固定安排"}</DialogTitle>
            <DialogDescription>
              {pendingDelete?.type === "rule"
                ? `确定删除“${pendingDelete.value.name}”吗？删除后无法恢复。`
                : "删除后取消该位置要求，现有课表不会自动移动或删除课程，已有课节锁定仍需在编排课表中单独解除。"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              取消
            </Button>
            <Button variant="destructive" onClick={() => void confirmDelete()}>
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

type RulePreset =
  | "unavailable"
  | "avoid"
  | "prefer"
  | "distribution"
  | "daily_limit"
  | "consecutive_limit"
  | "spacing"
  | "teacher_gaps"
  | "synchronization"
  | "mutual_exclusion"

type RuleKind = "hard" | "soft"

const rulePresetOptions: Record<RuleKind, { value: RulePreset; label: string }[]> = {
  hard: [
    { value: "unavailable", label: "不可安排指定课节" },
    { value: "daily_limit", label: "每日课时上限" },
    { value: "consecutive_limit", label: "连续授课上限" },
    { value: "spacing", label: "课程最小间隔" },
    { value: "distribution", label: "限制同一课程每日重复" },
    { value: "synchronization", label: "任课关系同步排课" },
    { value: "mutual_exclusion", label: "任课关系错峰 / 互斥" },
  ],
  soft: [
    { value: "avoid", label: "尽量避开指定课节" },
    { value: "prefer", label: "尽量安排到指定课节" },
    { value: "distribution", label: "同课程均匀分布" },
    { value: "daily_limit", label: "每日课时上限" },
    { value: "consecutive_limit", label: "连续授课上限" },
    { value: "spacing", label: "课程最小间隔" },
    { value: "teacher_gaps", label: "减少教师空堂" },
  ],
}

function linkedPresetForKind(preset: RulePreset, kind: RuleKind): RulePreset {
  if (
    rulePresetOptions[kind].some((option) => option.value === preset) &&
    supportsConstraintKindCategory(kind, constraintCategoryForPreset(preset))
  )
    return preset
  if (kind === "hard") {
    return "unavailable"
  }
  return "avoid"
}

function constraintCategoryForPreset(preset: RulePreset) {
  if (preset === "unavailable") return "availability"
  if (preset === "daily_limit") return "daily_load"
  if (preset === "consecutive_limit") return "consecutive_items"
  if (preset === "spacing") return "spacing"
  if (preset === "synchronization") return "synchronization"
  if (preset === "mutual_exclusion") return "mutual_exclusion"
  if (preset === "distribution") return "course_distribution"
  if (preset === "teacher_gaps") return "teacher_gaps"
  return "preferred_slot"
}

function RuleFormSection({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="grid gap-4 border-b pb-5 last:border-b-0 last:pb-0">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  )
}

function RuleFieldGroup({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: ReactNode
}) {
  return (
    <div className="grid gap-2 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  )
}

function RuleDialog({
  open,
  value,
  semesterId,
  etag,
  template,
  teachers,
  courses,
  rooms,
  classSettings,
  assignments,
  onClose,
  onSaved,
}: {
  open: boolean
  value: SchedulingConstraint | null
  semesterId: number
  etag: string | null
  template?: ScheduleTemplate
  teachers: Teacher[]
  courses: Course[]
  rooms: Room[]
  classSettings: ClassSetting[]
  assignments: TeachingAssignment[]
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const { user } = useAuth()
  const draftKey = `rule-editor:${user?.id}:${semesterId}:${value?.id ?? "new"}`
  const [draftReadyKey, setDraftReadyKey] = useState("")
  const [draftRestored, setDraftRestored] = useState(false)
  const [draftReset, setDraftReset] = useState(0)
  const [draftStorageError, setDraftStorageError] = useState(false)
  const initializedDraft = useRef("")
  const editEtag = useRef(etag)
  const finished = useRef(false)
  const [name, setName] = useState("")
  const [preset, setPreset] = useState<RulePreset>("avoid")
  const [targetType, setTargetType] = useState("")
  const [targetId, setTargetId] = useState("")
  const [kind, setRuleKind] = useState<RuleKind>("soft")
  const [weight, setWeight] = useState(70)
  const [limit, setLimit] = useState(1)
  const [relatedAssignmentIds, setRelatedAssignmentIds] = useState<number[]>([])
  const [exclusionMode, setExclusionMode] = useState<"same_slot" | "same_day">("same_slot")
  const [explanation, setExplanation] = useState("")
  const [selectedSlots, setSelectedSlots] = useState<string[]>([])
  const [dragMode, setDragMode] = useState<"add" | "remove" | null>(null)
  const [saving, setSaving] = useState(false)
  const [attemptedSubmit, setAttemptedSubmit] = useState(false)
  const savedRuleId = useRef<number | null>(null)
  const [saveError, setSaveError] = useState("")
  useEffect(() => {
    if (!open) {
      setDraftReadyKey("")
      initializedDraft.current = ""
      return
    }
    const initialization = `${draftKey}:${draftReset}`
    if (initializedDraft.current === initialization) return
    initializedDraft.current = initialization
    finished.current = false
    editEtag.current = etag
    setDraftRestored(false)
    savedRuleId.current = value?.id ?? null
    setSaveError("")
    const currentPreset: RulePreset =
      value?.category === "availability"
        ? "unavailable"
        : value?.category === "daily_load"
          ? "daily_limit"
          : value?.category === "consecutive_items"
            ? "consecutive_limit"
            : value?.category === "spacing"
              ? "spacing"
              : value?.category === "synchronization"
                ? "synchronization"
                : value?.category === "mutual_exclusion"
                  ? "mutual_exclusion"
                  : value?.category === "course_distribution"
                    ? "distribution"
                    : value?.category === "teacher_gaps"
                      ? "teacher_gaps"
                      : value?.requirement.preference === "prefer"
                        ? "prefer"
                        : "avoid"
    setName(value?.name ?? "")
    setPreset(currentPreset)
    setTargetType(value?.target_type ?? "")
    setTargetId(value?.target_id ? String(value.target_id) : "")
    setRuleKind(value?.kind ?? (currentPreset === "unavailable" ? "hard" : "soft"))
    setWeight(value?.weight ?? 70)
    setLimit(
      Number(
        value?.requirement.max_items_per_day ??
          value?.requirement.max_consecutive_items ??
          value?.requirement.max_same_course_per_day ??
          value?.requirement.min_gap_days ??
          1,
      ),
    )
    const related = value?.requirement.with_assignment_ids
    setRelatedAssignmentIds(
      Array.isArray(related) ? related.map(Number).filter(Number.isInteger) : [],
    )
    setExclusionMode(value?.requirement.mode === "same_day" ? "same_day" : "same_slot")
    setExplanation(value?.explanation ?? "")
    const slots = Array.isArray(value?.scope.slots) ? value.scope.slots : []
    setSelectedSlots(
      slots.flatMap((slot) =>
        typeof slot === "object" && slot !== null && "weekday" in slot && "item_id" in slot
          ? [`${String(slot.weekday)}:${String(slot.item_id)}`]
          : [],
      ),
    )
    setAttemptedSubmit(false)
    try {
      const cached = JSON.parse(sessionStorage.getItem(draftKey) ?? "null")
      if (
        cached?.version === 1 &&
        typeof cached.name === "string" &&
        typeof cached.targetType === "string" &&
        typeof cached.targetId === "string" &&
        (cached.kind === "hard" || cached.kind === "soft") &&
        typeof cached.explanation === "string" &&
        Array.isArray(cached.selectedSlots) &&
        cached.selectedSlots.every((slot: unknown) => typeof slot === "string") &&
        Array.isArray(cached.relatedAssignmentIds) &&
        cached.relatedAssignmentIds.every(Number.isInteger) &&
        typeof cached.preset === "string" &&
        Object.values(rulePresetOptions)
          .flat()
          .some((option) => option.value === cached.preset) &&
        Number.isFinite(cached.weight) &&
        Number.isFinite(cached.limit)
      ) {
        setName(cached.name)
        setPreset(cached.preset)
        setTargetType(cached.targetType)
        setTargetId(cached.targetId)
        setRuleKind(cached.kind)
        setWeight(cached.weight)
        setLimit(cached.limit)
        setRelatedAssignmentIds(cached.relatedAssignmentIds)
        setExclusionMode(cached.exclusionMode === "same_day" ? "same_day" : "same_slot")
        setExplanation(cached.explanation)
        setSelectedSlots(cached.selectedSlots)
        savedRuleId.current = Number.isInteger(cached.savedRuleId)
          ? cached.savedRuleId
          : (value?.id ?? null)
        editEtag.current = typeof cached.etag === "string" ? cached.etag : etag
        setDraftRestored(true)
      }
    } catch {
      setDraftStorageError(true)
    }
    setDraftReadyKey(draftKey)
    // Input revision is captured when opening; background refresh must not replace typed values.
  }, [open, value, draftKey, draftReset, etag])
  useEffect(() => {
    if (!open || draftReadyKey !== draftKey || finished.current) return
    if (!name && !targetId && !selectedSlots.length && !explanation) return
    try {
      sessionStorage.setItem(
        draftKey,
        JSON.stringify({
          version: 1,
          name,
          preset,
          targetType,
          targetId,
          kind,
          weight,
          limit,
          relatedAssignmentIds,
          exclusionMode,
          explanation,
          selectedSlots,
          savedRuleId: savedRuleId.current,
          etag: editEtag.current,
        }),
      )
    } catch {
      setDraftStorageError(true)
    }
  }, [
    open,
    draftReadyKey,
    draftKey,
    name,
    preset,
    targetType,
    targetId,
    kind,
    weight,
    limit,
    relatedAssignmentIds,
    exclusionMode,
    explanation,
    selectedSlots,
    saveError,
  ])
  useEffect(() => {
    if (!dragMode) return
    const stopDragging = () => setDragMode(null)
    window.addEventListener("pointerup", stopDragging)
    return () => window.removeEventListener("pointerup", stopDragging)
  }, [dragMode])
  const slotBased = ["unavailable", "avoid", "prefer"].includes(preset)
  const resourceLimited = ["daily_limit", "consecutive_limit"].includes(preset)
  const relationBased = ["synchronization", "mutual_exclusion"].includes(preset)
  const hardOnly = ["unavailable", "synchronization", "mutual_exclusion"].includes(preset)
  const softOnly = ["avoid", "prefer", "teacher_gaps"].includes(preset)
  const effectiveKind: RuleKind = hardOnly ? "hard" : softOnly ? "soft" : kind
  const options = targetOptions(targetType, {
    teachers,
    courses,
    rooms,
    classSettings,
    assignments,
  })
  const assignmentOptions = targetOptions("teaching_assignment", {
    teachers,
    courses,
    rooms,
    classSettings,
    assignments,
  })
  const relatedOptions = assignmentOptions.filter((option) => String(option.id) !== targetId)
  const targetName = !targetType
    ? "全校任课（本学期）"
    : (options.find((option) => String(option.id) === targetId)?.label ?? "尚未选择具体对象")
  const days = template?.days.filter((day) => day.is_enabled) ?? []
  const items =
    template?.items.filter(
      (item) => item.is_active && item.allows_course && item.counts_as_course,
    ) ?? []
  const selectedSlotSet = new Set(selectedSlots)
  const allSlotKeys = days.flatMap((day) => items.map((item) => `${day.weekday}:${item.id}`))
  const morningSlotKeys = days.flatMap((day) =>
    items.filter((item) => item.start_time < "12:00").map((item) => `${day.weekday}:${item.id}`),
  )
  const afternoonSlotKeys = days.flatMap((day) =>
    items.filter((item) => item.start_time >= "12:00").map((item) => `${day.weekday}:${item.id}`),
  )
  const relatedCount = relatedAssignmentIds.filter((id) => String(id) !== targetId).length
  const selectedCategory = constraintCategoryForPreset(preset)
  const selectedCombinationSupported = supportsConstraintKindCategory(
    effectiveKind,
    selectedCategory,
  )
  const preview = rulePreview({
    preset,
    kind: effectiveKind,
    targetName,
    limit,
    selectedSlotCount: selectedSlots.length,
    relatedCount,
    exclusionMode,
  })
  const affectedAssignments = assignments.filter((assignment) =>
    relationBased
      ? [Number(targetId), ...relatedAssignmentIds].includes(assignment.id)
      : assignmentMatchesTarget(assignment, targetType, targetId, classSettings),
  )
  const affectedCount = affectedAssignments.length
  const nameError = !name.trim() ? "请填写一个便于识别的规则名称" : undefined
  const targetError =
    resourceLimited && ["course", "teaching_assignment"].includes(targetType)
      ? TEACHING_GROUPS_ENABLED
        ? "课时上限需要选择教师、班级、教室、年级或教学组"
        : "课时上限需要选择教师、班级、教室或年级"
      : targetType && !targetId
        ? "请选择一个具体作用对象"
        : undefined
  const slotError = slotBased && selectedSlots.length === 0 ? "请至少选择一个生效课节" : undefined
  const relationError =
    relationBased && relatedCount < 1 ? "请至少再选择一条关联任课关系" : undefined
  const missingRequirements = [
    !etag ? "等待数据版本就绪" : null,
    nameError ? "填写规则名称" : null,
    targetError ? "选择具体对象" : null,
    slotError ? "选择生效课节" : null,
    relationError ? "选择关联任课关系" : null,
    !selectedCombinationSupported ? "选择当前求解器支持的规则组合" : null,
  ].filter((item): item is string => Boolean(item))
  const targetTypeLabel =
    {
      teacher: "教师",
      school_class: "班级",
      course: "课程",
      room: "教室",
      grade: "年级",
      teaching_assignment: "任课关系",
      teaching_group: "教学组",
    }[targetType] ?? "全校任课（本学期）"
  const targetPickerPlaceholder =
    targetType === "teacher"
      ? "搜索教师姓名、工号或任教学科"
      : targetType === "teaching_assignment"
        ? "搜索班级、课程、教师或周课时"
        : `搜索${targetTypeLabel}名称或编号`
  const limitConfiguration = [
    "distribution",
    "daily_limit",
    "consecutive_limit",
    "spacing",
  ].includes(preset)
  const limitLabel =
    preset === "daily_limit"
      ? "每天最多课时"
      : preset === "consecutive_limit"
        ? "最多连续课时"
        : preset === "spacing"
          ? "至少间隔天数"
          : "同一课程每天最多次数"
  const limitUnit = preset === "spacing" ? "天" : preset === "distribution" ? "次" : "节"
  const updateSlots = (keys: string[], force?: boolean) => {
    setSelectedSlots((current) => {
      const next = new Set(current)
      const shouldAdd = force ?? !keys.every((key) => next.has(key))
      for (const key of keys) {
        if (shouldAdd) next.add(key)
        else next.delete(key)
      }
      return [...next]
    })
  }
  const save = async (event: Pick<FormEvent, "preventDefault">, activate = false) => {
    event.preventDefault()
    setAttemptedSubmit(true)
    if (saving || missingRequirements.length > 0 || !etag) return
    const category = constraintCategoryForPreset(preset)
    const requirement =
      preset === "unavailable"
        ? { available: false }
        : preset === "daily_limit"
          ? { max_items_per_day: limit }
          : preset === "consecutive_limit"
            ? {
                max_consecutive_items: limit,
                ...(targetType ? {} : { resource_type: "teacher" }),
              }
            : preset === "spacing"
              ? { min_gap_days: limit }
              : preset === "synchronization"
                ? {
                    with_assignment_ids: relatedAssignmentIds.filter(
                      (id) => String(id) !== targetId,
                    ),
                  }
                : preset === "mutual_exclusion"
                  ? {
                      with_assignment_ids: relatedAssignmentIds.filter(
                        (id) => String(id) !== targetId,
                      ),
                      mode: exclusionMode,
                    }
                  : preset === "distribution"
                    ? { max_same_course_per_day: limit, spread_across_weekdays: true }
                    : preset === "teacher_gaps"
                      ? { minimize_teacher_gaps: true }
                      : { preference: preset }
    const scope = slotBased
      ? {
          slots: selectedSlots.map((slot) => {
            const [weekday, itemId] = slot.split(":").map(Number)
            return { weekday, item_id: itemId }
          }),
        }
      : {}
    setSaving(true)
    setSaveError("")
    let activationPending = false
    try {
      const saved = await api<SchedulingConstraint>(
        `/api/v1/semesters/${semesterId}/scheduling-constraints${savedRuleId.current ? `/${savedRuleId.current}` : ""}`,
        {
          method: savedRuleId.current ? "PATCH" : "POST",
          etag: editEtag.current,
          body: JSON.stringify({
            name: name.trim(),
            kind: effectiveKind,
            category,
            target_type: targetType || null,
            target_id: targetType ? Number(targetId) : null,
            scope,
            condition: null,
            requirement,
            weight: effectiveKind === "soft" ? weight : null,
            explanation: explanation.trim() || null,
          }),
        },
      )
      savedRuleId.current = saved.data.id
      editEtag.current = saved.etag
      if (activate && saved.data.status !== "active") {
        activationPending = true
        await api(
          `/api/v1/semesters/${semesterId}/scheduling-constraints/${saved.data.id}/activate`,
          {
            method: "POST",
            etag: saved.etag,
          },
        )
      }
      toast.success(
        activate || saved.data.status === "active"
          ? "规则已保存并启用"
          : "草稿已保存，尚未参与排课",
      )
      finished.current = true
      try {
        sessionStorage.removeItem(draftKey)
      } catch {
        /* Saving succeeded even when local storage is unavailable. */
      }
      onClose()
      await onSaved()
    } catch (error) {
      setSaveError(
        `${activationPending ? "草稿已保存，但启用失败。可修改后重试，不会重复创建规则。" : "保存失败，填写内容已保留。"}${apiMessage(error)}`,
      )
      await onSaved()
    } finally {
      setSaving(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !saving && onClose()}>
      <DialogContent className="max-h-[92svh] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="border-b px-6 py-5 pr-14">
          <DialogTitle>{value ? "编辑规则" : "新增规则"}</DialogTitle>
          <DialogDescription className="sr-only">配置排课规则。</DialogDescription>
        </DialogHeader>
        <form
          className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto]"
          onSubmit={(event) => void save(event)}
        >
          <div className="min-h-0 overflow-y-auto px-6 py-5">
            <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_14rem]">
              <div className="grid min-w-0 gap-5">
                {draftRestored && (
                  <p role="status" className="text-sm text-muted-foreground">
                    已恢复本浏览器中未完成的编辑，尚未提交。
                    <Button
                      type="button"
                      variant="link"
                      onClick={() => {
                        try {
                          sessionStorage.removeItem(draftKey)
                        } catch {
                          setDraftStorageError(true)
                        }
                        setDraftReadyKey("")
                        setDraftReset((current) => current + 1)
                      }}
                    >
                      丢弃本地编辑
                    </Button>
                  </p>
                )}
                {draftStorageError && (
                  <p role="status" className="text-sm text-destructive">
                    浏览器未能保存本地编辑，请在离开前保存草稿。
                  </p>
                )}
                {!value && (
                  <section className="space-y-2" aria-label="常用规则模板">
                    <h3 className="text-sm font-medium">从常见任务开始</h3>
                    <p className="text-xs text-muted-foreground">
                      模板带入常用要求，仍需选择具体对象并核对预览。
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {[
                        {
                          title: "教师周五下午教研禁排",
                          preset: "unavailable" as RulePreset,
                          kind: "hard" as RuleKind,
                          target: "teacher",
                          limit: 1,
                        },
                        {
                          title: "教师每天课时上限",
                          preset: "daily_limit" as RulePreset,
                          kind: "hard" as RuleKind,
                          target: "teacher",
                          limit: 4,
                        },
                        {
                          title: "课程尽量分散到不同天",
                          preset: "distribution" as RulePreset,
                          kind: "soft" as RuleKind,
                          target: "course",
                          limit: 1,
                        },
                        {
                          title: "指定课程优先上午",
                          preset: "prefer" as RulePreset,
                          kind: "soft" as RuleKind,
                          target: "course",
                          limit: 1,
                        },
                        {
                          title: "尽量减少教师空堂",
                          preset: "teacher_gaps" as RulePreset,
                          kind: "soft" as RuleKind,
                          target: "teacher",
                          limit: 1,
                        },
                      ].map((task) => (
                        <Button
                          key={task.title}
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setName(task.title)
                            setPreset(task.preset)
                            setRuleKind(task.kind)
                            setTargetType(task.target)
                            setTargetId("")
                            setRelatedAssignmentIds([])
                            setLimit(task.limit)
                            setWeight(70)
                            setExplanation("")
                            setSelectedSlots(
                              task.preset === "unavailable"
                                ? days
                                    .filter((day) => day.weekday === 5)
                                    .flatMap((day) =>
                                      items
                                        .filter((item) => item.start_time >= "12:00")
                                        .map((item) => `${day.weekday}:${item.id}`),
                                    )
                                : task.preset === "prefer"
                                  ? days.flatMap((day) =>
                                      items
                                        .filter((item) => item.start_time < "12:00")
                                        .map((item) => `${day.weekday}:${item.id}`),
                                    )
                                  : [],
                            )
                          }}
                        >
                          {task.title}
                        </Button>
                      ))}
                    </div>
                  </section>
                )}
                <RuleFormSection title="1. 定义规则">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="约束强度">
                      <SimpleSelect
                        className="w-full"
                        value={kind}
                        autoFocus
                        onValueChange={(value) => {
                          const next = value as RuleKind
                          setRuleKind(next)
                          setPreset((current) => linkedPresetForKind(current, next))
                        }}
                      >
                        <option value="hard">必须满足（硬约束）</option>
                        <option value="soft">尽量满足（软规则）</option>
                      </SimpleSelect>
                    </Field>
                    <Field label="规则意图">
                      <SimpleSelect
                        className="w-full"
                        value={preset}
                        onValueChange={(value) => {
                          const next = value as RulePreset
                          setPreset(next)
                          setRelatedAssignmentIds([])
                          if (["daily_limit", "consecutive_limit"].includes(next) && !targetType) {
                            setTargetType("teacher")
                          }
                          if (["synchronization", "mutual_exclusion"].includes(next)) {
                            setTargetType("teaching_assignment")
                            setTargetId("")
                          }
                        }}
                      >
                        {rulePresetOptions[kind].map((option) => {
                          const supported = supportsConstraintKindCategory(
                            kind,
                            constraintCategoryForPreset(option.value),
                          )
                          return (
                            <option key={option.value} value={option.value} disabled={!supported}>
                              {option.label}
                              {supported ? "" : "（当前暂不支持）"}
                            </option>
                          )
                        })}
                      </SimpleSelect>
                    </Field>
                  </div>
                  {(limitConfiguration || preset === "mutual_exclusion") && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      {limitConfiguration && (
                        <Field label={limitLabel}>
                          <div className="relative">
                            <Input
                              type="number"
                              min="1"
                              max={preset === "spacing" ? 7 : 20}
                              value={limit}
                              className="pr-10"
                              onChange={(event) =>
                                setLimit(Math.max(1, Number(event.target.value) || 1))
                              }
                            />
                            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
                              {limitUnit}
                            </span>
                          </div>
                        </Field>
                      )}
                      {preset === "mutual_exclusion" && (
                        <Field label="错峰范围">
                          <SimpleSelect
                            className="w-full"
                            value={exclusionMode}
                            onValueChange={(value) =>
                              setExclusionMode(value as "same_slot" | "same_day")
                            }
                          >
                            <option value="same_slot">不能在同一课节</option>
                            <option value="same_day">不能在同一天</option>
                          </SimpleSelect>
                        </Field>
                      )}
                    </div>
                  )}
                  {!hardOnly && (kind === "soft" || softOnly) && (
                    <RuleFieldGroup label="重要程度">
                      <div className="flex flex-wrap gap-2">
                        {[
                          { value: 40, label: "一般" },
                          { value: 70, label: "重要" },
                          { value: 90, label: "优先" },
                        ].map((option) => (
                          <Button
                            key={option.value}
                            type="button"
                            size="sm"
                            variant={weight === option.value ? "secondary" : "outline"}
                            aria-pressed={weight === option.value}
                            onClick={() => setWeight(option.value)}
                          >
                            {option.label} {option.value}
                          </Button>
                        ))}
                      </div>
                      <details>
                        <summary className="cursor-pointer text-xs text-muted-foreground">
                          高级：精确设置重要程度
                        </summary>
                        <div className="mt-3 flex items-center gap-3">
                          <input
                            type="range"
                            min={1}
                            max={100}
                            value={weight}
                            aria-label="软规则重要程度"
                            onChange={(event) => setWeight(Number(event.target.value))}
                            className="w-full accent-primary"
                          />
                          <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
                            {weight}/100
                          </span>
                        </div>
                      </details>
                    </RuleFieldGroup>
                  )}
                </RuleFormSection>

                <RuleFormSection title="2. 选择作用范围">
                  {!relationBased && (
                    <Field label="作用对象类型">
                      <SimpleSelect
                        className="w-full"
                        value={targetType}
                        onValueChange={(value) => {
                          setTargetType(value)
                          setTargetId("")
                          setRelatedAssignmentIds([])
                        }}
                      >
                        <option value="">全校任课（本学期）</option>
                        <option value="teacher">教师</option>
                        <option value="school_class">班级</option>
                        <option value="course" disabled={resourceLimited}>
                          课程
                        </option>
                        <option value="room">教室</option>
                        <option value="grade">年级</option>
                        <option value="teaching_assignment" disabled={resourceLimited}>
                          任课关系
                        </option>
                        {(TEACHING_GROUPS_ENABLED || targetType === "teaching_group") && (
                          <option value="teaching_group">教学组</option>
                        )}
                      </SimpleSelect>
                    </Field>
                  )}
                  {targetType && (
                    <RuleFieldGroup
                      label={relationBased ? "主任课关系" : `具体${targetTypeLabel}`}
                      error={attemptedSubmit ? targetError : undefined}
                    >
                      <SearchablePicker
                        options={options}
                        ariaLabel={relationBased ? "搜索主任课关系" : `搜索具体${targetTypeLabel}`}
                        value={targetId ? Number(targetId) : null}
                        onValueChange={(next) => {
                          setTargetId(next ? String(next) : "")
                          setRelatedAssignmentIds((current) =>
                            next ? current.filter((id) => id !== next) : current,
                          )
                        }}
                        placeholder={targetPickerPlaceholder}
                        searchPlaceholder={targetPickerPlaceholder}
                        invalid={attemptedSubmit && Boolean(targetError)}
                        emptyDescription={
                          targetType === "teaching_group" && options.length === 0
                            ? "当前学期还没有教学组，请先在任课关系中建立教学组"
                            : undefined
                        }
                      />
                    </RuleFieldGroup>
                  )}
                  {relationBased && (
                    <RuleFieldGroup
                      label={preset === "synchronization" ? "同步对象" : "错峰对象"}
                      error={attemptedSubmit ? relationError : undefined}
                    >
                      <SearchableMultiPicker
                        options={relatedOptions}
                        ariaLabel={preset === "synchronization" ? "搜索同步对象" : "搜索错峰对象"}
                        value={relatedAssignmentIds.filter((id) => String(id) !== targetId)}
                        onValueChange={setRelatedAssignmentIds}
                        placeholder={targetId ? "搜索并添加关联任课关系" : "请先选择主任课关系"}
                        searchPlaceholder="继续搜索班级、课程或教师"
                        disabled={!targetId}
                        invalid={attemptedSubmit && Boolean(relationError)}
                      />
                    </RuleFieldGroup>
                  )}
                </RuleFormSection>

                {slotBased && (
                  <RuleFormSection title="3. 选择生效课节">
                    <RuleFieldGroup
                      label={`生效课节（已选 ${selectedSlots.length} 个）`}
                      error={attemptedSubmit ? slotError : undefined}
                    >
                      <div className="mb-1 flex flex-wrap gap-2">
                        {[
                          { label: "全部课节", keys: allSlotKeys },
                          { label: "全周上午", keys: morningSlotKeys },
                          { label: "全周下午", keys: afternoonSlotKeys },
                        ].map((option) => {
                          const active =
                            option.keys.length > 0 &&
                            option.keys.every((key) => selectedSlots.includes(key))
                          return (
                            <Button
                              key={option.label}
                              type="button"
                              size="sm"
                              variant={active ? "secondary" : "outline"}
                              aria-pressed={active}
                              onClick={() => updateSlots(option.keys)}
                            >
                              {option.label}
                            </Button>
                          )
                        })}
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={selectedSlots.length === 0}
                          onClick={() => setSelectedSlots([])}
                        >
                          清空
                        </Button>
                      </div>
                      {days.length > 0 && items.length > 0 ? (
                        <div className="overflow-auto rounded-2xl border">
                          <div className="relative inline-block min-w-full align-top">
                            <table className="min-w-[600px] border-collapse text-xs">
                              <thead>
                                <tr>
                                  <th className="sticky left-0 z-10 bg-muted p-2 text-left">
                                    课节
                                  </th>
                                  {days.map((day) => (
                                    <th key={day.weekday} className="bg-muted p-1">
                                      <button
                                        type="button"
                                        className="w-full rounded-lg px-2 py-1.5 hover:bg-background"
                                        aria-label={`选择${weekdayNames[day.weekday]}全部课节`}
                                        onClick={() =>
                                          updateSlots(
                                            items.map((item) => `${day.weekday}:${item.id}`),
                                          )
                                        }
                                      >
                                        {weekdayNames[day.weekday]}
                                      </button>
                                      <div className="flex justify-center gap-1">
                                        {[
                                          { label: "上午", morning: true },
                                          { label: "下午", morning: false },
                                        ].map((period) => (
                                          <button
                                            key={period.label}
                                            type="button"
                                            className="rounded px-1.5 py-1 font-normal hover:bg-background focus-visible:ring-2 focus-visible:ring-ring"
                                            aria-label={`选择${weekdayNames[day.weekday]}${period.label}`}
                                            onClick={() =>
                                              updateSlots(
                                                items
                                                  .filter(
                                                    (item) =>
                                                      item.start_time < "12:00" === period.morning,
                                                  )
                                                  .map((item) => `${day.weekday}:${item.id}`),
                                              )
                                            }
                                          >
                                            {period.label}
                                          </button>
                                        ))}
                                      </div>
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {items.map((item, row) => (
                                  <tr key={item.id}>
                                    <th className="sticky left-0 z-10 border-t bg-background p-1 text-left font-medium">
                                      <button
                                        type="button"
                                        className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-muted"
                                        aria-label={`选择所有工作日的${item.name}`}
                                        onClick={() =>
                                          updateSlots(
                                            days.map((day) => `${day.weekday}:${item.id}`),
                                          )
                                        }
                                      >
                                        {item.name}
                                      </button>
                                    </th>
                                    {days.map((day, column) => {
                                      const key = `${day.weekday}:${item.id}`
                                      const active = selectedSlotSet.has(key)
                                      return (
                                        <td
                                          key={key}
                                          data-grid-selection-cell=""
                                          data-grid-row={row}
                                          data-grid-column={column}
                                          data-grid-selected={active ? "true" : undefined}
                                          className={cn(
                                            "relative z-0 border-t border-l",
                                            active ? "bg-primary/[0.07]" : "bg-background",
                                          )}
                                        >
                                          <button
                                            type="button"
                                            aria-pressed={active}
                                            aria-label={`${weekdayNames[day.weekday]} ${item.name}${active ? "，已选择" : ""}`}
                                            className={cn(
                                              "relative z-10 flex h-10 w-full items-center justify-center bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/30",
                                              active
                                                ? "text-primary hover:bg-transparent"
                                                : "hover:bg-muted/50",
                                            )}
                                            onPointerDown={(event) => {
                                              event.preventDefault()
                                              const mode = active ? "remove" : "add"
                                              setDragMode(mode)
                                              updateSlots([key], mode === "add")
                                            }}
                                            onPointerEnter={() => {
                                              if (dragMode) updateSlots([key], dragMode === "add")
                                            }}
                                            onClick={(event) => {
                                              if (event.detail === 0) updateSlots([key])
                                            }}
                                          />
                                        </td>
                                      )
                                    })}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            <GridSelectionOverlay selectionKey={selectedSlots.join("|")} />
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-dashed px-4 py-6 text-center">
                          <p className="text-sm font-medium">当前学期没有可排课节</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            请先在班级与作息中启用工作日和课程课节。
                          </p>
                        </div>
                      )}
                    </RuleFieldGroup>
                  </RuleFormSection>
                )}

                <RuleFormSection title={`${slotBased ? "4" : "3"}. 命名规则`}>
                  <Field label="规则名称" error={attemptedSubmit ? nameError : undefined}>
                    <Input
                      value={name}
                      maxLength={120}
                      aria-invalid={(attemptedSubmit && Boolean(nameError)) || undefined}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="例如：胡静周五下午不可排课"
                    />
                  </Field>
                  <Field label="备注（可选）">
                    <Textarea
                      value={explanation}
                      maxLength={1000}
                      onChange={(event) => setExplanation(event.target.value)}
                      placeholder="例如：教师参加固定教研活动"
                    />
                  </Field>
                </RuleFormSection>
              </div>

              <aside className="self-start rounded-2xl border bg-muted/30 p-4 sm:sticky sm:top-0">
                <p className="text-sm font-semibold">规则预览</p>
                <p className="mt-2 text-sm leading-6 text-foreground">{preview}</p>
                {slotBased && (
                  <ul className="mt-3 space-y-1 text-xs leading-5 text-muted-foreground">
                    {days.map((day) => {
                      const selected = items.filter((item) =>
                        selectedSlotSet.has(`${day.weekday}:${item.id}`),
                      )
                      return selected.length ? (
                        <li key={day.weekday}>
                          {weekdayNames[day.weekday]}：
                          {selected.map((item) => item.name).join("、")}
                        </li>
                      ) : null
                    })}
                  </ul>
                )}
                <p className="mt-3 text-xs leading-5 text-muted-foreground">
                  {effectiveKind === "hard"
                    ? "启用后必须满足；不满足时阻止发布。"
                    : "启用后尽量满足；权重表示偏好强度，不保证全部满足。"}
                  保存规则不会自动移动现有课表。
                </p>
                <details className="mt-3 text-xs">
                  <summary className="cursor-pointer">匹配 {affectedCount} 条任课关系</summary>
                  <p className="mt-2 text-muted-foreground">
                    这是作用对象数量，不代表将移动的课节数。
                  </p>
                  <ul className="mt-2 max-h-48 space-y-2 overflow-auto">
                    {affectedAssignments.map((assignment) => (
                      <li key={assignment.id}>
                        {assignmentTarget(assignment)} · {assignment.course.name} ·{" "}
                        {assignment.teacher.name}
                      </li>
                    ))}
                  </ul>
                </details>
                {saveError && (
                  <p role="alert" className="mt-3 text-sm text-destructive">
                    {saveError}
                  </p>
                )}
                {saveError && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={async () => {
                      try {
                        const current = await api<unknown>(`/api/v1/semesters/${semesterId}`)
                        editEtag.current = current.etag
                        setSaveError("已读取最新资料版本。请核对当前规则与预览后，再次保存。")
                        await onSaved()
                      } catch (error) {
                        setSaveError(apiMessage(error))
                      }
                    }}
                  >
                    读取最新版本后重新核对
                  </Button>
                )}
              </aside>
            </div>
          </div>
          <DialogFooter className="flex-col gap-3 border-t bg-popover px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p
              className={`text-left text-sm ${missingRequirements.length ? "text-muted-foreground" : "text-emerald-700"}`}
              aria-live="polite"
            >
              {missingRequirements.length
                ? `还需：${missingRequirements.join("、")}`
                : `匹配 ${affectedCount} 条任课关系 · ${value?.status === "active" ? "保存后更新已启用规则" : "草稿不参与排课"}`}
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
                取消
              </Button>
              <Button
                type="submit"
                variant={value?.status === "active" ? "default" : "outline"}
                disabled={saving}
              >
                {saving ? "保存中…" : value?.status === "active" ? "保存并更新规则" : "保存草稿"}
              </Button>
              {value?.status !== "active" && (
                <Button type="button" disabled={saving} onClick={(event) => void save(event, true)}>
                  保存并启用
                </Button>
              )}
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function PlacementDialog({
  open,
  value,
  semesterId,
  etag,
  template,
  assignments,
  rooms,
  onClose,
  onSaved,
}: {
  open: boolean
  value: FixedPlacement | null
  semesterId: number
  etag: string | null
  template?: ScheduleTemplate
  assignments: TeachingAssignment[]
  rooms: Room[]
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [assignmentId, setAssignmentId] = useState("")
  const [weekday, setWeekday] = useState("")
  const [itemId, setItemId] = useState("")
  const [roomId, setRoomId] = useState("")
  const [weekPattern, setWeekPattern] = useState<WeekPattern>("all")
  const [saving, setSaving] = useState(false)
  const activePlacements = useQuery({
    queryKey: ["fixed-placement-capacity", semesterId, assignmentId, etag],
    enabled: open && Boolean(assignmentId),
    queryFn: () =>
      apiAllPages<FixedPlacement>(
        `/api/v1/semesters/${semesterId}/fixed-placements?status=active&teaching_assignment_id=${assignmentId}`,
      ),
  })
  const selectedAssignment = assignments.find(
    (assignment) => assignment.id === Number(assignmentId),
  )
  const fixedCount = activePlacements.data?.data.length ?? 0
  const availableCount = (selectedAssignment?.weekly_items ?? 0) - fixedCount
  const otherFixedCount =
    activePlacements.data?.data.filter((placement) => placement.id !== value?.id).length ?? 0
  const exceedsCapacity = Boolean(
    selectedAssignment && otherFixedCount >= selectedAssignment.weekly_items,
  )
  useEffect(() => {
    if (!open) return
    const initialAssignmentId = value?.teaching_assignment_id
    setAssignmentId(String(initialAssignmentId ?? ""))
    setWeekday(String(value?.weekday ?? ""))
    setItemId(String(value?.item_id ?? ""))
    setRoomId(value?.room_id ? String(value.room_id) : "")
    setWeekPattern(value?.week_pattern ?? "all")
  }, [open, value])
  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (
      saving ||
      !etag ||
      !assignmentId ||
      !weekday ||
      !itemId ||
      !activePlacements.isSuccess ||
      exceedsCapacity
    )
      return
    setSaving(true)
    try {
      await api(`/api/v1/semesters/${semesterId}/fixed-placements${value ? `/${value.id}` : ""}`, {
        method: value ? "PATCH" : "POST",
        etag,
        body: JSON.stringify({
          teaching_assignment_id: Number(assignmentId),
          week_pattern: weekPattern,
          weekday: Number(weekday),
          item_id: Number(itemId),
          room_id: roomId ? Number(roomId) : null,
          is_locked: true,
        }),
      })
      toast.success(
        value?.status === "inactive" ? "固定安排已保存，仍为停用状态" : "固定安排已保存并启用",
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
    <Dialog open={open} onOpenChange={(next) => !next && !saving && onClose()}>
      <DialogContent className="max-h-[calc(100svh-2rem)] grid-rows-[auto_minmax(0,1fr)] gap-0 p-0 sm:max-w-xl">
        <DialogHeader className="border-b px-6 py-5 pr-14">
          <DialogTitle>{value ? "编辑固定安排" : "新增固定安排"}</DialogTitle>
          <DialogDescription>
            启用后，这条任课必须排在指定位置，并占用其周课时。固定安排仍须遵守禁排规则及教师、班级、教室冲突检查。
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto]"
          onSubmit={(event) => void save(event)}
        >
          <div className="grid gap-4 overflow-y-auto px-6 py-5">
            <Field label="班级、课程与任课教师">
              <AssignmentPicker
                assignments={assignments}
                value={assignmentId}
                onValueChange={(selectedId) => {
                  setAssignmentId(selectedId)
                  const assignment = assignments.find((item) => item.id === Number(selectedId))
                  if (assignment) setWeekPattern(assignment.week_pattern)
                }}
              />
            </Field>
            {selectedAssignment && (
              <div className="rounded-lg bg-muted/50 p-3 text-sm" aria-live="polite">
                <p>
                  周课时 {selectedAssignment.weekly_items} 节 ·{" "}
                  {activePlacements.isSuccess
                    ? `已固定 ${fixedCount} 节 · 尚未固定 ${Math.max(0, availableCount)} 节`
                    : "正在核对已固定课时…"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  仅统计启用的固定安排；剩余课时可自动排课。每条固定安排占一个课节，连排课程请按实际课节逐条设置。
                </p>
                {exceedsCapacity && (
                  <p role="alert" className="mt-1 text-destructive">
                    固定课时已达到周课时，请先调整已有固定安排。
                  </p>
                )}
                {activePlacements.isError && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void activePlacements.refetch()}
                  >
                    核对失败，重试
                  </Button>
                )}
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="星期">
                <SimpleSelect className="w-full" value={weekday} onValueChange={setWeekday}>
                  <option value="" disabled>
                    请选择星期
                  </option>
                  {template?.days
                    .filter((day) => day.is_enabled)
                    .map((day) => (
                      <option key={day.weekday} value={day.weekday}>
                        {weekdayNames[day.weekday]}
                      </option>
                    ))}
                </SimpleSelect>
              </Field>
              <Field label="课节">
                <SimpleSelect className="w-full" value={itemId} onValueChange={setItemId}>
                  <option value="" disabled>
                    请选择课节
                  </option>
                  {template?.items
                    .filter((item) => item.is_active && item.allows_course && item.counts_as_course)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} · {item.start_time.slice(0, 5)}
                      </option>
                    ))}
                </SimpleSelect>
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="周型（随任课关系）">
                <SimpleSelect
                  className="w-full"
                  value={weekPattern}
                  disabled
                  onValueChange={(value) => setWeekPattern(value as WeekPattern)}
                >
                  <option value="all">每周</option>
                  <option value="a">A 周</option>
                  <option value="b">B 周</option>
                  <option value="specified">指定教学周</option>
                </SimpleSelect>
              </Field>
              <Field label="指定教室（可选）">
                <RoomPicker rooms={rooms} value={roomId} onValueChange={setRoomId} clearable />
              </Field>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              自动排课会保留指定位置。取消要求请停用或删除固定安排；修改要求不会自动调整现有课表，已有课节锁定需在编排课表中单独解除。
            </p>
          </div>
          <DialogFooter className="border-t bg-popover px-6 py-3">
            <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
              取消
            </Button>
            <Button
              type="submit"
              disabled={
                saving ||
                !etag ||
                !assignmentId ||
                !weekday ||
                !itemId ||
                !activePlacements.isSuccess ||
                exceedsCapacity
              }
            >
              {saving ? "保存中…" : "保存固定安排"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function paginationOf(meta?: Record<string, unknown>): PaginationMeta | null {
  const value = meta?.pagination
  if (!value || typeof value !== "object") return null
  return value as PaginationMeta
}
function targetLabel(
  rule: SchedulingConstraint,
  data: {
    teachers: Teacher[]
    courses: Course[]
    rooms: Room[]
    classSettings: ClassSetting[]
    assignments: TeachingAssignment[]
  },
) {
  if (!rule.target_type || !rule.target_id) return "全校任课（本学期）"
  return (
    targetOptions(rule.target_type, data).find((option) => option.id === rule.target_id)?.label ??
    "对象已失效"
  )
}
function scopeLabel(scope: Record<string, unknown>) {
  const slots = Array.isArray(scope.slots) ? scope.slots.length : 0
  return slots ? `${slots} 个课节` : "全时段"
}
function assignmentTarget(assignment: TeachingAssignment) {
  return assignment.school_class?.name ?? assignment.teaching_group?.name ?? "未设置授课对象"
}
function weekPatternLabel(pattern: WeekPattern) {
  return pattern === "all" ? "每周" : pattern === "a" ? "A 周" : pattern === "b" ? "B 周" : "指定周"
}
function targetOptions(
  type: string,
  data: {
    teachers: Teacher[]
    courses: Course[]
    rooms: Room[]
    classSettings: ClassSetting[]
    assignments: TeachingAssignment[]
  },
): SearchableOption[] {
  if (type === "teacher")
    return data.teachers.map((item) => {
      const courseNames = item.courses?.map((course) => course.name).join("、")
      const identity = item.employee_no ? `工号 ${item.employee_no}` : "未设置工号"
      return {
        id: item.id,
        label: item.name,
        description: `${identity}${courseNames ? ` · 可授 ${courseNames}` : ""}`,
        searchText: `${item.employee_no ?? ""} ${courseNames ?? ""}`,
        disabled: !item.is_active,
      }
    })
  if (type === "course")
    return data.courses.map((item) => ({
      id: item.id,
      label: item.name,
      description: `${item.short_name ? `简称 ${item.short_name}` : "未设置简称"}${item.is_active ? "" : " · 已停用"}`,
      searchText: item.short_name ?? "",
      disabled: !item.is_active,
    }))
  if (type === "room")
    return data.rooms.map((item) => ({
      id: item.id,
      label: item.name,
      description: `${
        {
          standard: "普通教室",
          laboratory: "实验室",
          computer: "计算机教室",
          music: "音乐教室",
          art: "美术教室",
          sports: "体育场地",
        }[item.type] ?? item.type
      }${item.is_active ? "" : " · 已停用"}`,
      searchText: item.type,
      disabled: !item.is_active,
    }))
  if (type === "school_class")
    return data.classSettings.map((item) => ({
      id: item.school_class_id,
      label: item.school_class.name,
      description: `${item.school_class.grade.name}${item.school_class.code ? ` · 编号 ${item.school_class.code}` : ""}${item.status === "active" ? "" : " · 已停用"}`,
      searchText: `${item.school_class.grade.name} ${item.school_class.code ?? ""}`,
      disabled: item.status !== "active",
    }))
  if (type === "grade")
    return Array.from(
      new Map(
        data.classSettings.map((item) => [
          item.school_class.grade.id,
          {
            id: item.school_class.grade.id,
            label: item.school_class.grade.name,
            description: `${data.classSettings.filter((setting) => setting.school_class.grade.id === item.school_class.grade.id).length} 个班级`,
          },
        ]),
      ).values(),
    )
  if (type === "teaching_assignment")
    return data.assignments.map((item) => ({
      id: item.id,
      label: `${assignmentTarget(item)} · ${item.course.name}`,
      description: `主讲 ${item.teacher.name} · 每周 ${item.weekly_items} 节${item.collaborators.length ? ` · 协同 ${item.collaborators.map((teacher) => teacher.name).join("、")}` : ""}`,
      searchText: `${item.teacher.name} ${item.teacher.employee_no ?? ""} ${item.collaborators.map((teacher) => teacher.name).join(" ")} ${item.weekly_items}`,
    }))
  if (type === "teaching_group")
    return Array.from(
      new Map(
        data.assignments.flatMap((item) =>
          item.teaching_group
            ? [
                [
                  item.teaching_group.id,
                  {
                    id: item.teaching_group.id,
                    label: item.teaching_group.name,
                    description: `${item.teaching_group.school_classes.length} 个班级 · ${
                      item.teaching_group.mode === "combined"
                        ? "合班教学"
                        : item.teaching_group.mode === "split"
                          ? "分层教学"
                          : "走班教学"
                    }`,
                    searchText: item.teaching_group.school_classes
                      .map((schoolClass) => schoolClass.name)
                      .join(" "),
                    disabled: item.teaching_group.status !== "active",
                  },
                ],
              ]
            : [],
        ),
      ).values(),
    )
  return []
}

function assignmentMatchesTarget(
  assignment: TeachingAssignment,
  targetType: string,
  targetId: string,
  classSettings: ClassSetting[] = [],
) {
  if (!targetType) return true
  const id = Number(targetId)
  if (!id) return false
  if (targetType === "teacher")
    return assignment.teacher_id === id || assignment.collaborators.some((item) => item.id === id)
  if (targetType === "school_class")
    return (
      assignment.school_class_id === id ||
      assignment.teaching_group?.school_classes.some((item) => item.id === id) === true
    )
  if (targetType === "course") return assignment.course_id === id
  if (targetType === "room")
    return assignment.room_mode === "class_default"
      ? classSettings.some(
          (setting) =>
            setting.school_class_id === assignment.school_class_id && setting.fixed_room_id === id,
        )
      : assignment.specified_room_id === id
  if (targetType === "grade")
    return (
      assignment.school_class?.grade.id === id ||
      assignment.teaching_group?.school_classes.some((item) => item.grade.id === id) === true
    )
  if (targetType === "teaching_assignment") return assignment.id === id
  if (targetType === "teaching_group") return assignment.teaching_group_id === id
  return false
}

function rulePreview({
  preset,
  kind,
  targetName,
  limit,
  selectedSlotCount,
  relatedCount,
  exclusionMode,
}: {
  preset: RulePreset
  kind: RuleKind
  targetName: string
  limit: number
  selectedSlotCount: number
  relatedCount: number
  exclusionMode: "same_slot" | "same_day"
}) {
  if (preset === "unavailable")
    return `${targetName}在选中的 ${selectedSlotCount} 个课节不得安排课程。`
  if (preset === "avoid") return `${targetName}尽量避开选中的 ${selectedSlotCount} 个课节。`
  if (preset === "prefer") return `${targetName}尽量安排在选中的 ${selectedSlotCount} 个课节。`
  if (preset === "distribution")
    return `${targetName}同一课程每天${kind === "hard" ? "最多安排" : "尽量不超过"} ${limit} 次，并尽量分散到不同工作日。`
  if (preset === "daily_limit")
    return `${targetName}每天${kind === "hard" ? "最多安排" : "尽量不超过"} ${limit} 个课时。`
  if (preset === "consecutive_limit")
    return `${targetName}连续授课${kind === "hard" ? "不得" : "尽量不"}超过 ${limit} 节。`
  if (preset === "spacing")
    return `${targetName}相邻两次授课${kind === "hard" ? "至少" : "尽量至少"}间隔 ${limit} 天。`
  if (preset === "teacher_gaps") return `${targetName}的课程尽量集中，减少日内空堂。`
  if (preset === "synchronization")
    return `${targetName}与另外 ${relatedCount} 条任课关系必须安排在相同课节。`
  return `${targetName}与另外 ${relatedCount} 条任课关系不能安排在${exclusionMode === "same_day" ? "同一天" : "同一课节"}。`
}
