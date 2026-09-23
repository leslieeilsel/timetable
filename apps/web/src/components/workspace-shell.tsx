import { useEffect, type ReactNode } from "react"
import { Link, Outlet, useLocation } from "react-router"
import { ChevronDownIcon, MoonIcon, SunIcon, type LucideIcon } from "lucide-react"
import { useTheme } from "next-themes"
import { AppSidebar } from "@/components/app-sidebar"
import { resourceNavigationItems, schedulingNavigationItems } from "@/components/app-navigation"
import { WorkspaceUserMenu } from "@/components/workspace-user-menu"
import { useSchoolToday } from "@/lib/semester-phase"
import { useAuth } from "@/lib/auth"
import { cn } from "@/lib/utils"
import {
  isDailySemesterPath,
  isSchedulingSemesterPath,
  semesterDestinationForPath,
  semesterPathOrCurrent,
  useResolvedSemesterId,
} from "@/lib/semester"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { TooltipProvider } from "@/components/ui/tooltip"

const labels: Record<string, string> = {
  resources: "基础资料",
  grades: "年级",
  teachers: "教师",
  courses: "课程",
  rooms: "教室",
  years: "学年学期",
  semester: "当前学期",
  scheduling: "学期排课",
  preparation: "教学安排",
  assignments: "任课关系",
  constraints: "排课规则",
  generate: "自动排课",
  setup: "学期配置",
  timetable: "查看课表",
  planning: "检查并发布",
  daily: "调课与代课",
  adjustments: "调课与代课",
  "long-term": "持续调课",
  leaves: "请假与代课",
  users: "用户管理",
  settings: "系统设置",
  "change-password": "修改密码",
  ai: "AI 助手",
  dashboard: "学期工作台",
}

