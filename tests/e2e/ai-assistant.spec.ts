import { randomUUID } from "node:crypto"
import { expect, test, type Page, type BrowserContext } from "@playwright/test"
import type {
  ChatMessage,
  ChatProposal,
  ChatQuestion,
  ConversationDetail,
} from "../../packages/agent-contracts/src/index"
import { mockAdmin } from "./fixtures/prelaunch"

const proposal = (limit = 4): ChatProposal => ({
  id: randomUUID(),
  semester_id: 1,
  status: "pending",
  preview: {
    constraints: [
      {
        name: "教师每日上限",
        kind: "hard",
        category: "daily_load",
        target_type: "teacher",
        target_id: 1,
        scope: {},
        condition: {},
        requirement: { max_items_per_day: limit },
        weight: null,
        explanation: null,
      },
    ],
    summaries: [`复核教师 · 每天最多 ${limit} 节 · 必须满足`],
    etag: '"semester-1-timetable-1-catalog-1"',
  },
})
async function setup(
  page: Page,
  context: BrowserContext,
  respond: (text: string, body: Record<string, unknown>) => ChatMessage["parts"],
) {
  await mockAdmin(page)
  await context.addCookies([
    {
      name: "XSRF-TOKEN-ADMIN",
      value: "e2e-chat-csrf",
      url: test.info().project.use.baseURL as string,
    },
  ])
  const chats = new Map<string, ConversationDetail>()
  const requests: Record<string, unknown>[] = []
  let saves = 0
  await page.route("**/agent/v1/conversations**", async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const parts = url.pathname.split("/").filter(Boolean)
    const id = parts[3]
    expect(req.headers()["x-xsrf-token"]).toBe("e2e-chat-csrf")
    if (!id && req.method() === "POST") {
      const chat: ConversationDetail = {
        id: randomUUID(),
        title: "新对话",
        title_generating: false,
        semester_id: req.postDataJSON().semester_id,
        revision: 0,
        busy: false,
        updated_at: new Date().toISOString(),
        messages: [],
        has_earlier: false,
        before: null,
      }
      chats.set(chat.id, chat)
      await route.fulfill({ status: 201, json: { data: chat } })
      return
    }
    if (!id) {
      await route.fulfill({
        json: { data: [...chats.values()].filter((chat) => chat.revision > 0) },
      })
      return
    }
    const chat = chats.get(id)!
    if (!chat) {
      await route.fulfill({ status: 404, json: { message: "对话不存在或无权访问。" } })
      return
    }
    if (parts[4] === "actions") {
      const action = chat.messages
        .flatMap((m) => m.parts)
        .find((part) => part.type === "data-proposal" && part.data.id === parts[5])!
      if (action.type !== "data-proposal") throw new Error("Missing proposal")
      expect(req.postDataJSON()).toEqual({})
      if (action.data.status !== "saved") saves++
      action.data = { ...action.data, status: "saved", saved_count: 1 }
      await route.fulfill({ json: { data: action.data } })
      return
    }
    if (parts[4] !== "messages") {
      await route.fulfill({ json: { data: chat } })
      return
    }
    const body = req.postDataJSON() as Record<string, unknown>
    requests.push(body)
    expect(body.revision).toBe(chat.revision)
    expect(body).not.toHaveProperty("messages")
    for (const message of chat.messages)
      for (const part of message.parts) {
        if (part.type === "data-question" && part.data.status === "pending")
          part.data.status = body.answer ? "answered" : "cancelled"
        if (part.type === "data-proposal" && part.data.status === "pending")
          part.data.status = "expired"
      }
    const response = respond(body.text as string, body)
    const user: ChatMessage = {
      id: body.message_id as string,
      role: "user",
      parts: [{ type: "text", text: body.text as string }],
    }
    const assistant: ChatMessage = {
      id: randomUUID(),
      role: "assistant",
      parts: response,
      metadata: { status: "complete" },
    }
    chat.messages.push(user, assistant)
    chat.revision++
    chat.title =
      chat.messages[0]!.parts[0]!.type === "text"
        ? chat.messages[0]!.parts[0]!.text.slice(0, 40)
        : "对话"
    const chunks: unknown[] = [
      { type: "start", messageId: assistant.id, messageMetadata: { status: "running" } },
    ]
    response.forEach((part, index) => {
      if (part.type === "text")
        chunks.push(
          { type: "text-start", id: `t${index}` },
          { type: "text-delta", id: `t${index}`, delta: part.text },
          { type: "text-end", id: `t${index}` },
        )
      else chunks.push(part)
    })
    chunks.push({ type: "finish", finishReason: "stop", messageMetadata: { status: "complete" } })
    await route.fulfill({
      contentType: "text/event-stream",
      headers: { "x-vercel-ai-ui-message-stream": "v1" },
      body:
        chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n",
    })
  })
  const send = async (text: string) => {
    await page.getByRole("textbox", { name: "发送给 AI 的消息" }).fill(text)
    await page.getByRole("button", { name: "发送消息", exact: true }).click()
  }
  return { chats, requests, saves: () => saves, send }
}

