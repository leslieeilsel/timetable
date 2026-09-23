export const SYSTEM_NAME = "教务排课中心"

const pageTitles: Record<string, string> = {
  "/": "工作台",
  "/login": "登录",
  "/change-password": "修改密码",
  "/resources": "基础资料",
  "/resources/grades": "年级",
  "/resources/teachers": "教师",
  "/resources/courses": "课程",
  "/resources/rooms": "教室",
  "/years": "学年与班级",
  "/semester/setup": "学期配置",
  "/semester/assignments": "任课关系",
  "/semester/timetable": "查看课表",
  "/scheduling/preparation": "教学安排",
  "/scheduling/assignments": "任课关系",
  "/scheduling/constraints": "排课规则",
  "/scheduling/generate": "自动排课",
  "/scheduling/timetable": "检查并发布",
  "/scheduling/planning": "检查并发布",
  "/daily/adjustments": "调课与代课",
  "/daily/long-term": "持续调课",
  "/daily/leaves": "请假与代课",
  "/users": "用户管理",
  "/settings": "系统设置",
}

const semesterPageTitles: Record<string, string> = {
  dashboard: "学期工作台",
  setup: "学期配置",
  preparation: "教学安排",
  assignments: "任课关系",
  constraints: "排课规则",
  generate: "自动排课",
  timetable: "查看课表",
  planning: "检查并发布",
  adjustments: "调课与代课",
  "long-term": "持续调课",
  leaves: "请假与代课",
}

export function pageTitleForPath(pathname: string) {
  if (pathname === "/ai" || pathname.startsWith("/ai/")) return "AI 助手"
  const normalizedPath = pathname.replace(/\/+$/, "") || "/"
  if (/^\/years\/[^/]+$/.test(normalizedPath)) return "学年详情"
  const semesterPage = /^\/semesters\/[^/]+\/([^/]+)$/.exec(normalizedPath)?.[1]
  if (semesterPage) {
    if (semesterPageTitles[semesterPage]) return semesterPageTitles[semesterPage]
  }
  return pageTitles[normalizedPath] ?? "工作台"
}
