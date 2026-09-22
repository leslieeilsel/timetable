import { DatabaseSync } from "node:sqlite"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { randomUUID } from "node:crypto"
import type { AgentMessage } from "@earendil-works/pi-agent-core"
import type {
  ChatInput,
  ChatMessage,
  ChatProposal,
  ChatQuestion,
  Conversation,
  ConversationDetail,
} from "@timetable/agent-contracts"
import { AgentError } from "./errors.ts"
import { restoreTextPhases } from "./chat-text.ts"
import { conversationTitleSchema } from "@timetable/agent-contracts"
import type { ChatDiagnostics, ChatRunRecord } from "./chat-record.ts"
import { omitHistoricalThinking, replayChatTranscript } from "./chat-history.ts"

interface ConversationRow {
  id: string
  owner: number
  title: string
  semester_id: number | null
  revision: number
  busy: number
  updated_at: string
  deleted_at: string | null
  title_request: string | null
}
interface TurnRow {
  seq: number
  request_id: string
  user_json: string
  assistant_json: string
  transcript_json: string
  status: string
}
interface ActionRow {
  id: string
  conversation_id: string
  payload: string
  status: ChatProposal["status"]
  saved_count: number | null
}
const parse = <T>(text: string): T => JSON.parse(text) as T
const missing = () => new AgentError("NOT_FOUND", "对话不存在或无权访问。", 404)

