import { lazy, Suspense, useState } from "react"
import { Link, Outlet, useLocation } from "react-router"
import { ChevronDownIcon, MoonIcon, SunIcon } from "lucide-react"
import { useTheme } from "next-themes"
import { AppSidebar } from "@/components/app-sidebar"
import { useAuth } from "@/lib/auth"
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
import { Button } from "@/components/ui/button"

const WorkspaceUserMenu = lazy(() =>
  import("@/components/workspace-user-menu").then((module) => ({
    default: module.WorkspaceUserMenu,
  })),
)

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
}

export function WorkspaceShell() {
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
  return (
    <SidebarProvider>
      <a
        href="#main-content"
        className="sr-only fixed top-2 left-2 z-[100] rounded-lg bg-background px-3 py-2 text-sm font-medium shadow-lg ring-2 ring-ring focus:not-sr-only"
      >
        跳到主要内容
      </a>
      <AppSidebar />
      <SidebarInset id="main-content" tabIndex={-1}>
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-border/50 bg-background/95 px-4 supports-[backdrop-filter]:bg-background/70 supports-[backdrop-filter]:backdrop-blur-2xl supports-[backdrop-filter]:backdrop-saturate-150 lg:px-5">
          <SidebarTrigger className="-ml-1 rounded-full border bg-background xl:hidden" />
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
                    <BreadcrumbLink render={<Link to={schedulingRoot} />}>排课中心</BreadcrumbLink>
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
            <DeferredWorkspaceUserMenu userName={user?.name} />
          </div>
        </header>
        <div className="min-w-0 flex-1 bg-background">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

function DeferredWorkspaceUserMenu({ userName }: { userName?: string }) {
  const [requested, setRequested] = useState(false)

  if (!requested) {
    return <UserMenuTrigger userName={userName} onClick={() => setRequested(true)} />
  }

  return (
    <Suspense fallback={<UserMenuTrigger userName={userName} disabled />}>
      <WorkspaceUserMenu />
    </Suspense>
  )
}

function UserMenuTrigger({
  userName,
  disabled = false,
  onClick,
}: {
  userName?: string
  disabled?: boolean
  onClick?: () => void
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      className="ml-1 gap-2 px-2.5"
      aria-label={userName}
      aria-haspopup="menu"
      disabled={disabled}
      onClick={onClick}
    >
      <span className="hidden sm:inline">{userName}</span>
      <ChevronDownIcon className="size-3.5 text-muted-foreground" />
    </Button>
  )
}