test("free chat, follow-up, history, refresh and a new conversation", async ({ page, context }) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  const app = await setup(page, context, (text) => [
    {
      type: "text",
      text: text.includes("通知")
        ? "各位老师：请留意本周调课安排。"
        : "**硬约束**是排课必须满足的条件，例如教师不能同时出现在两间教室。",
    },
  ])
  await page.goto("/ai")
  await expect(page.getByRole("heading", { name: "今天想处理什么？" })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath("ai-chat-empty.png") })
  await app.send("什么是硬约束？")
  await expect(page.getByRole("article", { name: "AI 回复" })).toContainText("排课必须满足的条件")
  await app.send("帮我写一份通知")
  await expect(page.getByRole("article").last()).toContainText("各位老师")
  expect(app.requests).toHaveLength(2)
  const firstUrl = page.url()
  await page.reload()
  await expect(page.getByRole("article")).toHaveCount(4)
  await expect(page.getByRole("textbox", { name: "发送给 AI 的消息" })).toHaveValue("")
  await page.getByRole("link", { name: "新对话", exact: true }).click()
  await expect(page.getByRole("heading", { name: "今天想处理什么？" })).toBeVisible()
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "什么是硬约束？", exact: true })
    .click()
  await expect(page).toHaveURL(firstUrl)
  await expect(page.getByRole("article")).toHaveCount(4)
  expect(errors).toEqual([])
})

test("structured questionnaire resumes the same chat and rule edits expire the old preview", async ({
  page,
  context,
}) => {
  const question: ChatQuestion = {
    id: randomUUID(),
    status: "pending",
    items: [
      {
        id: "teacher",
        prompt: "你指的是哪位教师？",
        multiple: false,
        choices: [
          { value: "teacher-1", label: "复核教师 · T001" },
          { value: "teacher-2", label: "李老师 · T002" },
        ],
        allow_text: true,
      },
    ],
  }
  const app = await setup(page, context, (text, body) => {
    if (text.includes("最多") && !body.answer)
      return [{ type: "data-question", id: question.id, data: question }]
    if (body.answer)
      expect(body.answer).toEqual({ question_id: question.id, values: { teacher: ["teacher-1"] } })
    return [{ type: "data-proposal", id: randomUUID(), data: proposal(text.includes("5") ? 5 : 4) }]
  })
  await page.goto("/ai")
  await app.send("李老师每天最多 4 节课")
  await expect(page.getByText("你指的是哪位教师？")).toBeVisible()
  const url = page.url()
  await page.reload()
  await page.getByRole("radio", { name: /复核教师/ }).check()
  await page.getByRole("button", { name: "提交并继续" }).click()
  await expect(page.getByRole("button", { name: "确认保存草稿" })).toBeEnabled()
  expect(app.saves()).toBe(0)
  await expect(page).toHaveURL(url)
  await app.send("改成每天 5 节")
  await expect(page.getByText("已有新要求或业务数据变化，这份草稿已失效。")).toBeVisible()
  await expect(page.getByText("复核教师 · 每天最多 5 节 · 必须满足")).toBeVisible()
  await page.screenshot({ path: test.info().outputPath("ai-chat-rule.png") })
  await page.getByRole("button", { name: "确认保存草稿", exact: true }).click()
  await expect(page.getByText("已保存 1 条草稿，尚未启用。")).toBeVisible()
  expect(app.saves()).toBe(1)
  await page.reload()
  await expect(page.getByText("已保存 1 条草稿，尚未启用。")).toBeVisible()
  await expect(page.getByRole("button", { name: "确认保存草稿" })).toHaveCount(0)
})

test("composer prefill does not auto-send and a disabled model preserves the business workflow", async ({
  page,
  context,
}) => {
  const app = await setup(page, context, () => [])
  const prefill = new URLSearchParams({ semester_id: "1", prompt: "我想添加一条排课规则：" })
  await page.goto(`/ai?${prefill}`)
  await expect(page.getByRole("textbox", { name: "发送给 AI 的消息" })).toHaveValue(
    "我想添加一条排课规则：",
  )
  expect(app.requests).toHaveLength(0)
  await page.route("**/agent/v1/conversations/*/messages", (route) =>
    route.fulfill({
      status: 503,
      json: { code: "AI_UNCONFIGURED", message: "AI 服务尚未启用，请联系管理员。" },
    }),
  )
  await app.send("教师每天最多 4 节")
  await expect(page.getByRole("alert")).toContainText("AI 服务尚未启用")
  await page.goto("/semesters/1/constraints")
  await page.getByRole("button", { name: "新增规则", exact: true }).click()
  await expect(page.getByRole("dialog").getByRole("heading", { name: "新增规则" })).toBeVisible()
})

