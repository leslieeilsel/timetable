# 测试逐项审查清单（2026-09-25）

范围：实施前工作区 47 个文件、306 条测试声明，运行后展开为 351 个用例。参数化声明合并列示，各输入场景的去留见对应说明。行号和分类保留审查时快照；最新去留及修正情况见 [实施结果](/Users/leslielau/project/dev/timetable/docs/testing/test-cleanup-implemented-2026-09-25.md)。

R = 保留；F = 修正断言、输入或标题，修正前保留；C = 合并重叠断言，见明确保留位置；D = 删除。F 不代表对应业务无需保护。

审查时结论：R 283、F 20、C 2、D 1。C 中一项是整条重复用例，一项只合并局部断言。全部 23 项处理建议现已落实，实施报告逐项列出对应结果。

基线、覆盖率、变异实验见 [审查报告](/Users/leslielau/project/dev/timetable/docs/testing/test-audit-2026-09-25.md)。

## apps/agent/tests/chat-http.test.ts

[chat-http.test.ts](/Users/leslielau/project/dev/timetable/apps/agent/tests/chat-http.test.ts) · 8 条声明。

| 序号 / 行 | 当前测试名 | 决定 | 依据与后续处理 |
| --- | --- | --- | --- |
| 1 / [chat-http.test.ts:110](/Users/leslielau/project/dev/timetable/apps/agent/tests/chat-http.test.ts:110) | generates the first title without delaying the answer and does not replace a manual edit | R | HTTP 入口异步生成标题；手动改名后迟到结果不得覆盖。作为跨层标题行为的保留用例。 |
| 2 / [chat-http.test.ts:139](/Users/leslielau/project/dev/timetable/apps/agent/tests/chat-http.test.ts:139) | authorizes title changes and soft deletion, and rejects access through deleted URLs | R | 通过实际路由验证改名、软删除的身份校验和删除后访问拒绝；与数据库迁移测试职责不同。 |
| 3 / [chat-http.test.ts:172](/Users/leslielau/project/dev/timetable/apps/agent/tests/chat-http.test.ts:172) | streams a real AI SDK-compatible message, persists it, and sends only server-owned context on follow-up | R | 真实流协议进入 HTTP 响应和持久化历史；后续模型上下文取自服务端，防止浏览器伪造历史。 |
| 4 / [chat-http.test.ts:206](/Users/leslielau/project/dev/timetable/apps/agent/tests/chat-http.test.ts:206) | keeps activity, text phases and interleaved progress identical in the live stream and saved history | R | 交错进度、活动和分段文本在实时流与恢复历史中顺序一致。 |
| 5 / [chat-http.test.ts:268](/Users/leslielau/project/dev/timetable/apps/agent/tests/chat-http.test.ts:268) | authenticates history reads, rejects forged messages and hides another user's conversation | R | 拒绝未登录、伪造消息和其他用户会话的读取，保护 HTTP 身份边界。 |
| 6 / [chat-http.test.ts:287](/Users/leslielau/project/dev/timetable/apps/agent/tests/chat-http.test.ts:287) | requires explicit confirmation, ignores browser-supplied previews and makes saved replays local | R | 确认前无业务写入；确认只接受服务器保存的预览，成功重放不重复请求 Laravel。 |
| 7 / [chat-http.test.ts:317](/Users/leslielau/project/dev/timetable/apps/agent/tests/chat-http.test.ts:317) | retries an uncertain business write with the same key and expires a definitively stale preview | F | 实际只触发 500 后按原幂等键重试成功，没有触发标题所说的明确过期预览。保留重试断言，补 412 场景或收窄标题。 |
| 8 / [chat-http.test.ts:340](/Users/leslielau/project/dev/timetable/apps/agent/tests/chat-http.test.ts:340) | keeps partial text on cancellation and never exposes a raw provider error or half-finished proposal | R | 取消保留部分回答；异常不泄露提供商原始错误，也不留下可执行的半成品提案。 |

## apps/agent/tests/chat-record.test.ts

[chat-record.test.ts](/Users/leslielau/project/dev/timetable/apps/agent/tests/chat-record.test.ts) · 4 条声明。

| 序号 / 行 | 当前测试名 | 决定 | 依据与后续处理 |
| --- | --- | --- | --- |
| 1 / [chat-record.test.ts:34](/Users/leslielau/project/dev/timetable/apps/agent/tests/chat-record.test.ts:34) | uses the documented DeepSeek ceiling and rejects invalid environment limits | R | 环境配置的上下文上限与无效数值拒绝；上限来自模型能力约束，不能把非法配置静默当作正常值。 |
| 2 / [chat-record.test.ts:45](/Users/leslielau/project/dev/timetable/apps/agent/tests/chat-record.test.ts:45) | records cutoff reasons and reported usage without double-counting reasoning | R | 截断原因和用量入库，推理 token 不重复计费统计；与页面文本格式不同。 |
| 3 / [chat-record.test.ts:66](/Users/leslielau/project/dev/timetable/apps/agent/tests/chat-record.test.ts:66) | retains completed tool facts when a later request dies, including after process restart | R | 后续请求失败、进程重启后仍可恢复已经完成的工具事实。 |
| 4 / [chat-record.test.ts:128](/Users/leslielau/project/dev/timetable/apps/agent/tests/chat-record.test.ts:128) | marks missing provider usage as unknown and never replays truncated tool arguments | R | 缺失的用量标为未知；截断的工具参数不能进入重放执行。 |

## apps/agent/tests/chat-store.test.ts

[chat-store.test.ts](/Users/leslielau/project/dev/timetable/apps/agent/tests/chat-store.test.ts) · 8 条声明。

| 序号 / 行 | 当前测试名 | 决定 | 依据与后续处理 |
| --- | --- | --- | --- |
| 1 / [chat-store.test.ts:49](/Users/leslielau/project/dev/timetable/apps/agent/tests/chat-store.test.ts:49) | keeps title edits independent from chat revisions and ignores superseded AI results | R | 存储层标题请求标识与会话 revision 分离；拒绝被新编辑取代的生成结果。 |
| 2 / [chat-store.test.ts:64](/Users/leslielau/project/dev/timetable/apps/agent/tests/chat-store.test.ts:64) | soft-deletes without erasing turns and blocks access through old conversation URLs | R | 删除保留历史记录但阻止继续访问或写入；数据库行为不能只由路由 404 代替。 |
| 3 / [chat-store.test.ts:96](/Users/leslielau/project/dev/timetable/apps/agent/tests/chat-store.test.ts:96) | migrates pre-title databases in place and clears interrupted title jobs after restart | R | 旧数据库迁移保留会话；重启清理中断的标题任务，避免永久忙碌。 |
| 4 / [chat-store.test.ts:126](/Users/leslielau/project/dev/timetable/apps/agent/tests/chat-store.test.ts:126) | isolates owners, rejects stale revisions and duplicate/concurrent turns | R | 同一会话拒绝过期 revision、重复消息及并发占用，并隔离所有者。 |
| 5 / [chat-store.test.ts:141](/Users/leslielau/project/dev/timetable/apps/agent/tests/chat-store.test.ts:141) | validates structured answers against the saved question and consumes them once | R | 问卷答案必须匹配已保存的问题、选项和状态，而且只能消费一次。 |
| 6 / [chat-store.test.ts:182](/Users/leslielau/project/dev/timetable/apps/agent/tests/chat-store.test.ts:182) | expires old proposals on a new request and recovers uncertain confirmations with the same action | R | 新需求使旧提案失效；不确定的确认状态保留原 action 以便安全重试。 |
| 7 / [chat-store.test.ts:205](/Users/leslielau/project/dev/timetable/apps/agent/tests/chat-store.test.ts:205) | restores checkpointed partial text after a restart without an executable action | R | 重启从检查点恢复部分文本，但不恢复未完成的可执行动作。 |
| 8 / [chat-store.test.ts:229](/Users/leslielau/project/dev/timetable/apps/agent/tests/chat-store.test.ts:229) | paginates history and bounds context by complete turns without orphaning tool results | F | 33 轮 fixture 的模型历史全是 user 文本，没有工具调用与结果。分页计数有效，但“无孤立工具结果”未被验证。 |

## apps/agent/tests/chat-title.test.ts

[chat-title.test.ts](/Users/leslielau/project/dev/timetable/apps/agent/tests/chat-title.test.ts) · 3 条声明。

| 序号 / 行 | 当前测试名 | 决定 | 依据与后续处理 |
| --- | --- | --- | --- |
| 1 / [chat-title.test.ts:32](/Users/leslielau/project/dev/timetable/apps/agent/tests/chat-title.test.ts:32) | uses user requests without internal context and does not block another chat turn | R | 标题模型仅获得用户问题；标题任务进行时仍能发起聊天，重复标题任务被拒绝。 |
| 2 / [chat-title.test.ts:60](/Users/leslielau/project/dev/timetable/apps/agent/tests/chat-title.test.ts:60) | retains the existing title when the provider fails without exposing its error | R | 标题提供商失败后保留旧名称、清除忙碌状态，并返回脱敏错误。 |
| 3 / [chat-title.test.ts:73](/Users/leslielau/project/dev/timetable/apps/agent/tests/chat-title.test.ts:73) | cancels an older AI title when a user names the conversation | C | 手动名称优先的结果已由 chat-http 第 1 项和 chat-store 第 1 项保护；可移除本条跨层重复。临时删除后 Agent 69 项全过且四项覆盖计数不变。 |

## apps/agent/tests/chat-tools.test.ts

[chat-tools.test.ts](/Users/leslielau/project/dev/timetable/apps/agent/tests/chat-tools.test.ts) · 11 条声明。

| 序号 / 行 | 当前测试名 | 决定 | 依据与后续处理 |
| --- | --- | --- | --- |
| 1 / [chat-tools.test.ts:53](/Users/leslielau/project/dev/timetable/apps/agent/tests/chat-tools.test.ts:53) | preserves teacher courses and nullable employee numbers on page %i without needing a semester | R | 分页查询保留教师任教课程和可空工号；不依赖当前学期。各页是独立参数案例。 |
| 2 / [chat-tools.test.ts:80](/Users/leslielau/project/dev/timetable/apps/agent/tests/chat-tools.test.ts:80) | distinguishes unregistered courses from an API response missing the courses relation | R | 区分没有登记任教课程与 API 漏传 courses，避免把缺数据解释成无资格。 |
| 3 / [chat-tools.test.ts:119](/Users/leslielau/project/dev/timetable/apps/agent/tests/chat-tools.test.ts:119) | resolves a semester from explicit, selected, or current context: $expected | R | 显式、选中、学校默认学期的优先级分别验证，防止跨学期查询。 |
| 4 / [chat-tools.test.ts:142](/Users/leslielau/project/dev/timetable/apps/agent/tests/chat-tools.test.ts:142) | reports no selected semester without inventing one when the system also has none | R | 所有上下文都无学期时明确返回缺失，不能编造 ID。 |
| 5 / [chat-tools.test.ts:148](/Users/leslielau/project/dev/timetable/apps/agent/tests/chat-tools.test.ts:148) | sanitizes a missing semester and allows recovery by listing actual years and semesters | R | 无效学期错误脱敏，同时允许重新列出真实学年、学期恢复操作。 |
| 6 / [chat-tools.test.ts:174](/Users/leslielau/project/dev/timetable/apps/agent/tests/chat-tools.test.ts:174) | uses the semester's actual academic year to look up classes | R | 班级查询使用目标学期实际所属学年，防止混用当前学年。 |
| 7 / [chat-tools.test.ts:193](/Users/leslielau/project/dev/timetable/apps/agent/tests/chat-tools.test.ts:193) | shares unique catalog resolution with rule drafts without bypassing per-semester checks or ambiguity | R | 聊天工具的资源唯一确认、按学期读取前置上下文及预览流程；保留为新入口的主验证。 |
| 8 / [chat-tools.test.ts:258](/Users/leslielau/project/dev/timetable/apps/agent/tests/chat-tools.test.ts:258) | uses actual daily rows, filters by all participating teachers and does not reuse the whole-school totals | R | 按所有参与教师过滤实际日课表，并重新计算过滤后的数量，避免照搬全校汇总。 |
| 9 / [chat-tools.test.ts:299](/Users/leslielau/project/dev/timetable/apps/agent/tests/chat-tools.test.ts:299) | preserves pagination and maps class/course filters to the documented API fields | R | 列表工具保留页码并把班级、课程筛选映射为 API 要求字段。 |
| 10 / [chat-tools.test.ts:313](/Users/leslielau/project/dev/timetable/apps/agent/tests/chat-tools.test.ts:313) | exposes no save, generic HTTP or executable tools | D | 仅按工具名称匹配 save/http/exec 等单词，不能证明工具能力安全；可删。执行前确认由 chat-http 第 6 项保护。临时删后覆盖计数不变。 |
| 11 / [chat-tools.test.ts:319](/Users/leslielau/project/dev/timetable/apps/agent/tests/chat-tools.test.ts:319) | defers large run details explicitly and makes every evidence page and freshness flag readable | R | 大诊断结果明确分页，证据可逐页取回且保留过期状态，不静默丢弃后半部分。 |

