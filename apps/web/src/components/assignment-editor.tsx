import { useEffect, useMemo, useState } from "react"
import { AlertTriangleIcon } from "lucide-react"
import { toast } from "sonner"
import { api, apiMessage, jsonBody } from "@/lib/api"
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
import { ClassPicker, CoursePicker, RoomPicker, TeacherPicker } from "@/components/resource-picker"
import { SimpleSelect } from "@/components/simple-select"
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

export interface AssignmentEditorSeed {
  assignment?: TeachingAssignment
  schoolClassId?: number
  courseId?: number
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
  const [form, setForm] = useState({
    targetType: "class" as "class" | "group",
    schoolClassId: "",
    teachingGroupId: "",
    courseId: "",
    teacherId: "",
    collaboratorIds: [] as number[],
    weeklyItems: "1",
    itemsPerSession: "1",
    weekPattern: "all" as WeekPattern,
    activeWeeks: "",
    roomMode: "class_default" as "class_default" | "specified",
    specifiedRoomId: "",
    allowsSubstitution: true,
  })
  const assignment = seed?.assignment
  const activeTeachers = useMemo(() => teachers.filter((item) => item.is_active), [teachers])
  const selectedCourseId = Number(form.courseId)
  const qualifiedTeachers = useMemo(
    () =>
      activeTeachers.filter(
        (teacher) =>
          teacher.courses?.some((course) => course.id === selectedCourseId) ||
          teacher.id === Number(form.teacherId) ||
          form.collaboratorIds.includes(teacher.id),
      ),
    [activeTeachers, form.collaboratorIds, form.teacherId, selectedCourseId],
  )
  const selectedTeacher = teachers.find((item) => item.id === Number(form.teacherId))
  const teacherQualified =
    !selectedTeacher || selectedTeacher.courses?.some((course) => course.id === selectedCourseId)

