import { useState } from "react"
import { useNavigate } from "react-router"
import { ChevronDownIcon, LogOutIcon } from "lucide-react"
import { useAuth } from "@/lib/auth"
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

export function WorkspaceUserMenu() {
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const [open, setOpen] = useState(true)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={<Button variant="ghost" className="ml-1 gap-2 px-2.5" aria-label={user?.name} />}
      >
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
          <DropdownMenuItem onClick={() => navigate("/change-password")}>修改密码</DropdownMenuItem>
          <DropdownMenuItem onClick={() => void logout()}>
            <LogOutIcon />
            退出登录
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