## apps/agent/tests/diagnostic-data.test.ts

[diagnostic-data.test.ts](/Users/leslielau/project/dev/timetable/apps/agent/tests/diagnostic-data.test.ts) · 2 条声明。

| 序号 / 行 | 当前测试名 | 决定 | 依据与后续处理 |
| --- | --- | --- | --- |
| 1 / [diagnostic-data.test.ts:5](/Users/leslielau/project/dev/timetable/apps/agent/tests/diagnostic-data.test.ts:5) | retains every field beyond the former first-ten limit | R | 超过原先十条上限的诊断字段仍全部可读取，防止截断真实排课失败证据。 |
| 2 / [diagnostic-data.test.ts:18](/Users/leslielau/project/dev/timetable/apps/agent/tests/diagnostic-data.test.ts:18) | exposes a long string as ordered segments instead of dropping it | F | 长字符串重组断言有价值；offset 固定为 2000 绑定分片大小，可改为等于前一分片长度，保留顺序和无损重组。 |

## apps/agent/tests/model-data.test.ts

[model-data.test.ts](/Users/leslielau/project/dev/timetable/apps/agent/tests/model-data.test.ts) · 4 条声明。

| 序号 / 行 | 当前测试名 | 决定 | 依据与后续处理 |
| --- | --- | --- | --- |
| 1 / [model-data.test.ts:43](/Users/leslielau/project/dev/timetable/apps/agent/tests/model-data.test.ts:43) | retains business attributes, removes internal metadata and restores typed references across turns | R | 保留业务属性、移除内部元数据，并跨轮次恢复类型化资源引用。 |
| 2 / [model-data.test.ts:111](/Users/leslielau/project/dev/timetable/apps/agent/tests/model-data.test.ts:111) | distinguishes missing, empty, partial and unavailable results: $state | R | 缺失、空集合、部分结果与不可用四种状态不能混同；保留各参数行。 |
| 3 / [model-data.test.ts:149](/Users/leslielau/project/dev/timetable/apps/agent/tests/model-data.test.ts:149) | translates nested rule references without exposing server IDs or changing unrelated question IDs | R | 翻译嵌套规则资源引用，避免暴露内部 ID，同时不改写无关问题 ID。 |
| 4 / [model-data.test.ts:198](/Users/leslielau/project/dev/timetable/apps/agent/tests/model-data.test.ts:198) | projects old structured tool evidence without mutating persisted history | R | 旧版工具证据可投影到当前模型格式，且不修改已持久化历史。 |

## apps/agent/tests/run.test.ts

[run.test.ts](/Users/leslielau/project/dev/timetable/apps/agent/tests/run.test.ts) · 12 条声明。

| 序号 / 行 | 当前测试名 | 决定 | 依据与后续处理 |
| --- | --- | --- | --- |
| 1 / [run.test.ts:72](/Users/leslielau/project/dev/timetable/apps/agent/tests/run.test.ts:72) | executes a real pi tool call and publishes only the validated result | R | 真实 pi 调用链执行工具，并只发布经过校验的业务结果。 |
| 2 / [run.test.ts:107](/Users/leslielau/project/dev/timetable/apps/agent/tests/run.test.ts:107) | does not turn an agent_end without a result into success | R | 模型结束但没有交付结果时不能报告任务成功。 |
| 3 / [run.test.ts:122](/Users/leslielau/project/dev/timetable/apps/agent/tests/run.test.ts:122) | continues tool calls beyond the former limit until the workflow returns a result | R | 旧的工具调用次数上限不能提前截断仍在进行的工作流。 |
| 4 / [run.test.ts:165](/Users/leslielau/project/dev/timetable/apps/agent/tests/run.test.ts:165) | provides model identity and uses maximum reasoning without exposing reasoning or credentials | R | 模型配置传递身份和推理选项，但用户输出不能泄露推理文本或凭证。 |
| 5 / [run.test.ts:197](/Users/leslielau/project/dev/timetable/apps/agent/tests/run.test.ts:197) | delivers fresh teacher courses through the real pi loop after a corrected question | R | 纠正问题后真实 pi 循环重新取得教师课程，避免沿用旧查询事实。 |
| 6 / [run.test.ts:267](/Users/leslielau/project/dev/timetable/apps/agent/tests/run.test.ts:267) | marks failed queries as errors in both pi history and UI progress | R | 查询失败同时反映在模型历史与用户进度中，不能把失败当成功证据。 |
| 7 / [run.test.ts:307](/Users/leslielau/project/dev/timetable/apps/agent/tests/run.test.ts:307) | delivers free-form answers and keeps only the new turn in the durable transcript | R | 自由文本答案进入下一轮，仅新增轮次写入耐久历史。 |
| 8 / [run.test.ts:332](/Users/leslielau/project/dev/timetable/apps/agent/tests/run.test.ts:332) | keeps tools available beyond the former limit until the model finishes its answer | R | 自由聊天独立执行循环超过旧工具次数限制仍可继续；不同于工作流循环第 3 项。 |
| 9 / [run.test.ts:384](/Users/leslielau/project/dev/timetable/apps/agent/tests/run.test.ts:384) | streams %s before the upstream response finishes | R | 各类增量内容在上游结束前送达，保护流式交付时序；不是静态文字出现测试。 |
| 10 / [run.test.ts:473](/Users/leslielau/project/dev/timetable/apps/agent/tests/run.test.ts:473) | repairs a missing delivery tool without imposing a query budget | R | 缺少交付工具时补救交付，不用查询预算中止正常工作。 |
| 11 / [run.test.ts:494](/Users/leslielau/project/dev/timetable/apps/agent/tests/run.test.ts:494) | revokes a truncated final answer instead of completing it | R | 截断的最终答案撤销成功状态，防止用户误以为回答完整。 |
| 12 / [run.test.ts:520](/Users/leslielau/project/dev/timetable/apps/agent/tests/run.test.ts:520) | ends the turn with a structured question without leaving a live model call waiting | R | 结构化问卷结束本轮等待用户，不留下持续运行的模型请求。 |

## apps/agent/tests/server.test.ts

[server.test.ts](/Users/leslielau/project/dev/timetable/apps/agent/tests/server.test.ts) · 5 条声明。

| 序号 / 行 | 当前测试名 | 决定 | 依据与后续处理 |
| --- | --- | --- | --- |
| 1 / [server.test.ts:48](/Users/leslielau/project/dev/timetable/apps/agent/tests/server.test.ts:48) | validates origin and CSRF through Laravel before calling the model | R | 模型调用前校验 Origin、CSRF 与 Laravel 会话，阻止未授权工作。 |
| 2 / [server.test.ts:62](/Users/leslielau/project/dev/timetable/apps/agent/tests/server.test.ts:62) | does not accept tool targets or credentials in user input | R | 客户端不能指定工具执行目标或凭证，保护请求契约。 |
| 3 / [server.test.ts:80](/Users/leslielau/project/dev/timetable/apps/agent/tests/server.test.ts:80) | reports an unconfigured server without attempting a model call | R | 服务未配置时返回可识别的不可用状态，而且不调用模型。 |
| 4 / [server.test.ts:87](/Users/leslielau/project/dev/timetable/apps/agent/tests/server.test.ts:87) | keeps concurrent users and their cookies isolated | R | 并发用户的 Cookie 与模型任务隔离，不能串用身份。 |
| 5 / [server.test.ts:111](/Users/leslielau/project/dev/timetable/apps/agent/tests/server.test.ts:111) | redacts provider exceptions and aborts work when the browser disconnects | R | 异常脱敏且浏览器断开后终止工作，防止泄密和遗留请求。 |

## apps/agent/tests/tools.test.ts

[tools.test.ts](/Users/leslielau/project/dev/timetable/apps/agent/tests/tools.test.ts) · 4 条声明。

| 序号 / 行 | 当前测试名 | 决定 | 依据与后续处理 |
| --- | --- | --- | --- |
| 1 / [tools.test.ts:78](/Users/leslielau/project/dev/timetable/apps/agent/tests/tools.test.ts:78) | requires unique resource resolution and validates a draft through Laravel without saving | F | 旧工作流仍需验证 proposal/etag 和预览不写入；可删除末尾工具名正则。不能整条删掉旧入口覆盖。 |
| 2 / [tools.test.ts:94](/Users/leslielau/project/dev/timetable/apps/agent/tests/tools.test.ts:94) | refuses to silently choose one of multiple matching teachers | R | 旧入口自身负责把唯一解析结果加入 resolved。变异实验表明本条独立抓住“多个教师仍自动选中”，聊天入口测试不能替代。 |
| 3 / [tools.test.ts:104](/Users/leslielau/project/dev/timetable/apps/agent/tests/tools.test.ts:104) | does not present a partial proposal when some requirements are unsupported | R | 存在不支持的需求时不发布部分方案，也不调用预览保存路径。 |
| 4 / [tools.test.ts:120](/Users/leslielau/project/dev/timetable/apps/agent/tests/tools.test.ts:120) | binds explanations to the requested failed run and rejects fabricated evidence or counts | R | 解释须绑定请求的失败任务与真实证据，拒绝编造证据引用或数量。 |

## apps/api/tests/Feature/AuthenticationTest.php

[AuthenticationTest.php](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/AuthenticationTest.php) · 10 条声明。

| 序号 / 行 | 当前测试名 | 决定 | 依据与后续处理 |
| --- | --- | --- | --- |
| 1 / [AuthenticationTest.php:8](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/AuthenticationTest.php:8) | starts a session for the configured Vite development host | R | 开发站点 Origin 下真实会话能建立，保护 Cookie/跨域认证连接。 |
| 2 / [AuthenticationTest.php:27](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/AuthenticationTest.php:27) | keeps administrator and teacher browser sessions isolated | R | 管理员与教师客户端会话隔离，登出或切换不能串用身份。 |
| 3 / [AuthenticationTest.php:106](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/AuthenticationTest.php:106) | requires a temporary password to be changed before using the workspace | R | 临时密码用户必须先改密才能使用工作区，改密后访问恢复。 |
| 4 / [AuthenticationTest.php:136](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/AuthenticationTest.php:136) | lets an administrator create exactly one teacher account for an active teacher profile | R | 一个有效教师档案只建立一个教师账号，阻止重复或无效绑定。 |
| 5 / [AuthenticationTest.php:181](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/AuthenticationTest.php:181) | refuses login when a teacher account is bound to an inactive teacher profile | R | 绑定已停用教师的账号拒绝登录，不能保留旧访问权限。 |
| 6 / [AuthenticationTest.php:204](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/AuthenticationTest.php:204) | protects the last enabled administrator | R | 禁止禁用最后一个可用管理员，避免系统无法管理。 |
| 7 / [AuthenticationTest.php:217](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/AuthenticationTest.php:217) | requires a resource version for user edits and password resets | R | 用户编辑与重置密码必须带资源版本，防止盲写。 |
| 8 / [AuthenticationTest.php:246](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/AuthenticationTest.php:246) | rejects stale full-form edits after another administrator removes access | R | 其他管理员已移除权限时拒绝旧整表单回写，避免恢复已撤销的权限。 |
| 9 / [AuthenticationTest.php:291](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/AuthenticationTest.php:291) | rejects a stale password reset without changing the password | R | 旧版本密码重置被拒绝且现有密码不变，保护并发凭证更新。 |
| 10 / [AuthenticationTest.php:322](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/AuthenticationTest.php:322) | enforces the scheduler and viewer permission boundaries | R | 排课员和只读用户的各类写权限有区别；保留角色权限矩阵。 |

## apps/api/tests/Feature/CatalogImpactTest.php

[CatalogImpactTest.php](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/CatalogImpactTest.php) · 1 条声明。

| 序号 / 行 | 当前测试名 | 决定 | 依据与后续处理 |
| --- | --- | --- | --- |
| 1 / [CatalogImpactTest.php:29](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/CatalogImpactTest.php:29) | requires a fresh impact confirmation before deactivating a used resource | F | 已验证无确认返回 409、按当前影响确认后成功；没有在两次请求间改变引用关系，标题中的 fresh 尚未证明。 |

## apps/api/tests/Feature/ConstraintBatchTest.php

[ConstraintBatchTest.php](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/ConstraintBatchTest.php) · 6 条声明。

