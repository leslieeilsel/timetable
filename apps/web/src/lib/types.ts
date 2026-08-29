export type Role = "admin" | "scheduler" | "viewer"
export type LifecycleStatus = "draft" | "open" | "closed"
export type ResourceStatus = "active" | "inactive"
export type AssignmentStatus = "draft" | "confirmed" | "inactive"
export type WeekPattern = "all" | "a" | "b" | "specified"
export type OperationalStatus = "draft" | "active" | "cancelled"
export type CalendarExceptionType =
  | "move"
  | "swap"
  | "teacher_change"
  | "room_change"
  | "cancel"
  | "makeup"
  | "activity"
export type TeachingGroupMode = "combined" | "split" | "roaming"
export type ConstraintKind = "hard" | "soft"
export type ConstraintStatus = "draft" | "active" | "inactive"
export type ScheduleRunStatus =
  | "queued"
  | "checking"
  | "solving"
  | "optimizing"
  | "building_candidates"
  | "completed"
  | "failed"
  | "cancelled"

export interface User {
  id: number
  name: string
  email: string
  role: Role
  is_active: boolean
  must_change_password: boolean
  created_at?: string
}

export interface Grade {
  id: number
  name: string
  sort_order: number
  is_active: boolean
}

export interface Course {
  id: number
  name: string
  short_name: string | null
  is_active: boolean
}

export interface Teacher {
  id: number
  name: string
  employee_no: string | null
  is_active: boolean
  courses?: Course[]
}

export interface Room {
  id: number
  name: string
  type: string
  is_active: boolean
}

export interface AcademicYear {
  id: number
  name: string
  start_date: string
  end_date: string
  status: LifecycleStatus
}

export interface Semester {
  id: number
  academic_year_id: number
  name: string
  sequence: 1 | 2
  start_date: string
  end_date: string
  status: LifecycleStatus
  etag: string
  timetable_revision: number | string
  input_revision: number | string
  assignment_revision: number | string
  constraint_revision: number | string
  current_timetable_version_id: number | null
  academic_year?: AcademicYear
}

export interface SchoolClass {
  id: number
  academic_year_id: number
  grade_id: number
  name: string
  code: string | null
  status: ResourceStatus
  grade: Pick<Grade, "id" | "name">
}

export interface ClassSetting {
  id: number
  semester_id: number
  school_class_id: number
  fixed_room_id: number | null
  homeroom_teacher_id: number | null
  status: ResourceStatus
  school_class: SchoolClass
  fixed_room: Room | null
  homeroom_teacher: Teacher | null
}

export interface ScheduleDay {
  id: number
  weekday: number
  is_enabled: boolean
}

export interface Item {
  id: number
  name: string
  type: "course" | "fixed_non_course" | "self_study"
  start_time: string
  end_time: string
  sort_order: number
  allows_course: boolean
  allows_teacher: boolean
  counts_as_course: boolean
  show_in_official: boolean
  show_in_full: boolean
  is_active: boolean
}

export interface ScheduleTemplate {
  id: number
  semester_id: number
  name: string
  days: ScheduleDay[]
  items: Item[]
}

export interface TeachingAssignment {
  id: number
  semester_id: number
  school_class_id: number | null
  teaching_group_id: number | null
  course_id: number
  teacher_id: number
  weekly_items: number
  items_per_session: number
  week_pattern: WeekPattern
  active_weeks: number[] | null
  room_mode: "class_default" | "specified"
  specified_room_id: number | null
  allows_substitution: boolean
  status: AssignmentStatus
  scheduled?: number
  remaining?: number
  completed?: boolean
  school_class: SchoolClass | null
  teaching_group: TeachingGroup | null
  course: Course
  teacher: Teacher
  collaborators: Teacher[]
  specified_room: Room | null
}

export interface TeachingGroup {
  id: number
  semester_id: number
  name: string
  mode: TeachingGroupMode
  status: ResourceStatus
  school_classes: SchoolClass[]
  assignments_count?: number
}

export interface PaginationMeta {
  page: number
  per_page: number
  total: number
  last_page: number
  from: number | null
  to: number | null
}

export interface PreparationCheckItem {
  key: string
  label: string
  status: "passed" | "warning" | "blocking"
  issue_count: number
  message: string
  fix_path: string
  items: Array<Record<string, unknown>>
}

