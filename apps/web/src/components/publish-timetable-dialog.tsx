import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router"
import { toast } from "sonner"
import { api, ApiError, apiMessage } from "@/lib/api"
import type {
  Semester,
  TeachingAssignment,
  TimetablePublicationPreview,
  TimetableVersion,
} from "@/lib/types"
import type { GradeValidation } from "@/lib/grade-timetable"
import { semesterPath } from "@/lib/semester"
import { useAuth } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"

export interface PublicationRepairTarget {
  assignmentId: number
  label: string
  weekday?: number
  itemId?: number
  entryId?: number
}

export function PublishTimetableDialog({
  open,
  onClose,
  semester,
  version,
  onPublished,
  assignments,
  onLocate,
  onRefreshDraft,
}: {
  open: boolean
  onClose: () => void
  semester: Semester
  version: TimetableVersion
  onPublished: () => Promise<void>
  assignments: TeachingAssignment[]
  onLocate: (target: PublicationRepairTarget) => void
  onRefreshDraft: () => Promise<void>
}) {
  const { user } = useAuth()
  const reasonKey = `publication-reason:${user?.id}:${semester.id}:${version.id}`
  const [reason, setReason] = useState(() => {
    try {
      return sessionStorage.getItem(reasonKey) ?? ""
    } catch {
      return ""
    }
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const preview = useQuery({
    queryKey: [
      "timetable-publication-preview",
      semester.id,
      version.id,
      semester.timetable_revision,
    ],
    enabled: open,
    staleTime: 0,
    retry: false,
    queryFn: () =>
      api<TimetablePublicationPreview>(
        `/api/v1/semesters/${semester.id}/timetable-versions/${version.id}/publication-preview`,
        { method: "POST" },
      ),
  })
  const diagnosis = useQuery({
    queryKey: ["publication-diagnostics", semester.id, version.id, semester.timetable_revision],
    enabled: open,
    staleTime: 0,
    retry: false,
    queryFn: () =>
      api<GradeValidation>(
        `/api/v1/semesters/${semester.id}/timetable/validation?version_id=${version.id}`,
      ),
  })
  const assignmentLabel = (id: number) => {
    const assignment = assignments.find((item) => item.id === id)
    return assignment
      ? `${assignment.school_class?.name ?? assignment.teaching_group?.name ?? "任课"} · ${assignment.course.name} · ${assignment.teacher.name}`
      : `任课 #${id}`
  }
  const incompleteGroups = new Map<string, NonNullable<GradeValidation["incomplete_assignments"]>>()
  for (const issue of diagnosis.data?.data.incomplete_assignments ?? []) {
    const assignment = assignments.find((item) => item.id === issue.id)
    const group = assignment?.school_class?.name ?? assignment?.teaching_group?.name ?? "其他任课"
    incompleteGroups.set(group, [...(incompleteGroups.get(group) ?? []), issue])
  }
  const repairHref = (
    destination: "constraints" | "fixed-placements" | "assignments",
    focus?: number,
  ) =>
    `${semesterPath(semester.id, destination)}?return_version=${version.id}${focus ? `&focus=${focus}` : ""}`
  const publish = async () => {
    if (busy || !preview.data?.etag || !preview.data.data.allowed || reason.trim().length < 2)
      return
    setBusy(true)
    setError("")
    try {
      await api(`/api/v1/semesters/${semester.id}/timetable-versions/${version.id}/activate`, {
        method: "POST",
        etag: preview.data.etag,
        body: JSON.stringify({ reason: reason.trim() }),
      })
      await onPublished()
      try {
        sessionStorage.removeItem(reasonKey)
      } catch {
        /* Storage may be unavailable. */
      }
      setReason("")
      toast.success("课表已发布，可在“查看课表”中查看")
      onClose()
    } catch (caught) {
      setError(apiMessage(caught))
      void preview.refetch()
      void diagnosis.refetch()
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value && !busy) onClose()
      }}
    >
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-[680px]">
        <DialogHeader className="pr-10">
          <DialogTitle>检查并发布课表</DialogTitle>
          <DialogDescription>
            {semester.academic_year?.name} · {semester.name} · {version.name}（v{version.version_no}
            ）
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2 text-sm">
          <div className="rounded-lg bg-muted/50 p-3">
            <p className="font-medium">替换本学期的标准课表</p>
            <p className="mt-1 text-muted-foreground">
              {semester.start_date} 至 {semester.end_date}
            </p>
          </div>
          {preview.isFetching ? (
            <p role="status">正在检查课程冲突与现有调课…</p>
          ) : preview.isError ? (
            <div role="alert">
              <p className="text-destructive">{apiMessage(preview.error)}</p>
              {preview.error instanceof ApiError &&
                preview.error.code === "VERSION_INPUT_STALE" && (
                  <div className="mt-2 space-y-2">
                    <p className="text-muted-foreground">
                      创建修复草稿会复制现有课程位置，按最新资料重新检查，并带入已填写的发布说明。
                    </p>
                    <Button
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true)
                        try {
                          await onRefreshDraft()
                        } finally {
                          setBusy(false)
                        }
                      }}
                    >
                      使用最新资料创建修复草稿
                    </Button>
                  </div>
                )}
              <Button
                className="mt-2"
                variant="outline"
                onClick={() => {
                  void preview.refetch()
                  void diagnosis.refetch()
                }}
              >
                重新检查
              </Button>
            </div>
          ) : (
            preview.data && (
              <div>
                <p
                  className={
                    preview.data.data.allowed
                      ? "text-emerald-700 dark:text-emerald-400"
                      : "text-destructive"
                  }
                >
                  {preview.data.data.summary}
                </p>
                {preview.data.data.impact.items
                  .filter((item) => item.status === "needs_review" || item.status === "orphaned")
                  .map((item) => (
                    <p key={`${item.kind}-${item.id}`} className="mt-2 text-muted-foreground">
                      {item.effective_date} · {item.summary}：{item.reason}
                    </p>
                  ))}
              </div>
            )
          )}
          {diagnosis.isFetching && (
            <p role="status" className="text-muted-foreground">
              正在整理需要修复的任课与冲突…
            </p>
          )}
          {diagnosis.isError && (
            <div role="alert">
              <p>问题清单暂时无法载入：{apiMessage(diagnosis.error)}</p>
              <Button variant="outline" size="sm" onClick={() => void diagnosis.refetch()}>
                重试问题清单
              </Button>
            </div>
          )}
          {diagnosis.data && (
            <div className="max-h-[45svh] space-y-4 overflow-y-auto" aria-label="发布问题清单">
              {incompleteGroups.size > 0 && (
                <section aria-label="课时不完整">
                  <p className="font-semibold">
                    课时不完整 · {diagnosis.data.data.incomplete_assignments.length} 条任课
                  </p>
                  {Array.from(incompleteGroups, ([group, issues]) => (
                    <details key={group} open className="mt-2 rounded-lg border p-3">
                      <summary className="cursor-pointer font-medium">
                        {group} · {issues.length} 项
                      </summary>
                      <ul className="mt-2 divide-y">
                        {issues.map((issue) => (
                          <li
                            key={issue.id}
                            className="flex flex-wrap items-center justify-between gap-2 py-2"
                          >
                            <div>
                              <p>{assignmentLabel(issue.id)}</p>
                              <p className="text-xs text-muted-foreground">
                                应排 {issue.required} 节，已排 {issue.scheduled} 节，
                                {issue.scheduled < issue.required
                                  ? `还缺 ${issue.required - issue.scheduled}`
                                  : `多排 ${issue.scheduled - issue.required}`}{" "}
                                节
                              </p>
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                onLocate({
                                  assignmentId: issue.id,
                                  label: assignmentLabel(issue.id),
                                })
                              }
                            >
                              定位任课
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ))}
                </section>
              )}
              {diagnosis.data.data.hard_conflicts.length > 0 && (
                <section aria-label="必须修复的冲突">
                  <p className="font-semibold">
                    必须修复的冲突 · {diagnosis.data.data.hard_conflicts.length} 项
                  </p>
                  <ul className="mt-2 divide-y rounded-lg border px-3">
                    {diagnosis.data.data.hard_conflicts.map((issue, index) => (
                      <li key={`${issue.type}-${index}`} className="space-y-2 py-3">
                        {issue.assignment_id && (
                          <p className="font-medium">{assignmentLabel(issue.assignment_id)}</p>
                        )}
                        <p>
                          {issue.weekday
                            ? `周${"一二三四五六日"[issue.weekday - 1]} ${issue.item_name ?? ""} · `
                            : ""}
                          {issue.message}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {issue.assignment_id && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                onLocate({
                                  assignmentId: issue.assignment_id!,
                                  label: assignmentLabel(issue.assignment_id!),
                                  weekday: issue.weekday,
                                  itemId: issue.item_id,
                                  entryId: issue.entry_id,
                                })
                              }
                            >
                              定位课表
                            </Button>
                          )}
                          {issue.fixed_placement_id && (
                            <Button
                              nativeButton={false}
                              size="sm"
                              variant="outline"
                              render={
                                <Link
                                  to={repairHref("fixed-placements", issue.fixed_placement_id)}
                                />
                              }
                            >
                              查看固定安排
                            </Button>
                          )}
                          {issue.constraint_id && (
                            <Button
                              nativeButton={false}
                              size="sm"
                              variant="outline"
                              render={<Link to={repairHref("constraints", issue.constraint_id)} />}
                            >
                              查看冲突规则
                            </Button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {!!diagnosis.data.data.draft_assignment_count && (
                <p>
                  还有 {diagnosis.data.data.draft_assignment_count} 条任课尚未确认。
                  <Link className="underline underline-offset-4" to={repairHref("assignments")}>
                    去确认任课
                  </Link>
                </p>
              )}
              {diagnosis.data.data.synchronization_issues?.map((issue, index) => (
                <p key={index} className="text-destructive">
                  {issue.message ?? "关联任课的排课位置需要同步，请检查关联课程。"}
                  <Link className="ml-2 underline" to={repairHref("constraints")}>
                    检查关联规则
                  </Link>
                  {issue.assignment_ids?.map((id) => (
                    <Button
                      key={id}
                      className="m-1"
                      size="sm"
                      variant="outline"
                      onClick={() => onLocate({ assignmentId: id, label: assignmentLabel(id) })}
                    >
                      {assignmentLabel(id)}
                    </Button>
                  ))}
                </p>
              ))}
              {version.soft_warning_count > 0 && (
                <p className="text-muted-foreground">
                  生成时记录 {version.soft_warning_count}{" "}
                  项软规则提醒，供人工复核；软规则提醒本身不阻止发布。
                </p>
              )}
            </div>
          )}
          <label className="grid gap-2">
            发布说明
            <Textarea
              value={reason}
              onChange={(event) => {
                setReason(event.target.value)
                try {
                  sessionStorage.setItem(reasonKey, event.target.value)
                } catch {
                  /* Keep the in-memory draft. */
                }
              }}
              placeholder="例如：新学期课表复核完成"
              maxLength={500}
              disabled={busy}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            修复后可返回继续检查。发布说明会在本浏览器会话中保留，正式发布前会重新校验最新课表。
          </p>
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            返回编排
          </Button>
          <Button
            disabled={
              busy ||
              preview.isFetching ||
              preview.isError ||
              !preview.data?.data.allowed ||
              reason.trim().length < 2
            }
            onClick={() => void publish()}
          >
            {busy ? "正在发布…" : "确认发布"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
