import { useEffect, useState } from "react"
import { Link, useLocation } from "react-router"
import {
  BookOpenTextIcon,
  CalendarCheck2Icon,
  CalendarCogIcon,
  ChevronDownIcon,
  ChevronsUpDownIcon,
  DatabaseIcon,
  LayoutDashboardIcon,
  PanelLeftIcon,
  SettingsIcon,
  UsersIcon,
} from "lucide-react"
import {
  dailyNavigationItems,
  resourceNavigationItems,
  schedulingNavigationItems,
} from "@/components/app-navigation"
import { useAuth } from "@/lib/auth"
import { SYSTEM_NAME, SYSTEM_TAGLINE } from "@/lib/brand"
import type { Role } from "@/lib/types"
import {
  isDailySemesterPath,
  isSchedulingSemesterPath,
  semesterPathOrCurrent,
  useResolvedSemesterId,
} from "@/lib/semester"
import { WorkspaceUserMenu } from "@/components/workspace-user-menu"
import { LogoMark } from "@/components/brand"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
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
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
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

const primary = [{ title: "工作台", to: "/", icon: LayoutDashboardIcon }]

const roleLabels: Record<Role, string> = {
  admin: "系统管理员",
  scheduler: "排课员",
  viewer: "查看者",
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { pathname } = useLocation()
  const { user } = useAuth()
  const { semesterId } = useResolvedSemesterId()
  const sidebar = useSidebar()
  const resourcesActive = pathname.startsWith("/resources") || pathname.startsWith("/years")
  const schedulingActive = isSchedulingSemesterPath(pathname)
  const dailyActive = isDailySemesterPath(pathname)
  const schedulingMenuItems = schedulingNavigationItems.map((item) => ({
    ...item,
    to: semesterPathOrCurrent(semesterId, item.destination),
  }))
  const dailyMenuItems = dailyNavigationItems.map((item) => ({
    ...item,
    to: semesterPathOrCurrent(semesterId, item.destination),
  }))
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
        {items.map((item) => {
          const isActive = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to)
          return (
            <SidebarMenuItem key={item.to}>
              <SidebarMenuButton
                tooltip={item.title}
                isActive={isActive}
                render={
                  <Link
                    to={item.to}
                    aria-current={isActive ? "page" : undefined}
                    onClick={() => sidebar.setOpenMobile(false)}
                  />
                }
              >
                <item.icon />
                <span>{item.title}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )
        })}
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
      className="group/collapsible group-data-[collapsible=icon]:hidden"
      render={<SidebarMenuItem />}
    >
      <CollapsibleTrigger
        render={<SidebarMenuButton tooltip="基础资料" isActive={resourcesActive} />}
      >
        <DatabaseIcon />
        <span>基础资料</span>
        <ChevronDownIcon className="ml-auto transition-transform duration-200 group-data-[open]/collapsible:rotate-180 group-data-[collapsible=icon]:hidden motion-reduce:transition-none" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <SidebarMenuSub>
          {resourceNavigationItems.map((item) => (
            <SidebarMenuSubItem key={item.to}>
              <SidebarMenuSubButton
                isActive={pathname === item.to}
                render={
                  <Link
                    to={item.to}
                    aria-current={pathname === item.to ? "page" : undefined}
                    onClick={() => sidebar.setOpenMobile(false)}
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
      className="group/collapsible group-data-[collapsible=icon]:hidden"
      render={<SidebarMenuItem />}
    >
      <CollapsibleTrigger
        render={<SidebarMenuButton tooltip="排课中心" isActive={schedulingActive} />}
      >
        <CalendarCogIcon />
        <span>排课中心</span>
        <ChevronDownIcon className="ml-auto transition-transform duration-200 group-data-[open]/collapsible:rotate-180 group-data-[collapsible=icon]:hidden motion-reduce:transition-none" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <SidebarMenuSub>
          {schedulingMenuItems.map((item) => (
            <SidebarMenuSubItem key={item.to}>
              <SidebarMenuSubButton
                isActive={pathname === item.to}
                render={
                  <Link
                    to={item.to}
                    aria-current={pathname === item.to ? "page" : undefined}
                    onClick={() => sidebar.setOpenMobile(false)}
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
      className="group/collapsible group-data-[collapsible=icon]:hidden"
      render={<SidebarMenuItem />}
    >
      <CollapsibleTrigger render={<SidebarMenuButton tooltip="日常运行" isActive={dailyActive} />}>
        <CalendarCheck2Icon />
        <span>日常运行</span>
        <ChevronDownIcon className="ml-auto transition-transform duration-200 group-data-[open]/collapsible:rotate-180 group-data-[collapsible=icon]:hidden motion-reduce:transition-none" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <SidebarMenuSub>
          {dailyMenuItems.map((item) => (
            <SidebarMenuSubItem key={item.to}>
              <SidebarMenuSubButton
                isActive={pathname === item.to}
                render={
                  <Link
                    to={item.to}
                    aria-current={pathname === item.to ? "page" : undefined}
                    onClick={() => sidebar.setOpenMobile(false)}
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
  const accountMenu = user ? (
    <WorkspaceUserMenu
      placement="sidebar"
      trigger={
        <SidebarMenuButton
          type="button"
          size="lg"
          aria-label={`打开${user.name}的账户菜单`}
          className="cursor-pointer pl-0 pr-2 hover:bg-transparent hover:text-sidebar-foreground active:bg-transparent active:text-sidebar-foreground data-popup-open:bg-transparent data-popup-open:text-sidebar-foreground group-data-[collapsible=icon]:h-12! group-data-[collapsible=icon]:w-8! group-data-[collapsible=icon]:p-0!"
        >
          <Avatar className="size-8 shrink-0 rounded-xl">
            <AvatarFallback className="rounded-xl bg-sidebar-primary text-xs font-semibold text-sidebar-primary-foreground">
              {userInitial(user.name)}
            </AvatarFallback>
          </Avatar>
          <span className="grid min-w-0 flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
            <span className="truncate text-sm font-medium">{user.name}</span>
            <span className="mt-0.5 truncate text-xs text-sidebar-foreground/60">
              {roleLabels[user.role]}
            </span>
          </span>
          <ChevronsUpDownIcon className="ml-auto size-3.5 text-sidebar-foreground/50 group-data-[collapsible=icon]:hidden" />
        </SidebarMenuButton>
      }
    />
  ) : null

  const sidebarHeader =
    !sidebar.isMobile && sidebar.state === "collapsed" ? (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="展开侧边栏"
        className="group/sidebar-logo size-8 cursor-pointer rounded-xl p-0 hover:bg-sidebar-accent focus-visible:bg-sidebar-accent"
        onClick={() => sidebar.setOpen(true)}
      >
        <LogoMark className="size-8 max-w-none group-hover/sidebar-logo:hidden group-focus-visible/sidebar-logo:hidden" />
        <PanelLeftIcon className="hidden size-4 group-hover/sidebar-logo:block group-focus-visible/sidebar-logo:block" />
      </Button>
    ) : (
      <div className="flex h-8 min-w-0 items-center gap-2">
        <Link
          to="/"
          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-sidebar-ring/50"
          onClick={() => sidebar.setOpenMobile(false)}
        >
          <LogoMark className="size-8" />
          <span className="grid min-w-0 flex-1 text-left leading-tight">
            <span className="truncate text-sm font-semibold">{SYSTEM_NAME}</span>
            <span className="mt-0.5 truncate text-xs text-sidebar-foreground/60">
              {SYSTEM_TAGLINE}
            </span>
          </span>
        </Link>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={sidebar.isMobile ? "关闭侧边栏" : "收起侧边栏"}
          className="size-8 cursor-pointer rounded-xl text-muted-foreground hover:text-foreground"
          onClick={() => {
            if (sidebar.isMobile) {
              sidebar.setOpenMobile(false)
            } else {
              sidebar.setOpen(false)
            }
          }}
        >
          <PanelLeftIcon />
        </Button>
      </div>
    )

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="shrink-0 px-2 pt-3 pb-2">{sidebarHeader}</SidebarHeader>
      <SidebarContent role="navigation" aria-label="主导航">
        {group("日常工作", primary)}
        {user?.role !== "viewer" &&
          group(
            "当前学期",
            [],
            <>
              {schedulingMenu}
              <CollapsedModuleMenu
                title="排课中心"
                icon={CalendarCogIcon}
                items={schedulingMenuItems}
                isActive={schedulingActive}
              />
              {dailyMenu}
              <CollapsedModuleMenu
                title="日常运行"
                icon={CalendarCheck2Icon}
                items={dailyMenuItems}
                isActive={dailyActive}
              />
            </>,
          )}
        {user?.role !== "viewer" &&
          group(
            "基础资料",
            [],
            <>
              {resourcesMenu}
              <CollapsedModuleMenu
                title="基础资料"
                icon={DatabaseIcon}
                items={resourceNavigationItems}
                isActive={resourcesActive}
              />
            </>,
          )}
        {user?.role === "viewer" &&
          group("当前课表", [
            {
              title: "课表查看",
              to: semesterPathOrCurrent(semesterId, "timetable"),
              icon: BookOpenTextIcon,
            },
          ])}
        {user?.role === "admin" &&
          group("系统", [
            { title: "用户管理", to: "/users", icon: UsersIcon },
            { title: "系统设置", to: "/settings", icon: SettingsIcon },
          ])}
      </SidebarContent>
      {accountMenu && (
        <SidebarFooter className="hidden shrink-0 gap-0 p-2 md:flex">
          <SidebarMenu>
            <SidebarMenuItem>{accountMenu}</SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      )}
      <SidebarRail />
    </Sidebar>
  )
}

const COLLAPSED_MENU_OPEN_EVENT = "timetable:sidebar-module-open"

function CollapsedModuleMenu({
  title,
  icon: Icon,
  items,
  isActive,
}: {
  title: string
  icon: typeof DatabaseIcon
  items: Array<{ title: string; to: string; icon: typeof DatabaseIcon }>
  isActive: boolean
}) {
  const { pathname } = useLocation()
  const sidebar = useSidebar()
  const isMobileSurface = sidebar.isMobile
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (isMobileSurface || sidebar.state === "expanded") setOpen(false)
  }, [isMobileSurface, sidebar.state])

  useEffect(() => {
    const closeWhenAnotherMenuOpens = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== title) setOpen(false)
    }

    window.addEventListener(COLLAPSED_MENU_OPEN_EVENT, closeWhenAnotherMenuOpens)
    return () => window.removeEventListener(COLLAPSED_MENU_OPEN_EVENT, closeWhenAnotherMenuOpens)
  }, [title])

  return (
    <SidebarMenuItem className="hidden group-data-[collapsible=icon]:block">
      <DropdownMenu
        open={open}
        onOpenChange={(nextOpen) => {
          if (nextOpen && (isMobileSurface || sidebar.state === "expanded")) {
            return
          }
          if (nextOpen) {
            window.dispatchEvent(
              new CustomEvent<string>(COLLAPSED_MENU_OPEN_EVENT, { detail: title }),
            )
          }
          setOpen(nextOpen)
        }}
      >
        <DropdownMenuTrigger
          openOnHover
          delay={0}
          closeDelay={120}
          render={<SidebarMenuButton isActive={isActive} aria-label={`打开${title}菜单`} />}
        >
          <Icon />
          <span>{title}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          data-sidebar-module-menu="true"
          side="right"
          align="start"
          sideOffset={8}
          className="w-56 rounded-2xl p-1.5 shadow-xl ring-foreground/10"
        >
          <DropdownMenuGroup>
            <DropdownMenuLabel className="px-2.5 py-2 text-xs font-medium text-foreground">
              {title}
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="my-1" />
            {items.map((item) => {
              const itemActive = pathname === item.to
              return (
                <DropdownMenuItem
                  key={item.to}
                  className={`h-9 cursor-pointer px-2.5 ${
                    itemActive
                      ? "bg-accent font-medium text-accent-foreground [&_svg]:text-accent-foreground"
                      : ""
                  }`}
                  render={
                    <Link
                      to={item.to}
                      aria-current={itemActive ? "page" : undefined}
                      onClick={() => setOpen(false)}
                    />
                  }
                >
                  <item.icon className="text-muted-foreground" />
                  <span>{item.title}</span>
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  )
}

function userInitial(name?: string) {
  return Array.from(name?.trim() || "用")[0]
}
