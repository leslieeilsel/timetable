import { describe, expect, it } from "vitest"
import { diagnosticEvidence } from "../src/diagnostic-data.ts"

describe("complete diagnostic evidence", () => {
  it("retains every field beyond the former first-ten limit", () => {
    const values = Object.fromEntries(
      Array.from({ length: 15 }, (_, index) => [
        `issue_${index}`,
        { name: `任务 ${index}`, detail: "需核对的事实".repeat(100) },
      ]),
    )
    const evidence = diagnosticEvidence(values)
    const restored = Object.assign({}, ...evidence.map((entry) => JSON.parse(entry.fact)))
    expect(restored).toEqual(values)
    expect(new Set(evidence.map((entry) => entry.evidence_id)).size).toBe(evidence.length)
  })

  it("exposes a long string as ordered segments instead of dropping it", () => {
    const value = "完整诊断文本".repeat(1200)
    const evidence = diagnosticEvidence({ detail: value })
    const segments = evidence.map((entry) => JSON.parse(entry.fact))
    expect(segments.map((segment) => segment.text).join("")).toBe(value)
    expect(segments[0]).toMatchObject({
      field: "diagnostics/detail",
      offset: 0,
      total_characters: value.length,
    })
    expect(segments[1].offset).toBe(2000)
  })
})
