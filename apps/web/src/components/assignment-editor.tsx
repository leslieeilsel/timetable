import { useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangleIcon } from "lucide-react"
import { toast } from "sonner"
import { api, apiMessage } from "@/lib/api"
import { TEACHING_GROUPS_ENABLED } from "@/lib/features"
import type {
  ClassSetting,
  Course,
  Room,
  Teacher,
  TeachingAssignment,
  TeachingGroup,
  WeekPattern,
} from "@/lib/types"
import { Field } from "@/components/page"
import {
  AssignmentCapacityPanel,
  type CapacityCheck,
  type CapacityPreview,
} from "@/components/assignment-capacity"
import { ClassPicker, CoursePicker, RoomPicker, TeacherPicker } from "@/components/resource-picker"
import { SimpleSelect } from "@/components/simple-select"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import "./assignment-editor.css"

export interface AssignmentEditorSeed {
  assignment?: TeachingAssignment
  schoolClassId?: number
  courseId?: number
}

function sortedSelection(values: readonly number[] | null) {
  return [...new Set(values ?? [])].sort((left, right) => left - right)
}

export function AssignmentEditorDialog({
  seed,
  semesterId,
  etag,
  settings,
  groups,
  courses,
  teachers,
  rooms,
  onClose,
  onSaved,
}: {
  seed: AssignmentEditorSeed | undefined
  semesterId: number
  etag: string | null
  settings: ClassSetting[]
  groups: TeachingGroup[]
  courses: Course[]
  teachers: Teacher[]
  rooms: Room[]
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const [capacityResult, setCapacityResult] = useState<(CapacityCheck & { key: string }) | null>(
    null,
  )
  const [capacityVisible, setCapacityVisible] = useState(false)
  const pendingSubmission = useRef<AbortController | null>(null)
  const validationRegion = useRef<HTMLDivElement>(null)
  const [form, setForm] = useState({
    targetType: "class" as "class" | "group",
    schoolClassId: "",
    teachingGroupId: "",
    courseId: "",
    teacherId: "",
    weeklyItems: "1",
    itemsPerSession: "1",
    weekPattern: "all" as WeekPattern,
    activeWeeks: "",
    roomMode: "class_default" as "class_default" | "specified",
    specifiedRoomId: "",
  })
  const updateForm: typeof setForm = (update) => {
    setCapacityVisible(false)
    setForm(update)
  }
  const assignment = seed?.assignment
  const activeTeachers = useMemo(() => teachers.filter((item) => item.is_active), [teachers])
  const selectedCourseId = Number(form.courseId)
  const selectedTeacher = teachers.find((item) => item.id === Number(form.teacherId))
  const teacherQualified =
    !selectedTeacher || selectedTeacher.courses?.some((course) => course.id === selectedCourseId)

  useEffect(() => {
    if (!seed) return
    setCapacityVisible(false)
    const nextCourseId =
      assignment?.course_id ?? seed.courseId ?? courses.find((item) => item.is_active)?.id
    const nextTeacher =
      assignment?.teacher_id ??
      activeTeachers.find((teacher) =>
        teacher.courses?.some((course) => course.id === nextCourseId),
      )?.id ??
      activeTeachers[0]?.id
    const targetType = assignment?.teaching_group_id ? "group" : "class"
    setForm({
      targetType,
      schoolClassId: String(
        assignment?.school_class_id ?? seed.schoolClassId ?? settings[0]?.school_class_id ?? "",
      ),
      teachingGroupId: String(assignment?.teaching_group_id ?? groups[0]?.id ?? ""),
      courseId: String(nextCourseId ?? ""),
      teacherId: String(nextTeacher ?? ""),
      weeklyItems: String(assignment?.weekly_items ?? 1),
      itemsPerSession: String(assignment?.items_per_session ?? 1),
      weekPattern: assignment?.week_pattern ?? "all",
      activeWeeks: assignment?.active_weeks?.join("、") ?? "",
      roomMode: assignment?.room_mode ?? "class_default",
      specifiedRoomId: String(
        assignment?.specified_room_id ?? rooms.find((item) => item.is_active)?.id ?? "",
      ),
    })
  }, [activeTeachers, assignment, courses, groups, rooms, seed, settings])

  useEffect(() => {
    setCapacityResult(null)
    setCapacityVisible(false)
    setSaving(false)
    return () => {
      pendingSubmission.current?.abort()
      pendingSubmission.current = null
    }
  }, [seed, semesterId])

  const activeWeeks = form.activeWeeks
    .split(/[、,，\s]+/)
    .map(Number)
    .filter((value) => Number.isInteger(value) && value > 0)
  const invalidSession =
    Number(form.itemsPerSession) > Number(form.weeklyItems) ||
    !Number.isInteger(Number(form.itemsPerSession)) ||
    Number(form.itemsPerSession) < 1 ||
    Number(form.itemsPerSession) > 10
  const invalidWeeklyItems =
    !Number.isInteger(Number(form.weeklyItems)) ||
    Number(form.weeklyItems) < 1 ||
    Number(form.weeklyItems) > 100
  const missingTarget =
    (form.targetType === "class" && !form.schoolClassId) ||
    (form.targetType === "group" && !form.teachingGroupId)
  const missingRoom =
    (form.targetType === "group" || form.roomMode === "specified") && !form.specifiedRoomId
  const missingWeeks = form.weekPattern === "specified" && activeWeeks.length === 0
  const invalidWeeks = form.weekPattern === "specified" && activeWeeks.some((week) => week > 60)
  const body = {
    school_class_id: form.targetType === "class" ? Number(form.schoolClassId) : null,
    teaching_group_id: form.targetType === "group" ? Number(form.teachingGroupId) : null,
    course_id: Number(form.courseId),
    teacher_id: Number(form.teacherId),
    weekly_items: Number(form.weeklyItems),
    items_per_session: Number(form.itemsPerSession),
    week_pattern: form.weekPattern,
    active_weeks: form.weekPattern === "specified" ? sortedSelection(activeWeeks) : null,
    room_mode: form.targetType === "group" ? "specified" : form.roomMode,
    specified_room_id:
      form.targetType === "group" || form.roomMode === "specified"
        ? Number(form.specifiedRoomId)
        : null,
  }
  const savedValues = assignment
    ? {
        ...assignment,
        active_weeks:
          assignment.week_pattern === "specified" ? sortedSelection(assignment.active_weeks) : null,
      }
    : null
  const hasChanges =
    savedValues === null ||
    (Object.keys(body) as (keyof typeof body)[]).some(
      (key) => JSON.stringify(body[key]) !== JSON.stringify(savedValues[key]),
    )
  const invalidForm =
    !form.courseId ||
    !form.teacherId ||
    missingTarget ||
    missingRoom ||
    missingWeeks ||
    invalidWeeks ||
    invalidSession ||
    invalidWeeklyItems
  const validationKey = JSON.stringify([semesterId, assignment?.id ?? null, etag, body])
  // Only Save opens the panel; returning to previously checked values must not reopen it.
  const capacity = capacityVisible && capacityResult?.key === validationKey ? capacityResult : null

  useEffect(() => {
    if (!capacity || capacity.checking || saving) return
    validationRegion.current?.focus({ preventScroll: true })
    if (window.matchMedia("(max-width: 63.999rem)").matches) {
      validationRegion.current?.scrollIntoView({ block: "nearest" })
    }
  }, [capacity, saving])

  const save = async () => {
    if (pendingSubmission.current || saving || !hasChanges || !etag || invalidForm) return
    const controller = new AbortController()
    pendingSubmission.current = controller
    setSaving(true)
    setCapacityResult({ key: validationKey, checking: true })
    setCapacityVisible(true)
    let checkedData: CapacityPreview | undefined
    try {
      const preview = await api<CapacityPreview>(
        `/api/v1/semesters/${semesterId}/teaching-assignments/capacity-preview`,
        {
          method: "POST",
          signal: controller.signal,
          body: JSON.stringify({
            ...body,
            assignment_id: assignment?.id ?? null,
            // Preserve existing records while removing collaboration from new assignments.
            collaborator_ids: assignment?.collaborators.map((teacher) => teacher.id) ?? [],
          }),
        },
      )
      if (controller.signal.aborted) return
      checkedData = preview.data
      setCapacityResult({ key: validationKey, checking: false, data: checkedData })
      if (
        checkedData.capacity === 0 ||
        checkedData.active_weeks.length === 0 ||
        checkedData.overloaded_weeks.length > 0
      )
        return
      await api(
        assignment
          ? `/api/v1/semesters/${semesterId}/teaching-assignments/${assignment.id}`
          : `/api/v1/semesters/${semesterId}/teaching-assignments`,
        {
          method: assignment ? "PATCH" : "POST",
          etag,
          signal: controller.signal,
          body: JSON.stringify(body),
        },
      )
      if (controller.signal.aborted) return
      toast.success(assignment ? "任课关系已更新" : "任课关系已添加")
      onClose()
      await onSaved()
    } catch (error) {
      if (!controller.signal.aborted) {
        setCapacityResult({
          key: validationKey,
          checking: false,
          data: checkedData,
          error: apiMessage(error),
        })
      }
    } finally {
      if (pendingSubmission.current === controller) {
        pendingSubmission.current = null
        setSaving(false)
      }
    }
  }

  return (
    <Dialog open={seed !== undefined} onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent
        showCloseButton={!saving}
        data-capacity-open={Boolean(capacity)}
        className="assignment-editor-dialog max-h-[90dvh] grid-rows-[auto_minmax(0,1fr)_auto]"
      >
        <DialogHeader className="pr-10">
          <DialogTitle>{assignment ? "编辑任课关系" : "设置任课关系"}</DialogTitle>
        </DialogHeader>
        <div className="assignment-editor-layout min-h-0 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <fieldset
            disabled={saving}
            aria-label="任课信息"
            className="grid min-w-0 content-start gap-5 py-1"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              {(TEACHING_GROUPS_ENABLED || Boolean(assignment?.teaching_group_id)) && (
                <Field label="授课对象类型">
                  <SimpleSelect
                    className="w-full"
                    value={form.targetType}
                    disabled={Boolean(seed?.schoolClassId)}
                    onValueChange={(value) => {
                      const targetType = value as "class" | "group"
                      updateForm((current) => ({
                        ...current,
                        targetType,
                        roomMode: targetType === "group" ? "specified" : current.roomMode,
                      }))
                    }}
                  >
                    <option value="class">班级</option>
                    {(TEACHING_GROUPS_ENABLED || Boolean(assignment?.teaching_group_id)) && (
                      <option value="group">教学组（合班 / 拆班 / 走班）</option>
                    )}
                  </SimpleSelect>
                </Field>
              )}
              {form.targetType === "class" ? (
                <Field label="班级">
                  <ClassPicker
                    classes={settings.map((item) => item.school_class)}
                    statusById={Object.fromEntries(
                      settings.map((item) => [
                        item.school_class_id,
                        {
                          disabled: item.status !== "active",
                          label: item.status === "active" ? "可选" : "本学期已停用",
                          reason: item.status === "active" ? undefined : "班级本学期配置已停用",
                        },
                      ]),
                    )}
                    value={form.schoolClassId}
                    disabled={Boolean(seed?.schoolClassId)}
                    onValueChange={(value) =>
                      updateForm((current) => ({ ...current, schoolClassId: value }))
                    }
                  />
                </Field>
              ) : (
                <Field label="教学组">
                  <SimpleSelect
                    className="w-full"
                    value={form.teachingGroupId}
                    onValueChange={(value) =>
                      updateForm((current) => ({ ...current, teachingGroupId: value }))
                    }
                  >
                    <option value="">请选择教学组</option>
                    {groups
                      .filter((item) => item.status === "active")
                      .map((group) => (
                        <option key={group.id} value={group.id}>
                          {group.name}（{group.school_classes.length} 个班）
                        </option>
                      ))}
                  </SimpleSelect>
                </Field>
              )}
              <Field label="课程">
                <CoursePicker
                  courses={courses}
                  value={form.courseId}
                  disabled={Boolean(seed?.courseId)}
                  onValueChange={(value) =>
                    updateForm((current) => ({ ...current, courseId: value }))
                  }
                />
              </Field>
              <Field label="任课教师">
                <TeacherPicker
                  teachers={teachers}
                  courseId={selectedCourseId || null}
                  value={form.teacherId}
                  onValueChange={(value) =>
                    updateForm((current) => ({
                      ...current,
                      teacherId: value,
                    }))
                  }
                />
              </Field>
              <div className="grid gap-2">
                <Field
                  label={form.weekPattern === "all" ? "每周节数（节）" : "每个上课周的节数（节）"}
                >
                  <Input
                    type="number"
                    min="1"
                    aria-invalid={invalidWeeklyItems}
                    max="100"
                    value={form.weeklyItems}
                    onChange={(event) =>
                      updateForm((current) => ({ ...current, weeklyItems: event.target.value }))
                    }
                  />
                </Field>
              </div>
            </div>
            {!teacherQualified && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
                该教师尚未标记为可教授此课程。可以先保存草稿，但确认前必须补齐任教资格。
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="上课地点">
                <SimpleSelect
                  className="w-full"
                  value={form.targetType === "group" ? "specified" : form.roomMode}
                  disabled={form.targetType === "group"}
                  onValueChange={(value) =>
                    updateForm((current) => ({
                      ...current,
                      roomMode: value as "class_default" | "specified",
                    }))
                  }
                >
                  <option value="class_default">使用班级固定教室</option>
                  <option value="specified">指定教室</option>
                </SimpleSelect>
              </Field>
              {(form.targetType === "group" || form.roomMode === "specified") && (
                <Field label="指定教室">
                  <RoomPicker
                    rooms={rooms}
                    value={form.specifiedRoomId}
                    onValueChange={(value) =>
                      updateForm((current) => ({ ...current, specifiedRoomId: value }))
                    }
                  />
                </Field>
              )}
            </div>

            {invalidSession && (
              <p role="alert" className="text-sm text-destructive">
                每次连续上课请填写 1 至 10 的整数，且不能超过每个上课周的总节数。
              </p>
            )}
            <section aria-label="上课周次与连堂设置">
              <div className="grid gap-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="每次连续上几节">
                    <Input
                      type="number"
                      min="1"
                      max="10"
                      value={form.itemsPerSession}
                      aria-invalid={invalidSession}
                      onChange={(event) =>
                        updateForm((current) => ({
                          ...current,
                          itemsPerSession: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label="上课周次">
                    <SimpleSelect
                      className="w-full"
                      label="上课周次"
                      value={form.weekPattern}
                      onValueChange={(value) =>
                        updateForm((current) => ({
                          ...current,
                          weekPattern: value as WeekPattern,
                        }))
                      }
                    >
                      <option value="all">每周</option>
                      <option value="a">单周</option>
                      <option value="b">双周</option>
                      <option value="specified">指定教学周</option>
                    </SimpleSelect>
                  </Field>
                </div>
                {form.weekPattern === "specified" && (
                  <Field
                    label="指定教学周"
                    error={
                      missingWeeks
                        ? "请输入至少一个教学周"
                        : invalidWeeks
                          ? "教学周请输入 1 至 60 之间的整数"
                          : undefined
                    }
                  >
                    <Input
                      value={form.activeWeeks}
                      placeholder="例如：1、3、5、7"
                      onChange={(event) =>
                        updateForm((current) => ({ ...current, activeWeeks: event.target.value }))
                      }
                    />
                  </Field>
                )}
              </div>
            </section>
          </fieldset>
          <div
            className="assignment-editor-capacity-slot"
            inert={!capacity}
            aria-hidden={!capacity}
          >
            <div className="min-h-0 overflow-hidden">
              <div
                ref={validationRegion}
                tabIndex={-1}
                aria-label="提交检查结果"
                className="assignment-editor-capacity min-w-0 outline-none"
              >
                {capacityResult && (
                  <AssignmentCapacityPanel key={capacityResult.key} preview={capacityResult} />
                )}
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={onClose}>
            取消
          </Button>
          <Button disabled={saving || !hasChanges || invalidForm} onClick={() => void save()}>
            {saving
              ? capacity?.checking
                ? "正在检查…"
                : "正在保存…"
              : assignment
                ? "保存修改"
                : "保存任课"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
