import { describe, expect, it } from "vitest"

import { matchesResourceQuery, type ResourcePickerItem } from "@/components/resource-picker"
import { resourcePinyin } from "@/lib/resource-pinyin"

const teacher: ResourcePickerItem = {
  value: "108",
  label: "王静",
  description: "T-0108",
  searchText: "语文",
  pinyinSource: "王静 语文",
  status: "可选",
  statusTone: "success",
}

describe("resource picker search", () => {
  it("matches visible labels and employee numbers", () => {
    expect(matchesResourceQuery(teacher, "王静")).toBe(true)
    expect(matchesResourceQuery(teacher, "T-0108")).toBe(true)
  })

  it("matches full pinyin and pinyin initials", () => {
    const pinyinSearchText = resourcePinyin(teacher.pinyinSource ?? teacher.label)
    expect(matchesResourceQuery(teacher, "wangjing", pinyinSearchText)).toBe(true)
    expect(matchesResourceQuery(teacher, "wj", pinyinSearchText)).toBe(true)
  })

  it("matches subject search text and rejects unrelated input", () => {
    expect(matchesResourceQuery(teacher, "语文")).toBe(true)
    expect(matchesResourceQuery(teacher, "数学")).toBe(false)
  })
})
