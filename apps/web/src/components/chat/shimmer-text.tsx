import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"

/** Keep both layers mounted so finishing a tool fades without restarting its layout. */
export function ShimmerText({
  text,
  active,
  className,
}: {
  text: string
  active: boolean
  className?: string
}) {
  const [animating, setAnimating] = useState(active)
  useEffect(() => {
    if (active) {
      setAnimating(true)
      return
    }
    const timer = window.setTimeout(() => setAnimating(false), 220)
    return () => window.clearTimeout(timer)
  }, [active])
  return (
    <span className={cn("chat-shimmer", className)} data-active={active} aria-label={text}>
      <span aria-hidden className="chat-shimmer-base">
        {text}
      </span>
      <span aria-hidden className={cn("chat-shimmer-overlay", (active || animating) && "shimmer")}>
        {text}
      </span>
    </span>
  )
}