  useEffect(() => {
    if (!seed) return
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
      collaboratorIds: assignment?.collaborators.map((teacher) => teacher.id) ?? [],
      weeklyItems: String(assignment?.weekly_items ?? 1),
      itemsPerSession: String(assignment?.items_per_session ?? 1),
      weekPattern: assignment?.week_pattern ?? "all",
      activeWeeks: assignment?.active_weeks?.join("、") ?? "",
      roomMode: assignment?.room_mode ?? "class_default",
      specifiedRoomId: String(
        assignment?.specified_room_id ?? rooms.find((item) => item.is_active)?.id ?? "",
      ),
      allowsSubstitution: assignment?.allows_substitution ?? true,
    })
  }, [activeTeachers, assignment, courses, groups, rooms, seed, settings])

  const activeWeeks = form.activeWeeks
    .split(/[、,，\s]+/)
    .map(Number)
    .filter((value) => Number.isInteger(value) && value > 0)
  const invalidSession = Number(form.itemsPerSession) > Number(form.weeklyItems)
  const missingTarget =
    (form.targetType === "class" && !form.schoolClassId) ||
    (form.targetType === "group" && !form.teachingGroupId)
  const missingRoom = form.roomMode === "specified" && !form.specifiedRoomId
  const missingWeeks = form.weekPattern === "specified" && activeWeeks.length === 0

  const save = async () => {
    if (!etag || missingTarget || missingRoom || missingWeeks || invalidSession) return
    setSaving(true)
    try {
      const body = {
        school_class_id: form.targetType === "class" ? Number(form.schoolClassId) : null,
        teaching_group_id: form.targetType === "group" ? Number(form.teachingGroupId) : null,
        course_id: Number(form.courseId),
        teacher_id: Number(form.teacherId),
        collaborator_ids: form.collaboratorIds,
        weekly_items: Number(form.weeklyItems),
        items_per_session: Number(form.itemsPerSession),
        week_pattern: form.weekPattern,
        active_weeks: form.weekPattern === "specified" ? [...new Set(activeWeeks)] : null,
        room_mode: form.targetType === "group" ? "specified" : form.roomMode,
        specified_room_id:
          form.targetType === "group" || form.roomMode === "specified"
            ? Number(form.specifiedRoomId)
            : null,
        allows_substitution: form.allowsSubstitution,
      }
      await api(
        assignment
          ? `/api/v1/semesters/${semesterId}/teaching-assignments/${assignment.id}`
          : `/api/v1/semesters/${semesterId}/teaching-assignments`,
        {
          method: assignment ? "PATCH" : "POST",
          etag,
          body: jsonBody(body),
        },
      )
      toast.success(assignment ? "任课关系已更新" : "任课关系已加入矩阵")
      onClose()
      await onSaved()
    } catch (error) {
      toast.error(apiMessage(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={seed !== undefined} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{assignment ? "编辑任课关系" : "设置任课关系"}</DialogTitle>
          <DialogDescription>
            确认前可继续调整；已有课程安排后，授课对象、教师、周型、连排和教室规则将被保护。
          </DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[65vh] gap-5 overflow-y-auto pr-1">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="授课对象类型">
              <SimpleSelect
                className="w-full"
                value={form.targetType}
                disabled={Boolean(seed?.schoolClassId)}
                onValueChange={(value) => {
                  const targetType = value as "class" | "group"
                  setForm((current) => ({
                    ...current,
                    targetType,
                    roomMode: targetType === "group" ? "specified" : current.roomMode,
                  }))
                }}
              >
                <option value="class">班级</option>
                <option value="group">教学组（合班 / 拆班 / 走班）</option>
              </SimpleSelect>
            </Field>
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
                    setForm((current) => ({ ...current, schoolClassId: value }))
                  }
                />
              </Field>
            ) : (
              <Field label="教学组">
                <SimpleSelect
                  className="w-full"
                  value={form.teachingGroupId}
                  onValueChange={(value) =>
                    setForm((current) => ({ ...current, teachingGroupId: value }))
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
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="课程">
              <CoursePicker
                courses={courses}
                value={form.courseId}
                disabled={Boolean(seed?.courseId)}
                onValueChange={(value) => setForm((current) => ({ ...current, courseId: value }))}
              />
            </Field>
            <Field label="主讲教师">
              <TeacherPicker
                teachers={teachers}
                courseId={selectedCourseId || null}
                value={form.teacherId}
                onValueChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    teacherId: value,
                    collaboratorIds: current.collaboratorIds.filter((id) => id !== Number(value)),
                  }))
                }
              />
            </Field>
          </div>
          {!teacherQualified && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
              该教师尚未标记为可教授此课程。可以先保存草稿，但确认前必须补齐任教资格。
            </div>
          )}

          <Field label="协同教师（可选）">
            <div className="grid max-h-32 gap-1 overflow-y-auto rounded-lg border p-2 sm:grid-cols-2">
              {qualifiedTeachers
                .filter((teacher) => teacher.id !== Number(form.teacherId))
                .map((teacher) => (
                  <label
                    key={teacher.id}
                    className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-muted"
                  >
                    <Checkbox
                      checked={form.collaboratorIds.includes(teacher.id)}
                      onCheckedChange={(checked) =>
                        setForm((current) => ({
                          ...current,
                          collaboratorIds: checked
                            ? [...current.collaboratorIds, teacher.id]
                            : current.collaboratorIds.filter((id) => id !== teacher.id),
                        }))
                      }
                    />
                    <span>{teacher.name}</span>
                    {teacher.employee_no && (
                      <span className="ml-auto text-xs text-muted-foreground">
                        {teacher.employee_no}
                      </span>
                    )}
                  </label>
                ))}
              {!qualifiedTeachers.length && (
                <p className="px-2 py-1 text-sm text-muted-foreground">没有匹配此课程的教师。</p>
              )}
            </div>
          </Field>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="每周课时">
              <Input
                type="number"
                min="1"
                max="100"
                value={form.weeklyItems}
                onChange={(event) =>
                  setForm((current) => ({ ...current, weeklyItems: event.target.value }))
                }
              />
            </Field>
            <Field label="每次连排">
              <Input
                type="number"
                min="1"
                max="10"
                value={form.itemsPerSession}
                aria-invalid={invalidSession}
                onChange={(event) =>
                  setForm((current) => ({ ...current, itemsPerSession: event.target.value }))
                }
              />
            </Field>
            <Field label="教学周型">
              <SimpleSelect
                className="w-full"
                value={form.weekPattern}
                onValueChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    weekPattern: value as WeekPattern,
                  }))
                }
              >
                <option value="all">每周</option>
                <option value="a">单周 / A 周</option>
                <option value="b">双周 / B 周</option>
                <option value="specified">指定教学周</option>
              </SimpleSelect>
            </Field>
          </div>
          {invalidSession && (
            <p className="-mt-3 text-xs text-destructive">每次连排课时不能超过每周课时。</p>
          )}
          {form.weekPattern === "specified" && (
            <Field label="指定教学周" error={missingWeeks ? "请输入至少一个教学周" : undefined}>
              <Input
                value={form.activeWeeks}
                placeholder="例如：1、3、5、7"
                onChange={(event) =>
                  setForm((current) => ({ ...current, activeWeeks: event.target.value }))
                }
              />
            </Field>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="教室方式">
              <SimpleSelect
                className="w-full"
                value={form.targetType === "group" ? "specified" : form.roomMode}
                disabled={form.targetType === "group"}
                onValueChange={(value) =>
                  setForm((current) => ({
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
                    setForm((current) => ({ ...current, specifiedRoomId: value }))
                  }
                />
              </Field>
            )}
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-3">
            <Checkbox
              className="mt-0.5"
              checked={form.allowsSubstitution}
              onCheckedChange={(checked) =>
                setForm((current) => ({ ...current, allowsSubstitution: Boolean(checked) }))
              }
            />
            <span>
              <span className="block font-medium">允许临时代课</span>
              <span className="block text-xs text-muted-foreground">
                教师请假时可在日常运行中为此课程安排代课教师。
              </span>
            </span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={
              saving ||
              !form.courseId ||
              !form.teacherId ||
              missingTarget ||
              missingRoom ||
              missingWeeks ||
              invalidSession
            }
            onClick={() => void save()}
          >
            {saving ? "正在保存…" : assignment ? "保存修改" : "加入矩阵"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
