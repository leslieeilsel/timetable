# 测试清理审查（2026-09-25）

这是实施前的审查快照，记录基线、逐项判断和初始实验。审查中的建议现已全部落实，最新测试与覆盖率结果见 [实施结果](/Users/leslielau/project/dev/timetable/docs/testing/test-cleanup-implemented-2026-09-25.md)。以下“当前”指审查时的工作区。

[完整逐项清单](/Users/leslielau/project/dev/timetable/docs/testing/test-audit-ledger-2026-09-25.md) · [原始计数与实验摘要](/Users/leslielau/project/dev/timetable/docs/testing/test-audit-2026-09-25.json)

## 结论

去留依据是测试能捕获的独立故障，以及是否已有可靠的替代验证。测试名称、业务关键词和覆盖率都不足以单独决定删除。

- 当前 47 个文件、306 条声明：**283 条保留、20 条修正、2 条合并、1 条删除**。参数化声明运行后展开为 351 个用例。
- 两条可整体移除的用例已在临时副本验证：重复的手动改名测试，以及工具名称正则检查。Agent 从 71 项变为 69 项，全部通过，行、语句、分支、函数覆盖计数都不变。
- 另一项合并建议仅涉及长期调课测试中的公共消息已读/权限断言；长期调课的教师变更和消息生成断言仍须保留，尚未进行该局部删除的变异验证。
- 发现真实漏测：临时移除候选推荐的硬冲突拒绝判断后，当前 Web 89 项全部通过。应修正该场景，不能将全绿视为业务已经受到完整保护。
- “同名教师不能自动选中”看似重复，实际保护旧工具入口独有的代码。变异实验已证实应保留。

这里的“修正”包括标题夸大了实际验证范围、输入未触发目标分支、断言可能空通过，以及实现常量造成的脆弱性；不代表这 20 项业务无需测试。

## 清理前后基线

基准为 HEAD `30887f344fca4d4d7d0e54c48a1a6b0357f927b4`。当前版本为同一提交叠加本轮开始时的工作区变更。生产源码完全一致，两边使用同样的依赖、测试命令和覆盖率分母。

| 项目 | 清理前 | 当前 | 差值 |
| --- | ---: | ---: | ---: |
| 测试文件 | 52 | 47 | −5 |
| 测试声明 | 336 | 306 | −30 |
| 测试文件总行数，含 fixture/空行 | 10,584 | 9,908 | −676（6.39%） |
| 展开后的运行用例 | 384 | 351 | −33（8.59%） |

已有 diff 涉及 16 个文件，新增 15 行、删除 691 行；净减少 676 行。以上数值不包含本轮审查文档。

| 测试范围 | 清理前通过 / 总数 | 当前通过 / 总数 |
| --- | ---: | ---: |
| 管理端 Web | 117 / 117 | 89 / 89 |
| 教师端 | 12 / 12 | 10 / 10 |
| Agent | 71 / 71 | 71 / 71 |
| API，SQLite | 173 / 173 | 171 / 171 |
| 浏览器 E2E | 11 / 11 | 10 / 10 |
| **合计** | **384 / 384** | **351 / 351** |

两组 E2E 均使用独立数据库、1 个 worker、0 次重试，没有跳过或 flaky 用例。本次没有执行 MySQL 环境和外部模型质量评估。

## 覆盖率变化

以下百分比统一按“已覆盖 / 总计”重新计算并四舍五入到三位小数；Vitest 原输出存在截断显示，所以管理端当前会显示 6.80%，这里为 6.810%。判断阈值使用原始计数。

| 范围 / 指标 | 清理前 | 当前 | 变化（百分点） |
| --- | ---: | ---: | ---: |
| Web 行 | 599 / 6,799（8.810%） | 463 / 6,799（6.810%） | −2.0003 |
| Web 语句 | 673 / 7,681（8.762%） | 514 / 7,681（6.692%） | −2.0700 |
| Web 分支 | 570 / 8,788（6.486%） | 454 / 8,788（5.166%） | −1.3200 |
| 教师端行 | 26 / 809（3.214%） | 13 / 809（1.607%） | −1.6069 |
| 教师端分支 | 28 / 842（3.325%） | 17 / 842（2.019%） | −1.3064 |
| Agent 行 | 1,176 / 1,343（87.565%） | 同左 | 0 |
| Agent 分支 | 861 / 1,114（77.289%） | 同左 | 0 |
| API 可执行语句 | 9,005 / 11,133（80.886%） | 9,006 / 11,133（80.895%） | +0.0090 |

管理端此前清理使 136 行失去测试执行覆盖。若采用推文中“覆盖率下降不超过 2 个百分点”的示例目标，按本次固定分母，行覆盖率实际下降 2.000294 个百分点，语句下降 2.070043 个百分点，不能声称严格达标；整体删减也尚未达到其示例的 20%。

