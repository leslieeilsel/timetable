import { describe, expect, it } from "vitest"

import { lessonStartHint, lessonTiming, parseSemesterDate, rowStatus } from "@/lib/timetable"
import type { TimetableRow } from "@/lib/types"

const baseRow: TimetableRow = {
  key: "row-1",
  date: "2026-09-02",
  original_entry_id: 1,
  item_id: 1,
  item_name: "第一节",
  item_sort_order: 1,
  start_time: "08:00:00",
  end_time: "08:45:00",
  course_name: "语文",
  target_name: "七年级一班",
  class_names: ["七年级一班"],
  teacher_ids: [1],
  teacher_names: ["张老师"],
  room_name: "101",
  status: "base",
  exception_type: null,
  title: null,
  note: null,
  is_cancelled: false,
  duty_status: "assigned",
}

describe("teacher date selection", () => {
  it.each(["", "2026-09", "2026-02-30", "2025-12-31", "2027-01-01"])(
    "rejects incomplete, invalid and out-of-semester input %s",
    (value) => {
      expect(parseSemesterDate(value, "2026-01-01", "2026-12-31")).toBeNull()
    },
  )

  it("accepts valid dates including both semester boundaries", () => {
    for (const value of ["2026-09-07", "2026-09-12", "2026-10-30"]) {
      expect(parseSemesterDate(value, "2026-09-07", "2026-10-30")).toEqual(
        new Date(`${value}T00:00:00`),
      )
    }
  })
})

describe("teacher timetable row status", () => {
  it("keeps an unchanged lesson unlabelled", () => {
    expect(rowStatus(baseRow)).toBeNull()
  })

  it("makes a replacement duty explicit", () => {
    expect(rowStatus({ ...baseRow, duty_status: "added", status: "substitution" })).toEqual({
      label: "临时代课",
      variant: "secondary",
    })
  })

  it("shows when the teacher no longer needs to attend", () => {
    expect(rowStatus({ ...baseRow, duty_status: "removed", status: "teacher_change" })).toEqual({
      label: "已调出",
      variant: "destructive",
    })
  })
})

describe("teacher timetable time copy", () => {
  it("shows a concrete time instead of a large minute count", () => {
    const row = {
      ...baseRow,
      date: "2026-09-03",
      start_time: "16:00:00",
      end_time: "16:45:00",
    }

    expect(lessonStartHint(row, new Date("2026-09-03T09:08:00"))).toBe("今天下午")
  })

  it("keeps short countdowns easy to scan", () => {
    const row = {
      ...baseRow,
      date: "2026-09-03",
      start_time: "09:30:00",
      end_time: "10:15:00",
    }

    expect(lessonStartHint(row, new Date("2026-09-03T09:08:00"))).toBe("22分钟后")
  })

  it("distinguishes ongoing and completed lessons", () => {
    const row = {
      ...baseRow,
      date: "2026-09-03",
      start_time: "08:00:00",
      end_time: "08:45:00",
    }

    expect(lessonTiming(row, new Date("2026-09-03T08:20:00"))).toBe("ongoing")
    expect(lessonTiming(row, new Date("2026-09-03T09:08:00"))).toBe("completed")
  })
})
