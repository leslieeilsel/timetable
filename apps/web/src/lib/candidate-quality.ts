import type { ScheduleCandidate } from "@/lib/types"

export const candidateRecommendationFloor = {
  overall: 70,
  teacherExperience: 60,
  courseDistribution: 60,
  classLoad: 60,
  sessionSpacing: 60,
} as const

export interface CandidateQualityAssessment {
  eligible: boolean
  reasons: string[]
}

export function assessCandidateQuality(
  candidate: Pick<
    ScheduleCandidate,
    "quality_score" | "hard_conflict_count" | "unscheduled_count" | "score_breakdown"
  >,
): CandidateQualityAssessment {
  const score = Number(candidate.quality_score ?? 0)
  const reasons: string[] = []

  if (candidate.hard_conflict_count > 0) reasons.push("仍有硬冲突")
  if (candidate.unscheduled_count > 0) reasons.push(`仍有 ${candidate.unscheduled_count} 节未排`)
  if (score < candidateRecommendationFloor.overall) {
    reasons.push(`综合质量 ${score.toFixed(1)}，低于 ${candidateRecommendationFloor.overall} 分`)
  }

  const dimensions = [
    [
      "教师体验",
      candidate.score_breakdown.teacher_experience,
      candidateRecommendationFloor.teacherExperience,
    ],
    [
      "课程分布",
      candidate.score_breakdown.course_distribution,
      candidateRecommendationFloor.courseDistribution,
    ],
    ["班级负荷", candidate.score_breakdown.class_load, candidateRecommendationFloor.classLoad],
    [
      "连排与间隔",
      candidate.score_breakdown.session_spacing,
      candidateRecommendationFloor.sessionSpacing,
    ],
  ] as const
  for (const [label, value, floor] of dimensions) {
    if (Number(value) < floor)
      reasons.push(`${label} ${Number(value).toFixed(1)}，低于 ${floor} 分`)
  }

  return { eligible: reasons.length === 0, reasons }
}
