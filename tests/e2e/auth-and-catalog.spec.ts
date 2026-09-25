import { expect, test, type Page } from "@playwright/test"

const temporaryPassword = process.env.E2E_ADMIN_PASSWORD ?? "E2eTemporary1234"
const permanentPassword = "E2ePermanent5678"

async function submitLogin(page: Page, password: string) {
  await page.locator('input[name="password"]').fill(password)
  const response = page.waitForResponse(
    (candidate) =>
      candidate.url().endsWith("/api/v1/auth/login") && candidate.request().method() === "POST",
  )
  await page.getByRole("button", { name: "登录" }).click()
  return response
}

test("管理员首次改密、会话恢复、维护资料并安全退出", async ({ page }) => {
  await page.goto("/login")
  await page.getByLabel("账号").fill("e2e-admin@example.test")
  let loginResponse = await submitLogin(page, temporaryPassword)
  if (loginResponse.status() === 422) {
    loginResponse = await submitLogin(page, permanentPassword)
  }
  expect(loginResponse.ok()).toBe(true)

  await expect(page).toHaveURL(/change-password|\/$/)
  if (new URL(page.url()).pathname === "/change-password") {
    await page.locator('input[name="current_password"]').fill(temporaryPassword)
    await page.locator('input[name="password"]').fill(permanentPassword)
    await page.locator('input[name="password_confirmation"]').fill(permanentPassword)
    await page.getByRole("button", { name: "保存密码" }).click()
  }

  await expect(page).toHaveURL(/\/$/)
  await page.goto("/resources/teachers")
  const teacherName = `端到端教师-${Date.now()}`
  await page.getByRole("button", { name: "新增教师" }).click()
  await page.getByLabel("名称").fill(teacherName)
  await page.getByRole("button", { name: "保存", exact: true }).click()
  await expect(page.getByRole("cell").filter({ hasText: teacherName })).toBeVisible()
  await page.reload()
  await expect(page.getByRole("cell").filter({ hasText: teacherName })).toBeVisible()

  await page.getByRole("button", { name: "打开端到端管理员的账户菜单" }).click()
  await page.getByRole("menuitem", { name: "退出登录" }).click()
  await expect(page).toHaveURL(/login/)

  await page.getByLabel("账号").fill("e2e-admin@example.test")
  expect((await submitLogin(page, permanentPassword)).ok()).toBe(true)
  await expect(page).toHaveURL(/\/$/)
})
