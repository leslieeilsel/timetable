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
  "/semester/setup": "班级与作息",
  "/semester/assignments": "任课与课时",
  "/semester/timetable": "查看课表",
  "/scheduling/preparation": "排课准备",
  "/scheduling/assignments": "任课与课时",
  "/scheduling/constraints": "排课规则",
  "/scheduling/fixed-placements": "固定安排",
  "/scheduling/generate": "自动排课",
  "/scheduling/timetable": "编排课表",
  "/scheduling/planning": "编排课表",
  "/daily/adjustments": "调课与代课",
  "/daily/long-term": "持续调课",
  "/daily/leaves": "请假与代课",
  "/users": "用户管理",
  "/settings": "系统设置",
}

const semesterPageTitles: Record<string, string> = {
  dashboard: "学期工作台",
  setup: "班级与作息",
  preparation: "排课准备",
  assignments: "任课与课时",
  constraints: "排课规则",
  "fixed-placements": "固定安排",
  generate: "自动排课",
  timetable: "查看课表",
  planning: "编排课表",
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