/** Single-process SQLite repository. Only authenticated actor IDs enter this boundary. */
export class ChatStore {
  private db: DatabaseSync
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    this.db = new DatabaseSync(path)
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY, owner INTEGER NOT NULL, title TEXT NOT NULL, semester_id INTEGER,
        revision INTEGER NOT NULL DEFAULT 0, busy INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS conversations_owner ON conversations(owner, updated_at);
      CREATE TABLE IF NOT EXISTS turns (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        request_id TEXT NOT NULL, user_json TEXT NOT NULL, assistant_json TEXT NOT NULL,
        transcript_json TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL,
        UNIQUE(conversation_id, request_id));
      CREATE TABLE IF NOT EXISTS actions (
        id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        payload TEXT NOT NULL, status TEXT NOT NULL, saved_count INTEGER);
      UPDATE turns SET status='interrupted' WHERE status='running';
      UPDATE conversations SET busy=0;
    `)
    // Upgrade existing local databases without replacing their conversations.
    const columns = new Set(
      (this.db.prepare("PRAGMA table_info(conversations)").all() as { name: string }[]).map(
        (column) => column.name,
      ),
    )
    for (const name of ["deleted_at", "title_request"])
      if (!columns.has(name)) this.db.exec(`ALTER TABLE conversations ADD COLUMN ${name} TEXT`)
    const turnColumns = this.db.prepare("PRAGMA table_info(turns)").all() as { name: string }[]
    if (!turnColumns.some((column) => column.name === "diagnostics_json"))
      this.db.exec("ALTER TABLE turns ADD COLUMN diagnostics_json TEXT")
    const interrupted = this.db
      .prepare(
        "SELECT seq,assistant_json,diagnostics_json FROM turns WHERE status='interrupted' AND json_extract(diagnostics_json,'$.status')='running'",
      )
      .all() as { seq: number; assistant_json: string; diagnostics_json: string }[]
    for (const row of interrupted) {
      const diagnostics = parse<ChatDiagnostics>(row.diagnostics_json)
      diagnostics.status = "interrupted"
      diagnostics.error_code = "AGENT_RESTARTED"
      for (const tool of diagnostics.tools)
        if (tool.status === "running") tool.status = "interrupted"
      const assistant = parse<ChatMessage>(row.assistant_json)
      assistant.metadata = {
        ...assistant.metadata,
        status: "interrupted",
        error_code: "AGENT_RESTARTED",
        error: "服务重启导致回答中断，可以继续提问或重试。",
      }
      // No invented completion time or token count for a killed request.
      this.db
        .prepare("UPDATE turns SET assistant_json=?,diagnostics_json=? WHERE seq=?")
        .run(JSON.stringify(assistant), JSON.stringify(diagnostics), row.seq)
    }
    // In-flight title requests cannot survive a process restart; keep the last title.
    this.db.exec("UPDATE conversations SET title_request=NULL WHERE title_request IS NOT NULL")
  }
  close() {
    this.db.close()
  }
  private transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE")
    try {
      const result = work()
      this.db.exec("COMMIT")
      return result
    } catch (error) {
      this.db.exec("ROLLBACK")
      throw error
    }
  }
  private row(owner: number, id: string): ConversationRow {
    const row = this.db
      .prepare("SELECT * FROM conversations WHERE id=? AND owner=? AND deleted_at IS NULL")
      .get(id, owner) as unknown as ConversationRow | undefined
    if (!row) throw missing()
    return row
  }
  private summary(row: ConversationRow): Conversation {
    return {
      id: row.id,
      title: row.title,
      title_generating: row.title_request !== null,
      semester_id: row.semester_id,
      revision: row.revision,
      busy: !!row.busy,
      updated_at: row.updated_at,
    }
  }
  list(owner: number, offset = 0) {
    return (
      this.db
        .prepare(
          "SELECT * FROM conversations WHERE owner=? AND deleted_at IS NULL AND revision>0 ORDER BY updated_at DESC, id DESC LIMIT 50 OFFSET ?",
        )
        .all(owner, offset) as unknown as ConversationRow[]
    ).map((row) => this.summary(row))
  }
  get(owner: number, id: string): Conversation {
    return this.summary(this.row(owner, id))
  }
  create(owner: number, semesterId: number | null) {
    const id = randomUUID()
    this.db
      .prepare("INSERT INTO conversations(id,owner,title,semester_id,updated_at) VALUES(?,?,?,?,?)")
      .run(id, owner, "新对话", semesterId, new Date().toISOString())
    return this.detail(owner, id)
  }
  rename(owner: number, id: string, title: string): Conversation {
    this.row(owner, id)
    const value = conversationTitleSchema.parse(title)
    this.db
      .prepare(
        "UPDATE conversations SET title=?,title_request=NULL WHERE id=? AND owner=? AND deleted_at IS NULL",
      )
      .run(value, id, owner)
    return this.summary(this.row(owner, id))
  }
  softDelete(owner: number, id: string) {
    this.transaction(() => {
      // Repeated deletion is harmless, but never expose another owner's record.
      const row = this.db
        .prepare("SELECT owner FROM conversations WHERE id=? AND owner=?")
        .get(id, owner)
      if (!row) throw missing()
      if (
        this.db
          .prepare("SELECT id FROM actions WHERE conversation_id=? AND status='confirming'")
          .get(id)
      )
        throw new AgentError(
          "CONFIRMATION_PENDING",
          "请先在规则卡片确认上次保存的结果，再删除对话。",
          409,
        )
      this.db
        .prepare(
          "UPDATE conversations SET deleted_at=COALESCE(deleted_at,?),title_request=NULL WHERE id=? AND owner=?",
        )
        .run(new Date().toISOString(), id, owner)
    })
  }
  titlePrompts(owner: number, id: string): string[] {
    this.row(owner, id)
    const first = this.db
      .prepare("SELECT seq,user_json FROM turns WHERE conversation_id=? ORDER BY seq LIMIT 1")
      .get(id) as Pick<TurnRow, "seq" | "user_json"> | undefined
    if (!first) throw new AgentError("CHAT_EMPTY", "发送消息后才能生成标题。", 422)
    const recent = this.db
      .prepare(
        "SELECT seq,user_json FROM turns WHERE conversation_id=? AND seq>? ORDER BY seq DESC LIMIT 4",
      )
      .all(id, first.seq) as Pick<TurnRow, "seq" | "user_json">[]
    // Only user-visible requests are needed to name a conversation. Never send
    // database IDs, tool payloads or model reasoning to the title model.
    return [first, ...recent.reverse()].map((turn) =>
      parse<ChatMessage>(turn.user_json)
        .parts.filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n")
        .slice(0, 1200),
    )
  }
  beginTitle(owner: number, id: string) {
    return this.transaction(() => {
      const row = this.row(owner, id)
      if (row.title_request) throw new AgentError("TITLE_BUSY", "正在生成标题，请稍候。", 409)
      const prompts = this.titlePrompts(owner, id)
      const requestId = randomUUID()
      this.db.prepare("UPDATE conversations SET title_request=? WHERE id=?").run(requestId, id)
      return { requestId, prompts }
    })
  }
  finishTitle(owner: number, id: string, requestId: string, title: string): Conversation {
    const value = conversationTitleSchema.parse(title)
    const result = this.db
      .prepare(
        "UPDATE conversations SET title=?,title_request=NULL WHERE id=? AND owner=? AND deleted_at IS NULL AND title_request=?",
      )
      .run(value, id, owner, requestId)
    const row = this.row(owner, id)
    if (!result.changes)
      throw new AgentError("TITLE_CHANGED", "标题已被更新，本次生成结果未覆盖新标题。", 409)
    return this.summary(row)
  }
  cancelTitle(id: string, requestId: string) {
    this.db
      .prepare("UPDATE conversations SET title_request=NULL WHERE id=? AND title_request=?")
      .run(id, requestId)
  }
  detail(owner: number, id: string, before?: number): ConversationDetail {
    const row = this.row(owner, id)
    const turns = this.db
      .prepare("SELECT * FROM turns WHERE conversation_id=? AND seq<? ORDER BY seq DESC LIMIT 31")
      .all(id, before ?? Number.MAX_SAFE_INTEGER) as unknown as TurnRow[]
    const hasEarlier = turns.length > 30
    const page = turns.slice(0, 30).reverse()
    const messages = page.flatMap((turn) => {
      const user = parse<ChatMessage>(turn.user_json)
      const assistant = parse<ChatMessage>(turn.assistant_json)
      let transcript: AgentMessage[] | undefined
      const readTranscript = () => (transcript ??= parse<AgentMessage[]>(turn.transcript_json))
      assistant.metadata = {
        ...assistant.metadata,
        status: turn.status as "complete" | "interrupted" | "running",
      }
      // Sent timestamps saved by the server can recover timing for older turns.
      // Do this before the pi fallback below: model timestamps are not completion times.
      assistant.metadata.started_at ??= user.metadata?.sent_at
      const startedAt = Date.parse(assistant.metadata.started_at ?? "")
      const finishedAt = Date.parse(assistant.metadata.sent_at ?? "")
      if (
        turn.status !== "running" &&
        assistant.metadata.duration_ms === undefined &&
        Number.isFinite(startedAt) &&
        Number.isFinite(finishedAt)
      ) {
        assistant.metadata.duration_ms = Math.max(0, finishedAt - startedAt)
      }
      // Older messages can use the original pi timestamps. Never substitute the
      // current time for historical messages that have no recorded timestamp.
      if (!user.metadata?.sent_at || !assistant.metadata.sent_at) {
        const transcript = readTranscript()
        for (const message of [user, assistant]) {
          if (message.metadata?.sent_at) continue
          const timestamp =
            message.role === "user"
              ? transcript.find((entry) => entry.role === "user")?.timestamp
              : transcript.findLast((entry) => entry.role === "assistant")?.timestamp
          if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) continue
          const date = new Date(timestamp)
          if (Number.isNaN(date.getTime())) continue
          message.metadata = {
            status: "complete",
            ...message.metadata,
            sent_at: date.toISOString(),
          }
        }
      }
      if (
        turn.status === "complete" &&
        !assistant.parts.some((part) => part.type === "data-text-phase")
      )
        restoreTextPhases(assistant, readTranscript())
      assistant.parts = assistant.parts.map((part) => {
        if (part.type !== "data-proposal") return part
        const action = this.action(owner, id, part.data.id)
        return { ...part, data: action }
      })
      return [user, assistant]
    })
    return { ...this.summary(row), messages, has_earlier: hasEarlier, before: page[0]?.seq ?? null }
  }
  private pendingQuestion(id: string): ChatQuestion | undefined {
    const row = this.db
      .prepare(
        "SELECT assistant_json FROM turns WHERE conversation_id=? AND status='complete' ORDER BY seq DESC LIMIT 1",
      )
      .get(id) as { assistant_json: string } | undefined
    const part = row
      ? parse<ChatMessage>(row.assistant_json).parts.find(
          (part) => part.type === "data-question" && part.data.status === "pending",
        )
      : undefined
    return part?.type === "data-question" ? part.data : undefined
  }
  private expireQuestions(id: string, answered?: string) {
    const rows = this.db
      .prepare("SELECT seq,assistant_json FROM turns WHERE conversation_id=?")
      .all(id) as unknown as Pick<TurnRow, "seq" | "assistant_json">[]
    for (const row of rows) {
      const message = parse<ChatMessage>(row.assistant_json)
      let changed = false
      for (const part of message.parts)
        if (part.type === "data-question" && part.data.status === "pending") {
          part.data.status = part.data.id === answered ? "answered" : "cancelled"
          changed = true
        }
      if (changed)
        this.db
          .prepare("UPDATE turns SET assistant_json=? WHERE seq=?")
          .run(JSON.stringify(message), row.seq)
    }
  }
  begin(owner: number, id: string, input: ChatInput) {
    return this.transaction(() => {
      const row = this.row(owner, id)
      if (row.busy) throw new AgentError("CHAT_BUSY", "这段对话正在处理，请稍候再试。", 409)
      if (
        this.db
          .prepare("SELECT id FROM actions WHERE conversation_id=? AND status='confirming'")
          .get(id)
      )
        throw new AgentError(
          "CONFIRMATION_PENDING",
          "上次保存的结果尚待确认，请先在原规则卡片重试保存。",
          409,
        )
      if (row.revision !== input.revision)
        throw new AgentError("CHAT_CHANGED", "对话已更新，请刷新后继续。", 409)
      if (
        this.db
          .prepare("SELECT seq FROM turns WHERE conversation_id=? AND request_id=?")
          .get(id, input.message_id)
      )
        throw new AgentError("MESSAGE_EXISTS", "消息已接收，请刷新查看结果。", 409)
      let prompt = input.text
      if (input.answer) {
        const question = this.pendingQuestion(id)
        const values = input.answer.values
        if (
          !question ||
          question.id !== input.answer.question_id ||
          Object.keys(values).length !== question.items.length
        )
          throw new AgentError("QUESTION_EXPIRED", "这个问题已结束，请根据最新消息继续。", 409)
        const lines = question.items.map((item) => {
          const selected = values[item.id]
          if (
            !selected ||
            (!item.multiple && selected.length !== 1) ||
            new Set(selected).size !== selected.length ||
            selected.some(
              (value) => !item.allow_text && !item.choices.some((choice) => choice.value === value),
            )
          )
            throw new AgentError("ANSWER_INVALID", "请按问题提供有效答案。", 422)
          return `${item.prompt}：${selected.map((value) => item.choices.find((choice) => choice.value === value)?.label ?? value).join("、")}`
        })
        prompt = lines.join("\n")
      }
      this.expireQuestions(id, input.answer?.question_id)
      this.db
        .prepare("UPDATE actions SET status='expired' WHERE conversation_id=? AND status='pending'")
        .run(id)
      const startedAt = new Date().toISOString()
      const user: ChatMessage = {
        id: input.message_id,
        role: "user",
        parts: [{ type: "text", text: prompt }],
        metadata: { status: "complete", sent_at: startedAt },
      }
      const assistant: ChatMessage = {
        id: randomUUID(),
        role: "assistant",
        parts: [],
        metadata: { status: "running", started_at: startedAt },
      }
      const insert = this.db
        .prepare(
          "INSERT INTO turns(conversation_id,request_id,user_json,assistant_json,status) VALUES(?,?,?,?,'running')",
        )
        .run(id, input.message_id, JSON.stringify(user), JSON.stringify(assistant))
      this.db
        .prepare(
          "UPDATE conversations SET busy=1,revision=revision+1,title=?,updated_at=? WHERE id=?",
        )
        .run(row.revision === 0 ? prompt.slice(0, 40) : row.title, new Date().toISOString(), id)
      return {
        seq: Number(insert.lastInsertRowid),
        assistant,
        prompt,
        semesterId: row.semester_id,
        firstTurn: row.revision === 0,
      }
    })
  }
  checkpoint(seq: number, assistant: ChatMessage) {
    this.db
      .prepare("UPDATE turns SET assistant_json=? WHERE seq=? AND status='running'")
      .run(JSON.stringify(assistant), seq)
  }
  checkpointRecord(seq: number, record: ChatRunRecord) {
    this.db
      .prepare(
        "UPDATE turns SET transcript_json=?,diagnostics_json=? WHERE seq=? AND status='running'",
      )
      .run(JSON.stringify(record.transcript), JSON.stringify(record.diagnostics), seq)
  }
  finish(
    id: string,
    seq: number,
    assistant: ChatMessage,
    transcript: AgentMessage[],
    complete: boolean,
    diagnostics?: ChatDiagnostics,
  ) {
    this.transaction(() => {
      const finishedAt = new Date()
      const startedAt = Date.parse(assistant.metadata?.started_at ?? "")
      assistant.metadata = {
        ...assistant.metadata,
        status: complete ? "complete" : "interrupted",
        sent_at: finishedAt.toISOString(),
        duration_ms: Number.isFinite(startedAt)
          ? Math.max(0, finishedAt.getTime() - startedAt)
          : undefined,
      }
      if (diagnostics) {
        diagnostics.status = complete ? "complete" : "interrupted"
        diagnostics.finished_at = finishedAt.toISOString()
        diagnostics.error_code = assistant.metadata.error_code
      }
      if (complete)
        for (const part of assistant.parts)
          if (part.type === "data-proposal") {
            this.db
              .prepare(
                "INSERT INTO actions(id,conversation_id,payload,status) VALUES(?,?,?,'pending')",
              )
              .run(part.data.id, id, JSON.stringify(part.data))
          }
      this.db
        .prepare(
          "UPDATE turns SET assistant_json=?,transcript_json=?,diagnostics_json=COALESCE(?,diagnostics_json),status=? WHERE seq=?",
        )
        .run(
          JSON.stringify(assistant),
          JSON.stringify(transcript),
          diagnostics ? JSON.stringify(diagnostics) : null,
          complete ? "complete" : "interrupted",
          seq,
        )
      this.db
        .prepare("UPDATE conversations SET busy=0,updated_at=? WHERE id=?")
        .run(new Date().toISOString(), id)
    })
  }
  history(owner: number, id: string): AgentMessage[] {
    this.row(owner, id)
    const rows = this.db
      .prepare(
        "SELECT * FROM turns WHERE conversation_id=? AND status<>'running' ORDER BY seq DESC LIMIT 20",
      )
      .all(id) as unknown as TurnRow[]
    const selected: AgentMessage[][] = []
    let size = 0
    for (const row of rows) {
      let turn = replayChatTranscript(parse<AgentMessage[]>(row.transcript_json))
      if (!turn.length) {
        const user = parse<ChatMessage>(row.user_json)
        const assistant = parse<ChatMessage>(row.assistant_json)
        const text = assistant.parts
          .filter((p) => p.type === "text")
          .map((p) => p.text)
          .join("\n")
        turn = [
          {
            role: "user",
            content:
              user.parts
                .filter((p) => p.type === "text")
                .map((p) => p.text)
                .join("\n") +
              (text
                ? `\n[上次回答${row.status === "complete" ? "已完成" : "已中断，工具明细未记录，不能据此判断查询或操作结果"}；已显示文本：${text.slice(0, 4000)}]`
                : ""),
            timestamp: Date.now(),
          },
        ]
      }
      if (row.status === "interrupted") {
        const assistant = parse<ChatMessage>(row.assistant_json)
        turn.push({
          role: "user",
          content: `[上轮回答未完成；原因：${assistant.metadata?.error_code ?? "UNKNOWN"}。已返回的工具结果仍可用于理解追问，未返回结果的调用状态未知。未交付的问卷或待确认草稿不能当作已确认或已保存；保存状态以系统操作记录为准。]`,
          timestamp: Date.now(),
        })
      }
      if (JSON.stringify(turn).length > 24000) turn = omitHistoricalThinking(turn)
      if (JSON.stringify(turn).length > 24000) {
        // Preserve the latest intent and visible answer when a tool-heavy turn is
        // oversized. Drop its ENTIRE tool exchange, never a single half of a pair.
        const user = parse<ChatMessage>(row.user_json)
        const assistant = parse<ChatMessage>(row.assistant_json)
        const visible = assistant.parts.filter(
          (part) => part.type === "text" || part.type === "data-question",
        )
        turn = [
          {
            role: "user",
            content: `[较早轮次的摘要，仅供理解追问；状态：${row.status}；工具明细已省略，业务事实必须重查] ${JSON.stringify({ request: user.parts, response: visible }).slice(0, 14000)}`,
            timestamp: Date.now(),
          },
        ]
      }
      const length = JSON.stringify(turn).length
      if (size + length > 60000) break
      selected.unshift(turn)
      size += length
    }
    const actions = this.db
      .prepare(
        "SELECT payload,status,saved_count FROM actions WHERE conversation_id=? ORDER BY rowid DESC LIMIT 5",
      )
      .all(id) as unknown as ActionRow[]
    const actionState: AgentMessage[] = actions.length
      ? [
          {
            role: "user",
            content: `[系统记录的规则操作状态] ${JSON.stringify(actions.map((action) => ({ summaries: parse<ChatProposal>(action.payload).preview.summaries, status: action.status, saved_count: action.saved_count })))}`,
            timestamp: Date.now(),
          },
        ]
      : []
    return [...selected.flat(), ...actionState]
  }
  action(owner: number, id: string, actionId: string): ChatProposal {
    this.row(owner, id)
    const row = this.db
      .prepare("SELECT * FROM actions WHERE id=? AND conversation_id=?")
      .get(actionId, id) as unknown as ActionRow | undefined
    if (!row) throw missing()
    return {
      ...parse<ChatProposal>(row.payload),
      status: row.status,
      ...(row.saved_count === null ? {} : { saved_count: row.saved_count }),
    }
  }
  lockAction(owner: number, id: string, actionId: string) {
    return this.transaction(() => {
      const conversation = this.row(owner, id)
      if (conversation.busy) throw new AgentError("CHAT_BUSY", "请等待当前回复完成后再保存。", 409)
      const action = this.action(owner, id, actionId)
      if (action.status === "expired")
        throw new AgentError("ACTION_EXPIRED", "这份草稿已失效，请重新生成并确认。", 409)
      if (action.status === "saved") return action
      this.db.prepare("UPDATE conversations SET busy=1 WHERE id=?").run(id)
      this.db.prepare("UPDATE actions SET status='confirming' WHERE id=?").run(actionId)
      return action
    })
  }
  finishAction(id: string, actionId: string, status: ChatProposal["status"], savedCount?: number) {
    this.transaction(() => {
      this.db
        .prepare("UPDATE actions SET status=?,saved_count=? WHERE id=?")
        .run(status, savedCount ?? null, actionId)
      this.db
        .prepare("UPDATE conversations SET busy=0,updated_at=? WHERE id=?")
        .run(new Date().toISOString(), id)
    })
  }
}
