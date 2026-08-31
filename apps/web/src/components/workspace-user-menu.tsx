import { useState, type ReactElement } from "react"
import { useNavigate } from "react-router"
import { ChevronRightIcon, KeyRoundIcon, LogOutIcon } from "lucide-react"
import { useAuth } from "@/lib/auth"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export function WorkspaceUserMenu({
  placement = "header",
  trigger,
}: {
  placement?: "header" | "sidebar"
  trigger: ReactElement
}) {
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const [open, setOpen] = useState(false)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger render={trigger} />
      <DropdownMenuContent
        align="end"
        side={placement === "sidebar" ? "right" : "bottom"}
        sideOffset={8}
        className="w-[17rem] rounded-2xl p-1.5 shadow-xl ring-foreground/10"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center gap-3 px-2.5 py-2.5 font-normal">
            <Avatar size="lg" className="size-9">
              <AvatarFallback className="bg-foreground text-sm font-semibold text-background">
                {userInitial(user?.name)}
              </AvatarFallback>
            </Avatar>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-foreground">
                {user?.name}
              </span>
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                {user?.email}
              </span>
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator className="my-1.5" />
        <DropdownMenuGroup>
          <DropdownMenuItem className="h-10 px-2.5" onClick={() => navigate("/change-password")}>
            <KeyRoundIcon className="text-muted-foreground" />
            <span>修改密码</span>
            <ChevronRightIcon className="ml-auto size-3.5 text-muted-foreground" />
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator className="my-1.5" />
        <DropdownMenuGroup>
          <DropdownMenuItem
            variant="destructive"
            className="h-10 px-2.5"
            onClick={() => void logout()}
          >
            <LogOutIcon />
            退出登录
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function userInitial(name?: string) {
  return Array.from(name?.trim() || "用")[0]
}