test("a narrow screen keeps the composer accessible and history can be opened and dismissed", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const app = await setup(page, context, () => [{ type: "text", text: "可以，请告诉我具体要求。" }])
  await page.goto("/ai")
  await app.send("你好")
  await expect(page.getByRole("article", { name: "AI 回复" })).toContainText("具体要求")
  await page.getByRole("button", { name: "查看对话历史" }).click()
  await expect(page.getByRole("complementary", { name: "对话历史" })).toBeVisible()
  // 遮罩层铺满容器，其几何中心被 256px 宽的历史面板盖住；真实交互是点击面板外侧区域。
  const historyBackdrop = page.getByRole("button", { name: "关闭对话历史", exact: true })
  const backdropBox = await historyBackdrop.boundingBox()
  if (!backdropBox) throw new Error("未找到历史遮罩层")
  await historyBackdrop.click({
    position: { x: backdropBox.width - 24, y: backdropBox.height / 2 },
  })
  await expect(page.getByRole("textbox", { name: "发送给 AI 的消息" })).toBeVisible()
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  )
  expect(overflow).toBe(false)
  await page.screenshot({ path: test.info().outputPath("ai-chat-mobile.png") })
})

test("multi-step questionnaire preserves multiple choices and free text", async ({
  page,
  context,
}) => {
  const question: ChatQuestion = {
    id: randomUUID(),
    status: "pending",
    items: [
      {
        id: "days",
        prompt: "选择需要说明的日期",
        multiple: true,
        choices: [
          { value: "mon", label: "周一" },
          { value: "wed", label: "周三" },
        ],
        allow_text: false,
      },
      { id: "details", prompt: "补充说明", multiple: false, choices: [], allow_text: true },
    ],
  }
  const app = await setup(page, context, (_text, body) => {
    if (!body.answer) return [{ type: "data-question", id: question.id, data: question }]
    expect(body.answer).toEqual({
      question_id: question.id,
      values: { days: ["mon", "wed"], details: ["请通知任课教师"] },
    })
    return [{ type: "text", text: "已根据周一、周三的要求拟好通知。" }]
  })
  await page.goto("/ai")
  await app.send("帮我写通知")
  await page.getByRole("checkbox", { name: /周一/ }).check()
  await page.getByRole("checkbox", { name: /周三/ }).check()
  await page.getByRole("button", { name: "下一项" }).click()
  await page.getByRole("textbox", { name: "补充说明，自由填写" }).fill("请通知任课教师")
  await page.getByRole("button", { name: "提交并继续" }).click()
  await expect(page.getByRole("article").last()).toContainText("已根据周一、周三")
})

test("stop aborts the pending request, restores the partial response and allows explicit retry", async ({
  page,
  context,
}) => {
  const app = await setup(page, context, () => [{ type: "text", text: "这是重新生成的完整回答。" }])
  let first = true
  let release!: () => void
  let markStopped = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  page.on("requestfailed", (request) => {
    if (request.url().endsWith("/messages")) markStopped()
  })
  await page.route("**/agent/v1/conversations/*/messages", async (route) => {
    if (!first) {
      await route.fallback()
      return
    }
    first = false
    const id = new URL(route.request().url()).pathname.split("/")[4]!
    const chat = app.chats.get(id)!
    const body = route.request().postDataJSON()
    chat.revision++
    chat.busy = true
    const partial: ChatMessage = {
      id: randomUUID(),
      role: "assistant",
      parts: [{ type: "text", text: "保留已生成的内容" }],
      metadata: { status: "running" },
    }
    chat.messages.push(
      { id: body.message_id, role: "user", parts: [{ type: "text", text: body.text }] },
      partial,
    )
    markStopped = () => {
      chat.busy = false
      partial.metadata = { status: "interrupted", error: "回答已停止，可以继续提问或重试。" }
    }
    await held
    await route.abort().catch(() => {})
  })
  await page.goto("/ai")
  await app.send("请帮我说明排课规则")
  await page.getByRole("button", { name: "停止生成" }).click()
  release()
  await expect(page.getByText("保留已生成的内容")).toBeVisible()
  await expect(page.getByRole("button", { name: "重试回答" })).toBeEnabled()
  await page.getByRole("button", { name: "重试回答" }).click()
  await expect(page.getByRole("article").last()).toContainText("这是重新生成的完整回答")
})