API 多覆盖的一行位于 [AutoScheduler.php:77](/Users/leslielau/project/dev/timetable/apps/api/app/Modules/Scheduling/Services/AutoScheduler.php:77)，是重复候选解的 `continue` 分支。求解使用随机种子，这一差异与运行路径波动一致；未做多次重复测量，不能归因于删测试改善了覆盖。

覆盖口径：JS 包含各应用全部 `src/**/*.{ts,tsx}`，仅排除测试文件；API 使用 PCOV 测量 `app/`，不提供分支覆盖。**浏览器运行没有合并进源码覆盖率**，前端低比例不能被解释为整个应用只受到该比例的验证。也没有通过排除未测生产文件抬高指标。

### 失去覆盖的具体位置

| 生产文件 | 已覆盖行变化 | 对应内容及判断 |
| --- | ---: | --- |
| [grid-selection-frame.tsx](/Users/leslielau/project/dev/timetable/apps/web/src/components/grid-selection-frame.tsx) | 25 → 0 | 选区描边、像素边缘几何。符合此前去掉外观精确断言的范围，但不能据此声称拖动业务已被覆盖。 |
| [agent.ts](/Users/leslielau/project/dev/timetable/apps/web/src/lib/agent.ts) | 59 → 0 | 旧前端流消费与请求封装；当前生产调用搜索未发现外部调用。 |
| [api.ts](/Users/leslielau/project/dev/timetable/apps/web/src/lib/api.ts) | 83 → 68 | API 错误/校验消息的整理。精确文案断言可少，但此次没有证明每种错误都能在真实界面中得到有效反馈。 |
| [brand.ts](/Users/leslielau/project/dev/timetable/apps/web/src/lib/brand.ts) | 10 → 3 | 标题匹配、尾斜杠处理与默认标题。 |
| [course-colors.ts](/Users/leslielau/project/dev/timetable/apps/web/src/lib/course-colors.ts) | 8 → 0 | 颜色回退和推荐分配。服务端保存、权限、资料 revision 测试仍在。 |
| [long-term-changes.ts](/Users/leslielau/project/dev/timetable/apps/web/src/lib/long-term-changes.ts) | 62 → 54 | `recordSummary`；生产调用搜索未发现外部调用。 |
| [scheduling-workflow.ts](/Users/leslielau/project/dev/timetable/apps/web/src/lib/scheduling-workflow.ts) | 10 → 0 | `workflowStepState`；生产调用搜索未发现外部调用。 |
| [semester.ts](/Users/leslielau/project/dev/timetable/apps/web/src/lib/semester.ts) | 41 → 37 | 导航类别和路径构造。显式学期选择、viewer 草稿隔离仍有测试。 |
| 教师端 [timetable.ts](/Users/leslielau/project/dev/timetable/apps/teacher/src/lib/timetable.ts) | 26 → 13 | 课前时间提示格式；日期有效性、职责变化、进行中/已结束判断仍保留。 |

旧前端 Agent 封装、旧工作流状态函数和未用摘要函数可作为后续死代码核查项；本轮没有删除生产代码，也没有为覆盖率数字恢复这些未使用函数的测试。

## 本轮可清理的具体项

| 处理 | 位置 | 保留依据 |
| --- | --- | --- |
| 合并后删除整条 | [chat-title.test.ts:73](/Users/leslielau/project/dev/timetable/apps/agent/tests/chat-title.test.ts:73) | 手动名称不被迟到 AI 结果覆盖，已由 [HTTP 用例](/Users/leslielau/project/dev/timetable/apps/agent/tests/chat-http.test.ts:110) 和 [存储并发用例](/Users/leslielau/project/dev/timetable/apps/agent/tests/chat-store.test.ts:49) 保护。 |
| 删除整条 | [chat-tools.test.ts:313](/Users/leslielau/project/dev/timetable/apps/agent/tests/chat-tools.test.ts:313) | 正则检查名称中有没有 save/http/exec，无法检验实际权限或执行能力。确认前不写入由 [HTTP 确认流程](/Users/leslielau/project/dev/timetable/apps/agent/tests/chat-http.test.ts:287) 验证；这仍不是任意新增工具能力的完备证明。 |
| 删除局部断言 | [tools.test.ts:91](/Users/leslielau/project/dev/timetable/apps/agent/tests/tools.test.ts:91) | 同类工具名称正则；保留旧入口的资源解析、预览、proposal/etag、未调用 bulk 断言。 |
| 合并局部断言 | [LongTermChangeWorkbenchTest.php:126](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/LongTermChangeWorkbenchTest.php:126) | 公共消息已读及越权读取可集中到 [TemporaryAdjustmentWorkbenchTest.php:72](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/TemporaryAdjustmentWorkbenchTest.php:72)；长期教师变更、双方消息和长期消息类型仍保留。 |

应优先修正的用例：

