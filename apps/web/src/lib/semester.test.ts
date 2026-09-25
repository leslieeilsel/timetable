import { describe, expect, it } from "vitest"
import type { TimetableVersion } from "@/lib/types"
import {
  resolveSemesterId,
  resolveTimetableVersionSelection,
  timetableVersionsForRole,
  withSemesterId,
} from "@/lib/semester"

type Version = Pick<TimetableVersion, "id" | "status">

describe("semester routes", () => {
  it("rewrites current-semester compatibility links without losing their query or hash", () => {
    expect(withSemesterId(17, "/scheduling/generate?run=42#candidate")).toBe(
      "/semesters/17/generate?run=42#candidate",
    )
    expect(withSemesterId(17, "/semester/assignments?view=table&status=draft")).toBe(
      "/semesters/17/assignments?view=table&status=draft",
    )
    expect(withSemesterId(17, "/semesters/9/generate?run=42")).toBe("/semesters/9/generate?run=42")
    expect(withSemesterId(17, "/resources/teachers")).toBe("/resources/teachers")
  })

  it("uses current semester only when the route has no explicit semester", () => {
    expect(resolveSemesterId(undefined, 23)).toBe(23)
    expect(resolveSemesterId("17", 23)).toBe(17)
    expect(resolveSemesterId("invalid", 23)).toBeNull()
    expect(resolveSemesterId("0", 23)).toBeNull()
  })
})

describe("timetable version selection", () => {
  const versions: Version[] = [
    { id: 103, status: "draft" },
    { id: 102, status: "draft" },
    { id: 101, status: "active" },
    { id: 100, status: "historical" },
  ]

  it("defaults viewers to the semester current version instead of the latest draft", () => {
    expect(resolveTimetableVersionSelection(versions, "", 101, "viewer")).toBe("101")
  })

  it("lets viewers keep an explicitly selected historical version", () => {
    expect(resolveTimetableVersionSelection(versions, "100", 101, "viewer")).toBe("100")
  })

  it("removes every draft from the viewer selectable collection", () => {
    expect(timetableVersionsForRole(versions, "viewer")).toEqual([
      { id: 101, status: "active" },
      { id: 100, status: "historical" },
    ])
    expect(timetableVersionsForRole(versions, "scheduler")).toBe(versions)
  })

  it("does not invent a viewer default when the semester has no current version", () => {
    expect(resolveTimetableVersionSelection(versions, "", null, "viewer")).toBe("")
  })

  it("never defaults a viewer to a draft even if a broken pointer references it", () => {
    expect(resolveTimetableVersionSelection(versions, "", 103, "viewer")).toBe("")
  })

  it("does not preserve a draft selected before the user became a viewer", () => {
    expect(resolveTimetableVersionSelection(versions, "103", 101, "viewer")).toBe("101")
  })

  it("defaults editors to the current version unless they explicitly select a draft", () => {
    expect(resolveTimetableVersionSelection(versions, "", 101, "scheduler")).toBe("101")
    expect(resolveTimetableVersionSelection(versions, "", 101, "admin")).toBe("101")
    expect(resolveTimetableVersionSelection(versions, "103", 101, "admin")).toBe("103")
  })
})
