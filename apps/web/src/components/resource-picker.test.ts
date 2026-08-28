import { describe, expect, it } from "vitest"

import {
  matchesResourceQuery,
  resourcePinyin,
  type ResourcePickerItem,
} from "@/components/resource-picker"

const teacher: ResourcePickerItem = {
  value: "108",
  label: "王静",
  description: "T-0108",
  searchText: `${resourcePinyin("王静")} 语文 ${resourcePinyin("语文")}`,
  status: "可选",
  statusTone: "success",
}

describe("resource picker search", () => {
  it("matches visible labels and employee numbers", () => {
    expect(matchesResourceQuery(teacher, "王静")).toBe(true)
    expect(matchesResourceQuery(teacher, "T-0108")).toBe(true)
  })

  it("matches full pinyin and pinyin initials", () => {
    expect(matchesResourceQuery(teacher, "wangjing")).toBe(true)
    expect(matchesResourceQuery(teacher, "wj")).toBe(true)
  })

  it("matches subject search text and rejects unrelated input", () => {
    expect(matchesResourceQuery(teacher, "语文")).toBe(true)
    expect(matchesResourceQuery(teacher, "数学")).toBe(false)
  })
})
