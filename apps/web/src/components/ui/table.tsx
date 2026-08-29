import * as React from "react"

import { cn } from "@/lib/utils"

function Table({
  className,
  responsive = false,
  ...props
}: React.ComponentProps<"table"> & { responsive?: boolean }) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const [canScroll, setCanScroll] = React.useState(false)
  const [hasScrolled, setHasScrolled] = React.useState(false)

  React.useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const update = () => setCanScroll(container.scrollWidth > container.clientWidth + 1)
    update()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(update)
    observer.observe(container)
    const table = container.querySelector("table")
    if (table) observer.observe(table)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={containerRef}
      data-slot="table-container"
      role={canScroll ? "region" : undefined}
      aria-label={canScroll ? "可横向滚动的数据表" : undefined}
      tabIndex={canScroll ? 0 : undefined}
      className={cn(
        "relative w-full overflow-x-auto focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
        responsive && "max-sm:overflow-visible",
      )}
      onScroll={() => setHasScrolled(true)}
    >
      {canScroll && !hasScrolled && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-2 right-2 z-20 rounded-lg border bg-background/95 px-2 py-1 text-[11px] font-medium text-muted-foreground shadow-sm md:hidden"
        >
          左右滑动查看
        </span>
      )}
      <table
        data-slot="table"
        data-responsive={responsive || undefined}
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead data-slot="table-header" className={cn("[&_tr]:border-b", className)} {...props} />
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn("border-t bg-muted/50 font-medium [&>tr]:last:border-b-0", className)}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-primary/[0.045] data-[state=selected]:hover:bg-primary/[0.055]",
        className,
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      scope="col"
      className={cn(
        "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0",
        className,
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn("p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0", className)}
      {...props}
    />
  )
}

function TableCaption({ className, ...props }: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption }
