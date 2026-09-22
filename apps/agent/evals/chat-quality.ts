// Opt-in: real DeepSeek inference, synthetic business data, no writes or chat persistence.
import type { AgentMessage } from "@earendil-works/pi-agent-core"
import type { AssistantMessage } from "@earendil-works/pi-ai"
import { BusinessApi } from "../src/business-api.ts"
import { runChat } from "../src/chat-run.ts"
import { finalAnswerToolName } from "../src/chat-text.ts"
import { readConfig } from "../src/config.ts"

const config = readConfig()
if (!config.apiKey) {
  console.error("请先在 Agent 服务端配置 DEEPSEEK_API_KEY；评测会调用真实模型。")
  process.exit(1)
}

const year = {
  id: 2,
  name: "2026–2027",
  start_date: "2026-09-01",
  end_date: "2027-08-31",
  status: "active",
}
const semester = {
  id: 4,
  academic_year_id: 2,
  name: "上学期",
  sequence: 1,
  start_date: "2026-09-01",
  end_date: "2027-01-31",
  status: "active",
  academic_year: year,
}
const teacher = {
  id: 37,
  name: "林文",
  employee_no: "T037",
  is_active: true,
  courses: [{ id: 3, name: "物理" }],
}
const user = (content: string): AgentMessage => ({ role: "user", content, timestamp: Date.now() })
const assistant = (text: string): AssistantMessage => ({
  role: "assistant",
  content: [{ type: "text", text }],
  api: "openai-completions",
  provider: "deepseek",
  model: config.model,
  stopReason: "stop",
  timestamp: Date.now(),
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
})

const pastCall = (name: string, args: Record<string, string | number>): AssistantMessage => ({
  ...assistant(""),
  stopReason: "toolUse",
  content: [{ type: "toolCall", id: `old-${name}`, name, arguments: args }],
})
const pastResult = (name: string, data: unknown): AgentMessage => ({
  role: "toolResult",
  toolCallId: `old-${name}`,
  toolName: name,
  content: [{ type: "text", text: JSON.stringify(data) }],
  isError: false,
  timestamp: Date.now(),
})

type Sample = {
  name: string
  prompt: string
  history?: AgentMessage[]
  fixture?: "empty_courses" | "missing_courses" | "ambiguous"
  kind: "identity" | "subject" | "assignments" | "missing" | "empty" | "ambiguous" | "general"
}
const samples: Sample[] = [
  { name: "模型身份", prompt: "你是什么模型", kind: "identity" },
  { name: "任教课程", prompt: "林文负责什么课程", kind: "subject" },
  {
    name: "纠正旧结论",
    prompt: "我问的是基础资料。比如张三是语文老师，林文是什么老师？",
    kind: "subject",
    history: [
      user("林文负责什么课程"),
      pastCall("find_resources", { resource: "teacher", query: "林文", semester_id: 4 }),
      pastResult("find_resources", {
        matches: [{ id: 37, name: "林文", employee_no: "T037" }],
        total: 1,
        unique: true,
      }),
      pastCall("list_teaching_assignments", { semester_id: 4, teacher_id: 37 }),
      pastResult("list_teaching_assignments", {
        data: [],
        meta: { semester_id: 4, assignment_revision: "361", pagination: { total: 0 } },
      }),
      assistant("林文在学期 4 中没有任课安排，所以基础资料中未登记任教课程。"),
    ],
  },
  { name: "学期任课为空", prompt: "林文这学期教哪些班？", kind: "assignments" },
  { name: "基础课程未登记", prompt: "林文是什么老师？", kind: "empty", fixture: "empty_courses" },
  {
    name: "字段缺失不是空数据",
    prompt: "林文是什么老师？",
    kind: "missing",
    fixture: "missing_courses",
  },
  { name: "同名消歧", prompt: "林文是什么老师？", kind: "ambiguous", fixture: "ambiguous" },
  { name: "自由问答", prompt: "写一句提醒老师们明天带水杯的通知，直接给正文。", kind: "general" },
]

