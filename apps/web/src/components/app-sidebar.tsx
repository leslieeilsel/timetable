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
  SparklesIcon,
  PanelLeftIcon,
  SettingsIcon,
  UsersIcon,
} from "lucide-react"
import { resourceNavigationItems, schedulingNavigationItems } from "@/components/app-navigation"
import { useAuth } from "@/lib/auth"
import { useSystemBranding } from "@/lib/queries"
import type { Role } from "@/lib/types"
import {
  isDailySemesterPath,
  isSchedulingSemesterPath,
  semesterDestinationForPath,
  semesterPathOrCurrent,
  useResolvedSemesterId,
} from "@/lib/semester"
import { WorkspaceUserMenu } from "@/components/workspace-user-menu"
import { LogoMark, SidebarBrand } from "@/components/brand"
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
  teacher: "教师",
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const branding = useSystemBranding()
  const { pathname } = useLocation()
  const { user } = useAuth()
  const { semesterId } = useResolvedSemesterId()
  const primaryItems =
    user && ["admin", "scheduler"].includes(user.role)
      ? [
          ...primary,
          {
            title: "AI 助手",
            to: semesterId ? `/ai?semester_id=${semesterId}` : "/ai",
            icon: SparklesIcon,
          },
        ]
      : primary
  const sidebar = useSidebar()
  const resourcesActive = pathname.startsWith("/resources") || pathname.startsWith("/years")
  const schedulingActive = isSchedulingSemesterPath(pathname)
  const dailyActive = isDailySemesterPath(pathname)
  const destination = semesterDestinationForPath(pathname)
  const canSchedule = user && ["admin", "scheduler"].includes(user.role)
  const schedulingItems = schedulingNavigationItems.map((item) => ({
    ...item,
    to: semesterPathOrCurrent(semesterId, item.destination),
    active:
      item.destination === destination ||
      (item.destination === "planning" && destination === "generate"),
  }))
  const group = (
    label: string,
    items: Array<(typeof primary)[number] & { active?: boolean }>,
    tail?: React.ReactNode,
  ) => (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => {
          const isActive =
            item.active ??
            (item.to === "/"
              ? pathname === "/" || /^\/semesters\/\d+\/dashboard$/.test(pathname)
              : pathname.startsWith(item.to.split("?")[0]))
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
        <LogoMark className="size-5.5 max-w-none group-hover/sidebar-logo:hidden group-focus-visible/sidebar-logo:hidden" />
        <PanelLeftIcon className="hidden size-4 group-hover/sidebar-logo:block group-focus-visible/sidebar-logo:block" />
      </Button>
    ) : (
      <div className="flex h-8 min-w-0 items-center gap-2">
        <Link
          to="/"
          className="flex min-w-0 flex-1 items-center gap-1 rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-sidebar-ring/50"
          onClick={() => sidebar.setOpenMobile(false)}
        >
          <SidebarBrand name={branding.system_name} tagline={branding.system_tagline} />
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
        {group("日常工作", primaryItems)}
        {group(
          "教务工作",
          [
            {
              title: "查看课表",
              to: semesterPathOrCurrent(semesterId, "timetable"),
              icon: BookOpenTextIcon,
            },
          ],
          canSchedule ? (
            <>
              <SidebarModuleMenu
                title="学期排课"
                icon={CalendarCogIcon}
                items={schedulingItems}
                isActive={schedulingActive}
              />
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip="调课与代课"
                  isActive={dailyActive}
                  render={
                    <Link
                      to={semesterPathOrCurrent(semesterId, "adjustments")}
                      aria-current={dailyActive ? "page" : undefined}
                      onClick={() => sidebar.setOpenMobile(false)}
                    />
                  }
                >
                  <CalendarCheck2Icon />
                  <span>调课与代课</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </>
          ) : undefined,
        )}
        {user?.role !== "viewer" &&
          group(
            "基础资料",
            [],
            <SidebarModuleMenu
              title="基础资料"
              icon={DatabaseIcon}
              items={resourceNavigationItems}
              isActive={resourcesActive}
              defaultOpen
            />,
          )}
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

type ModuleMenuProps = {
  title: string
  icon: typeof DatabaseIcon
  items: Array<{ title: string; to: string; icon: typeof DatabaseIcon; active?: boolean }>
  isActive: boolean
}

function SidebarModuleMenu({
  title,
  icon: Icon,
  items,
  isActive,
  defaultOpen = false,
}: ModuleMenuProps & { defaultOpen?: boolean }) {
  const { pathname } = useLocation()
  const sidebar = useSidebar()
  const [open, setOpen] = useState(defaultOpen || isActive)

  useEffect(() => {
    if (isActive) setOpen(true)
  }, [isActive, pathname])

  return (
    <>
      <Collapsible
        open={open}
        onOpenChange={setOpen}
        className="group/collapsible group-data-[collapsible=icon]:hidden"
        render={<SidebarMenuItem />}
      >
        <CollapsibleTrigger render={<SidebarMenuButton tooltip={title} isActive={isActive} />}>
          <Icon />
          <span>{title}</span>
          <ChevronDownIcon className="ml-auto transition-transform duration-200 group-data-[open]/collapsible:rotate-180 motion-reduce:transition-none" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {items.map((item) => {
              const active = item.active ?? pathname === item.to
              return (
                <SidebarMenuSubItem key={item.to}>
                  <SidebarMenuSubButton
                    isActive={active}
                    render={
                      <Link
                        to={item.to}
                        aria-current={active ? "page" : undefined}
                        onClick={() => sidebar.setOpenMobile(false)}
                      />
                    }
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              )
            })}
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
      <CollapsedModuleMenu title={title} icon={Icon} items={items} isActive={isActive} />
    </>
  )
}

const COLLAPSED_MENU_OPEN_EVENT = "timetable:sidebar-module-open"

function CollapsedModuleMenu({ title, icon: Icon, items, isActive }: ModuleMenuProps) {
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
              const itemActive = item.active ?? pathname === item.to
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
