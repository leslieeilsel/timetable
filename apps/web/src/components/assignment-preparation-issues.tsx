import { useQuery } from "@tanstack/react-query"
import { api, apiAllPages } from "@/lib/api"
import { assignmentMatchesResource } from "@/lib/timetable-state"
import type { ClassSetting, PreparationCheck, Room, Teacher, TeachingAssignment } from "@/lib/types"
import { ErrorState, LoadingState } from "@/components/page"
import { Button } from "@/components/ui/button"

function issueText(value: unknown, fallback = "—") {
  return typeof value === "string" || typeof value === "number" ? String(value) : fallback
}

export function AssignmentPreparationIssues({
  semesterId,
  filter,
  settings,
  teachers,
  rooms,
  disabled,
  onEdit,
  onClose,
}: {
  semesterId: number
  filter: "issues" | "capacity"
  settings: ClassSetting[]
  teachers: Teacher[]
  rooms: Room[]
  disabled: boolean
  onEdit: (assignment: TeachingAssignment) => void
  onClose: () => void
}) {
  const check = useQuery({
    queryKey: ["preparation-check", semesterId],
    queryFn: () => api<PreparationCheck>(`/api/v1/semesters/${semesterId}/preparation-check`),
  })
  const assignments = useQuery({
    queryKey: ["teaching-assignments", semesterId, "confirmed"],
    queryFn: () =>
      apiAllPages<TeachingAssignment>(
        `/api/v1/semesters/${semesterId}/teaching-assignments?status=confirmed`,
      ),
  })
  const result = check.data?.data.checks.find(
    (item) => item.key === (filter === "issues" ? "assignment_resources" : "theoretical_capacity"),
  )
  const retry = () => {
    void check.refetch()
    void assignments.refetch()
  }

  return (
    <section
      className="surface-panel mb-4 overflow-hidden"
      aria-label={filter === "issues" ? "任课资源异常" : "课时容量问题"}
    >
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <h2 className="text-sm font-semibold">
          {filter === "issues" ? "任课资源异常" : "课时容量问题"}
        </h2>
        <Button variant="ghost" size="sm" onClick={onClose}>
          收起问题
        </Button>
      </div>
      {check.isLoading || assignments.isLoading ? (
        <LoadingState label="正在读取问题明细…" />
      ) : check.isError || assignments.isError || !result ? (
        <ErrorState retry={retry} />
      ) : !result.items.length ? (
        <p className="px-4 py-4 text-sm text-muted-foreground">
          {result.status === "passed" ? "当前未发现此类问题。" : result.message}
        </p>
      ) : (
        <div className="divide-y">
          {result.items.map((issue, index) => {
            const resourceId = Number(issue.resource_id)
            const view =
              issue.resource_type === "school_class"
                ? "class"
                : issue.resource_type === "teacher"
                  ? "teacher"
                  : "room"
            const resourceName =
              view === "class"
                ? settings.find((setting) => setting.school_class_id === resourceId)?.school_class
                    .name
                : view === "teacher"
                  ? teachers.find((teacher) => teacher.id === resourceId)?.name
                  : rooms.find((room) => room.id === resourceId)?.name
            const related = (assignments.data?.data ?? []).filter((assignment) =>
              filter === "issues"
                ? assignment.id === Number(issue.assignment_id)
                : assignmentMatchesResource(assignment, view, resourceId, settings),
            )
            return (
              <div key={index} className="px-4 py-3 text-sm">
                {filter === "issues" ? (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">
                        {issueText(issue.class_or_group, "未设置班级")} ·{" "}
                        {issueText(issue.course, "课程")} · {issueText(issue.teacher, "教师")}
                      </p>
                      <p className="mt-1 text-muted-foreground">
                        {Array.isArray(issue.reasons)
                          ? issue.reasons
                              .filter((reason): reason is string => typeof reason === "string")
                              .join("；")
                          : result.message}
                      </p>
                    </div>
                    {related[0] && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={disabled}
                        onClick={() => onEdit(related[0])}
                      >
                        编辑任课
                      </Button>
                    )}
                  </div>
                ) : (
                  <details>
                    <summary className="cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-ring">
                      <span className="font-medium">
                        {resourceName ??
                          `${view === "class" ? "班级" : view === "teacher" ? "教师" : "教室"} #${resourceId}`}
                      </span>
                      <span className="ml-3 text-muted-foreground">
                        第 {issueText(issue.teaching_week)} 周 · 应排 {issueText(issue.required)} 节
                        / 可排 {issueText(issue.capacity)} 节
                      </span>
                    </summary>
                    <div className="mt-3 space-y-1">
                      {related.map((assignment) => (
                        <div
                          key={assignment.id}
                          className="flex flex-wrap items-center justify-between gap-2 py-1"
                        >
                          <span>
                            {assignment.school_class?.name ?? assignment.teaching_group?.name} ·{" "}
                            {assignment.course.name} · {assignment.teacher.name} · 每周{" "}
                            {assignment.weekly_items} 节
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={disabled}
                            onClick={() => onEdit(assignment)}
                          >
                            编辑任课
                          </Button>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
