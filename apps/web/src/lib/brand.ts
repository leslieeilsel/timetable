export const SYSTEM_NAME = "教务排课中心"
export const SYSTEM_TAGLINE = "学校教务工作台"

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
  "/semester/assignments": "课程与任课矩阵",
  "/semester/timetable": "课表调整与诊断",
  "/scheduling/preparation": "准备检查",
  "/scheduling/assignments": "课程与任课矩阵",
  "/scheduling/constraints": "规则与约束",
  "/scheduling/generate": "方案生成",
  "/scheduling/timetable": "课表调整与诊断",
  "/daily/adjustments": "临时调课",
  "/daily/leaves": "请假与代课",
  "/users": "用户管理",
  "/settings": "系统设置",
}

export function pageTitleForPath(pathname: string) {
  const normalizedPath = pathname.replace(/\/+$/, "") || "/"
  if (/^\/years\/[^/]+$/.test(normalizedPath)) return "学年详情"
  if (/^\/semesters\/[^/]+\/setup$/.test(normalizedPath)) return "学期配置"
  if (/^\/semesters\/[^/]+\/assignments$/.test(normalizedPath)) {
    return "课程与任课矩阵"
  }
  if (/^\/semesters\/[^/]+\/timetable$/.test(normalizedPath)) {
    return "课表调整与诊断"
  }
  return pageTitles[normalizedPath] ?? "工作台"
}
