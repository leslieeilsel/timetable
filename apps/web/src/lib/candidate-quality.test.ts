import { describe, expect, it } from "vitest"
import { assessCandidateQuality } from "@/lib/candidate-quality"
import type { ScheduleCandidate } from "@/lib/types"

function candidate(overrides: Partial<ScheduleCandidate> = {}): ScheduleCandidate {
  return {
    id: 1,
    schedule_run_id: 1,
    semester_id: 1,
    rank: 1,
    name: "方案 A",
    quality_score: "82.50",
    hard_conflict_count: 0,
    soft_warning_count: 0,
    unscheduled_count: 0,
    created_at: "2026-08-30T00:00:00Z",
    score_breakdown: {
      methodology_version: 2,
      course_distribution: 80,
      teacher_experience: 80,
      class_load: 80,
      session_spacing: 80,
      room_stability: 80,
      custom_rules: 80,
      core_course_priority: 80,
      stability: 80,
      same_course_same_day_repeats: 0,
      teacher_gaps: 0,
      consecutive_over_preference: 0,
      core_preferred_ratio: 1,
      changes_from_current: 0,
      class_daily_imbalance: 0,
      room_changes: 0,
      rule_results: [],
    },
    ...overrides,
  }
}

describe("candidate recommendation floor", () => {
  it("does not recommend legacy scores using the current scoring threshold", () => {
    const value = candidate()
    delete value.score_breakdown.methodology_version
    expect(assessCandidateQuality(value)).toEqual({
      eligible: false,
      reasons: ["历史评分口径已更新，请重新生成后再比较"],
    })
  })
  it("does not recommend a high overall score with a severely poor teacher experience", () => {
    const value = candidate({
      quality_score: "75.80",
      score_breakdown: {
        ...candidate().score_breakdown,
        teacher_experience: 22,
        teacher_gaps: 628,
      },
    })

    expect(assessCandidateQuality(value)).toMatchObject({ eligible: false })
    expect(assessCandidateQuality(value).reasons[0]).toContain("教师课时安排")
  })

  it("recommends only complete, conflict-free candidates above every floor", () => {
    expect(assessCandidateQuality(candidate())).toEqual({ eligible: true, reasons: [] })
    for (const overrides of [
      { hard_conflict_count: 1 },
      { unscheduled_count: 1 },
      { quality_score: "69.99" },
    ]) {
      expect(assessCandidateQuality(candidate(overrides)).eligible).toBe(false)
    }
    for (const dimension of [
      "teacher_experience",
      "course_distribution",
      "class_load",
      "session_spacing",
    ] as const) {
      const value = candidate()
      value.score_breakdown[dimension] = 59.99
      expect(assessCandidateQuality(value).eligible).toBe(false)
      value.score_breakdown[dimension] = 60
      value.quality_score = "70.00"
      expect(assessCandidateQuality(value).eligible).toBe(true)
    }
  })

  it("ignores recommendation floors for dimensions that are not active in the score", () => {
    const value = candidate({
      score_breakdown: {
        ...candidate().score_breakdown,
        session_spacing: 0,
        weights: { session_spacing: 0 },
      },
    })

    expect(assessCandidateQuality(value)).toEqual({ eligible: true, reasons: [] })
  })
})
