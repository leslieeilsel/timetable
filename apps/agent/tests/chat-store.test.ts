import { afterEach, describe, expect, it } from "vitest"
import { randomUUID } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { DatabaseSync } from "node:sqlite"
import type { ChatInput, ChatQuestion, ChatProposal } from "@timetable/agent-contracts"
import { ChatStore } from "../src/chat-store.ts"

const stores: ChatStore[] = []
afterEach(() => {
  for (const store of stores.splice(0)) store.close()
})
const store = () => {
  const value = new ChatStore(":memory:")
  stores.push(value)
  return value
}
const input = (revision = 0, text = "解释硬约束"): ChatInput => ({
  message_id: randomUUID(),
  revision,
  text,
})
const proposal = (): ChatProposal => ({
  id: randomUUID(),
  semester_id: 1,
  status: "pending",
  preview: {
    constraints: [
      {
        name: "每日上限",
        kind: "hard",
        category: "daily_load",
        target_type: "teacher",
        target_id: 1,
        scope: {},
        condition: {},
        requirement: { max_items_per_day: 4 },
        weight: null,
        explanation: null,
      },
    ],
    summaries: ["李老师每日最多 4 节"],
    etag: '"semester-1-timetable-1-catalog-1"',
  },
})

describe("private durable conversation state", () => {
  it("keeps title edits independent from chat revisions and ignores superseded AI results", () => {
    const db = store()
    const chat = db.create(1, null)
    const turn = db.begin(1, chat.id, input())
    db.finish(chat.id, turn.seq, turn.assistant, [], true)
    const pending = db.beginTitle(1, chat.id)
    expect(() => db.rename(2, chat.id, "别人的标题")).toThrowError(/无权/)
    expect(() => db.beginTitle(2, chat.id)).toThrowError(/无权/)
    const updated = db.rename(1, chat.id, "手动名称")
    expect(updated).toMatchObject({ title: "手动名称", revision: 1, title_generating: false })
    expect(() => db.finishTitle(1, chat.id, pending.requestId, "迟到的标题")).toThrowError(/未覆盖/)
    expect(db.get(1, chat.id).title).toBe("手动名称")
    const next = db.begin(1, chat.id, input(1))
    expect(next.firstTurn).toBe(false)
  })
  it("soft-deletes without erasing turns and blocks access through old conversation URLs", () => {
    const directory = mkdtempSync(join(tmpdir(), "timetable-deleted-chat-"))
    const path = join(directory, "chat.sqlite")
    const db = new ChatStore(path)
    const audit = new DatabaseSync(path)
    try {
      const chat = db.create(1, null)
      const turn = db.begin(1, chat.id, input())
      const pending = db.beginTitle(1, chat.id)
      expect(() => db.softDelete(2, chat.id)).toThrowError(/无权/)
      db.softDelete(1, chat.id)
      db.softDelete(1, chat.id)
      // Finishing a cancelled stream must not make a deleted conversation visible again.
      db.finish(chat.id, turn.seq, turn.assistant, [], false)
      expect(db.list(1)).toEqual([])
      expect(() => db.detail(1, chat.id)).toThrowError(/不存在/)
      expect(() => db.history(1, chat.id)).toThrowError(/不存在/)
      expect(() => db.begin(1, chat.id, input(1))).toThrowError(/不存在/)
      expect(() => db.rename(1, chat.id, "名称")).toThrowError(/不存在/)
      expect(() => db.finishTitle(1, chat.id, pending.requestId, "AI 名称")).toThrowError(/不存在/)
      expect(
        audit.prepare("SELECT deleted_at FROM conversations WHERE id=?").get(chat.id),
      ).toMatchObject({ deleted_at: expect.any(String) })
      expect(
        audit.prepare("SELECT COUNT(*) AS total FROM turns WHERE conversation_id=?").get(chat.id),
      ).toMatchObject({ total: 1 })
    } finally {
      audit.close()
      db.close()
      rmSync(directory, { recursive: true })
    }
  })
  it("migrates pre-title databases in place and clears interrupted title jobs after restart", () => {
    const directory = mkdtempSync(join(tmpdir(), "timetable-title-migration-"))
    const path = join(directory, "chat.sqlite")
    const legacy = new DatabaseSync(path)
    const id = randomUUID()
    legacy.exec(
      "CREATE TABLE conversations (id TEXT PRIMARY KEY, owner INTEGER NOT NULL, title TEXT NOT NULL, semester_id INTEGER, revision INTEGER NOT NULL DEFAULT 0, busy INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)",
    )
    legacy
      .prepare("INSERT INTO conversations(id,owner,title,updated_at) VALUES(?,?,?,?)")
      .run(id, 1, "旧对话", new Date().toISOString())
    legacy.close()
    const upgraded = new ChatStore(path)
    const turn = upgraded.begin(1, id, input())
    upgraded.finish(id, turn.seq, turn.assistant, [], true)
    upgraded.beginTitle(1, id)
    upgraded.close()
    const restored = new ChatStore(path)
    try {
      expect(restored.detail(1, id)).toMatchObject({
        title: "解释硬约束",
        title_generating: false,
        revision: 1,
      })
      expect(restored.detail(1, id).messages).toHaveLength(2)
    } finally {
      restored.close()
      rmSync(directory, { recursive: true })
    }
  })
  it("isolates owners, rejects stale revisions and duplicate/concurrent turns", () => {
    const db = store()
    const chat = db.create(1, null)
    const request = input()
    expect(db.list(2)).toEqual([])
    expect(() => db.detail(2, chat.id)).toThrowError(/无权/)
    const turn = db.begin(1, chat.id, request)
    expect(() => db.begin(1, chat.id, input(1))).toThrowError(/正在处理/)
    turn.assistant.parts = [{ type: "text", text: "这是必须满足的条件。" }]
    db.finish(chat.id, turn.seq, turn.assistant, [], true)
    expect(() => db.begin(1, chat.id, input())).toThrowError(/已更新/)
    expect(() => db.begin(1, chat.id, { ...request, revision: 1 })).toThrowError(/已接收/)
    expect(db.detail(1, chat.id).messages).toHaveLength(2)
    expect(db.list(1)[0]?.title).toBe("解释硬约束")
  })
  it("validates structured answers against the saved question and consumes them once", () => {
    const db = store()
    const chat = db.create(1, 1)
    const turn = db.begin(1, chat.id, input())
    const question: ChatQuestion = {
      id: randomUUID(),
      status: "pending",
      items: [
        {
          id: "teacher",
          prompt: "哪位教师？",
          choices: [{ value: "teacher-4", label: "李明 · 004" }],
          multiple: false,
          allow_text: false,
        },
      ],
    }
    turn.assistant.parts = [{ type: "data-question", data: question }]
    db.finish(chat.id, turn.seq, turn.assistant, [], true)
    expect(() =>
      db.begin(1, chat.id, {
        ...input(1),
        answer: { question_id: question.id, values: { teacher: ["forged-99"] } },
      }),
    ).toThrowError(/有效答案/)
    const second = db.begin(1, chat.id, {
      ...input(1, "客户端伪造回答"),
      answer: { question_id: question.id, values: { teacher: ["teacher-4"] } },
    })
    expect(second.prompt).toBe("哪位教师？：李明 · 004")
    db.finish(chat.id, second.seq, second.assistant, [], true)
    expect(db.detail(1, chat.id).messages[1]?.parts[0]).toMatchObject({
      data: { status: "answered" },
    })
    expect(() =>
      db.begin(1, chat.id, {
        ...input(2),
        answer: { question_id: question.id, values: { teacher: ["teacher-4"] } },
      }),
    ).toThrowError(/问题已结束/)
  })
  it("expires old proposals on a new request and recovers uncertain confirmations with the same action", () => {
    const db = store()
    const chat = db.create(1, 1)
    const turn = db.begin(1, chat.id, input())
    const first = proposal()
    turn.assistant.parts = [{ type: "data-proposal", data: first }]
    db.finish(chat.id, turn.seq, turn.assistant, [], true)
    const second = db.begin(1, chat.id, input(1, "改成每天 5 节"))
    expect(() => db.lockAction(1, chat.id, first.id)).toThrowError(/等待/)
    const next = proposal()
    second.assistant.parts = [{ type: "data-proposal", data: next }]
    db.finish(chat.id, second.seq, second.assistant, [], true)
    expect(() => db.lockAction(1, chat.id, first.id)).toThrowError(/失效/)
    expect(() => db.lockAction(2, chat.id, next.id)).toThrowError(/无权/)
    db.lockAction(1, chat.id, next.id)
    db.finishAction(chat.id, next.id, "confirming")
    expect(() => db.begin(1, chat.id, input(2))).toThrowError(/先在原规则卡片/)
    expect(db.lockAction(1, chat.id, next.id).id).toBe(next.id)
    db.finishAction(chat.id, next.id, "saved", 1)
    expect(db.detail(1, chat.id).messages[3]?.parts[0]).toMatchObject({
      data: { status: "saved", saved_count: 1 },
    })
  })
  it("restores checkpointed partial text after a restart without an executable action", () => {
    const directory = mkdtempSync(join(tmpdir(), "timetable-chat-"))
    const path = join(directory, "chat.sqlite")
    const first = new ChatStore(path)
    const chat = first.create(1, null)
    const turn = first.begin(1, chat.id, input())
    turn.assistant.parts = [{ type: "text", text: "部分回答" }]
    first.checkpoint(turn.seq, turn.assistant)
    first.close()
    const second = new ChatStore(path)
    try {
      expect(second.detail(1, chat.id)).toMatchObject({
        busy: false,
        messages: [
          { role: "user" },
          { metadata: { status: "interrupted" }, parts: [{ text: "部分回答" }] },
        ],
      })
      expect(second.history(1, chat.id)[0]).toMatchObject({ role: "user" })
    } finally {
      second.close()
      rmSync(directory, { recursive: true })
    }
  })
  it("paginates history and bounds context by complete turns without orphaning tool results", () => {
    const db = store()
    const chat = db.create(1, null)
    for (let i = 0; i < 33; i++) {
      const turn = db.begin(1, chat.id, input(i, `问题 ${i}`))
      db.finish(
        chat.id,
        turn.seq,
        turn.assistant,
        [{ role: "user", content: `问题 ${i}`, timestamp: i }],
        true,
      )
    }
    const latest = db.detail(1, chat.id)
    expect(latest.messages).toHaveLength(60)
    expect(latest.has_earlier).toBe(true)
    expect(db.detail(1, chat.id, latest.before!).messages).toHaveLength(6)
    expect(db.history(1, chat.id)).toHaveLength(20)
  })
})
