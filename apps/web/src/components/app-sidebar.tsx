import { useEffect, useState } from "react"
import { Link, useLocation } from "react-router"
import {
  BookOpenCheckIcon,
  BookOpenTextIcon,
  CalendarCheck2Icon,
  CalendarCogIcon,
  CalendarDaysIcon,
  ChevronRightIcon,
  ClipboardListIcon,
  DatabaseIcon,
  GalleryVerticalEndIcon,
  LayoutDashboardIcon,
  MapPinIcon,
  PanelLeftIcon,
  SettingsIcon,
  UserRoundIcon,
  UsersIcon,
} from "lucide-react"
import { useAuth } from "@/lib/auth"
import { SYSTEM_NAME, SYSTEM_TAGLINE } from "@/lib/brand"
import { LogoMark } from "@/components/brand"
import { Button } from "@/components/ui/button"
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

const primary = [{ title: "工作台", to: "/", icon: LayoutDashboardIcon }]
const resourceItems = [
  { title: "教师", to: "/resources/teachers", icon: UserRoundIcon },
  { title: "课程", to: "/resources/courses", icon: BookOpenTextIcon },
  { title: "教室", to: "/resources/rooms", icon: MapPinIcon },
  { title: "年级与班级", to: "/years", icon: CalendarDaysIcon },
]
const schedulingItems = [
  { title: "① 准备检查", to: "/scheduling/preparation", icon: BookOpenCheckIcon },
  { title: "② 课程与任课矩阵", to: "/scheduling/assignments", icon: ClipboardListIcon },
  { title: "③ 规则与约束", to: "/scheduling/constraints", icon: SettingsIcon },
  { title: "④ 方案生成", to: "/scheduling/generate", icon: GalleryVerticalEndIcon },
  { title: "⑤ 课表调整与诊断", to: "/scheduling/timetable", icon: BookOpenTextIcon },
]
const dailyItems = [
  { title: "临时调课", to: "/daily/adjustments", icon: CalendarDaysIcon },
  { title: "请假与代课", to: "/daily/leaves", icon: CalendarCheck2Icon },
]
const SIDEBAR_TOOLTIP_DELAY = 150

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { pathname } = useLocation()
  const { user } = useAuth()
  const sidebar = useSidebar()
  const resourcesActive = pathname.startsWith("/resources") || pathname.startsWith("/years")
  const schedulingActive = pathname.startsWith("/scheduling") || pathname.startsWith("/semester/")
  const dailyActive = pathname.startsWith("/daily/")
  const [resourcesOpen, setResourcesOpen] = useState(true)
  const [schedulingOpen, setSchedulingOpen] = useState(true)
  const [dailyOpen, setDailyOpen] = useState(true)
  useEffect(() => {
    if (resourcesActive) setResourcesOpen(true)
  }, [resourcesActive])
  useEffect(() => {
    if (schedulingActive) setSchedulingOpen(true)
  }, [schedulingActive])
  useEffect(() => {
    if (dailyActive) setDailyOpen(true)
  }, [dailyActive])
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
  const schedulingMenu = (
    <Collapsible
      open={schedulingOpen}
      onOpenChange={(open) => {
        setSchedulingOpen(open)
        if (open && sidebar.state === "collapsed") sidebar.setOpen(true)
      }}
      className="group/collapsible"
      render={<SidebarMenuItem />}
    >
      <CollapsibleTrigger
        render={<SidebarMenuButton tooltip="排课中心" isActive={schedulingActive} />}
      >
        <CalendarCogIcon />
        <span>排课中心</span>
        <ChevronRightIcon className="ml-auto transition-transform group-data-open/collapsible:rotate-90 group-data-[collapsible=icon]:hidden" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <SidebarMenuSub>
          {schedulingItems.map((item) => (
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
  const dailyMenu = (
    <Collapsible
      open={dailyOpen}
      onOpenChange={(open) => {
        setDailyOpen(open)
        if (open && sidebar.state === "collapsed") sidebar.setOpen(true)
      }}
      className="group/collapsible"
      render={<SidebarMenuItem />}
    >
      <CollapsibleTrigger render={<SidebarMenuButton tooltip="日常运行" isActive={dailyActive} />}>
        <CalendarCheck2Icon />
        <span>日常运行</span>
        <ChevronRightIcon className="ml-auto transition-transform group-data-open/collapsible:rotate-90 group-data-[collapsible=icon]:hidden" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <SidebarMenuSub>
          {dailyItems.map((item) => (
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
  const sidebarHeader =
    !sidebar.isMobile && sidebar.state === "collapsed" ? (
      <Tooltip>
        <TooltipTrigger
          delay={SIDEBAR_TOOLTIP_DELAY}
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="展开侧边栏"
              className="group/sidebar-logo relative size-8 rounded-xl p-0 hover:bg-sidebar-accent focus-visible:bg-sidebar-accent"
              onClick={() => sidebar.setOpen(true)}
            />
          }
        >
          <LogoMark className="size-8 transition-opacity duration-150 group-hover/sidebar-logo:opacity-0 group-focus-visible/sidebar-logo:opacity-0" />
          <PanelLeftIcon className="absolute size-4 opacity-0 transition-opacity duration-150 group-hover/sidebar-logo:opacity-100 group-focus-visible/sidebar-logo:opacity-100" />
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          展开侧边栏
        </TooltipContent>
      </Tooltip>
    ) : (
      <div className="flex h-8 min-w-0 items-center gap-2">
        <Link
          to="/"
          aria-label={SYSTEM_NAME}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-sidebar-ring/50"
          onClick={() => {
            if (sidebar.isMobile) sidebar.setOpenMobile(false)
          }}
        >
          <LogoMark className="size-8" />
          <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
            <span className="truncate font-semibold">{SYSTEM_NAME}</span>
            <span className="truncate text-xs text-muted-foreground">{SYSTEM_TAGLINE}</span>
          </div>
        </Link>
        <Tooltip>
          <TooltipTrigger
            delay={SIDEBAR_TOOLTIP_DELAY}
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={sidebar.isMobile ? "关闭侧边栏" : "收起侧边栏"}
                className="size-8 rounded-xl text-muted-foreground hover:text-foreground"
                onClick={() => {
                  if (sidebar.isMobile) {
                    sidebar.setOpenMobile(false)
                  } else {
                    sidebar.setOpen(false)
                  }
                }}
              />
            }
          >
            <PanelLeftIcon />
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8} hidden={sidebar.isMobile}>
            收起侧边栏
          </TooltipContent>
        </Tooltip>
      </div>
    )
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="px-2 pt-3 pb-2">{sidebarHeader}</SidebarHeader>
      <SidebarContent>
        {group("日常工作", primary)}
        {group("当前学期", [], user?.role === "viewer" ? undefined : schedulingMenu)}
        {user?.role !== "viewer" && group("日常运行", [], dailyMenu)}
        {user?.role !== "viewer" && group("基础资料", [], resourcesMenu)}
        {user?.role === "viewer" &&
          group("当前课表", [
            { title: "课表查看", to: "/scheduling/timetable", icon: BookOpenTextIcon },
          ])}
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