| 序号 / 行 | 当前测试名 | 决定 | 依据与后续处理 |
| --- | --- | --- | --- |
| 1 / [ConstraintBatchTest.php:34](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/ConstraintBatchTest.php:34) | previews valid drafts without writing rules, audits or revisions | R | 预览不写规则、审计日志或 revision，保证预览无持久副作用。 |
| 2 / [ConstraintBatchTest.php:49](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/ConstraintBatchTest.php:49) | atomically saves drafts and safely replays a retry with the old etag | R | 批量规则原子写入且旧 ETag 的同键重试安全重放，防止重复规则。 |
| 3 / [ConstraintBatchTest.php:65](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/ConstraintBatchTest.php:65) | rejects a whole batch when any draft is invalid or carries extra model fields | R | 任一规则无效或携带额外模型字段时整批拒绝，不能部分保存。 |
| 4 / [ConstraintBatchTest.php:78](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/ConstraintBatchTest.php:78) | requires a fresh preview version and rejects a closed semester | R | 版本过期和已关闭学期拒绝保存，保护版本及学期生命周期。 |
| 5 / [ConstraintBatchTest.php:88](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/ConstraintBatchTest.php:88) | does not let viewers preview or commit rule drafts | R | 只读角色不能预览或提交规则草稿，保护服务端授权。 |
| 6 / [ConstraintBatchTest.php:95](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/ConstraintBatchTest.php:95) | checks the existing authenticated session and rejects revoked sessions | R | 使用当前有效会话，已撤销会话不能借 Agent 路径继续操作。 |

## apps/api/tests/Feature/CourseColorTest.php

[CourseColorTest.php](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/CourseColorTest.php) · 5 条声明。

| 序号 / 行 | 当前测试名 | 决定 | 依据与后续处理 |
| --- | --- | --- | --- |
| 1 / [CourseColorTest.php:18](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/CourseColorTest.php:18) | preserves color when a course is renamed and validates manual colors | R | 重命名保留已有颜色且非法手工颜色被拒绝，属于保存数据契约；不同于固定色板分配顺序。 |
| 2 / [CourseColorTest.php:32](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/CourseColorTest.php:32) | changes appearance without invalidating scheduling revisions and rejects stale edits | R | 纯外观编辑不让排课输入失效，同时仍拒绝旧资源版本编辑。 |
| 3 / [CourseColorTest.php:56](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/CourseColorTest.php:56) | still advances the scheduling catalog revision when color and business data change together | R | 外观和业务字段一起变化仍推进排课资料 revision，避免候选误判为有效。 |
| 4 / [CourseColorTest.php:66](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/CourseColorTest.php:66) | backfills existing courses without changing their identities or scheduling revision | R | 旧数据回填不改变课程身份和排课 revision，属于数据迁移保障。 |
| 5 / [CourseColorTest.php:77](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/CourseColorTest.php:77) | does not let a viewer change course appearance | R | 只读用户不能通过外观接口绕过课程写权限。 |

## apps/api/tests/Feature/DailyOperationsTest.php

[DailyOperationsTest.php](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/DailyOperationsTest.php) · 13 条声明。

| 序号 / 行 | 当前测试名 | 决定 | 依据与后续处理 |
| --- | --- | --- | --- |
| 1 / [DailyOperationsTest.php:19](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/DailyOperationsTest.php:19) | resolves the actual date timetable with real specified-week semantics | R | 指定周在真实日期上的课表出现或不出现，保护周次换算。 |
| 2 / [DailyOperationsTest.php:36](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/DailyOperationsTest.php:36) | previews and stores a date-only move without mutating the base weekly timetable | R | 日期级移动不修改基础周课表；实际日课表生成移出、移入记录并可撤销。 |
| 3 / [DailyOperationsTest.php:85](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/DailyOperationsTest.php:85) | rejects new makeup lessons while preserving historical records | R | 新补课操作被拒绝，同时旧补课历史仍能读取关联资源。 |
| 4 / [DailyOperationsTest.php:118](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/DailyOperationsTest.php:118) | blocks a temporary adjustment when the target date has a hard resource conflict | R | 目标日实际资源冲突时预览不允许，提交返回指定冲突码且无写入。 |
| 5 / [DailyOperationsTest.php:142](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/DailyOperationsTest.php:142) | previews leave impact, explains substitute recommendations and supports multi-date batch substitution | R | 请假范围按实际课次展开；推荐教师负荷、资格及批量代课和撤销结果正确。 |
| 6 / [DailyOperationsTest.php:231](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/DailyOperationsTest.php:231) | keeps independent substitutions when two teachers on the same entry are absent | R | 同课次两个教师同时缺席可独立代课，同名教师仍按 ID 区分，撤销一方不撤销另一方。 |
| 7 / [DailyOperationsTest.php:368](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/DailyOperationsTest.php:368) | rejects an unqualified teacher in a temporary teacher change preview | R | 临时替换教师未取得课程资格时返回明确业务拒绝。 |
| 8 / [DailyOperationsTest.php:388](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/DailyOperationsTest.php:388) | lets a teacher view only their own effective timetable | R | 教师只查看自己的生效课表和任教班级，不能读取管理端或无权班级。 |
| 9 / [DailyOperationsTest.php:437](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/DailyOperationsTest.php:437) | does not grant long-term class access to a temporary replacement teacher | R | 当天临时代课不能获得长期班级课表访问权限。 |
| 10 / [DailyOperationsTest.php:469](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/DailyOperationsTest.php:469) | changes class access when a different teacher is assigned in the date-effective long-term version | R | 长期版本在生效日期改变班级权限，旧教师、新教师的访问范围随日期变化。 |
| 11 / [DailyOperationsTest.php:558](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/DailyOperationsTest.php:558) | publishes a long-term adjustment for only the selected date range | R | 已有生效区间与尚无区间两个参数场景都按选定范围切分发布，区间外保持原版本。 |
| 12 / [DailyOperationsTest.php:638](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/DailyOperationsTest.php:638) | previews the same temporary rebase that publishing applies without retaining preview writes | R | 预览和发布的临时记录迁移结果一致，但预览不保留任何数据库改写。 |
| 13 / [DailyOperationsTest.php:698](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/DailyOperationsTest.php:698) | prevents a long-term timetable from conflicting with a temporary move into its date range | R | 区间外移入的临时课程也参与长期发布冲突校验，拒绝时原安排保持。 |

## apps/api/tests/Feature/DashboardSummaryTest.php

[DashboardSummaryTest.php](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/DashboardSummaryTest.php) · 1 条声明。

| 序号 / 行 | 当前测试名 | 决定 | 依据与后续处理 |
| --- | --- | --- | --- |
| 1 / [DashboardSummaryTest.php:8](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/DashboardSummaryTest.php:8) | returns the compact counts needed by the dashboard | R | 服务端按实际资料返回紧凑计数，保护首页业务汇总的来源；不同于前端下一步优先级。 |

## apps/api/tests/Feature/HistoricalCorrectionTest.php

[HistoricalCorrectionTest.php](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/HistoricalCorrectionTest.php) · 1 条声明。

| 序号 / 行 | 当前测试名 | 决定 | 依据与后续处理 |
| --- | --- | --- | --- |
| 1 / [HistoricalCorrectionTest.php:13](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/HistoricalCorrectionTest.php:13) | requires an administrator for identity corrections after a semester is closed | R | 学期关闭后只有管理员可做身份纠正，保护历史数据更正权限。 |

## apps/api/tests/Feature/LongTermChangeWorkbenchTest.php

[LongTermChangeWorkbenchTest.php](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/LongTermChangeWorkbenchTest.php) · 17 条声明。

| 序号 / 行 | 当前测试名 | 决定 | 依据与后续处理 |
| --- | --- | --- | --- |
| 1 / [LongTermChangeWorkbenchTest.php:53](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/LongTermChangeWorkbenchTest.php:53) | previews without persisting drafts, periods, messages or changing the revision | R | 预览不留下草稿、区间、消息或 revision 改动。 |
| 2 / [LongTermChangeWorkbenchTest.php:65](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/LongTermChangeWorkbenchTest.php:65) | publishes only the selected recurring changes and keeps earlier and later arrangements | R | 只发布选中的周期性变更，保留之前和之后的安排。 |
| 3 / [LongTermChangeWorkbenchTest.php:75](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/LongTermChangeWorkbenchTest.php:75) | preserves an unrelated future field change while applying a time change across periods | R | 跨区间时间变更保留不相关的未来字段变更。 |
| 4 / [LongTermChangeWorkbenchTest.php:83](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/LongTermChangeWorkbenchTest.php:83) | blocks overlapping edits to the same future field and rolls back every segment | R | 未来同字段有重叠编辑时拒绝，并回滚所有区间。 |
| 5 / [LongTermChangeWorkbenchTest.php:92](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/LongTermChangeWorkbenchTest.php:92) | swaps both recurring lessons atomically and refuses a one-sided collision | R | 周期性交换双方原子生效，单边冲突不能留下部分变更。 |
| 6 / [LongTermChangeWorkbenchTest.php:100](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/LongTermChangeWorkbenchTest.php:100) | swaps lessons of the same assignment without transient duplicate slots and restores their identities | R | 同一任课关系的课次交换不触发中间重复槽，身份保持可恢复。 |
| 7 / [LongTermChangeWorkbenchTest.php:126](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/LongTermChangeWorkbenchTest.php:126) | changes the effective teacher and sends private recurring messages to both teachers | C | 保留生效教师及双方长期消息生成；公共已读/越权读取断言可集中到 TemporaryAdjustmentWorkbench 第 4 项。仅局部合并，未做删除实验。 |
| 8 / [LongTermChangeWorkbenchTest.php:141](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/LongTermChangeWorkbenchTest.php:141) | rejects unqualified replacements and effective-teacher conflicts | R | 长期替换同时校验授课资格与实际生效教师的占用冲突。 |
| 9 / [LongTermChangeWorkbenchTest.php:151](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/LongTermChangeWorkbenchTest.php:151) | cancels a future change without erasing a later independent room change | R | 取消未来变更保留后来独立的教室变更。 |
| 10 / [LongTermChangeWorkbenchTest.php:162](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/LongTermChangeWorkbenchTest.php:162) | restores from a future date without rewriting already executed weeks | R | 从未来日期恢复不改写已经执行的历史周。 |
| 11 / [LongTermChangeWorkbenchTest.php:170](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/LongTermChangeWorkbenchTest.php:170) | blocks undo when a later time change depends on the current arrangement | R | 后来时间变更依赖当前安排时拒绝撤销，避免破坏依赖。 |
| 12 / [LongTermChangeWorkbenchTest.php:177](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/LongTermChangeWorkbenchTest.php:177) | preserves and validates existing temporary changes inside the interval | R | 长期发布保留并重新校验区间内已有临时变更。 |
| 13 / [LongTermChangeWorkbenchTest.php:184](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/LongTermChangeWorkbenchTest.php:184) | does not publish an assignment to a teacher on leave | R | 教师请假日期内不能发布其长期任课安排。 |
| 14 / [LongTermChangeWorkbenchTest.php:190](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/LongTermChangeWorkbenchTest.php:190) | searches records before pagination and filters by overlapping effective dates | F | 只有一条变更记录，查询/日期交叠/状态筛选有效，但未验证“先筛选后分页”；补跨页 fixture 或收窄标题。 |
| 15 / [LongTermChangeWorkbenchTest.php:199](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/LongTermChangeWorkbenchTest.php:199) | enforces permissions and optimistic concurrency for preview and publication | R | 预览与发布均检查权限和乐观并发版本。 |
| 16 / [LongTermChangeWorkbenchTest.php:211](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/LongTermChangeWorkbenchTest.php:211) | blocks a weekday change that would orphan an existing temporary occurrence | R | 改变星期不能让现有临时课次失去来源。 |
| 17 / [LongTermChangeWorkbenchTest.php:219](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/LongTermChangeWorkbenchTest.php:219) | returns only each records message receipts without marking messages as read | R | 每条记录仅返回自己的消息回执，查询回执不标为已读。 |

## apps/api/tests/Feature/PrelaunchRegressionTest.php

[PrelaunchRegressionTest.php](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/PrelaunchRegressionTest.php) · 17 条声明。

