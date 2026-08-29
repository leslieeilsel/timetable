import type { ComponentProps } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type TableActionButtonProps = Omit<ComponentProps<typeof Button>, "size" | "variant"> & {
  intent: "edit" | "delete" | "activate" | "deactivate"
}

const intentClassNames = {
  edit: "text-blue-600 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-400",
  delete: "text-destructive hover:text-destructive",
  activate:
    "text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300",
  deactivate: "text-amber-700 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-300",
} as const

export function TableActionButton({ intent, className, ...props }: TableActionButtonProps) {
  return (
    <Button
      size="sm"
      variant="ghost"
      className={cn(intentClassNames[intent], className)}
      {...props}
    />
  )
}
