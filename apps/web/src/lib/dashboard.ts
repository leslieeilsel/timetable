import { semesterPath } from "@/lib/semester"
import type { DashboardSummary, Semester } from "@/lib/types"

export interface DashboardTask {
  id: string
  title: string
  description: string
  action: string
  href: string
}

export function dashboardTasks(semester: Semester, summary: DashboardSummary): DashboardTask[] {
  const path = (destination: Parameters<typeof semesterPath>[1]) =>
    semesterPath(semester.id, destination)
  const tasks: DashboardTask[] = []
  if (!summary.class_count)
    tasks.push({
      id: "classes",
      title: "先配置本学期的班级",
      description: "选择参与排课的班级，并设置班级教室。",
      action: "配置学期班级",
      href: path("setup"),
    })
  if (!summary.template_ready)
    tasks.push({
      id: "template",
      title: "设置本学期的作息",
      description: "确定上课日、节次和每节课的起止时间。",
      action: "设置作息",
      href: path("setup"),
    })
  if (!summary.assignment_count)
    tasks.push({
      id: "assignments",
      title: "建立本学期的任课关系",
      description: "明确每个班级的课程、任课教师和周课时。",
      action: "安排任课",
      href: path("assignments"),
    })
  else if (summary.confirmed_count < summary.assignment_count)
    tasks.push({
      id: "assignments",
      title: "复核本学期的任课关系",
      description: `共 ${summary.assignment_count} 条，已确认 ${summary.confirmed_count} 条；检查未确认或已停用的任务。`,
      action: "查看任课关系",
      href: path("assignments"),
    })
  if (!summary.current_version_id || summary.current_version_is_stale) {
    if (summary.working_draft_id && !summary.working_draft_is_stale)
      tasks.push({
        id: "draft",
        title: "最新草稿资料已同步，继续编排与复核",
        description: "这份草稿已使用最新资料。完成检查后，可将它设为当前课表。",
        action: "继续编辑最新草稿",
        href: `${path("planning")}?version=${summary.working_draft_id}`,
      })
    else
      tasks.push(
        summary.current_version_id
          ? {
              id: "stale",
              title: "资料已变化，需要更新课表",
              description:
                "请基于最新资料生成并复核新方案。现有课表可查看，排课进度与冲突需重新校验。",
              action: "重新排课",
              href: path("generate"),
            }
          : {
              id: "generate",
              title: "准备好后，生成第一份课表",
              description: "根据任课关系和排课规则生成方案，复核后设为当前课表。",
              action: "开始排课",
              href: path("generate"),
            },
      )
  } else {
    if (summary.current_version_hard_conflict_count)
      tasks.push({
        id: "conflicts",
        title: `处理 ${summary.current_version_hard_conflict_count} 个课表冲突`,
        description: "检查教师、班级或教室的时间冲突，完成调整后重新校验。",
        action: "查看冲突",
        href: path("planning"),
      })
    if (summary.remaining)
      tasks.push({
        id: "remaining",
        title: `还有 ${summary.remaining} 节课程待安排`,
        description: "进入课表，继续安排未排课程并检查约束。",
        action: "继续完成排课",
        href: path("planning"),
      })
    if (summary.current_version_soft_warning_count)
      tasks.push({
        id: "warnings",
        title: `复核 ${summary.current_version_soft_warning_count} 项排课提醒`,
        description: "检查课时分布与软约束，确认是否符合本校安排。",
        action: "查看提醒",
        href: path("planning"),
      })
  }
  return tasks
}
