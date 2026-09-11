import type { ComponentProps } from "react"
import { cn } from "@/lib/utils"

type LogoMarkProps = Omit<ComponentProps<"img">, "src">

export function LogoMark({ className, alt = "", ...props }: LogoMarkProps) {
  return (
    <img
      src="/brand/logo-mark.svg"
      alt={alt}
      className={cn("shrink-0 select-none dark:brightness-110 dark:saturate-90", className)}
      draggable={false}
      {...props}
    />
  )
}

export function SidebarBrand({ name, tagline }: { name: string; tagline: string | null }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1">
      <span className="flex size-8 shrink-0 items-center justify-center">
        <LogoMark className="size-5.5" />
      </span>
      <span className="grid min-w-0 flex-1 text-left">
        <span className="truncate text-[13px] leading-4 font-medium" title={name}>
          {name}
        </span>
        {tagline?.trim() && (
          <span
            className="mt-0.5 truncate text-[11px] leading-[14px] text-sidebar-foreground/55"
            title={tagline}
          >
            {tagline}
          </span>
        )}
      </span>
    </span>
  )
}