1. [candidate-quality.test.ts:54](/Users/leslielau/project/dev/timetable/apps/web/src/lib/candidate-quality.test.ts:54)：没有硬冲突输入，删掉对应业务判断仍全绿。补一个高分、已排齐但有硬冲突的案例；门槛测试应分别触发实际声称保护的维度。
2. [grade-timetable.test.ts:56](/Users/leslielau/project/dev/timetable/apps/web/src/lib/grade-timetable.test.ts:56)：`every()` 对空数组仍为真，需先核对班级行或 ID。
3. [adjustment-detail.test.ts:79](/Users/leslielau/project/dev/timetable/apps/web/src/lib/adjustment-detail.test.ts:79)：用同一输出的两个字段互相比，两个都算错也通过，应核对具体原始日期。
4. [chat-http.test.ts:317](/Users/leslielau/project/dev/timetable/apps/agent/tests/chat-http.test.ts:317)：标题包含过期预览，但输入只有 500 后重试成功。
5. [chat-store.test.ts:229](/Users/leslielau/project/dev/timetable/apps/agent/tests/chat-store.test.ts:229)：声称不产生孤立工具结果，但 fixture 只有用户文本。
6. [LongTermChangeWorkbenchTest.php:190](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/LongTermChangeWorkbenchTest.php:190)：只有一条记录，不能证明先筛选后分页。

其余修正项，包括过期影响确认、规则“支持”静态表、选定草稿的保留位置、队列常量与 SQL 次序耦合，都在完整清单中逐项标出。

## 变异实验

实验只在当前版本的临时副本中进行，每次恢复原文件；没有把缺陷写入工作区。定向变异是证据抽样，不是全项目变异覆盖率。

| 实验 | 结果 | 意义 |
| --- | --- | --- |
| 去掉上述标题重复测试与工具名测试 | Agent 69 / 69；四项覆盖计数全部不变 | 支持删除这两项，不以“全绿”单独作结论。 |
| 在保留集内取消标题 request-id 的存储比较 | 15 过、1 失败；存储并发用例失败 | 移除重复标题测试后，仍能发现迟到标题覆盖保护被破坏。 |
| 旧入口错误地把歧义教师标为已唯一解析 | tools + chat-tools：17 过、1 失败 | 失败的是旧入口同名教师测试，证明其独立价值。 |
| 在上个缺陷存在时再删掉旧入口同名教师测试 | 同两文件 17 / 17 | 新聊天入口测试不能替代旧入口的保护，放弃删除此项。 |
| 去掉候选推荐的硬冲突拒绝条件 | Web 89 / 89 | 当前完整 Web 用例集对该缺陷漏检，需要补强。 |

## 截图中“新增教师”测试的去留

[auth-and-catalog.spec.ts](/Users/leslielau/project/dev/timetable/tests/e2e/auth-and-catalog.spec.ts:16) 保留。它驱动真实浏览器与后端：填写教师、保存、查看列表、刷新后仍存在，并串起改密、会话恢复和退出重登。它能发现保存按钮没有提交、字段传错、Cookie 会话不通等问题，这些问题可能同时通过后端 API 测试。

这里的按钮中文名称是操作定位器；最终判断是教师资料确实保存并可重新读取。此前侧栏宽度、Logo 坐标和菜单文案等断言没有承担同样职责。

其余 AI 与上线回归 E2E 使用模拟响应，保留的是前端协议装配、问卷状态、资源筛选、停止请求和刷新行为，不能作为真实 Laravel 或外部模型的替代覆盖。

## 测量方式与可复查证据

- 将 HEAD 导出到 baseline 临时目录，将同一提交叠加工作区已跟踪 diff 导出到 current。API vendor 独立复制，避免自动加载器指回原工作区。
- Node 24.19.0、PHP 8.4.25、Vitest 4.1.10。缺少的 `@vitest/coverage-v8@4.1.10` 和 PCOV 1.0.12 仅安装/编译到临时目录，没有修改项目依赖、锁文件或系统 PHP 配置。
- 三个 JS 应用各运行完整 `vp test run`，统一启用 V8 覆盖；包含全部应用 src，排除测试文件，输出 JSON 与 json-summary。
- API 两组均运行完整 Pest，使用 SQLite 内存数据库，输出 JUnit 与 Clover。浏览器两组均运行完整 Playwright，独立 SQLite 文件，`--workers=1 --retries=0 --reporter=json`。
- 测试文件清单、逐条测试体、覆盖原始报告、运行日志、两个版本快照以及变异脚本保存在本机临时目录：
  `/var/folders/zg/g866782x6rv7d60_z94qjmgc0000gn/T/timetable-test-audit-ed3yhne1`。
- 临时目录可能被系统清理。核心计数、覆盖变化、实验结果及工作区补丁 SHA-256 已保存到上方 JSON，306 条去留理由保存在逐项清单。
- 生成报告时再次校验：工作区已跟踪 diff 与基线开始时保存的补丁逐字节相同，所有本轮生产代码实验均未落入工作区。
