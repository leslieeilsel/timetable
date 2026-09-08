import type { ComponentProps } from "react"
import { cn } from "@/lib/utils"

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
