import { Link, Outlet, useLocation, useNavigate } from "react-router"
import { CalendarDaysIcon, ChevronDownIcon, LogOutIcon, UserRoundIcon } from "lucide-react"
import { AppSidebar } from "@/components/app-sidebar"
import { useAuth } from "@/lib/auth"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const labels: Record<string, string> = {
  resources: "基础资料",
  grades: "年级",
  teachers: "教师",
  courses: "课程",
  rooms: "教室",
  years: "学年与班级",
  semester: "当前学期",
  setup: "学期配置",
  tasks: "教学任务",
  timetable: "排课工作台",
  users: "用户管理",
  settings: "系统设置",
}

export function WorkspaceShell() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const parts = pathname.split("/").filter(Boolean)
  const part = parts.at(-1)
  const isResourcePage = pathname.startsWith("/resources/")
  const isSemesterPage = pathname.startsWith("/semester/") || pathname.startsWith("/semesters/")
  const isYearDetail = parts[0] === "years" && parts.length > 1
  const today = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  })
    .format(new Date())
    .replaceAll("/", "-")
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur lg:px-6">
          <SidebarTrigger className="-ml-1 rounded-full border bg-background" />
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
                    <BreadcrumbLink render={<Link to="/semester/setup" />}>当前学期</BreadcrumbLink>
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
            <div className="hidden items-center gap-2 text-sm text-foreground/80 lg:flex">
              <CalendarDaysIcon className="size-4" />
              <span>{today}</span>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="ghost" className="ml-1 gap-2 px-2.5" aria-label={user?.name} />
                }
              >
                <UserRoundIcon />
                <span className="hidden sm:inline">{user?.name}</span>
                <ChevronDownIcon className="size-3.5 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>
                    <span className="block">{user?.name}</span>
                    <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                      {user?.email}
                    </span>
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={() => navigate("/change-password")}>
                    修改密码
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void logout()}>
                    <LogOutIcon />
                    退出登录
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="min-w-0 flex-1 bg-background">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
