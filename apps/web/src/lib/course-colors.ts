import type { CSSProperties } from "react"
import palette from "../../../../contracts/course-colors.json"
import type { Course } from "@/lib/types"

export const courseColors = palette

export function courseColorStyle(course: Pick<Course, "color">): CSSProperties {
  // A missing color stays neutral; never guess a subject's identity from its name.
  const color = course.color && /^#[0-9a-f]{6}$/i.test(course.color) ? course.color : "#667887"
  return { "--course-color": color } as CSSProperties
}

export function recommendCourseColor(courses: Course[]) {
  const usage = new Map<string, number>()
  for (const course of courses) {
    if (course.is_active && course.color)
      usage.set(course.color, (usage.get(course.color) ?? 0) + 1)
  }
  return courseColors.reduce((best, color) =>
    (usage.get(color.value) ?? 0) < (usage.get(best.value) ?? 0) ? color : best,
  ).value
}

export function courseColorName(color: string | null | undefined) {
  return courseColors.find((item) => item.value === color)?.label ?? "未设置"
}