| 序号 / 行 | 当前测试名 | 决定 | 依据与后续处理 |
| --- | --- | --- | --- |
| 1 / [PrelaunchRegressionTest.php:35](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/PrelaunchRegressionTest.php:35) | R1 blocks moving an occurrence onto the same recurring lesson on another date | R | 跨日移动不能叠到同一周期课程的另一课次。 |
| 2 / [PrelaunchRegressionTest.php:45](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/PrelaunchRegressionTest.php:45) | R2 blocks undoing a cancellation after the released slot is reused | R | 停课释放的槽被复用后，撤销停课须拒绝。 |
| 3 / [PrelaunchRegressionTest.php:69](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/PrelaunchRegressionTest.php:69) | R3 finds substitutes using the moved lesson actual time | R | 代课候选依据移动后实际时刻查找，而非原始时刻。 |
| 4 / [PrelaunchRegressionTest.php:88](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/PrelaunchRegressionTest.php:88) | R4 counts scheduled workload within one version when editing weekly hours | R | 编辑周课时只计算单一版本工作量，避免多版本重复累计。 |
| 5 / [PrelaunchRegressionTest.php:100](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/PrelaunchRegressionTest.php:100) | R5 revalidates forbidden slots before publishing a cloned version | R | 克隆课表发布前重新检查现行禁排规则。 |
| 6 / [PrelaunchRegressionTest.php:118](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/PrelaunchRegressionTest.php:118) | R6 reports malformed CSV rows without crashing the whole preview | R | 畸形 CSV 行作为可报告错误返回，不让整个预览崩溃。 |
| 7 / [PrelaunchRegressionTest.php:126](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/PrelaunchRegressionTest.php:126) | R7 allows disjoint odd and even week loads that fit every actual week | R | 单双周错开且逐周容量足够的任课关系应允许。 |
| 8 / [PrelaunchRegressionTest.php:138](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/PrelaunchRegressionTest.php:138) | R8 checks moved-out destination when publishing a source-date room change | R | 源日期教室变更发布时也校验移出课次的实际目标日期。 |
| 9 / [PrelaunchRegressionTest.php:165](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/PrelaunchRegressionTest.php:165) | R10 accepts the corrected admin form payload for a specific teacher consecutive limit | R | 服务端接受指定教师连续课时上限的正确字段契约；前端表单另测序列化。 |
| 10 / [PrelaunchRegressionTest.php:174](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/PrelaunchRegressionTest.php:174) | R3 excludes a substitute who is busy at the moved time and rejects saving them | R | 移后时刻忙碌的教师既不能被推荐，也不能被直接提交为代课教师。 |
| 11 / [PrelaunchRegressionTest.php:197](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/PrelaunchRegressionTest.php:197) | R3 applies substitution to a moved-in lesson from a different effective version | R | 跨生效版本的移入课次仍能正确代课。 |
| 12 / [PrelaunchRegressionTest.php:218](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/PrelaunchRegressionTest.php:218) | R4 still rejects weekly hours below the workload of any single version | R | 任何单一版本已排量超过新周课时均须拒绝，和多版本误计数是相反边界。 |
| 13 / [PrelaunchRegressionTest.php:229](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/PrelaunchRegressionTest.php:229) | R5 checks actual fixed rooms against current hard rules even on locked entries | R | 发布时根据实际固定教室执行硬规则，锁定课次不能豁免。 |
| 14 / [PrelaunchRegressionTest.php:243](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/PrelaunchRegressionTest.php:243) | R5 refuses a clone that omits a newly activated fixed placement | R | 克隆缺少后来启用的固定安排时不能发布。 |
| 15 / [PrelaunchRegressionTest.php:255](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/PrelaunchRegressionTest.php:255) | R5 allows a valid locked clone to publish | R | 有效的锁定克隆应能发布，防止过严校验把合法路径一起封死。 |
| 16 / [PrelaunchRegressionTest.php:262](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/PrelaunchRegressionTest.php:262) | R5 rechecks aggregate teacher load rules across all placements before publishing | R | 发布前按全课表聚合教师负荷，不能只检查各条目局部。 |
| 17 / [PrelaunchRegressionTest.php:278](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/PrelaunchRegressionTest.php:278) | R7 checks specified weeks separately and rejects only an overlapping overloaded week | R | 指定周逐周计数，只拒绝真正重叠超载的周。 |

## apps/api/tests/Feature/PreparationCheckTest.php

[PreparationCheckTest.php](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/PreparationCheckTest.php) · 10 条声明。

| 序号 / 行 | 当前测试名 | 决定 | 依据与后续处理 |
| --- | --- | --- | --- |
| 1 / [PreparationCheckTest.php:19](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/PreparationCheckTest.php:19) | returns all preparation checks from current semester data | R | 准备检查从当前学期数据汇总真实检查项及状态。 |
| 2 / [PreparationCheckTest.php:51](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/PreparationCheckTest.php:51) | blocks preparation when a draft assignment exists | R | 有草稿任课关系时阻止进入排课。 |
| 3 / [PreparationCheckTest.php:69](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/PreparationCheckTest.php:69) | detects invalid assignment resources | R | 无效的教师、课程、教室等任课资源被报告为阻塞。 |
| 4 / [PreparationCheckTest.php:104](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/PreparationCheckTest.php:104) | detects theoretical capacity overload | R | 理论课时容量超限时阻止排课。 |
| 5 / [PreparationCheckTest.php:125](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/PreparationCheckTest.php:125) | detects conflicts between fixed placements | R | 固定安排之间有资源冲突时报告阻塞。 |
| 6 / [PreparationCheckTest.php:156](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/PreparationCheckTest.php:156) | blocks fixed placements forbidden by an active hard rule and clears the blocker after moving | R | 现行硬规则禁止的固定安排被阻止，移动到合法位置后解除。 |
| 7 / [PreparationCheckTest.php:206](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/PreparationCheckTest.php:206) | reports missing schedule and class setup as blockers | R | 缺作息或班级配置属于阻塞，不能被当作准备完成。 |
| 8 / [PreparationCheckTest.php:220](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/PreparationCheckTest.php:220) | reports missing soft rules and current timetable as warnings | R | 缺软规则或当前课表仅产生警告，不能错误阻塞首次排课。 |
| 9 / [PreparationCheckTest.php:236](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/PreparationCheckTest.php:236) | reports a current timetable based on older input as a warning | R | 当前课表基于旧输入时提示过期，不能继续视为最新。 |
| 10 / [PreparationCheckTest.php:250](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/PreparationCheckTest.php:250) | keeps preparation query count bounded for a medium school | R | 中等规模学校的查询数量有上界，防止 N+1 导致准备页面随规模失去可用性。 |

## apps/api/tests/Feature/ScheduleRunReliabilityTest.php

[ScheduleRunReliabilityTest.php](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/ScheduleRunReliabilityTest.php) · 19 条声明。

| 序号 / 行 | 当前测试名 | 决定 | 依据与后续处理 |
| --- | --- | --- | --- |
| 1 / [ScheduleRunReliabilityTest.php:27](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/ScheduleRunReliabilityTest.php:27) | persists the complete scheduling input baseline and dispatches a recoverable job after commit | F | 保留输入快照、耐久队列及重试超时关系；tries=3、backoff 精确数组、锁 330 秒等应区分运维契约与实现调参，当前标题也未实际运行提交后工作进程。 |
| 2 / [ScheduleRunReliabilityTest.php:83](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/ScheduleRunReliabilityTest.php:83) | rethrows retryable infrastructure failures and becomes terminal only after queue exhaustion | R | 可重试基础设施错误继续交给队列；只有耗尽重试才终结，不能提前写失败或候选。 |
| 3 / [ScheduleRunReliabilityTest.php:122](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/ScheduleRunReliabilityTest.php:122) | fails a legacy non-terminal run whose input snapshot is incomplete | R | 旧任务快照不完整时明确失败，不能拿实时数据补齐后悄悄求解。 |
| 4 / [ScheduleRunReliabilityTest.php:136](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/ScheduleRunReliabilityTest.php:136) | keeps a completed run idempotent when the same job is delivered again | R | 重复投递已完成任务不生成新的候选，保护队列幂等性。 |
| 5 / [ScheduleRunReliabilityTest.php:151](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/ScheduleRunReliabilityTest.php:151) | does not score rebuild tasks against the previous timetable or unconfigured soft dimensions | R | 重建任务不按旧课表或未配置软维度评分，启用权重仍归一化。 |
| 6 / [ScheduleRunReliabilityTest.php:166](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/ScheduleRunReliabilityTest.php:166) | keeps searching later candidates when an earlier candidate exhausts its attempts | F | 保留早期候选失败后继续搜索的结果；固定前 24 次失败依赖当前内部预算，建议用明确场景或受控预算表达候选耗尽。 |
| 7 / [ScheduleRunReliabilityTest.php:202](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/ScheduleRunReliabilityTest.php:202) | fails only after every requested candidate exhausts its attempts without a solution | F | 保留所有候选耗尽才返回无解及诊断；72 次调用绑定 3×24 的实现次数，不能因调优预算就认定业务回归。 |
| 8 / [ScheduleRunReliabilityTest.php:235](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/ScheduleRunReliabilityTest.php:235) | solves saturated class schedules that must alternate shared teachers across every slot | R | 共享教师满负载交替排课仍能求解，并逐槽验证教师不冲突。 |
| 9 / [ScheduleRunReliabilityTest.php:297](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/ScheduleRunReliabilityTest.php:297) | does not let a stale worker overwrite cancellation at the final checkpoint | F | 取消不能被旧 worker 覆盖值得保留；用第 3 次特定 SQL 读取插入取消较脆，需明确其对应检查点，避免查询重构误报。 |
| 10 / [ScheduleRunReliabilityTest.php:332](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/ScheduleRunReliabilityTest.php:332) | rechecks every revision in the locked completion transaction | F | 仅改变 catalog_revision，没有逐个触发标题宣称的 every revision；且依赖第 3 次 SQL 读取。保留最终事务复查，修正范围与注入方式。 |
| 11 / [ScheduleRunReliabilityTest.php:362](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/ScheduleRunReliabilityTest.php:362) | solves against the immutable constraint snapshot instead of changed live rows | R | 生成使用不可变规则快照，不受执行期间实时规则行修改影响。 |
| 12 / [ScheduleRunReliabilityTest.php:389](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/ScheduleRunReliabilityTest.php:389) | rejects adopting a candidate after catalog resources or qualifications change | R | 资料或资格改变后旧候选不能采用，且不生成课表版本。 |
| 13 / [ScheduleRunReliabilityTest.php:423](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/ScheduleRunReliabilityTest.php:423) | keeps completed candidates usable when only operational timetable revision changes | R | 纯运营 timetable revision 变化不误判候选输入过期。 |
| 14 / [ScheduleRunReliabilityTest.php:454](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/ScheduleRunReliabilityTest.php:454) | marks completed candidates stale when their current baseline version is replaced | R | 当前基准版本被替换后旧候选失效，不能继续采用。 |
| 15 / [ScheduleRunReliabilityTest.php:503](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/ScheduleRunReliabilityTest.php:503) | treats a completed legacy candidate with an incomplete run snapshot as stale | R | 已完成的旧候选仍需完整快照，不能绕过采用检查。 |
| 16 / [ScheduleRunReliabilityTest.php:524](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/ScheduleRunReliabilityTest.php:524) | rejects adoption when the selected base version lock baseline changes | R | 选定基准版本锁定信息改变后候选失效。 |
| 17 / [ScheduleRunReliabilityTest.php:551](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/ScheduleRunReliabilityTest.php:551) | carries candidate revision snapshots into drafts and rechecks them on activation | R | 候选快照传递到草稿，启用时再次校验资料 revision。 |
| 18 / [ScheduleRunReliabilityTest.php:577](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/ScheduleRunReliabilityTest.php:577) | rejects activating a legacy draft without a catalog revision snapshot | R | 缺 catalog 快照的旧草稿不能启用，状态保持草稿。 |
| 19 / [ScheduleRunReliabilityTest.php:595](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/ScheduleRunReliabilityTest.php:595) | generates synchronized lessons when the primary assignment is placed before its peer | R | 主任课关系先放置时同步排课仍满足同星期同课节，不能被软偏好拆散。 |

## apps/api/tests/Feature/SchedulingConstraintTest.php

[SchedulingConstraintTest.php](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/SchedulingConstraintTest.php) · 4 条声明。

| 序号 / 行 | 当前测试名 | 决定 | 依据与后续处理 |
| --- | --- | --- | --- |
| 1 / [SchedulingConstraintTest.php:16](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/SchedulingConstraintTest.php:16) | creates, activates, filters and protects scheduling constraints | R | 规则创建、启用、过滤以及修改保护构成规则生命周期。 |
| 2 / [SchedulingConstraintTest.php:91](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/SchedulingConstraintTest.php:91) | rejects unsupported kind category pairs and non strict nested payloads | R | 拒绝未支持的 kind/category 和不严格嵌套字段，不能把任意模型数据写成规则。 |
| 3 / [SchedulingConstraintTest.php:167](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/SchedulingConstraintTest.php:167) | accepts every template soft rule implemented by generation and manual diagnostics | F | 循环只创建六类软规则并断言 category，未运行生成或手工诊断；改名为规则输入接受范围，执行语义仍由各执行边界保留。 |
| 4 / [SchedulingConstraintTest.php:192](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/SchedulingConstraintTest.php:192) | blocks preparation when a legacy active rule cannot be executed | R | 旧版不可执行的激活规则会阻塞准备检查，不能静默忽略。 |

