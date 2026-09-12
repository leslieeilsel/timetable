import { expect, test } from "@playwright/test"
import { mockAdmin, mockTeacher } from "./fixtures/prelaunch"

test.use({ timezoneId: "Asia/Shanghai" })

test("R11 候选预览在全新页面加载班级、教师和教室课程", async ({ page }) => {
  const { requests } = await mockAdmin(page)
  await page.goto("/semesters/1/generate?run=1")
  await page.getByRole("button", { name: "查看课表", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByText("数学", { exact: true }).first()).toBeVisible()
  await expect(dialog.getByText("没有可查看的资源")).toHaveCount(0)
  for (const [label, filter] of [
    ["教师", "teacher_id"],
    ["教室", "room_id"],
  ]) {
    await dialog.getByRole("tab", { name: label, exact: true }).click()
    await expect(dialog.getByText("数学", { exact: true }).first()).toBeVisible()
    expect(
      requests.some(
        (url) => url.pathname.endsWith("/candidates/1") && url.searchParams.get(filter) === "1",
      ),
    ).toBe(true)
  }
  expect(requests.some((url) => url.pathname.endsWith("/class-settings"))).toBe(true)
  expect(requests.some((url) => url.pathname.endsWith("/teaching-assignments"))).toBe(true)
})

test("R10 指定教师的连续课时表单遵守接口字段约定", async ({ page }) => {
  const { submittedRules } = await mockAdmin(page)
  await page.goto("/semesters/1/constraints")
  await page.getByRole("button", { name: "新增规则", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "新增规则", exact: true })
  await dialog.getByRole("combobox").filter({ hasText: "尽量满足" }).click()
  await page.getByRole("option", { name: "必须满足（硬约束）", exact: true }).click()
  await dialog.getByRole("combobox").filter({ hasText: "不可安排指定课节" }).click()
  await page.getByRole("option", { name: "连续授课上限", exact: true }).click()
  await dialog.getByRole("button", { name: /搜索具体教师/ }).click()
  await page.getByRole("option").filter({ hasText: "复核教师" }).click()
  await page.getByRole("button", { name: "确认选择", exact: true }).click()
  await dialog.getByRole("spinbutton").fill("2")
  await dialog.getByLabel("规则名称").fill("教师连续课时上限")
  await dialog.getByRole("button", { name: "创建草稿", exact: true }).click()
  await expect(dialog).toBeHidden()
  expect(submittedRules).toHaveLength(1)
  expect(submittedRules[0]).toMatchObject({
    kind: "hard",
    category: "consecutive_items",
    target_type: "teacher",
    target_id: 1,
    requirement: { max_consecutive_items: 2 },
  })
  expect(submittedRules[0].requirement).not.toHaveProperty("resource_type")
  expect(submittedRules[0].requirement).not.toHaveProperty("resource_types")
})

for (const trigger of ["visibility", "interval"] as const) {
  test(`R9 教师课表在${trigger === "visibility" ? "恢复可见" : "前台停留一分钟"}后刷新停课安排`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.clock.install({ time: new Date("2026-09-07T08:10:00+08:00") })
    const state = await mockTeacher(page)
    const port = process.env.E2E_TEACHER_PORT ?? "5175"
    await page.goto(`http://localhost:${port}`)
    await expect(page.getByText("数学", { exact: true }).first()).toBeVisible()
    await page.getByRole("tab", { name: "周", exact: true }).click()
    await page.getByRole("tab", { name: "日", exact: true }).click()
    const before = state.requests
    state.cancelled = true
    if (trigger === "visibility") {
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")))
    } else {
      await page.clock.runFor(61_000)
    }
    await expect(page.getByText("已取消", { exact: true })).toBeVisible()
    expect(state.requests).toBeGreaterThan(before)
    await expect(page.getByText("正在上课", { exact: true })).toHaveCount(0)
    await page.getByRole("tab", { name: "周", exact: true }).click()
    await expect(page.getByText("已取消", { exact: true }).first()).toBeVisible()
  })
}
