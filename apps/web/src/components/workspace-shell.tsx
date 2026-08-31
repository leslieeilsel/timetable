import { useEffect, type ReactNode } from "react"
import { Link, Outlet, useLocation } from "react-router"
import { ChevronDownIcon, MoonIcon, SunIcon } from "lucide-react"
import { useTheme } from "next-themes"
import { AppSidebar } from "@/components/app-sidebar"
import { WorkspaceUserMenu } from "@/components/workspace-user-menu"
import { useAuth } from "@/lib/auth"
import { cn } from "@/lib/utils"
import {
  isDailySemesterPath,
  isSchedulingSemesterPath,
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
import { TooltipProvider } from "@/components/ui/tooltip"

const labels: Record<string, string> = {
  resources: "基础资料",
  grades: "年级",
  teachers: "教师",
  courses: "课程",
  rooms: "教室",
  years: "学年与班级",
  semester: "当前学期",
  scheduling: "排课中心",
  preparation: "准备检查",
  assignments: "课程与任课矩阵",
  constraints: "规则与约束",
  generate: "方案生成",
  setup: "学期配置",
  timetable: "课表调整与诊断",
  daily: "日常运行",
  adjustments: "临时调课",
  leaves: "请假与代课",
  users: "用户管理",
  settings: "系统设置",
  "change-password": "修改密码",
}

export function WorkspaceShell({ children }: { children?: ReactNode }) {
  const { pathname } = useLocation()
  const { user } = useAuth()
  const { resolvedTheme, setTheme } = useTheme()
  const isDark = resolvedTheme === "dark"
  const { semesterId } = useResolvedSemesterId()
  const parts = pathname.split("/").filter(Boolean)
  const part = parts.at(-1)
  const isResourcePage = pathname.startsWith("/resources/")
  const isSemesterPage = isSchedulingSemesterPath(pathname)
  const isDailyPage = isDailySemesterPath(pathname)
  const schedulingRoot = semesterPathOrCurrent(semesterId, "preparation")
  const dailyRoot = semesterPathOrCurrent(semesterId, "adjustments")
  const isYearDetail = parts[0] === "years" && parts.length > 1
  const now = new Date()
  const today = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(now)
    .replaceAll("/", "-")
  const weekday = new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(now)

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
          <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-border/50 bg-background px-4 lg:px-5">
            <SidebarTrigger className="-ml-1 rounded-full border bg-background md:hidden" />
            <Breadcrumb className="min-w-0 flex-1 overflow-hidden">
              <BreadcrumbList className="flex-nowrap overflow-hidden">
                {isResourcePage && (
                  <>
                    <BreadcrumbItem>
                      <BreadcrumbLink render={<Link to="/resources/grades" />}>
                        基础资料
                      </BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator />
                  </>
                )}
                {isSemesterPage && (
                  <>
                    <BreadcrumbItem>
                      <BreadcrumbLink render={<Link to={schedulingRoot} />}>
                        排课中心
                      </BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator />
                  </>
                )}
                {isDailyPage && (
                  <>
                    <BreadcrumbItem>
                      <BreadcrumbLink render={<Link to={dailyRoot} />}>日常运行</BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator />
                  </>
                )}
                {isYearDetail && (
                  <>
                    <BreadcrumbItem>
                      <BreadcrumbLink render={<Link to="/years" />}>学年与班级</BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator />
                  </>
                )}
                <BreadcrumbItem className="min-w-0">
                  <BreadcrumbPage className="block truncate">
                    {isYearDetail ? "学年详情" : part ? (labels[part] ?? "工作台") : "工作台"}
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
              <div className="hidden items-center gap-2 text-sm whitespace-nowrap text-muted-foreground lg:flex">
                <time dateTime={today}>
                  {today} {weekday}
                </time>
              </div>
              <WorkspaceUserMenu
                trigger={<UserMenuTrigger userName={user?.name} className="md:hidden" />}
              />
            </div>
          </header>
          <div className="min-w-0 flex-1 bg-background">{children ?? <Outlet />}</div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
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