## apps/api/tests/Feature/SchoolSettingsTest.php

[SchoolSettingsTest.php](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/SchoolSettingsTest.php) · 5 条声明。

| 序号 / 行 | 当前测试名 | 决定 | 依据与后续处理 |
| --- | --- | --- | --- |
| 1 / [SchoolSettingsTest.php:12](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/SchoolSettingsTest.php:12) | publishes only the system name without authentication | F | 公开 branding 与受保护配置的分界应保留；不必固定默认学校文案，改用非默认资料验证只公开允许字段。标题还漏写 tagline。 |
| 2 / [SchoolSettingsTest.php:19](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/SchoolSettingsTest.php:19) | persists the system name with concurrency protection and an audit record | R | 设置持久化、审计与并发版本保护，旧版本不能覆盖新名称。 |
| 3 / [SchoolSettingsTest.php:39](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/SchoolSettingsTest.php:39) | rejects invalid names and attempts to change the fixed timezone | R | 非法长度、类型和固定时区修改均拒绝，原设置保持；各参数场景保留。 |
| 4 / [SchoolSettingsTest.php:53](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/SchoolSettingsTest.php:53) | uses China time even when a legacy setting contains another timezone | R | 旧数据含其他时区时仍按学校固定中国时间解释日期。 |
| 5 / [SchoolSettingsTest.php:61](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/SchoolSettingsTest.php:61) | saves, preserves and clears the optional tagline | R | 可选标语的保存、未传保留、显式清空各有不同写入语义。 |

## apps/api/tests/Feature/ServerPaginationTest.php

[ServerPaginationTest.php](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/ServerPaginationTest.php) · 3 条声明。

| 序号 / 行 | 当前测试名 | 决定 | 依据与后续处理 |
| --- | --- | --- | --- |
| 1 / [ServerPaginationTest.php:26](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/ServerPaginationTest.php:26) | paginates and filters growing catalog and user lists on the server | R | 增长后的资料和账号列表在服务端筛选分页，防止只筛当前页。 |
| 2 / [ServerPaginationTest.php:66](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/ServerPaginationTest.php:66) | paginates classes, semester settings, and teaching groups without losing filters | R | 班级、学期设置、教学组分页保留筛选条件。 |
| 3 / [ServerPaginationTest.php:133](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/ServerPaginationTest.php:133) | pages large CSV previews on the server while preserving the cross-page selection set | R | 大 CSV 预览分页后跨页选择集合仍完整，避免漏导入。 |

## apps/api/tests/Feature/TeachingAssignmentTest.php

[TeachingAssignmentTest.php](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/TeachingAssignmentTest.php) · 1 条声明。

| 序号 / 行 | 当前测试名 | 决定 | 依据与后续处理 |
| --- | --- | --- | --- |
| 1 / [TeachingAssignmentTest.php:16](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/TeachingAssignmentTest.php:16) | supports teaching groups, collaborators, consecutive items and specified weeks | R | 教学组、协同教师、连堂与指定周字段通过真实任课写入保存，保护复杂关联契约。 |

## apps/api/tests/Feature/TemporaryAdjustmentWorkbenchTest.php

[TemporaryAdjustmentWorkbenchTest.php](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/TemporaryAdjustmentWorkbenchTest.php) · 18 条声明。

| 序号 / 行 | 当前测试名 | 决定 | 依据与后续处理 |
| --- | --- | --- | --- |
| 1 / [TemporaryAdjustmentWorkbenchTest.php:43](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/TemporaryAdjustmentWorkbenchTest.php:43) | publishes a cross-date swap atomically with exact before and after dates | R | 跨日交换双方原子发布且前后日期明确。 |
| 2 / [TemporaryAdjustmentWorkbenchTest.php:57](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/TemporaryAdjustmentWorkbenchTest.php:57) | rejects an inactive target occurrence and duplicate edits on the target day | R | 目标课次无效或当天已有重复编辑时拒绝。 |
| 3 / [TemporaryAdjustmentWorkbenchTest.php:64](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/TemporaryAdjustmentWorkbenchTest.php:64) | checks both target times against teacher leave and writes no partial result | R | 同时校验交换双方目标时刻的请假，失败时无部分写入。 |
| 4 / [TemporaryAdjustmentWorkbenchTest.php:72](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/TemporaryAdjustmentWorkbenchTest.php:72) | keeps teacher messages private and marks only an opened personal message read | R | 教师消息所有权隔离，只有打开自己的消息才标已读；作为公共消息读取语义的主用例。 |
| 5 / [TemporaryAdjustmentWorkbenchTest.php:86](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/TemporaryAdjustmentWorkbenchTest.php:86) | allows publication without generating messages and rejects stale publish attempts | R | 可选择不发消息，但旧发布版本仍被拒绝。 |
| 6 / [TemporaryAdjustmentWorkbenchTest.php:94](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/TemporaryAdjustmentWorkbenchTest.php:94) | finds independently scoped cross-course options using the same conflict validation | R | 跨课程目标选项独立筛选，并采用相同冲突校验。 |
| 7 / [TemporaryAdjustmentWorkbenchTest.php:100](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/TemporaryAdjustmentWorkbenchTest.php:100) | supports cross-week swaps and preserves other recurring occurrences | R | 跨周交换只影响指定课次，不修改其他周期课次。 |
| 8 / [TemporaryAdjustmentWorkbenchTest.php:106](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/TemporaryAdjustmentWorkbenchTest.php:106) | rebinds each side independently when a long-term version covers only the swap target | R | 长期版本仅覆盖交换一侧时，各侧独立重绑。 |
| 9 / [TemporaryAdjustmentWorkbenchTest.php:115](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/TemporaryAdjustmentWorkbenchTest.php:115) | finds a cross-date adjustment when filtering only its replacement date | R | 按替换日期也能找到跨日调整，不能只查源日期。 |
| 10 / [TemporaryAdjustmentWorkbenchTest.php:124](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/TemporaryAdjustmentWorkbenchTest.php:124) | rolls back the timetable change if creating its messages fails | R | 消息写入失败时整笔课表变更回滚，避免通知与安排不一致。 |
| 11 / [TemporaryAdjustmentWorkbenchTest.php:133](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/TemporaryAdjustmentWorkbenchTest.php:133) | refuses withdrawal when a later substitution depends on the moved occurrence | R | 后续代课依赖已移动课次时不能撤回来源。 |
| 12 / [TemporaryAdjustmentWorkbenchTest.php:140](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/TemporaryAdjustmentWorkbenchTest.php:140) | searches the complete target range before paginating and keeps later days reachable | R | 先搜索整个日期范围再分页，后续日期仍可到达。 |
| 13 / [TemporaryAdjustmentWorkbenchTest.php:150](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/TemporaryAdjustmentWorkbenchTest.php:150) | filters a known target period before pagination and keeps later dates reachable | R | 已知目标课节条件在分页之前应用，避免漏掉后续日期。 |
| 14 / [TemporaryAdjustmentWorkbenchTest.php:159](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/TemporaryAdjustmentWorkbenchTest.php:159) | filters the target class before pagination and includes merged-class lessons | R | 目标班级筛选在分页前完成并包括合班课。 |
| 15 / [TemporaryAdjustmentWorkbenchTest.php:178](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/TemporaryAdjustmentWorkbenchTest.php:178) | keeps conflicting targets visible in chronological order without recommending or hiding them | R | 冲突候选按时间显示但不能被推荐，避免以隐藏方式误导无目标。 |
| 16 / [TemporaryAdjustmentWorkbenchTest.php:186](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/TemporaryAdjustmentWorkbenchTest.php:186) | uses current restored resource details in withdrawal messages while preserving the original snapshot | R | 撤回消息使用当前恢复后的资源信息，同时保留原快照。 |
| 17 / [TemporaryAdjustmentWorkbenchTest.php:197](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/TemporaryAdjustmentWorkbenchTest.php:197) | keeps preview, actual timetable and messages consistent for replacement resources | R | 资源替换的预览、实际课表与消息内容一致。 |
| 18 / [TemporaryAdjustmentWorkbenchTest.php:210](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/TemporaryAdjustmentWorkbenchTest.php:210) | searches both sides of adjustment records before pagination and combines filters | R | 调整列表先查交换双方再分页，组合筛选不会漏记录。 |

## apps/api/tests/Feature/TimetableVersionTest.php

[TimetableVersionTest.php](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/TimetableVersionTest.php) · 18 条声明。

| 序号 / 行 | 当前测试名 | 决定 | 依据与后续处理 |
| --- | --- | --- | --- |
| 1 / [TimetableVersionTest.php:21](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/TimetableVersionTest.php:21) | keeps active timetable versions immutable and promotes a complete draft without approval | R | 当前课表不可直接改写；完整草稿启用后旧版转历史、当前指针切换，版本比较保留差异。 |
| 2 / [TimetableVersionTest.php:97](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/TimetableVersionTest.php:97) | generates comparable candidates and directly adopts one as the current timetable | R | 生成候选、采用为当前课表并建立关联，重复采用被拒绝。 |
| 3 / [TimetableVersionTest.php:157](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/TimetableVersionTest.php:157) | publishes a regenerated candidate while preserving temporary adjustments by stable lesson identity | R | 重新生成发布通过稳定 lesson_instance_id 保留临时安排，不能只依赖新 entry_key。 |
| 4 / [TimetableVersionTest.php:232](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/TimetableVersionTest.php:232) | blocks publication when a temporary adjustment references a lesson moved to another weekday | R | 课次改到另一星期导致临时安排待复核时拒绝发布，原当前版本和引用保持。 |
| 5 / [TimetableVersionTest.php:290](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/TimetableVersionTest.php:290) | uses a selected draft as the preserved baseline for local replanning | F | 只断言任务完成且有一条结果，未核对选中草稿的具体保留位置或范围外课次；不能充分证明选定基准被采用。 |
| 6 / [TimetableVersionTest.php:323](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/TimetableVersionTest.php:323) | preserves existing placements while automatically filling the remaining class items | R | 自动补齐未排课时同时保留已有位置，结果完整且无硬冲突。 |
| 7 / [TimetableVersionTest.php:368](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/TimetableVersionTest.php:368) | calculates each assignment remaining count against the timetable version being viewed | R | 剩余课时按正在查看的版本计数，不能混用另一草稿。 |
| 8 / [TimetableVersionTest.php:408](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/TimetableVersionTest.php:408) | places every multi-item teaching session in consecutive slots | R | 多课节教学场次必须落在同一天连续槽位。 |
| 9 / [TimetableVersionTest.php:434](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/TimetableVersionTest.php:434) | enforces a hard teacher daily item limit while solving | R | 求解器执行教师每日硬课时上限，结果分散到合法日期。 |
| 10 / [TimetableVersionTest.php:473](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/TimetableVersionTest.php:473) | allows the same resources in disjoint specified weeks and blocks real week overlap | R | 指定周不重叠可共用资源，真实重叠周必须拒绝。 |
| 11 / [TimetableVersionTest.php:544](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/TimetableVersionTest.php:544) | diagnoses a timetable move before saving and suggests feasible alternatives | R | 移动预诊断给出允许状态和可行备选位置，保护预览入口。 |
| 12 / [TimetableVersionTest.php:566](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/TimetableVersionTest.php:566) | returns readable hard conflicts when a proposed timetable slot is occupied | R | 占用位置的诊断提供具体冲突资源，用户能定位阻塞原因。 |
| 13 / [TimetableVersionTest.php:609](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/TimetableVersionTest.php:609) | enforces hard scheduling rules again when a timetable entry is saved | R | 提交入口独立重检硬规则，不能绕过预诊断直接写入。 |
| 14 / [TimetableVersionTest.php:648](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/TimetableVersionTest.php:648) | diagnoses the supported preferred slot semantics used by the solver | R | 手工诊断返回偏好时段软警告且不禁止合法移动。 |
| 15 / [TimetableVersionTest.php:685](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/TimetableVersionTest.php:685) | previews and atomically swaps two timetable entries | R | 交换预览与实际原子写入都验证双方最终位置。 |
| 16 / [TimetableVersionTest.php:745](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/TimetableVersionTest.php:745) | rejects a synchronization rule and version whose existing positions are misaligned | R | 同步组已有位置错位时，规则启用、课表发布及编辑均不能绕过检查。 |
| 17 / [TimetableVersionTest.php:806](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/TimetableVersionTest.php:806) | creates moves and deletes a hard synchronization group atomically | R | 同步组创建、锁定、移动、删除整组原子处理，锁定成员能阻止局部修改。 |
| 18 / [TimetableVersionTest.php:898](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/TimetableVersionTest.php:898) | does not create another synchronization group after its members reach their weekly limit | R | 同步组成员达到周课时上限后不再增排，失败不产生额外条目。 |

