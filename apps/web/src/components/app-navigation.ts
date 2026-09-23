import type { LucideIcon } from "lucide-react"
import {
  BookOpenCheckIcon,
  BookOpenTextIcon,
  CalendarCheck2Icon,
  CalendarDaysIcon,
  CalendarRangeIcon,
  ClipboardListIcon,
  PinIcon,
  MapPinIcon,
  SettingsIcon,
  UserRoundIcon,
} from "lucide-react"
import type { SemesterDestination } from "@/lib/semester"

export type NavigationItem = {
  title: string
  icon: LucideIcon
  to: string
}

export type SemesterNavigationItem = {
  title: string
  destination: SemesterDestination
  icon: LucideIcon
}

export const resourceNavigationItems = [
  { title: "教师", to: "/resources/teachers", icon: UserRoundIcon },
  { title: "课程", to: "/resources/courses", icon: BookOpenTextIcon },
  { title: "教室", to: "/resources/rooms", icon: MapPinIcon },
  { title: "年级", to: "/resources/grades", icon: CalendarDaysIcon },
  { title: "学年学期", to: "/years", icon: CalendarDaysIcon },
] satisfies NavigationItem[]

export const schedulingNavigationItems = [
  { title: "排课准备", destination: "preparation", icon: BookOpenCheckIcon },
  { title: "班级与作息", destination: "setup", icon: CalendarDaysIcon },
  { title: "任课与课时", destination: "assignments", icon: ClipboardListIcon },
  { title: "排课规则", destination: "constraints", icon: SettingsIcon },
  { title: "固定安排", destination: "fixed-placements", icon: PinIcon },
  { title: "编排课表", destination: "planning", icon: BookOpenTextIcon },
] satisfies SemesterNavigationItem[]

export const dailyNavigationItems = [
  { title: "单次调课记录", destination: "adjustments", icon: CalendarDaysIcon },
  { title: "持续调课记录", destination: "long-term", icon: CalendarRangeIcon },
  { title: "请假与代课", destination: "leaves", icon: CalendarCheck2Icon },
] satisfies SemesterNavigationItem[]
