export interface TeacherIdentity {
  id: number
  name: string
  employee_no: string | null
}

export interface User {
  id: number
  name: string
  email: string
  role: "admin" | "scheduler" | "viewer" | "teacher"
  teacher: TeacherIdentity | null
  is_active: boolean
  must_change_password: boolean
}

export interface TimetableRow {
  key: string
  date: string
  original_entry_id: number | null
  item_id: number
  item_name: string
  item_sort_order: number
  start_time: string
  end_time: string
  course_name: string
  target_name: string
  class_names: string[]
  teacher_ids: number[]
  teacher_names: string[]
  room_name: string
  status: string
  exception_type: string | null
  title: string | null
  note: string | null
  is_cancelled: boolean
  duty_status?: "assigned" | "added" | "removed"
}

export interface TimetableDay {
  date: string
  weekday: number
  week_number: number
  version: { id: number; version_no: number; name: string }
  rows: TimetableRow[]
}

export interface TeacherClass {
  id: number
  name: string
  code: string | null
  grade: { id: number; name: string }
  accessible_dates: string[]
}

export interface TeacherClasses {
  teacher: TeacherIdentity
  semester: TeacherTimetable["semester"]
  timezone: string
  from: string
  to: string
  classes: TeacherClass[]
}

export interface TeacherClassTimetable {
  teacher: TeacherIdentity
  semester: TeacherTimetable["semester"]
  school_class: Omit<TeacherClass, "accessible_dates">
  timezone: string
  from: string
  to: string
  days: Array<TimetableDay & { accessible: boolean }>
}

export interface TeacherTimetable {
  teacher: TeacherIdentity
  semester: {
    id: number
    name: string
    start_date: string
    end_date: string
    academic_year: { id: number; name: string } | null
  }
  timezone: string
  from: string
  to: string
  days: TimetableDay[]
}
