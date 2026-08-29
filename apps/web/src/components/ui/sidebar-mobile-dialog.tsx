import type { ReactNode } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export function SidebarMobileDialog({
  open,
  onOpenChange,
  dir,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  dir?: string
  children: ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        dir={dir}
        data-sidebar="sidebar"
        data-slot="sidebar"
        data-mobile="true"
        showCloseButton={false}
        className="h-[calc(100svh-2rem)] w-(--sidebar-width) max-w-[calc(100%-2rem)] gap-0 overflow-hidden bg-sidebar p-0 text-sidebar-foreground sm:max-w-[18rem]"
        style={{ "--sidebar-width": "18rem" } as React.CSSProperties}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>导航菜单</DialogTitle>
          <DialogDescription>显示系统导航菜单。</DialogDescription>
        </DialogHeader>
        <div className="flex h-full w-full flex-col">{children}</div>
      </DialogContent>
    </Dialog>
  )
}
