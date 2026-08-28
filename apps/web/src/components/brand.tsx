import type { ComponentProps } from "react"
import { cn } from "@/lib/utils"
import { SYSTEM_NAME, SYSTEM_TAGLINE } from "@/lib/brand"

type LogoMarkProps = Omit<ComponentProps<"img">, "src">

export function LogoMark({ className, alt = "", ...props }: LogoMarkProps) {
  return (
    <img
      src="/brand/logo-mark.svg"
      alt={alt}
      className={cn("shrink-0 select-none dark:invert", className)}
      draggable={false}
      {...props}
    />
  )
}

export function Brand({ large = false, className }: { large?: boolean; className?: string }) {
  return (
    <div className={cn("flex items-center", large ? "gap-5" : "gap-4", className)}>
      <LogoMark className={large ? "size-16" : "size-12"} />
      <div>
        <p className={cn("font-semibold tracking-tight", large ? "text-2xl" : "text-xl")}>
          {SYSTEM_NAME}
        </p>
        <p className={cn("text-muted-foreground", large ? "text-base" : "text-sm")}>
          {SYSTEM_TAGLINE}
        </p>
      </div>
    </div>
  )
}
