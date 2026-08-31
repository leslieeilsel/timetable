import type { LucideIcon } from "lucide-react"
import {
  BookOpenCheckIcon,
  BookOpenTextIcon,
  CalendarCheck2Icon,
  CalendarDaysIcon,
  ClipboardListIcon,
  GalleryVerticalEndIcon,
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
  { title: "年级与班级", to: "/years", icon: CalendarDaysIcon },
] satisfies NavigationItem[]

export const schedulingNavigationItems = [
  { title: "① 准备检查", destination: "preparation", icon: BookOpenCheckIcon },
  { title: "② 课程与任课矩阵", destination: "assignments", icon: ClipboardListIcon },
  { title: "③ 规则与约束", destination: "constraints", icon: SettingsIcon },
  { title: "④ 方案生成", destination: "generate", icon: GalleryVerticalEndIcon },
  { title: "⑤ 课表调整与诊断", destination: "timetable", icon: BookOpenTextIcon },
] satisfies SemesterNavigationItem[]

export const dailyNavigationItems = [
  { title: "临时调课", destination: "adjustments", icon: CalendarDaysIcon },
  { title: "请假与代课", destination: "leaves", icon: CalendarCheck2Icon },
] satisfies SemesterNavigationItem[]