export function WorkspaceShell({ children }: { children?: ReactNode }) {
  const { pathname } = useLocation()
  const { user } = useAuth()
  const { resolvedTheme, setTheme } = useTheme()
  const isDark = resolvedTheme === "dark"
  const { semesterId, context } = useResolvedSemesterId()
  const parts = pathname.split("/").filter(Boolean)
  const part = parts.at(-1)
  const isAiPage = parts[0] === "ai"
  const isResourcePage = pathname.startsWith("/resources/")
  const isSemesterSetup = semesterDestinationForPath(pathname) === "setup"
  const isSemesterPage = isSchedulingSemesterPath(pathname)
  const isDailyPage = isDailySemesterPath(pathname)
  const schedulingMenuItems = schedulingNavigationItems.map((item) => ({
    ...item,
    to: semesterPathOrCurrent(semesterId, item.destination),
  }))
  const isYearDetail = parts[0] === "years" && parts.length > 1
  const today = useSchoolToday(context.data?.timezone)
  const weekday = new Intl.DateTimeFormat("zh-CN", { weekday: "short", timeZone: "UTC" }).format(
    new Date(`${today}T00:00:00Z`),
  )

  useEffect(() => {
    document.getElementById("main-content")?.scrollTo({ top: 0, left: 0 })
  }, [pathname])

  return (
    <TooltipProvider delay={0}>
      <SidebarProvider>
        <a
          href="#main-content"
          onClick={() => {
            requestAnimationFrame(() => document.getElementById("main-content")?.focus())
          }}
          className="fixed top-3 left-3 z-[100] -translate-y-20 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg transition-transform focus:translate-y-0 focus:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
        >
          跳到主要内容
        </a>
        <AppSidebar />
        <SidebarInset id="main-content" tabIndex={-1}>
          {!isAiPage && (
            <header className="sticky top-0 z-20 flex min-h-14 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/50 bg-background px-4 py-2 lg:px-5">
              <SidebarTrigger className="-ml-1 rounded-full border bg-background md:hidden" />
              <Breadcrumb className="min-w-0 flex-1 overflow-hidden">
                <BreadcrumbList className="flex-nowrap overflow-hidden">
                  {isResourcePage && (
                    <>
                      <BreadcrumbItem>
                        <BreadcrumbMenu
                          label="基础资料"
                          items={resourceNavigationItems}
                          pathname={pathname}
                        />
                      </BreadcrumbItem>
                      <BreadcrumbSeparator />
                    </>
                  )}
                  {isSemesterPage && (
                    <>
                      <BreadcrumbItem>
                        <BreadcrumbMenu
                          label="学期排课"
                          items={schedulingMenuItems}
                          pathname={pathname}
                        />
                      </BreadcrumbItem>
                      <BreadcrumbSeparator />
                    </>
                  )}
                  {isDailyPage && part !== "adjustments" && (
                    <>
                      <BreadcrumbItem>
                        <BreadcrumbLink
                          render={<Link to={semesterPathOrCurrent(semesterId, "adjustments")} />}
                        >
                          调课与代课
                        </BreadcrumbLink>
                      </BreadcrumbItem>
                      <BreadcrumbSeparator />
                    </>
                  )}
                  {isYearDetail && (
                    <>
                      <BreadcrumbItem>
                        <BreadcrumbLink render={<Link to="/years" />}>学年学期</BreadcrumbLink>
                      </BreadcrumbItem>
                      <BreadcrumbSeparator />
                    </>
                  )}
                  <BreadcrumbItem className="min-w-0">
                    <BreadcrumbPage className="block truncate">
                      {isSemesterSetup
                        ? "学期配置"
                        : isYearDetail
                          ? "学年详情"
                          : part
                            ? (labels[part] ?? "工作台")
                            : "工作台"}
                    </BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
              <div className="ml-auto flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground"
                  aria-label={isDark ? "切换到浅色模式" : "切换到深色模式"}
                  aria-pressed={isDark}
                  title={isDark ? "切换到浅色模式" : "切换到深色模式"}
                  onClick={() => setTheme(isDark ? "light" : "dark")}
                >
                  {isDark ? <SunIcon /> : <MoonIcon />}
                </Button>
                <div className="hidden items-center gap-2 text-sm whitespace-nowrap text-muted-foreground 2xl:flex">
                  <time dateTime={today}>
                    {today} {weekday}
                  </time>
                </div>
                <WorkspaceUserMenu
                  trigger={<UserMenuTrigger userName={user?.name} className="md:hidden" />}
                />
              </div>
            </header>
          )}
          <div
            key={semesterId}
            className={cn("min-w-0 flex-1 bg-background", isAiPage && "min-h-0 overflow-hidden")}
          >
            {children ?? <Outlet />}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}

function BreadcrumbMenu({
  label,
  items,
  pathname,
}: {
  label: string
  items: Array<{ title: string; to: string; icon: LucideIcon }>
  pathname: string
}) {
  if (items.length <= 1) {
    return <BreadcrumbLink render={<Link to={items[0]?.to ?? "/"} />}>{label}</BreadcrumbLink>
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="inline-flex shrink-0 cursor-pointer items-center whitespace-nowrap text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:rounded-md focus-visible:ring-3 focus-visible:ring-ring/30 data-popup-open:text-foreground max-md:min-h-12"
            aria-label={`切换${label}页面`}
          />
        }
      >
        {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="w-56 rounded-2xl p-1 shadow-xl ring-foreground/10"
      >
        {items.map((item) => {
          const active = pathname === item.to
          return (
            <DropdownMenuItem
              key={item.to}
              className={cn(
                "h-8 cursor-pointer px-2.5",
                active &&
                  "bg-accent font-medium text-accent-foreground [&_svg]:text-accent-foreground",
              )}
              render={<Link to={item.to} aria-current={active ? "page" : undefined} />}
            >
              <item.icon className="text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{item.title}</span>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function UserMenuTrigger({
  userName,
  className,
  ...props
}: { userName?: string } & React.ComponentProps<typeof Button>) {
  return (
    <Button
      {...props}
      type="button"
      variant="ghost"
      className={cn(
        "group/user-menu ml-1 h-9 gap-2 rounded-full px-1.5 pr-2 data-popup-open:bg-muted disabled:cursor-wait disabled:opacity-100 max-md:min-w-9",
        className,
      )}
      aria-label={`打开${userName ?? "当前用户"}的账户菜单`}
      aria-haspopup="menu"
    >
      <Avatar className="size-7">
        <AvatarFallback className="bg-foreground text-xs font-semibold text-background">
          {userInitial(userName)}
        </AvatarFallback>
      </Avatar>
      <span className="hidden max-w-36 truncate text-sm font-medium md:inline">{userName}</span>
      <ChevronDownIcon className="hidden size-3.5 text-muted-foreground transition-transform group-data-popup-open/user-menu:rotate-180 md:block" />
    </Button>
  )
}

function userInitial(name?: string) {
  return Array.from(name?.trim() || "用")[0]
}
