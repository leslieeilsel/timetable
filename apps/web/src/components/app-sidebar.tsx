import { useEffect, useState } from "react"
import { Link, useLocation } from "react-router"
import {
  BookOpenCheckIcon,
  BookOpenTextIcon,
  CalendarCogIcon,
  CalendarDaysIcon,
  ChevronRightIcon,
  ClipboardListIcon,
  DatabaseIcon,
  GalleryVerticalEndIcon,
  GraduationCapIcon,
  LayoutDashboardIcon,
  MapPinIcon,
  SettingsIcon,
  UserRoundIcon,
  UsersIcon,
} from "lucide-react"
import { useAuth } from "@/lib/auth"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"

const primary = [
  { title: "工作台", to: "/", icon: LayoutDashboardIcon },
  { title: "学年与班级", to: "/years", icon: CalendarDaysIcon },
]
const resourceItems = [
  { title: "年级", to: "/resources/grades", icon: GraduationCapIcon },
  { title: "教师", to: "/resources/teachers", icon: UserRoundIcon },
  { title: "课程", to: "/resources/courses", icon: BookOpenTextIcon },
  { title: "教室", to: "/resources/rooms", icon: MapPinIcon },
]
const semester = [
  { title: "学期配置", to: "/semester/setup", icon: CalendarCogIcon },
  { title: "教学任务", to: "/semester/tasks", icon: ClipboardListIcon },
  { title: "排课工作台", to: "/semester/timetable", icon: BookOpenCheckIcon },
]

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { pathname } = useLocation()
  const { user } = useAuth()
  const sidebar = useSidebar()
  const resourcesActive = pathname.startsWith("/resources")
  const [resourcesOpen, setResourcesOpen] = useState(resourcesActive)
  useEffect(() => {
    if (resourcesActive) setResourcesOpen(true)
  }, [resourcesActive])
  const group = (label: string, items: typeof primary, tail?: React.ReactNode) => (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => (
          <SidebarMenuItem key={item.to}>
            <SidebarMenuButton
              tooltip={item.title}
              isActive={item.to === "/" ? pathname === "/" : pathname.startsWith(item.to)}
              render={<Link to={item.to} />}
            >
              <item.icon />
              <span>{item.title}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
        {tail}
      </SidebarMenu>
    </SidebarGroup>
  )
  const resourcesMenu = (
    <Collapsible
      open={resourcesOpen}
      onOpenChange={(open) => {
        setResourcesOpen(open)
        if (open && sidebar.state === "collapsed") sidebar.setOpen(true)
      }}
      className="group/collapsible"
      render={<SidebarMenuItem />}
    >
      <CollapsibleTrigger
        render={<SidebarMenuButton tooltip="基础资料" isActive={resourcesActive} />}
      >
        <DatabaseIcon />
        <span>基础资料</span>
        <ChevronRightIcon className="ml-auto transition-transform group-data-open/collapsible:rotate-90 group-data-[collapsible=icon]:hidden" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <SidebarMenuSub>
          {resourceItems.map((item) => (
            <SidebarMenuSubItem key={item.to}>
              <SidebarMenuSubButton
                isActive={pathname === item.to}
                render={
                  <Link
                    to={item.to}
                    onClick={() => {
                      if (sidebar.isMobile) sidebar.setOpenMobile(false)
                    }}
                  />
                }
              >
                <item.icon />
                <span>{item.title}</span>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          ))}
        </SidebarMenuSub>
      </CollapsibleContent>
    </Collapsible>
  )
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="px-3 pt-3 pb-2 group-data-[collapsible=icon]:px-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              aria-label="教务排课中心"
              className="hover:bg-transparent group-data-[collapsible=icon]:[&>div:last-child]:hidden"
              render={<Link to="/" />}
            >
              <div className="flex aspect-square size-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background shadow-sm group-data-[collapsible=icon]:size-8">
                <GalleryVerticalEndIcon className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">教务排课中心</span>
                <span className="truncate text-xs text-muted-foreground">学校工作台</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {group(
          "日常工作",
          user?.role === "viewer" ? primary.slice(0, 1) : primary,
          user?.role === "viewer" ? undefined : resourcesMenu,
        )}
        {group("当前学期", user?.role === "viewer" ? semester.slice(2) : semester)}
        {user?.role === "admin" &&
          group("系统", [
            { title: "用户管理", to: "/users", icon: UsersIcon },
            { title: "系统设置", to: "/settings", icon: SettingsIcon },
          ])}
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}
