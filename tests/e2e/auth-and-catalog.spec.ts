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

async function ensureResourcesOpen(page: Page) {
  const teacherLink = page.getByRole("link", { name: "教师", exact: true })
  if (await teacherLink.isVisible()) return

  const resourcesButton = page.getByRole("button", { name: "基础资料", exact: true })
  await expect(resourcesButton).toBeVisible()
  if ((await resourcesButton.getAttribute("aria-expanded")) !== "true") {
    await resourcesButton.click()
  }
  await expect(teacherLink).toBeVisible()
}

test("管理员首次改密、会话恢复、维护资料并安全退出", async ({ page }) => {
  await page.goto("/login")
  await page.getByLabel("邮箱").fill("e2e-admin@example.test")
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
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible()
  await page.reload()
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible()

  await ensureResourcesOpen(page)
  await page.getByRole("link", { name: "教师", exact: true }).click()
  await expect(page).toHaveURL(/resources\/teachers/)
  const teacherName = `端到端教师-${Date.now()}`
  await page.getByRole("button", { name: "新增教师" }).click()
  await page.getByLabel("名称").fill(teacherName)
  await page.getByRole("button", { name: "保存", exact: true }).click()
  await expect(page.getByRole("cell").filter({ hasText: teacherName })).toBeVisible()
  await page.getByRole("link", { name: "课程", exact: true }).click()
  await expect(page).toHaveURL(/resources\/courses/)
  await expect(page.getByRole("heading", { name: "课程" })).toBeVisible()

  const sidebarHeader = page.locator('[data-sidebar="header"]').first()
  const sidebarLogo = sidebarHeader.locator("img")
  const sidebarAvatar = page.locator('[data-sidebar="footer"] [data-slot="avatar"]').first()
  const desktopSidebar = page.locator('[data-slot="sidebar"][data-state]')
  const sidebarGap = page.locator('[data-slot="sidebar-gap"]')
  const sidebarContainer = page.locator('[data-slot="sidebar-container"]')
  await expect(sidebarHeader).toHaveCount(1)
  await expect(sidebarLogo).toHaveCount(1)
  await expect(sidebarHeader).toContainText("教务排课中心")
  await expect(sidebarHeader).toContainText("学校教务工作台")
  await expect(sidebarGap).toHaveCount(0)
  await expect(sidebarContainer).toHaveCount(0)
  await expect(desktopSidebar).toHaveCSS("position", "relative")
  await expect(desktopSidebar).toHaveCSS("transition-duration", "0.2s")
  await expect(desktopSidebar).toHaveCSS("transform", "none")
  await expect(desktopSidebar).toHaveCSS("will-change", "auto")
  await expect(desktopSidebar.locator(".t-acc-panel-inner")).toHaveCount(0)
  expect(
    await desktopSidebar.locator("*").evaluateAll((elements) =>
      elements
        .filter((element) => {
          const style = getComputedStyle(element)
          return style.filter !== "none" || style.backdropFilter !== "none"
        })
        .map((element) => element.outerHTML.slice(0, 160)),
    ),
  ).toEqual([])
  await expect(page.locator("#main-content > header")).toHaveCSS("backdrop-filter", "none")
  const expandedLogoBox = await sidebarLogo.boundingBox()
  const expandedAvatarBox = await sidebarAvatar.boundingBox()
  expect(expandedLogoBox).not.toBeNull()
  expect(expandedAvatarBox).not.toBeNull()

  const collapseSidebarButton = page.getByRole("button", { name: "收起侧边栏" })
  await collapseSidebarButton.hover()
  await expect(
    page.locator('[data-slot="tooltip-content"]').filter({ hasText: "收起侧边栏" }),
  ).toHaveCount(0)
  await collapseSidebarButton.click()
  const mainNavigation = page.getByRole("navigation", { name: "主导航" })
  const schedulingMenuTrigger = mainNavigation.getByRole("button", {
    name: "打开排课中心菜单",
  })
  await expect(schedulingMenuTrigger).toBeVisible()
  await expect(mainNavigation.getByRole("button", { name: "打开日常运行菜单" })).toBeVisible()
  await expect
    .poll(async () => (await desktopSidebar.boundingBox())?.width)
    .toBe(48)

  const collapsedAvatarBox = await sidebarAvatar.boundingBox()
  const collapsedLogoBox = await sidebarLogo.boundingBox()
  expect(collapsedAvatarBox).not.toBeNull()
  expect(collapsedLogoBox).not.toBeNull()
  expect(Math.abs(collapsedLogoBox!.x - expandedLogoBox!.x)).toBeLessThan(0.5)
  expect(Math.abs(collapsedLogoBox!.y - expandedLogoBox!.y)).toBeLessThan(0.5)
  expect(Math.abs(collapsedAvatarBox!.x - expandedAvatarBox!.x)).toBeLessThan(0.5)
  expect(Math.abs(collapsedAvatarBox!.y - expandedAvatarBox!.y)).toBeLessThan(0.5)

  const dashboardLink = mainNavigation.getByRole("link", { name: "工作台", exact: true })
  await dashboardLink.hover()
  await expect(
    page.locator('[data-slot="tooltip-content"]').filter({ hasText: "工作台" }),
  ).toBeVisible()
  expect(await dashboardLink.evaluate((element) => getComputedStyle(element).cursor)).toBe(
    "pointer",
  )

  const accountMenuTrigger = page.getByRole("button", {
    name: "打开端到端管理员的账户菜单",
  })
  await accountMenuTrigger.hover()
  await expect(page.locator('[data-slot="tooltip-content"]:visible')).toHaveCount(0)
  expect(
    await accountMenuTrigger.evaluate((element) => getComputedStyle(element).backgroundColor),
  ).toBe("rgba(0, 0, 0, 0)")
  expect(
    await page
      .locator('[data-sidebar="footer"]')
      .evaluate((element) => getComputedStyle(element).borderTopWidth),
  ).toBe("0px")

  const resourcesMenuTrigger = mainNavigation.getByRole("button", {
    name: "打开基础资料菜单",
  })
  await resourcesMenuTrigger.hover()
  const sidebarModuleMenu = page.locator('[data-sidebar-module-menu="true"]')
  await expect(page.getByRole("menuitem", { name: "教师", exact: true })).toBeVisible()
  expect(
    await sidebarModuleMenu.evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        backdropFilter: style.backdropFilter,
        filter: style.filter,
        transform: style.transform,
        transitionDuration: style.transitionDuration,
        willChange: style.willChange,
      }
    }),
  ).toEqual({
    backdropFilter: "none",
    filter: "none",
    transform: "none",
    transitionDuration: "0s",
    willChange: "auto",
  })
  expect(await resourcesMenuTrigger.evaluate((element) => getComputedStyle(element).cursor)).toBe(
    "pointer",
  )
  await page.keyboard.press("Escape")
  await expect(page.getByRole("menuitem", { name: "教师", exact: true })).toBeHidden()
  await page.mouse.move(800, 400)

  await page.setViewportSize({ width: 1400, height: 720 })
  await resourcesMenuTrigger.hover()
  await expect(page.getByRole("menuitem", { name: "教师", exact: true })).toBeVisible()
  await page.getByRole("menuitem", { name: "教师", exact: true }).hover()
  await expect(page.getByRole("menuitem", { name: "课程", exact: true })).toBeVisible()
  await page.keyboard.press("Escape")

  await desktopSidebar.evaluate((element) => element.setAttribute("data-e2e-persist", "true"))
  await page.setViewportSize({ width: 1279, height: 720 })
  await expect(desktopSidebar).toHaveAttribute("data-e2e-persist", "true")
  await expect(desktopSidebar).toBeVisible()
  await page.setViewportSize({ width: 1280, height: 720 })
  await expect(desktopSidebar).toHaveAttribute("data-e2e-persist", "true")
  await expect(desktopSidebar).toBeVisible()

  await page.setViewportSize({ width: 1290, height: 720 })
  await expect(desktopSidebar).toHaveAttribute("data-e2e-persist", "true")
  const expandSidebarButton = page.getByRole("button", { name: "展开侧边栏" })
  await expandSidebarButton.hover()
  await expect(
    page.locator('[data-slot="tooltip-content"]').filter({ hasText: "展开侧边栏" }),
  ).toHaveCount(0)
  await expandSidebarButton.click()

  await page.setViewportSize({ width: 767, height: 720 })
  await expect(desktopSidebar).toHaveCount(0)
  await expect(page.getByRole("button", { name: "切换侧边栏" }).last()).toBeVisible()
  await page.setViewportSize({ width: 768, height: 720 })
  await expect(desktopSidebar).toBeVisible()

  await page
    .locator('[data-sidebar="footer"]')
    .getByRole("button", { name: "打开端到端管理员的账户菜单" })
    .click()
  await page.getByRole("menuitem", { name: "退出登录" }).click()
  await expect(page).toHaveURL(/login/)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByLabel("邮箱").fill("e2e-admin@example.test")
  expect((await submitLogin(page, permanentPassword)).ok()).toBe(true)
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  const mobileAccountMenu = page.getByRole("button", {
    name: "打开端到端管理员的账户菜单",
  })
  await expect(mobileAccountMenu).toBeVisible()
  await mobileAccountMenu.click()
  await expect(page.getByRole("menuitem", { name: "修改密码" })).toBeVisible()
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "切换侧边栏" }).last().click()
  await ensureResourcesOpen(page)
  await page.getByRole("link", { name: "系统设置", exact: true }).click()
  await expect(page).toHaveURL(/settings/)
  await expect(page.getByRole("dialog")).toBeHidden()
})
