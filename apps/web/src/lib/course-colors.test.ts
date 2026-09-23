import { describe, expect, it } from "vitest"
import type { Course } from "@/lib/types"
import { courseColors, courseColorStyle, recommendCourseColor } from "./course-colors"

describe("persisted course colors", () => {
  it("uses the saved color and keeps a missing or unsafe color neutral", () => {
    expect(courseColorStyle({ color: "#3973C6" })).toEqual({ "--course-color": "#3973C6" })
    expect(courseColorStyle({ color: "url(test)" })).toEqual(courseColorStyle({ color: null }))
  })
  it("recommends an unused active-course color before a repeated color", () => {
    const used = courseColors
      .slice(0, 4)
      .map(({ value }, id) => ({ id, color: value, is_active: true })) as Course[]
    expect(recommendCourseColor(used)).toBe(courseColors[4].value)
    expect(recommendCourseColor([{ ...used[0], is_active: false }])).toBe(courseColors[0].value)
  })
  it("balances reuse after all preset colors are occupied", () => {
    const used = courseColors.map(({ value }, id) => ({
      id,
      color: value,
      is_active: true,
    })) as Course[]
    expect(recommendCourseColor([...used, used[0]])).toBe(courseColors[1].value)
  })
})