## apps/api/tests/Feature/TimetableWorkflowTest.php

[TimetableWorkflowTest.php](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/TimetableWorkflowTest.php) · 3 条声明。

| 序号 / 行 | 当前测试名 | 决定 | 依据与后续处理 |
| --- | --- | --- | --- |
| 1 / [TimetableWorkflowTest.php:16](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/TimetableWorkflowTest.php:16) | enforces optimistic concurrency for catalog writes | R | 资料写入必须使用正确 ETag，保护公共乐观锁契约。 |
| 2 / [TimetableWorkflowTest.php:32](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/TimetableWorkflowTest.php:32) | updates a teacher course assignment through the declared pivot table | R | 教师课程关联通过指定中间表更新并支持清空，不能被只新增关联的流程代替。 |
| 3 / [TimetableWorkflowTest.php:55](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/TimetableWorkflowTest.php:55) | builds a semester and rejects a teacher conflict in the same slot | R | 真实学期建档到排课链路拒绝同槽教师冲突，并验证导出业务数据。 |

## apps/api/tests/Feature/ViewerTimetableAccessTest.php

[ViewerTimetableAccessTest.php](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/ViewerTimetableAccessTest.php) · 1 条声明。

| 序号 / 行 | 当前测试名 | 决定 | 依据与后续处理 |
| --- | --- | --- | --- |
| 1 / [ViewerTimetableAccessTest.php:11](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/ViewerTimetableAccessTest.php:11) | keeps draft timetable versions out of every viewer read path | R | 所有 viewer 读取入口隐藏草稿，返回指定 VERSION_NOT_PUBLISHED 业务码，不能仅靠前端下拉框隐藏。 |

## apps/api/tests/Unit/SimpleXlsxWriterTest.php

[SimpleXlsxWriterTest.php](/Users/leslielau/project/dev/timetable/apps/api/tests/Unit/SimpleXlsxWriterTest.php) · 1 条声明。

| 序号 / 行 | 当前测试名 | 决定 | 依据与后续处理 |
| --- | --- | --- | --- |
| 1 / [SimpleXlsxWriterTest.php:8](/Users/leslielau/project/dev/timetable/apps/api/tests/Unit/SimpleXlsxWriterTest.php:8) | keeps formula-like timetable content as text and escapes XML characters | R | 公式样式的用户资料按文本导出，XML 字符正确转义；保护导出内容和安全，不是 A4 样式校验。 |

## apps/teacher/src/lib/timetable.test.ts

[timetable.test.ts](/Users/leslielau/project/dev/timetable/apps/teacher/src/lib/timetable.test.ts) · 6 条声明。

| 序号 / 行 | 当前测试名 | 决定 | 依据与后续处理 |
| --- | --- | --- | --- |
| 1 / [timetable.test.ts:30](/Users/leslielau/project/dev/timetable/apps/teacher/src/lib/timetable.test.ts:30) | rejects incomplete, invalid and out-of-semester input %s | R | 不完整、非法和学期外日期不能进入教师课表查询；保留全部参数场景。 |
| 2 / [timetable.test.ts:37](/Users/leslielau/project/dev/timetable/apps/teacher/src/lib/timetable.test.ts:37) | accepts valid dates including both semester boundaries | R | 合法日期及学期首尾边界均可选择，防止边界误拒绝。 |
| 3 / [timetable.test.ts:47](/Users/leslielau/project/dev/timetable/apps/teacher/src/lib/timetable.test.ts:47) | keeps an unchanged lesson unlabelled | R | 未变更课次不加异常标签，避免错误通知教师有职责变动。 |
| 4 / [timetable.test.ts:51](/Users/leslielau/project/dev/timetable/apps/teacher/src/lib/timetable.test.ts:51) | makes a replacement duty explicit | R | 替代职责应明确告知教师需要新增到课。 |
| 5 / [timetable.test.ts:57](/Users/leslielau/project/dev/timetable/apps/teacher/src/lib/timetable.test.ts:57) | shows when the teacher no longer needs to attend | R | 免除或取消职责应明确告知教师无需到课。 |
| 6 / [timetable.test.ts:67](/Users/leslielau/project/dev/timetable/apps/teacher/src/lib/timetable.test.ts:67) | distinguishes ongoing and completed lessons | R | 依据课节时间区分进行中和已结束，保留业务状态，不固定视觉徽章样式。 |

## apps/web/src/components/grouped-assignments-view.test.ts

[grouped-assignments-view.test.ts](/Users/leslielau/project/dev/timetable/apps/web/src/components/grouped-assignments-view.test.ts) · 5 条声明。

| 序号 / 行 | 当前测试名 | 决定 | 依据与后续处理 |
| --- | --- | --- | --- |
| 1 / [grouped-assignments-view.test.ts:45](/Users/leslielau/project/dev/timetable/apps/web/src/components/grouped-assignments-view.test.ts:45) | duplicates a teaching-group assignment into each member class | R | 合班任课必须进入每个成员班级且数量正确，不能只显示主班。 |
| 2 / [grouped-assignments-view.test.ts:67](/Users/leslielau/project/dev/timetable/apps/web/src/components/grouped-assignments-view.test.ts:67) | places primary and collaborating assignments under each teacher | R | 主讲与协同教师都能查到对应任课，职责标签保持正确。 |
| 3 / [grouped-assignments-view.test.ts:77](/Users/leslielau/project/dev/timetable/apps/web/src/components/grouped-assignments-view.test.ts:77) | groups by course and keeps assignment totals | R | 课程分组的周课时汇总准确，防止相加漏项或串科。 |
| 4 / [grouped-assignments-view.test.ts:91](/Users/leslielau/project/dev/timetable/apps/web/src/components/grouped-assignments-view.test.ts:91) | resolves fixed, specified, missing, and teaching-group classroom buckets | F | 当前只断言四个桶名称，任课关系分错桶也可能通过；应断言每个桶的 assignment ID 集合。 |
| 5 / [grouped-assignments-view.test.ts:129](/Users/leslielau/project/dev/timetable/apps/web/src/components/grouped-assignments-view.test.ts:129) | finds a group through group name or a child assignment | R | 可通过班级组名或内部任课教师检索到正确组，防止只过滤组标题。 |

## apps/web/src/components/resource-picker.test.ts

[resource-picker.test.ts](/Users/leslielau/project/dev/timetable/apps/web/src/components/resource-picker.test.ts) · 3 条声明。

| 序号 / 行 | 当前测试名 | 决定 | 依据与后续处理 |
| --- | --- | --- | --- |
| 1 / [resource-picker.test.ts:17](/Users/leslielau/project/dev/timetable/apps/web/src/components/resource-picker.test.ts:17) | matches visible labels and employee numbers | R | 资源名称和工号均可找到目标，保护实际查找方式。 |
| 2 / [resource-picker.test.ts:22](/Users/leslielau/project/dev/timetable/apps/web/src/components/resource-picker.test.ts:22) | matches full pinyin and pinyin initials | R | 全拼与拼音首字母能匹配中文资源名，具有独立搜索语义。 |
| 3 / [resource-picker.test.ts:28](/Users/leslielau/project/dev/timetable/apps/web/src/components/resource-picker.test.ts:28) | matches subject search text and rejects unrelated input | R | 学科关联文本参与搜索，无关输入不命中。 |

## apps/web/src/lib/adjustment-detail.test.ts

[adjustment-detail.test.ts](/Users/leslielau/project/dev/timetable/apps/web/src/lib/adjustment-detail.test.ts) · 8 条声明。

| 序号 / 行 | 当前测试名 | 决定 | 依据与后续处理 |
| --- | --- | --- | --- |
| 1 / [adjustment-detail.test.ts:56](/Users/leslielau/project/dev/timetable/apps/web/src/lib/adjustment-detail.test.ts:56) | also shows resource overrides attached to a time move | R | 时间调整附带替换教师、教室时详情不能漏掉资源变化。 |
| 2 / [adjustment-detail.test.ts:70](/Users/leslielau/project/dev/timetable/apps/web/src/lib/adjustment-detail.test.ts:70) | shows both directions even when the exchanged courses have identical names | R | 同名课程交换仍显示双向不同时间和日期，避免按课程名合并；已有数量及具体时间锚点。 |
| 3 / [adjustment-detail.test.ts:79](/Users/leslielau/project/dev/timetable/apps/web/src/lib/adjustment-detail.test.ts:79) | keeps same-day swaps on the original date when no replacement date is recorded | F | 只比较同一输出的 before/after 日期，两边同时算错仍通过；改为都断言原始 9/14。 |
| 4 / [adjustment-detail.test.ts:83](/Users/leslielau/project/dev/timetable/apps/web/src/lib/adjustment-detail.test.ts:83) | shows the changed primary teacher and preserves collaborating teachers as context | R | 更换主讲时协同教师仍显示为不变，不能错误移除整个教学团队。 |
| 5 / [adjustment-detail.test.ts:93](/Users/leslielau/project/dev/timetable/apps/web/src/lib/adjustment-detail.test.ts:93) | does not assign original resources to %s | R | 停课和活动不沿用原教师、教室占用信息，两种参数场景分别保留。 |
| 6 / [adjustment-detail.test.ts:99](/Users/leslielau/project/dev/timetable/apps/web/src/lib/adjustment-detail.test.ts:99) | shows added course resources without inventing an original lesson | R | 历史补课显示新增资源而不编造原课，虽然新建补课已禁用，历史读取仍在使用。 |
| 7 / [adjustment-detail.test.ts:117](/Users/leslielau/project/dev/timetable/apps/web/src/lib/adjustment-detail.test.ts:117) | distinguishes reciprocal weekly swaps from unrelated time moves | R | 互换同周期时间才识别为换课；无关时间移动与不同生效区间不能误合并。 |
| 8 / [adjustment-detail.test.ts:139](/Users/leslielau/project/dev/timetable/apps/web/src/lib/adjustment-detail.test.ts:139) | does not hide additional fields or effective intervals in a mixed recurring adjustment | R | 组合调整显示附加字段和各自生效区间，避免隐藏部分变更。 |

## apps/web/src/lib/api.test.ts

[api.test.ts](/Users/leslielau/project/dev/timetable/apps/web/src/lib/api.test.ts) · 3 条声明。

| 序号 / 行 | 当前测试名 | 决定 | 依据与后续处理 |
| --- | --- | --- | --- |
| 1 / [api.test.ts:7](/Users/leslielau/project/dev/timetable/apps/web/src/lib/api.test.ts:7) | refreshes an expired CSRF cookie once before retrying a write | R | CSRF 到期时刷新一次 Cookie 再重试写入，保护真实请求恢复流程。 |
| 2 / [api.test.ts:37](/Users/leslielau/project/dev/timetable/apps/web/src/lib/api.test.ts:37) | downloads binary responses and reads an RFC 5987 filename | R | 二进制下载及 RFC 5987 文件名正确解析，避免导出损坏或乱码。 |
| 3 / [api.test.ts:64](/Users/leslielau/project/dev/timetable/apps/web/src/lib/api.test.ts:64) | rejects paginated results assembled from different ETag revisions | R | 跨页响应 ETag 不同则拒绝拼接，防止把不同版本资料混成一个快照。 |

## apps/web/src/lib/candidate-quality.test.ts

[candidate-quality.test.ts](/Users/leslielau/project/dev/timetable/apps/web/src/lib/candidate-quality.test.ts) · 3 条声明。

| 序号 / 行 | 当前测试名 | 决定 | 依据与后续处理 |
| --- | --- | --- | --- |
| 1 / [candidate-quality.test.ts:40](/Users/leslielau/project/dev/timetable/apps/web/src/lib/candidate-quality.test.ts:40) | does not recommend a high overall score with a severely poor teacher experience | R | 综合高分不能掩盖严重教师体验问题，保护推荐门槛。 |
| 2 / [candidate-quality.test.ts:54](/Users/leslielau/project/dev/timetable/apps/web/src/lib/candidate-quality.test.ts:54) | recommends only complete, conflict-free candidates above every floor | F | 只测正常与未排齐，没有硬冲突或全部维度门槛样本。删掉硬冲突判断后 Web 89 项仍全过；优先修正，不能删除这条业务保护意图。 |
| 3 / [candidate-quality.test.ts:59](/Users/leslielau/project/dev/timetable/apps/web/src/lib/candidate-quality.test.ts:59) | ignores recommendation floors for dimensions that are not active in the score | R | 权重为零的未启用维度不参与推荐门槛，避免误拒合法方案。 |