export interface PreparationCheck {
  ready: boolean
  status: "passed" | "warning" | "blocking"
  input_revision: number
  summary: {
    blocking: number
    warnings: number
    passed: number
    confirmed_assignments: number
    required_entries: number
    available_slots_per_resource: number
    fixed_placements: number
    active_hard_constraints: number
    active_soft_constraints: number
  }
  checks: PreparationCheckItem[]
  recent_runs: ScheduleRun[]
}

export interface DashboardSummary {
  class_count: number
  template_ready: boolean
  assignment_count: number
  confirmed_count: number
  scheduled: number
  required: number
  remaining: number
  current_version_id: number | null
  current_version_name: string | null
  current_version_status: TimetableVersion["status"] | null
  current_version_is_stale: boolean
  current_version_quality_score: string | null
  current_version_hard_conflict_count: number
  current_version_soft_warning_count: number
  working_draft_id: number | null
  working_draft_name: string | null
  working_draft_is_stale: boolean
}

export interface SchedulingConstraint {
  id: number
  semester_id: number
  name: string
  kind: ConstraintKind
  category: string
  target_type: string | null
  target_id: number | null
  scope: Record<string, unknown>
  condition: Record<string, unknown> | null
  requirement: Record<string, unknown>
  weight: number | null
  source: "system" | "template" | "user"
  status: ConstraintStatus
  explanation: string | null
  created_at: string
  updated_at: string
}

export interface FixedPlacement {
  id: number
  semester_id: number
  teaching_assignment_id: number
  week_pattern: WeekPattern
  active_weeks: number[] | null
  weekday: number
  item_id: number
  room_id: number | null
  is_locked: boolean
  status: ResourceStatus
  teaching_assignment: TeachingAssignment
  item: Item
  room: Room | null
}

export interface ScheduleCandidateScore {
  course_distribution: number
  teacher_experience: number
  class_load: number
  session_spacing: number
  room_stability: number
  custom_rules: number
  core_course_priority: number
  stability: number
  same_course_same_day_repeats: number
  teacher_gaps: number
  consecutive_over_preference: number
  core_preferred_ratio: number
  changes_from_current: number
  class_daily_imbalance: number
  room_changes: number
  rule_results: Array<{
    constraint_id: number
    name: string
    category: string
    weight: number
    violations: number
    satisfied: boolean
  }>
}

export interface ScheduleCandidate {
  id: number
  schedule_run_id: number
  semester_id: number
  rank: number
  name: string
  quality_score: string | null
  score_breakdown: ScheduleCandidateScore & Record<string, unknown>
  hard_conflict_count: number
  soft_warning_count: number
  unscheduled_count: number
  created_at: string
}

export interface ScheduleRun {
  id: number
  semester_id: number
  status: ScheduleRunStatus
  scope: { type: "all" | "grade" | "class" | "assignment"; ids: number[] }
  preservation: { keep_locked: boolean; keep_current: boolean; base_version_id?: number | null }
  strategy: { profile: string; weights?: Record<string, number> }
  candidate_count: 1 | 3
  input_revision: number
  algorithm_version: string
  progress_stage: string
  progress_percent: number
  error_code: string | null
  error_message: string | null
  diagnostics: Record<string, unknown> | null
  created_at: string
  completed_at: string | null
  candidates?: ScheduleCandidate[]
  candidates_count?: number
}

export interface ScheduleCandidateEntry {
  id: number
  schedule_candidate_id: number
  teaching_assignment_id: number
  week_pattern: WeekPattern
  active_weeks: number[] | null
  weekday: number
  item_id: number
  actual_room_id: number
  is_locked: boolean
  teaching_assignment: TeachingAssignment
  actual_room: Room
  item: Item
}

export interface TimetableVersion {
  id: number
  semester_id: number
  version_no: number
  name: string
  status: "draft" | "active" | "historical"
  source: "manual" | "candidate" | "restored"
  source_candidate_id: number | null
  base_version_id: number | null
  input_revision: number
  catalog_revision: number | null
  quality_score: string | null
  score_breakdown: ScheduleCandidateScore | null
  hard_conflict_count: number
  soft_warning_count: number
  entries_count?: number
  created_at: string
  activated_at: string | null
}

