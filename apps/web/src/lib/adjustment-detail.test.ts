import { describe, expect, it } from "vitest"
import { temporaryDetail, weeklyDetail } from "./adjustment-detail"
import type { CalendarException, TimetableEntry } from "./types"
import type { WeeklySnapshot } from "./long-term-changes"
const source = {
  id: 1,
  teacher_id: 3,
  course: { name: "语文" },
  school_classes: [{ name: "七1" }, { name: "七2" }],
  teacher: { id: 3, name: "王静" },
  teachers: [
    { id: 3, name: "王静" },
    { id: 4, name: "李静" },
  ],
  actual_room: { name: "101教室" },
  item: { name: "第7节", start_time: "16:00:00", end_time: "16:45:00" },
} as TimetableEntry
const other = {
  ...source,
  id: 2,
  item: { ...source.item, name: "第3节", start_time: "10:10:00", end_time: "10:55:00" },
}
const record = (type: CalendarException["type"], patch: Partial<CalendarException> = {}) =>
  ({
    id: 1,
    type,
    effective_date: "2026-09-14",
    replacement_date: "2026-09-18",
    original_entry: source,
    related_entry: other,
    replacement_item: other.item,
    status: "active",
    ...patch,
  }) as CalendarException
const weekly = (patch: Partial<WeeklySnapshot> = {}): WeeklySnapshot => ({
  entry_key: "a",
  date: "2026-09-14",
  effective_from: "2026-09-14",
  effective_to: "2026-10-30",
  recurrence_label: "每周 · 周一",
  weekday: 1,
  item_id: 7,
  item_name: "第7节",
  course_id: 1,
  course_name: "语文",
  target_name: "七1",
  class_ids: [1],
  teacher_id: 3,
  teacher_ids: [3, 4],
  teacher_names: ["王静", "李静"],
  room_id: 1,
  room_name: "101教室",
  ...patch,
})
describe("adjustment detail presentation", () => {
  it("also shows resource overrides attached to a time move", () => {
    const detail = temporaryDetail(
      record("move", {
        replacement_teacher_id: 8,
        replacement_teacher: { name: "张静" } as CalendarException["replacement_teacher"],
        replacement_room_id: 10,
        replacement_room: { name: "图书馆" } as CalendarException["replacement_room"],
      }),
    )
    expect(detail.rows[0].after.meta).toContain("张静")
    expect(detail.rows[0].after.meta).toContain("图书馆")
    expect(detail.note).toBeUndefined()
  })

  it("shows both directions even when the exchanged courses have identical names", () => {
    const detail = temporaryDetail(record("swap"))
    expect(detail.rows).toHaveLength(2)
    expect(detail.rows[0].title).toBe("语文 · 七1、七2")
    expect(detail.rows[0].after).toEqual(detail.rows[1].before)
    expect(detail.rows[1].after).toEqual(detail.rows[0].before)
    expect(detail.rows[0].before.meta).toBe("16:00–16:45")
    expect(detail.rows[0].after.secondary).toContain("9/18")
  })
  it("keeps same-day swaps on the original date when no replacement date is recorded", () => {
    const detail = temporaryDetail(record("swap", { replacement_date: null }))
    expect(detail.rows).toHaveLength(2)
    for (const row of detail.rows) {
      expect(row.before.secondary).toContain("9/14")
      expect(row.after.secondary).toContain("9/14")
    }
  })
  it("shows the changed primary teacher and preserves collaborating teachers as context", () => {
    const detail = temporaryDetail(
      record("teacher_change", {
        replacement_teacher: { name: "张静" } as CalendarException["replacement_teacher"],
      }),
    )
    expect(detail.rows[0].before.primary).toBe("王静")
    expect(detail.rows[0].after.primary).toBe("张静")
    expect(detail.note).toContain("李静（不变）")
  })
  it.each(["cancel", "activity"] as const)("does not assign original resources to %s", (type) => {
    const detail = temporaryDetail(record(type, { title: "消防演练" }))
    expect(JSON.stringify(detail.rows[0].after)).not.toContain("王静")
    expect(JSON.stringify(detail.rows[0].after)).not.toContain("101教室")
    expect(detail.caution).toBe(true)
  })
  it("shows added course resources without inventing an original lesson", () => {
    const detail = temporaryDetail(
      record("makeup", {
        original_entry: null,
        replacement_assignment: {
          course: { name: "语文" },
          school_class: { name: "七1" },
          teacher: { name: "王静" },
          collaborators: [{ name: "李静" }],
        } as CalendarException["replacement_assignment"],
        replacement_teacher: { name: "张静" } as CalendarException["replacement_teacher"],
        replacement_room: { name: "图书馆" } as CalendarException["replacement_room"],
      }),
    )
    expect(detail.rows[0].before.primary).toBe("无课")
    expect(detail.rows[0].after.secondary).toBe("张静、李静")
    expect(detail.rows[0].after.meta).toBe("图书馆")
  })
  it("distinguishes reciprocal weekly swaps from unrelated time moves", () => {
    const a = weekly(),
      b = weekly({
        entry_key: "b",
        weekday: 2,
        recurrence_label: "每周 · 周二",
        item_id: 3,
        item_name: "第3节",
      })
    const changes = [
      { before: a, after: { ...a, weekday: 2, item_id: 3 } },
      { before: b, after: { ...b, weekday: 1, item_id: 7 } },
    ]
    expect(weeklyDetail(changes).type).toBe("换课")
    expect(weeklyDetail([changes[0], { ...changes[1], after: { ...b, weekday: 3 } }]).type).toBe(
      "改时间",
    )
    expect(
      weeklyDetail([changes[0], { ...changes[1], before: { ...b, effective_from: "2026-09-21" } }])
        .type,
    ).toBe("改时间")
  })
  it("does not hide additional fields or effective intervals in a mixed recurring adjustment", () => {
    const a = weekly(),
      b = weekly({ effective_from: "2026-09-21", room_id: 2, room_name: "图书馆" })
    const detail = weeklyDetail([
      {
        before: a,
        after: {
          ...a,
          weekday: 2,
          teacher_id: 6,
          teacher_ids: [6, 4],
          teacher_names: ["张静", "李静"],
        },
      },
      { before: b, after: { ...b, weekday: 2 } },
    ])
    expect(detail.type).toBe("组合调整")
    expect(detail.rows).toHaveLength(2)
    expect(detail.rows[0].after.secondary).toContain("张静")
    expect(detail.rows[1].before.meta).toBe("图书馆")
    expect(detail.rows[1].period).toContain("2026-09-21")
    expect(detail.rows[0].id).not.toBe(detail.rows[1].id)
  })
})
