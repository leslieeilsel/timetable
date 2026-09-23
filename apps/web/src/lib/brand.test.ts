import { describe, expect, it } from "vitest"
import { pageTitleForPath } from "@/lib/brand"

describe("pageTitleForPath", () => {
  it("returns exact titles for top-level pages", () => {
    expect(pageTitleForPath("/")).toBe("工作台")
    expect(pageTitleForPath("/login")).toBe("登录")
    expect(pageTitleForPath("/resources/teachers")).toBe("教师")
    expect(pageTitleForPath("/scheduling/generate")).toBe("自动排课")
  })

  it("recognizes pages with dynamic identifiers", () => {
    expect(pageTitleForPath("/years/42")).toBe("学年详情")
    expect(pageTitleForPath("/semesters/8/setup")).toBe("学期配置")
    expect(pageTitleForPath("/semesters/8/preparation")).toBe("教学安排")
    expect(pageTitleForPath("/semesters/8/assignments")).toBe("任课关系")
    expect(pageTitleForPath("/semesters/8/constraints")).toBe("排课规则")
    expect(pageTitleForPath("/semesters/8/generate")).toBe("自动排课")
    expect(pageTitleForPath("/semesters/8/timetable")).toBe("查看课表")
    expect(pageTitleForPath("/semesters/8/adjustments")).toBe("调课与代课")
    expect(pageTitleForPath("/semesters/8/leaves")).toBe("请假与代课")
  })

  it("normalizes trailing slashes and falls back safely", () => {
    expect(pageTitleForPath("/resources/courses/")).toBe("课程")
    expect(pageTitleForPath("/unknown-page")).toBe("工作台")
  })
})