export interface TimetableEntry {
  id: number
  timetable_version_id: number
  teaching_assignment_id: number
  school_class_id: number | null
  teaching_group_id: number | null
  teacher_id: number
  course_id: number
  actual_room_id: number
  week_pattern: WeekPattern
  active_weeks: number[] | null
  weekday: number
  item_id: number
  is_locked: boolean
  school_class: SchoolClass | null
  teaching_group: TeachingGroup | null
  school_classes: SchoolClass[]
  course: Course
  teacher: Teacher
  teachers: Teacher[]
  actual_room: Room
  item: Item
}

export interface DailyTimetableRow {
  key: string
  date: string
  week_number: number
  original_entry_id: number | null
  exception_id: number | null
  substitution_id: number | null
  substitution_ids: number[]
  substitution_notes: (string | null)[]
  item_id: number
  item_name: string
  item_sort_order: number
  start_time: string
  end_time: string
  course_id: number
  course_name: string
  target_name: string
  class_ids: number[]
  class_names: string[]
  primary_teacher_id: number
  teacher_id: number
  teacher_name: string
  teacher_ids: number[]
  teacher_names: string[]
  room_id: number
  room_name: string
  week_pattern: WeekPattern
  status:
    | "base"
    | "moved_out"
    | "moved_in"
    | "swap"
    | "teacher_change"
    | "room_change"
    | "cancel"
    | "makeup"
    | "activity"
    | "substitution"
  exception_type: CalendarExceptionType | null
  title: string | null
  note: string | null
  is_cancelled: boolean
}

export interface DailyTimetable {
  date: string
  weekday: number
  week_number: number
  version: TimetableVersion
  rows: DailyTimetableRow[]
  summary: {
    total: number
    temporary: number
    cancelled: number
    substitutions: number
  }
}

export interface CalendarException {
  id: number
  semester_id: number
  timetable_version_id: number
  effective_date: string
  replacement_date: string | null
  type: CalendarExceptionType
  original_entry_id: number | null
  related_entry_id: number | null
  replacement_assignment_id: number | null
  replacement_teacher_id: number | null
  replacement_room_id: number | null
  replacement_item_id: number | null
  title: string | null
  status: OperationalStatus
  reason: string
  created_at: string
  original_entry?: TimetableEntry | null
  related_entry?: TimetableEntry | null
  replacement_assignment?: TeachingAssignment | null
  replacement_teacher?: Teacher | null
  replacement_room?: Room | null
  replacement_item?: Item | null
  creator?: User
}

export interface CalendarExceptionPreview {
  allowed: boolean
  summary: string
  type: CalendarExceptionType
  effective_date: string
  replacement_date: string
  conflicts: Array<{ type: string; message: string; existing_entry_id?: number | null }>
  affected: Array<{
    entry_id: number | null
    date: string
    target: string | null
    course: string
    teacher: string
    room?: string
    item?: string
  }>
  notifications: string[]
  version_id: number
}

export interface TeacherLeave {
  id: number
  semester_id: number
  teacher_id: number
  starts_at: string
  ends_at: string
  type: "sick" | "personal" | "training" | "official" | "other"
  status: OperationalStatus
  reason: string | null
  includes_non_course_items: boolean
  created_at: string
  teacher: Teacher
  creator?: User
  substitutions_count?: number
  substitutions?: Substitution[]
}

export interface Substitution {
  id: number
  teacher_leave_id: number | null
  original_entry_id: number
  replaced_teacher_id: number | null
  effective_date: string
  replacement_teacher_id: number
  status: OperationalStatus
  reason: string | null
  original_entry?: TimetableEntry
  replaced_teacher?: Teacher | null
  replacement_teacher: Teacher
}

export interface TeacherLeavePreview {
  teacher: Teacher
  starts_at: string
  ends_at: string
  affected_count: number
  affected: DailyTimetableRow[]
}

export interface TeacherLeaveDetail {
  leave: TeacherLeave
  affected_count: number
  affected: DailyTimetableRow[]
}

export interface SubstituteRecommendation {
  teacher: Teacher
  score: number
  daily_load: number
  weekly_load: number
  consecutive_load: number
  historical_substitutions: number
  reasons: string[]
}

export interface ApiEnvelope<T> {
  data: T
  meta?: Record<string, unknown>
}