## apps/web/src/lib/daily-adjustments.test.ts

[daily-adjustments.test.ts](/Users/leslielau/project/dev/timetable/apps/web/src/lib/daily-adjustments.test.ts) · 8 条声明。

| 序号 / 行 | 当前测试名 | 决定 | 依据与后续处理 |
| --- | --- | --- | --- |
| 1 / [daily-adjustments.test.ts:31](/Users/leslielau/project/dev/timetable/apps/web/src/lib/daily-adjustments.test.ts:31) | combines course choices with OR and categories with AND | R | 同类课程选项取并集，不同筛选类别取交集，保护筛选逻辑。 |
| 2 / [daily-adjustments.test.ts:46](/Users/leslielau/project/dev/timetable/apps/web/src/lib/daily-adjustments.test.ts:46) | supports merged classes and collaborating teachers without mixing object kinds | R | 合班和协同教师可命中，但不同对象种类的相同 ID 不能混用。 |
| 3 / [daily-adjustments.test.ts:52](/Users/leslielau/project/dev/timetable/apps/web/src/lib/daily-adjustments.test.ts:52) | clamps week ranges at semester boundaries and rejects impossible dates | R | 按学期边界裁剪周范围，并拒绝不存在的日期。 |
| 4 / [daily-adjustments.test.ts:64](/Users/leslielau/project/dev/timetable/apps/web/src/lib/daily-adjustments.test.ts:64) | sends cross-date swaps as a single action and drops stale type-specific fields | R | 跨日换课生成单一原子动作，切换类型清除过期字段。 |
| 5 / [daily-adjustments.test.ts:86](/Users/leslielau/project/dev/timetable/apps/web/src/lib/daily-adjustments.test.ts:86) | requires a target and meaningful reason before review | R | 预览前必须有目标与有效原因，防止提交不完整调整。 |
| 6 / [daily-adjustments.test.ts:120](/Users/leslielau/project/dev/timetable/apps/web/src/lib/daily-adjustments.test.ts:120) | uses each side's actual date and lesson, including collaborating teachers | R | 交换两侧使用各自实际日期和课次，包含协同教师信息。 |
| 7 / [daily-adjustments.test.ts:128](/Users/leslielau/project/dev/timetable/apps/web/src/lib/daily-adjustments.test.ts:128) | distinguishes moving a lesson from changing its teacher or room | R | 调时间、更换教师与换教室显示不同业务变化。 |
| 8 / [daily-adjustments.test.ts:139](/Users/leslielau/project/dev/timetable/apps/web/src/lib/daily-adjustments.test.ts:139) | shows the occupied time for makeup and the emptied time for cancellation | R | 历史补课显示占用时段，停课显示释放时段。 |

## apps/web/src/lib/dashboard.test.ts

[dashboard.test.ts](/Users/leslielau/project/dev/timetable/apps/web/src/lib/dashboard.test.ts) · 10 条声明。

| 序号 / 行 | 当前测试名 | 决定 | 依据与后续处理 |
| --- | --- | --- | --- |
| 1 / [dashboard.test.ts:42](/Users/leslielau/project/dev/timetable/apps/web/src/lib/dashboard.test.ts:42) | puts missing prerequisites ahead of generating a timetable | R | 缺少准备条件时优先引导补齐，不能直接建议生成。 |
| 2 / [dashboard.test.ts:52](/Users/leslielau/project/dev/timetable/apps/web/src/lib/dashboard.test.ts:52) | does not treat zero assignments as confirmed preparation | R | 零任课关系不能误判为已确认完成准备。 |
| 3 / [dashboard.test.ts:57](/Users/leslielau/project/dev/timetable/apps/web/src/lib/dashboard.test.ts:57) | does not present old conflict and remaining counts as current tasks | R | 旧课表冲突和剩余量不当作当前任务计数。 |
| 4 / [dashboard.test.ts:68](/Users/leslielau/project/dev/timetable/apps/web/src/lib/dashboard.test.ts:68) | continues a fresh draft instead of asking for another generation | R | 存在有效草稿时继续处理该草稿，避免重复生成。 |
| 5 / [dashboard.test.ts:77](/Users/leslielau/project/dev/timetable/apps/web/src/lib/dashboard.test.ts:77) | does not direct the user to an outdated working draft | R | 过期工作草稿不能成为下一步操作入口。 |
| 6 / [dashboard.test.ts:87](/Users/leslielau/project/dev/timetable/apps/web/src/lib/dashboard.test.ts:87) | prioritizes hard conflicts before missing periods and soft warnings | R | 硬冲突优先于漏排和软警告，保护任务处理顺序。 |
| 7 / [dashboard.test.ts:97](/Users/leslielau/project/dev/timetable/apps/web/src/lib/dashboard.test.ts:97) | does not invent tasks for a complete current timetable | R | 完整当前课表不凭空产生待办事项。 |
| 8 / [dashboard.test.ts:103](/Users/leslielau/project/dev/timetable/apps/web/src/lib/dashboard.test.ts:103) | separates temporal phase from whether the semester is editable | R | 学期时间阶段和是否可编辑分开判断，关闭状态不被日期覆盖。 |
| 9 / [dashboard.test.ts:109](/Users/leslielau/project/dev/timetable/apps/web/src/lib/dashboard.test.ts:109) | uses the school's date even when the browser is on another calendar day | R | 学校日期优先于浏览器本地日期，防止跨时区错一天。 |
| 10 / [dashboard.test.ts:114](/Users/leslielau/project/dev/timetable/apps/web/src/lib/dashboard.test.ts:114) | counts calendar days across daylight-saving and month boundaries | R | 跨夏令时和月份仍按日历天数计算，不用固定毫秒错误折算。 |

## apps/web/src/lib/grade-timetable.test.ts

[grade-timetable.test.ts](/Users/leslielau/project/dev/timetable/apps/web/src/lib/grade-timetable.test.ts) · 8 条声明。

| 序号 / 行 | 当前测试名 | 决定 | 依据与后续处理 |
| --- | --- | --- | --- |
| 1 / [grade-timetable.test.ts:37](/Users/leslielau/project/dev/timetable/apps/web/src/lib/grade-timetable.test.ts:37) | uses only participating active classes and sorts class numbers naturally | R | 只列参与且启用的班级，班号自然排序而非字典序。 |
| 2 / [grade-timetable.test.ts:49](/Users/leslielau/project/dev/timetable/apps/web/src/lib/grade-timetable.test.ts:49) | places a shared lesson into every member class without duplicate class membership | R | 共享课次进入所有成员班级且不重复，其他年级不混入。 |
| 3 / [grade-timetable.test.ts:56](/Users/leslielau/project/dev/timetable/apps/web/src/lib/grade-timetable.test.ts:56) | does not infer pending lessons from empty cells | F | every() 对空数组也为真，缺班级行时漏报；增加明确班级 ID 或三行数量后再判断无问题。 |
| 4 / [grade-timetable.test.ts:60](/Users/leslielau/project/dev/timetable/apps/web/src/lib/grade-timetable.test.ts:60) | assigns shared teaching-group requirements to every affected class | R | 教学组缺课时分配到每个受影响班级，防止只记一次。 |
| 5 / [grade-timetable.test.ts:67](/Users/leslielau/project/dev/timetable/apps/web/src/lib/grade-timetable.test.ts:67) | includes a cross-grade teacher conflict reported against the other entry | R | 另一年级条目报告的教师冲突也归到当前受影响课次。 |
| 6 / [grade-timetable.test.ts:77](/Users/leslielau/project/dev/timetable/apps/web/src/lib/grade-timetable.test.ts:77) | keeps missing fixed placements and over-scheduled requirements actionable | R | 缺固定安排和超额排课仍可作为问题处理，剩余量不显示为负。 |
| 7 / [grade-timetable.test.ts:85](/Users/leslielau/project/dev/timetable/apps/web/src/lib/grade-timetable.test.ts:85) | shows all collaborating teachers, with a primary-teacher fallback | R | 显示所有协同教师，缺 teachers 集合时回退主讲。 |
| 8 / [grade-timetable.test.ts:95](/Users/leslielau/project/dev/timetable/apps/web/src/lib/grade-timetable.test.ts:95) | quotes spreadsheet exports and neutralizes formula-like resource names | R | CSV 引号、换行及公式式资源名正确转义，保护可用导出与公式注入防护。 |

## apps/web/src/lib/long-term-changes.test.ts

[long-term-changes.test.ts](/Users/leslielau/project/dev/timetable/apps/web/src/lib/long-term-changes.test.ts) · 7 条声明。

| 序号 / 行 | 当前测试名 | 决定 | 依据与后续处理 |
| --- | --- | --- | --- |
| 1 / [long-term-changes.test.ts:36](/Users/leslielau/project/dev/timetable/apps/web/src/lib/long-term-changes.test.ts:36) | keeps an assignment complete even when room or lesson filters only match one occurrence | R | 教室或课节过滤只匹配一课次时仍保留整个任课关系，不能截断长期修改范围。 |
| 2 / [long-term-changes.test.ts:50](/Users/leslielau/project/dev/timetable/apps/web/src/lib/long-term-changes.test.ts:50) | submits only changed fields and reverses an atomic exchange together | R | 只提交变更字段，交换撤销必须保持双方原子性。 |
| 3 / [long-term-changes.test.ts:64](/Users/leslielau/project/dev/timetable/apps/web/src/lib/long-term-changes.test.ts:64) | checks replacement teachers while retaining collaborating teachers | R | 替换主讲校验时保留协同教师，防止团队丢失或冲突漏检。 |
| 4 / [long-term-changes.test.ts:80](/Users/leslielau/project/dev/timetable/apps/web/src/lib/long-term-changes.test.ts:80) | permits disjoint odd/even weeks and blocks intersecting specified weeks | R | 单双周错开允许，指定周交集存在则冲突。 |
| 5 / [long-term-changes.test.ts:92](/Users/leslielau/project/dev/timetable/apps/web/src/lib/long-term-changes.test.ts:92) | rejects locked lessons and a replacement already in the teaching team | R | 锁定课次和已在教学团队内的替换教师不允许提交。 |
| 6 / [long-term-changes.test.ts:96](/Users/leslielau/project/dev/timetable/apps/web/src/lib/long-term-changes.test.ts:96) | distinguishes scheduled recovery from already restored history | R | 计划中的恢复与已恢复历史是不同业务状态。 |
| 7 / [long-term-changes.test.ts:108](/Users/leslielau/project/dev/timetable/apps/web/src/lib/long-term-changes.test.ts:108) | starts a new adjustment next Monday and stays within the semester | R | 新长期调整从下周一开始，并裁剪到学期范围。 |

## apps/web/src/lib/scheduling-constraint-support.test.ts

[scheduling-constraint-support.test.ts](/Users/leslielau/project/dev/timetable/apps/web/src/lib/scheduling-constraint-support.test.ts) · 2 条声明。

| 序号 / 行 | 当前测试名 | 决定 | 依据与后续处理 |
| --- | --- | --- | --- |
| 1 / [scheduling-constraint-support.test.ts:5](/Users/leslielau/project/dev/timetable/apps/web/src/lib/scheduling-constraint-support.test.ts:5) | allows %s %s rules implemented by both execution paths | F | 仅验证前端静态允许表，不能证明两个执行路径都实现了这些规则。收窄为界面可选项契约；若要主张执行支持，需对应真实执行场景。 |
| 2 / [scheduling-constraint-support.test.ts:21](/Users/leslielau/project/dev/timetable/apps/web/src/lib/scheduling-constraint-support.test.ts:21) | blocks %s %s rules not implemented by both execution paths | F | 同样只验证前端禁止表。保留不暴露不支持选项的意图，但不能拿它替代 API/求解器的拒绝行为。 |

## apps/web/src/lib/semester.test.ts

[semester.test.ts](/Users/leslielau/project/dev/timetable/apps/web/src/lib/semester.test.ts) · 9 条声明。

