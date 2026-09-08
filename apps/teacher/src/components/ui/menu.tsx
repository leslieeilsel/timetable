import { Menu as MenuPrimitive } from "@base-ui/react/menu"
import type * as React from "react"

import { cn } from "@/lib/utils"

function Menu(props: MenuPrimitive.Root.Props) {
  return <MenuPrimitive.Root {...props} />
}

function MenuTrigger(props: MenuPrimitive.Trigger.Props) {
  return <MenuPrimitive.Trigger {...props} />
}

function MenuContent({
  align = "center",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 8,
  className,
  ...props
}: MenuPrimitive.Popup.Props &
  Pick<MenuPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset">) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="z-50 outline-none"
      >
        <MenuPrimitive.Popup
          className={(state) =>
            cn(
              "teacher-menu",
              state.open && "teacher-menu-open",
              state.transitionStatus === "ending" && "teacher-menu-closing",
              typeof className === "function" ? className(state) : className,
            )
          }
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

function MenuItem({ className, ...props }: MenuPrimitive.Item.Props) {
  return <MenuPrimitive.Item className={cn("teacher-menu-item", className)} {...props} />
}

function MenuSeparator({ className, ...props }: MenuPrimitive.Separator.Props) {
  return <MenuPrimitive.Separator className={cn("teacher-menu-separator", className)} {...props} />
}

function MenuLabel({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("teacher-menu-label", className)} {...props} />
}

export { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger }
