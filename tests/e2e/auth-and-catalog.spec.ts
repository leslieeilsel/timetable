import { expect, test } from "@playwright/test"

const temporaryPassword = process.env.E2E_ADMIN_PASSWORD ?? "E2eTemporary1234"
const permanentPassword = "E2ePermanent5678"

test("管理员首次改密、会话恢复、维护资料并安全退出", async ({ page }) => {
  await page.goto("/login")
  await page.getByLabel("邮箱").fill("e2e-admin@example.test")
  await page.getByLabel("密码").fill(temporaryPassword)
  await page.getByRole("button", { name: "登录" }).click()

  await expect(page).toHaveURL(/change-password/)
  await page.getByLabel("当前密码").fill(temporaryPassword)
  await page.getByLabel("新密码", { exact: true }).fill(permanentPassword)
  await page.getByLabel("确认新密码").fill(permanentPassword)
  await page.getByRole("button", { name: "保存密码" }).click()

  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible()
  await page.reload()
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible()

  await page.getByRole("button", { name: "基础资料", exact: true }).click()
  await page.getByRole("link", { name: "年级", exact: true }).click()
  await expect(page).toHaveURL(/resources\/grades/)
  await page.getByRole("button", { name: "新增年级" }).click()
  await page.getByLabel("名称").fill("一年级")
  await page.getByLabel("排序").fill("1")
  await page.getByRole("button", { name: "保存", exact: true }).click()
  await expect(page.getByRole("cell", { name: "一年级", exact: true })).toBeVisible()
  await page.getByRole("link", { name: "教师", exact: true }).click()
  await expect(page).toHaveURL(/resources\/teachers/)
  await expect(page.getByRole("heading", { name: "教师" })).toBeVisible()

  await page.getByText("端到端管理员", { exact: true }).last().click()
  await page.getByRole("menuitem", { name: "退出登录" }).click()
  await expect(page).toHaveURL(/login/)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByLabel("邮箱").fill("e2e-admin@example.test")
  await page.getByLabel("密码").fill(permanentPassword)
  await page.getByRole("button", { name: "登录" }).click()
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.getByRole("button", { name: "Toggle Sidebar" }).last().click()
  await expect(page.getByRole("button", { name: "基础资料", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "基础资料", exact: true }).click()
  await expect(page.getByRole("link", { name: "年级", exact: true })).toBeVisible()
})