| 序号 / 行 | 当前测试名 | 决定 | 依据与后续处理 |
| --- | --- | --- | --- |
| 1 / [semester.test.ts:13](/Users/leslielau/project/dev/timetable/apps/web/src/lib/semester.test.ts:13) | rewrites current-semester compatibility links without losing their query or hash | R | 旧 current 学期链接转换为显式学期时保留 query/hash，避免丢版本或筛选上下文。 |
| 2 / [semester.test.ts:24](/Users/leslielau/project/dev/timetable/apps/web/src/lib/semester.test.ts:24) | uses current semester only when the route has no explicit semester | R | 显式学期优先，只有路由未指定时才使用当前学期。 |
| 3 / [semester.test.ts:40](/Users/leslielau/project/dev/timetable/apps/web/src/lib/semester.test.ts:40) | defaults viewers to the semester current version instead of the latest draft | R | 只读用户默认当前正式版，不能误用最新草稿。 |
| 4 / [semester.test.ts:44](/Users/leslielau/project/dev/timetable/apps/web/src/lib/semester.test.ts:44) | lets viewers keep an explicitly selected historical version | R | 只读用户可保持明确选中的历史版。 |
| 5 / [semester.test.ts:48](/Users/leslielau/project/dev/timetable/apps/web/src/lib/semester.test.ts:48) | removes every draft from the viewer selectable collection | R | 只读用户的可选集合过滤所有草稿。 |
| 6 / [semester.test.ts:56](/Users/leslielau/project/dev/timetable/apps/web/src/lib/semester.test.ts:56) | does not invent a viewer default when the semester has no current version | R | 没有当前版本时不为只读用户编造默认版本。 |
| 7 / [semester.test.ts:60](/Users/leslielau/project/dev/timetable/apps/web/src/lib/semester.test.ts:60) | never defaults a viewer to a draft even if a broken pointer references it | R | 损坏的当前版本指针指向草稿时仍不暴露草稿。 |
| 8 / [semester.test.ts:64](/Users/leslielau/project/dev/timetable/apps/web/src/lib/semester.test.ts:64) | does not preserve a draft selected before the user became a viewer | R | 角色切换为只读后，先前选中的草稿被清除。 |
| 9 / [semester.test.ts:68](/Users/leslielau/project/dev/timetable/apps/web/src/lib/semester.test.ts:68) | defaults editors to the current version unless they explicitly select a draft | R | 编辑用户默认当前版，也可主动选择草稿；区别于 viewer 限制。 |

## apps/web/src/lib/timetable-state.test.ts

[timetable-state.test.ts](/Users/leslielau/project/dev/timetable/apps/web/src/lib/timetable-state.test.ts) · 4 条声明。

| 序号 / 行 | 当前测试名 | 决定 | 依据与后续处理 |
| --- | --- | --- | --- |
| 1 / [timetable-state.test.ts:47](/Users/leslielau/project/dev/timetable/apps/web/src/lib/timetable-state.test.ts:47) | fills the whole timetable when an empty or incomplete outside baseline cannot support class-only generation | R | 范围外基准为空或不完整时扩大为全量生成，避免局部排课留空。 |
| 2 / [timetable-state.test.ts:52](/Users/leslielau/project/dev/timetable/apps/web/src/lib/timetable-state.test.ts:52) | marks a version stale when the timetable inputs changed afterwards | R | 排课输入改变后标记版本过期。 |
| 3 / [timetable-state.test.ts:64](/Users/leslielau/project/dev/timetable/apps/web/src/lib/timetable-state.test.ts:64) | counts only remaining items belonging to the current resource | R | 资源待排量仅计算当前资源的剩余课时。 |
| 4 / [timetable-state.test.ts:76](/Users/leslielau/project/dev/timetable/apps/web/src/lib/timetable-state.test.ts:76) | matches collaborating teachers as timetable resources | R | 协同教师同样作为课表资源匹配，不能只认主讲。 |

## apps/web/src/lib/working-semester.test.tsx

[working-semester.test.tsx](/Users/leslielau/project/dev/timetable/apps/web/src/lib/working-semester.test.tsx) · 6 条声明。

| 序号 / 行 | 当前测试名 | 决定 | 依据与后续处理 |
| --- | --- | --- | --- |
| 1 / [working-semester.test.tsx:34](/Users/leslielau/project/dev/timetable/apps/web/src/lib/working-semester.test.tsx:34) | uses the school default when no personal selection exists | R | 没有个人选择时使用学校默认学期。 |
| 2 / [working-semester.test.tsx:37](/Users/leslielau/project/dev/timetable/apps/web/src/lib/working-semester.test.tsx:37) | keeps a remembered selection on home and resource pages | R | 首页和资料页保留用户记住的工作学期。 |
| 3 / [working-semester.test.tsx:42](/Users/leslielau/project/dev/timetable/apps/web/src/lib/working-semester.test.tsx:42) | lets the explicit route override the remembered semester even in the parent layout | R | 显式路由覆盖记忆值，父布局也取得正确学期。 |
| 4 / [working-semester.test.tsx:46](/Users/leslielau/project/dev/timetable/apps/web/src/lib/working-semester.test.tsx:46) | does not silently substitute the default for an invalid explicit route | R | 非法显式学期不能静默替换为默认值，防止误操作别的学期。 |
| 5 / [working-semester.test.tsx:49](/Users/leslielau/project/dev/timetable/apps/web/src/lib/working-semester.test.tsx:49) | isolates remembered selections by signed-in user | R | 记住的工作学期按用户隔离。 |
| 6 / [working-semester.test.tsx:56](/Users/leslielau/project/dev/timetable/apps/web/src/lib/working-semester.test.tsx:56) | ignores corrupt storage and continues when browser storage is blocked | R | 损坏或被禁用的浏览器存储不阻断工作学期解析。 |

## tests/e2e/ai-assistant.spec.ts

[ai-assistant.spec.ts](/Users/leslielau/project/dev/timetable/tests/e2e/ai-assistant.spec.ts) · 5 条声明。

| 序号 / 行 | 当前测试名 | 决定 | 依据与后续处理 |
| --- | --- | --- | --- |
| 1 / [ai-assistant.spec.ts:155](/Users/leslielau/project/dev/timetable/tests/e2e/ai-assistant.spec.ts:155) | free chat, follow-up, history, refresh and a new conversation | R | 真实界面验证发送、追问、历史重载与新会话状态；API 被模拟，只证明前端集成。 |
| 2 / [ai-assistant.spec.ts:187](/Users/leslielau/project/dev/timetable/tests/e2e/ai-assistant.spec.ts:187) | structured questionnaire resumes the same chat and rule edits expire the old preview | R | 问卷恢复同会话，新需求使旧预览失效，显式确认才保存；保留表单到协议的前端职责。 |
| 3 / [ai-assistant.spec.ts:235](/Users/leslielau/project/dev/timetable/tests/e2e/ai-assistant.spec.ts:235) | composer prefill waits for explicit send and reports an unavailable model | R | 预填内容不自动发送，服务不可用时显示可理解的状态。 |
| 4 / [ai-assistant.spec.ts:256](/Users/leslielau/project/dev/timetable/tests/e2e/ai-assistant.spec.ts:256) | multi-step questionnaire preserves multiple choices and free text | R | 多步骤问卷保留多选和自由文本，并提交正确答案。 |
| 5 / [ai-assistant.spec.ts:295](/Users/leslielau/project/dev/timetable/tests/e2e/ai-assistant.spec.ts:295) | stop aborts the pending request, restores the partial response and allows explicit retry | R | 停止操作真正中止请求、保留部分回答，并允许主动重试。 |

## tests/e2e/auth-and-catalog.spec.ts

[auth-and-catalog.spec.ts](/Users/leslielau/project/dev/timetable/tests/e2e/auth-and-catalog.spec.ts) · 1 条声明。

| 序号 / 行 | 当前测试名 | 决定 | 依据与后续处理 |
| --- | --- | --- | --- |
| 1 / [auth-and-catalog.spec.ts:16](/Users/leslielau/project/dev/timetable/tests/e2e/auth-and-catalog.spec.ts:16) | 管理员首次改密、会话恢复、维护资料并安全退出 | R | 真实浏览器完成临时改密、登录、教师表单写入、刷新后持久化、退出及新密码重登；是当前 E2E 中唯一真实后端写入链路，不能由 API 用例替代。 |

## tests/e2e/prelaunch-regressions.spec.ts

[prelaunch-regressions.spec.ts](/Users/leslielau/project/dev/timetable/tests/e2e/prelaunch-regressions.spec.ts) · 3 条声明。

| 序号 / 行 | 当前测试名 | 决定 | 依据与后续处理 |
| --- | --- | --- | --- |
| 1 / [prelaunch-regressions.spec.ts:6](/Users/leslielau/project/dev/timetable/tests/e2e/prelaunch-regressions.spec.ts:6) | R11 候选预览在全新页面加载班级、教师和教室课程 | R | 新开页面候选预览补齐资源请求，并按班级/教师/教室发送正确筛选，保护前端数据装配。 |
| 2 / [prelaunch-regressions.spec.ts:29](/Users/leslielau/project/dev/timetable/tests/e2e/prelaunch-regressions.spec.ts:29) | R10 指定教师的连续课时表单遵守接口字段约定 | R | 实际连续课时规则表单序列化为接口所需字段，防止 UI 与 API 契约错配。 |
| 3 / [prelaunch-regressions.spec.ts:58](/Users/leslielau/project/dev/timetable/tests/e2e/prelaunch-regressions.spec.ts:58) | `R9 教师课表在${trigger === "visibility" ? "恢复可见" : "前台停留一分钟"}后刷新停课安排` | R | 恢复可见与定时刷新两个触发器分别取得最新停课安排，并同步日/周视图；不是只查文字存在。 |

## 前几轮已移除的 30 条声明

这是 HEAD 与当前工作区之间的历史删除记录，不是本轮新增删除建议。另有一条 AI 预填测试改名，已按当前名称列入上表。局部删减断言见 Git diff。

| 原文件 / HEAD 行 | 原测试名 |
| --- | --- |
| apps/api/tests/Feature/CourseColorTest.php:18 | allocates unused colors before reusing the least occupied color |
| apps/api/tests/Unit/SimpleXlsxWriterTest.php:41 | creates an A4 portrait timetable prepared for one-page printing |
| apps/teacher/src/lib/timetable.test.ts:67 | shows a concrete time instead of a large minute count |
| apps/teacher/src/lib/timetable.test.ts:78 | keeps short countdowns easy to scan |
| apps/web/src/components/grid-selection-frame.test.ts:27 | keeps a single perimeter cell's entire 2px stroke inside the grid |
| apps/web/src/components/grid-selection-frame.test.ts:36 | merges a rectangular selection into continuous pixel-aligned grid lines |
| apps/web/src/components/grid-selection-frame.test.ts:49 | preserves every edge and sealed intersection in an irregular selection |
| apps/web/src/components/grid-selection-frame.test.ts:72 | does not close the empty cells between diagonally disjoint selections |
| apps/web/src/lib/agent.test.ts:25 | handles Chinese UTF-8 split across chunks, CRLF and heartbeats |
| apps/web/src/lib/agent.test.ts:35 | rejects an interrupted or invalid protocol |
| apps/web/src/lib/agent.test.ts:46 | cancels the reader on abort instead of accepting an unfinished result |
| apps/web/src/lib/agent.test.ts:55 | refreshes CSRF once before starting a stream, with no automatic model retry |
| apps/web/src/lib/api.test.ts:7 | turns an ETag conflict into an actionable refresh message |
| apps/web/src/lib/api.test.ts:13 | preserves structured API error messages |
| apps/web/src/lib/api.test.ts:19 | turns validation envelopes into a specific field-level message |
| apps/web/src/lib/brand.test.ts:5 | returns exact titles for top-level pages |
| apps/web/src/lib/brand.test.ts:12 | recognizes pages with dynamic identifiers |
| apps/web/src/lib/brand.test.ts:24 | normalizes trailing slashes and falls back safely |
| apps/web/src/lib/course-colors.test.ts:6 | uses the saved color and keeps a missing or unsafe color neutral |
| apps/web/src/lib/course-colors.test.ts:10 | recommends an unused active-course color before a repeated color |
| apps/web/src/lib/course-colors.test.ts:17 | balances reuse after all preset colors are occupied |
| apps/web/src/lib/long-term-changes.test.ts:109 | shows a concrete before/after teacher change in record titles |
| apps/web/src/lib/scheduling-workflow.test.ts:10 | keeps the preparation step blocked when any required input is blocked |
| apps/web/src/lib/scheduling-workflow.test.ts:25 | marks preparation complete only when all preparation checks pass |
| apps/web/src/lib/scheduling-workflow.test.ts:40 | shows preparation warnings without pretending the step is complete |
| apps/web/src/lib/scheduling-workflow.test.ts:55 | treats a missing current timetable as pending instead of warning |
| apps/web/src/lib/scheduling-workflow.test.ts:59 | shows a stale or missing current timetable as a warning in the adjustment step |
| apps/web/src/lib/semester.test.ts:17 | builds explicit routes for every semester workflow |
| apps/web/src/lib/semester.test.ts:39 | recognizes scheduling and daily destinations in compatibility and explicit routes |
| tests/e2e/ai-assistant.spec.ts:262 | a narrow screen keeps the composer accessible and history can be opened and dismissed |
