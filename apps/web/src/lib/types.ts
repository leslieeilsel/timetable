export type Role = "admin" | "scheduler" | "viewer"
export type LifecycleStatus = "draft" | "open" | "closed"
export type ResourceStatus = "active" | "inactive"
export type TaskStatus = "draft" | "confirmed" | "inactive"

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

export interface TeachingTask {
  id: number
  semester_id: number
  school_class_id: number
  course_id: number
  teacher_id: number
  weekly_items: number
  room_mode: "class_default" | "specified"
  specified_room_id: number | null
  status: TaskStatus
  scheduled?: number
  remaining?: number
  completed?: boolean
  school_class: SchoolClass
  course: Course
  teacher: Teacher
  specified_room: Room | null
}

export interface TimetableEntry {
  id: number
  teaching_task_id: number
  school_class_id: number
  teacher_id: number
  course_id: number
  actual_room_id: number
  weekday: number
  item_id: number
  is_locked: boolean
  school_class: SchoolClass
  course: Course
  teacher: Teacher
  actual_room: Room
  item: Item
}

export interface ApiEnvelope<T> {
  data: T
  meta?: Record<string, string | number>
}
