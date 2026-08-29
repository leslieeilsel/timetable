import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "@/lib/utils"

function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 touch-manipulation cursor-pointer items-center rounded-full bg-input p-0.5 transition-colors outline-none after:absolute after:-inset-y-3.5 after:-inset-x-1.5 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 data-checked:bg-primary",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-4 rounded-full bg-background shadow-xs transition-transform data-checked:translate-x-4 dark:bg-foreground" />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