let failed = 0
console.log(
  `真实模型：${config.model}；推理：${config.thinkingLevel}；${samples.length} 个合成数据场景；不会访问学校业务服务或保存对话。`,
)
for (const sample of samples) {
  // Deadline for this evaluation sample only; production conversations have no overall cap.
  const signal = AbortSignal.timeout(60000)
  const paths: string[] = []
  const api = new BusinessApi(
    "http://business.invalid",
    { cookie: "synthetic", csrf: "synthetic", origin: "http://fixture.invalid" },
    signal,
    async (url, request) => {
      const parsed = new URL(url instanceof Request ? url.url : url.toString())
      const path = parsed.pathname
      paths.push(path)
      if (path.endsWith("session-check"))
        return Response.json({
          data: { id: 1, role: "scheduler", is_active: true, must_change_password: false },
        })
      if (request?.method !== "GET") throw new Error("Evaluation forbids mutations")
      if (path === "/api/v1/context")
        return Response.json({
          data: {
            timezone: "Asia/Shanghai",
            current_semester: {
              id: 8,
              name: "下学期",
              status: "active",
              academic_year: { id: 3, name: "2027–2028" },
            },
          },
        })
      if (path === "/api/v1/semesters/4") return Response.json({ data: semester })
      if (path === "/api/v1/academic-years") return Response.json({ data: [year] })
      if (path === "/api/v1/academic-years/2/semesters") return Response.json({ data: [semester] })
      if (path === "/api/v1/teachers") {
        let data: unknown[] = [teacher]
        if (sample.fixture === "empty_courses") data = [{ ...teacher, courses: [] }]
        if (sample.fixture === "missing_courses")
          data = [{ id: teacher.id, name: teacher.name, employee_no: null, is_active: true }]
        if (sample.fixture === "ambiguous") {
          const matches = [
            teacher,
            { ...teacher, id: 38, employee_no: "T038", courses: [{ id: 6, name: "历史" }] },
          ]
          data = matches.filter((row) => row.employee_no === parsed.searchParams.get("search"))
          if (data.length === 0) data = matches
        }
        return Response.json({
          data,
          meta: { pagination: { total: data.length, page: 1, per_page: 20, last_page: 1 } },
        })
      }
      if (path === "/api/v1/semesters/4/teaching-assignments")
        return Response.json({
          data: [],
          meta: { pagination: { total: 0, page: 1, per_page: 20, last_page: 1 } },
        })
      return Response.json(
        { message: "No query results for model [App\\Models\\Fixture]" },
        { status: 404 },
      )
    },
  )
  const texts = new Map<string, string>()
  const finalIds = new Set<string>()
  try {
    const result = await runChat(
      config,
      { prompt: sample.prompt, semesterId: 4, history: sample.history ?? [] },
      api,
      (chunk) => {
        if (chunk.type === "data-text-phase" && chunk.id) {
          if (chunk.data.phase === "final_answer") finalIds.add(chunk.id)
          else finalIds.delete(chunk.id)
        }
        if (chunk.type === "text-delta")
          texts.set(chunk.id, (texts.get(chunk.id) ?? "") + chunk.delta)
      },
      signal,
    )
    const text = [...texts]
      .filter(([id]) => finalIds.has(id))
      .map(([, value]) => value)
      .join("\n")
    const toolCalls = result.transcript.flatMap((message) =>
      message.role === "assistant"
        ? message.content
            .filter((part) => part.type === "toolCall")
            .filter((part) => part.name !== finalAnswerToolName)
            .map((part) => part.name)
        : [],
    )
    const checks: Record<string, boolean> = {
      无内部字段或固定追问:
        !/revision|ETag|学期\s*(ID\s*)?4|academic_year|(?:teacher|course|semester):[a-f\d-]+|需要我|要我|如果你|我可以再|App\\/i.test(
          text,
        ),
      简短回答: text.length <= 240,
      最终答复不重复过程: !/I['’]ll|I will|look up|我先查|我来查|让我查/i.test(text),
    }
    if (sample.kind !== "ambiguous") checks["不附无关工号"] = !/工号|T037|T038/.test(text)
    if (sample.kind === "identity")
      checks["报告真实模型且不调用工具"] =
        text
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "")
          .includes(config.model.toLowerCase().replace(/[^a-z0-9]/g, "")) && toolCalls.length === 0
    if (sample.kind === "subject") {
      checks["重新查询教师并回答物理"] =
        toolCalls.includes("find_resources") && text.includes("物理")
      checks["不把学期任课为空误当作未登记学科"] = !/未登记|没有任课/.test(text)
    }
    if (sample.kind === "assignments")
      checks["查所选学期且不混用学年"] =
        toolCalls.includes("list_teaching_assignments") &&
        paths.includes("/api/v1/semesters/4/teaching-assignments") &&
        !paths.includes("/api/v1/academic-years/4/semesters")
    if (sample.kind === "empty")
      checks["说明未登记而不编课程"] =
        toolCalls.includes("find_resources") &&
        /未登记|没有登记|未录入|未填写|未设置/.test(text) &&
        !text.includes("物理")
    if (sample.kind === "missing")
      checks["字段缺失不宣称未登记"] =
        toolCalls.includes("find_resources") &&
        /无法|未能|不完整|不全|缺少|未提供|失败|查不到|不能确认/.test(text) &&
        !/未登记|没有登记|未录入/.test(text)
    if (sample.kind === "ambiguous")
      checks["同名时询问用户"] =
        result.parts.some((part) => part.type === "data-question") &&
        toolCalls.includes("find_resources")
    if (sample.kind === "general")
      checks["自由问答不调用业务工具"] = toolCalls.length === 0 && text.includes("水杯")
    const passed = Object.values(checks).every(Boolean)
    if (!passed) failed++
    console.log(JSON.stringify({ scenario: sample.name, passed, answer: text, toolCalls, checks }))
  } catch {
    failed++
    // Do not print SDK/network exceptions, request objects or configuration.
    console.error(
      JSON.stringify({
        scenario: sample.name,
        passed: false,
        error: "运行失败或超时，请检查模型连接后重新评测。",
      }),
    )
  }
}
console.log(
  `${samples.length - failed}/${samples.length} 场景通过；这是一轮语义抽样，不代表所有表达都可靠。`,
)
if (failed) process.exitCode = 1
