import type { Page } from "@playwright/test"

const schoolClass = {
  id: 1,
  name: "七一班",
  code: "G7C1",
  grade_id: 1,
  status: "active",
  grade: { id: 1, name: "七年级" },
}
const teacher = { id: 1, name: "复核教师", employee_no: "REVIEW", is_active: true }
const course = { id: 1, name: "数学", short_name: "数", is_active: true }
const room = { id: 1, name: "101教室", is_active: true, type: "classroom" }
const item = {
  id: 1,
  name: "第1节",
  sort_order: 1,
  start_time: "08:00:00",
  end_time: "08:45:00",
  is_active: true,
  allows_course: true,
  counts_as_course: true,
  show_in_full: true,
  show_in_official: true,
}
const assignment = {
  id: 1,
  semester_id: 1,
  school_class_id: 1,
  teaching_group_id: null,
  teacher_id: 1,
  course_id: 1,
  weekly_items: 1,
  items_per_session: 1,
  week_pattern: "all",
  active_weeks: null,
  room_mode: "class_default",
  specified_room_id: null,
  status: "confirmed",
  allows_substitution: true,
  school_class: schoolClass,
  teaching_group: null,
  teacher,
  course,
  collaborators: [],
}
const score = {
  course_distribution: 90,
  teacher_experience: 90,
  class_load: 90,
  session_spacing: 90,
  room_stability: 90,
  custom_rules: 90,
  core_course_priority: 90,
  stability: 90,
  teacher_gaps: 0,
  same_course_same_day_repeats: 0,
  consecutive_over_preference: 0,
  class_daily_imbalance: 0,
  room_changes: 0,
  changes_from_current: 0,
  rule_results: [],
}
const candidate = {
  id: 1,
  rank: 1,
  name: "复核方案A",
  quality_score: 90,
  hard_conflict_count: 0,
  unscheduled_count: 0,
  soft_warning_count: 0,
  score_breakdown: score,
}
const entry = {
  id: 1,
  schedule_candidate_id: 1,
  teaching_assignment_id: 1,
  week_pattern: "all",
  active_weeks: null,
  weekday: 1,
  item_id: 1,
  actual_room_id: 1,
  is_locked: false,
  teaching_assignment: assignment,
  actual_room: room,
  item,
}
const run = {
  id: 1,
  semester_id: 1,
  status: "completed",
  input_revision: 1,
  progress_stage: "completed",
  progress_percent: 100,
  candidate_count: 1,
  strategy: { profile: "balanced" },
  scope: { type: "all", ids: [] },
  candidates: [candidate],
  created_at: "2026-09-07T00:00:00Z",
}
const semester = {
  id: 1,
  name: "上学期",
  status: "open",
  start_date: "2026-09-01",
  end_date: "2027-01-20",
  academic_year: { id: 1, name: "2026学年" },
}

export async function mockAdmin(page: Page) {
  const requests: URL[] = []
  const submittedRules: Array<Record<string, unknown>> = []
  await page.route("**/sanctum/csrf-cookie", (route) => route.fulfill({ status: 204 }))
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url())
    requests.push(url)
    let data: unknown = []
    if (url.pathname === "/api/v1/me")
      data = {
        id: 1,
        name: "复核管理员",
        email: "review@example.test",
        role: "admin",
        is_active: true,
        must_change_password: false,
      }
    else if (url.pathname.endsWith("/branding"))
      data = { system_name: "复核排课系统", system_tagline: null }
    else if (url.pathname.endsWith("/context"))
      data = { timezone: "Asia/Shanghai", current_semester: semester }
    else if (url.pathname.endsWith("/preparation-check"))
      data = { ready: true, summary: { required_entries: 1, blocking: 0 }, checks: [] }
    else if (url.pathname.endsWith("/schedule-runs/1")) data = run
    else if (url.pathname.endsWith("/schedule-runs")) data = [run]
    else if (url.pathname.endsWith("/schedule-template"))
      data = { id: 1, name: "标准作息", days: [{ weekday: 1, is_enabled: true }], items: [item] }
    else if (url.pathname.endsWith("/class-settings"))
      data = [{ id: 1, school_class_id: 1, status: "active", school_class: schoolClass }]
    else if (url.pathname.endsWith("/teaching-assignments")) data = [assignment]
    else if (url.pathname.endsWith("/candidates/1"))
      data = { candidate, entries: [entry], is_stale: false }
    else if (url.pathname.endsWith("/rooms")) data = [room]
    else if (url.pathname.endsWith("/teachers")) data = [teacher]
    else if (url.pathname.endsWith("/courses")) data = [course]
    else if (
      url.pathname.endsWith("/scheduling-constraints") &&
      route.request().method() === "POST"
    ) {
      const payload = route.request().postDataJSON() as Record<string, unknown>
      submittedRules.push(payload)
      data = { id: 1, status: "draft", ...payload }
    }
    await route.fulfill({
      json: {
        data,
        meta: {
          pagination: {
            page: 1,
            last_page: 1,
            total: Array.isArray(data) ? data.length : 1,
            per_page: 100,
          },
        },
      },
      headers: { ETag: '"review"' },
    })
  })
  return { requests, submittedRules }
}

export async function mockTeacher(page: Page) {
  const state = { cancelled: false, requests: 0 }
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === "/api/v1/me") {
      await route.fulfill({
        json: {
          data: {
            id: 1,
            name: teacher.name,
            email: "review@example.test",
            role: "teacher",
            teacher,
            is_active: true,
            must_change_password: false,
          },
        },
      })
      return
    }
    state.requests++
    const from = url.searchParams.get("from") ?? "2026-09-07"
    const to = url.searchParams.get("to") ?? "2026-09-13"
    const days = []
    for (
      let time = Date.parse(`${from}T00:00Z`);
      time <= Date.parse(`${to}T00:00Z`);
      time += 86_400_000
    ) {
      const date = new Date(time).toISOString().slice(0, 10)
      days.push({
        date,
        weekday: new Date(time).getUTCDay() || 7,
        week_number: 1,
        version: { id: 1, version_no: 1, name: "正式课表" },
        rows:
          date === "2026-09-07"
            ? [
                {
                  key: "entry:1",
                  date,
                  original_entry_id: 1,
                  item_id: 1,
                  item_name: item.name,
                  item_sort_order: 1,
                  start_time: item.start_time,
                  end_time: item.end_time,
                  course_name: course.name,
                  target_name: schoolClass.name,
                  class_names: [schoolClass.name],
                  teacher_ids: [1],
                  teacher_names: [teacher.name],
                  room_name: room.name,
                  status: state.cancelled ? "cancel" : "base",
                  exception_type: state.cancelled ? "cancel" : null,
                  title: null,
                  note: null,
                  is_cancelled: state.cancelled,
                  duty_status: state.cancelled ? "removed" : "assigned",
                },
              ]
            : [],
      })
    }
    await route.fulfill({
      json: {
        data: {
          teacher,
          semester,
          timezone: "Asia/Shanghai",
          from,
          to,
          ...(url.pathname.endsWith("/classes") ? { classes: [] } : { days }),
        },
      },
    })
  })
  return state
}
