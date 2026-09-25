# 测试清理实施结果（2026-09-25）

已在 main 落实审查中的全部 23 项处理建议：20 项修正、2 项合并、1 项删除。没有使用技能，没有修改生产代码或项目依赖。此前各轮测试清理改动继续保留。

[实施前审查](/Users/leslielau/project/dev/timetable/docs/testing/test-audit-2026-09-25.md) · [原始逐项清单](/Users/leslielau/project/dev/timetable/docs/testing/test-audit-ledger-2026-09-25.md) · [计数与实验数据](/Users/leslielau/project/dev/timetable/docs/testing/test-audit-2026-09-25.json)

## 改动结果

删除两条整项测试：重复的手动改名结果验证、按工具名称猜测安全性的验证。另删除旧入口的工具名称正则，并把公共消息已读/权限断言集中在一个用例。真实教师新增持久化流程、旧入口同名教师歧义拒绝等独立业务保护继续保留。

本轮增加了明确过期预览的独立失败场景，以及取消任务的第二个参数时点；其余补强放入现有用例。当前为 **47 个测试文件、305 条声明、351 个运行用例**。相对审查时减少 1 条声明，运行用例数相同；相对最初 HEAD 减少 5 个文件、31 条声明和 33 个运行用例。

测试文件总行数为 10,002：本轮因补强有效输入和断言净增 94 行；全部清理轮次累计净减少 582 行。没有为减少数量而删掉已证明有独立作用的业务测试。

## 验证结果

| 范围 | 通过 / 总数 |
| --- | ---: |
| Web | 89 / 89 |
| 教师端 | 10 / 10 |
| Agent | 70 / 70 |
| API，SQLite | 172 / 172 |
| 浏览器 E2E | 10 / 10 |
| **合计** | **351 / 351** |

浏览器使用独立数据库、1 个 worker、0 次重试，无跳过或 flaky。Web 类型、格式、lint 检查通过；Agent 类型检查通过，lint 只有原有 chat-record.test.ts 的 toThrow 消息警告，本轮没有新增警告。6 个修改的 PHP 文件通过 Pint 检查，Git diff 空白检查通过。本次未运行 MySQL 环境或外部模型质量评估。

### 本轮覆盖率对比

分母及覆盖范围与审查时一致；浏览器覆盖率不合并进源码计数。

| 范围 | 实施前已覆盖 | 实施后已覆盖 |
| --- | ---: | ---: |
| Web 行 / 6,799 | 463 | 464 |
| Web 分支 / 8,788 | 454 | 456 |
| Agent 行 / 1,343 | 1,176 | 1,176 |
| Agent 分支 / 1,114 | 861 | 864 |
| 教师端行 / 809 | 13 | 13 |
| API 可执行语句 / 11,133，原测量 | 9,006 | 8,997 |
| API 可执行语句 / 11,133，复测 | 8,995 | 8,998 |

API 单次计数下降 9 行，复测两份版本后均观察到波动。差异定位到随机排课生成的重复候选和课次身份近邻匹配路径（AutoScheduler.php:77、LessonIdentityService.php:238–263）；实施前相同测试自己复测也会减少 11 行。改进后的取消参数用例覆盖了原先的阶段更新保护，并新增落库前保护。不能把某一次随机结果当作覆盖率严格不降的证明，也没有改分母或隐藏这些文件。

### 8 次故障注入全部被捕获

只在临时副本中逐项引入缺陷并恢复，失败均来自目标断言，没有依赖语法错误或测试启动失败。

| 注入的错误 | 保护结果 |
| --- | --- |
| 去掉候选推荐的硬冲突拒绝 | 推荐门槛用例失败 |
| 没有课程时直接返回空班级列表 | 班级行数断言失败 |
| 交换详情前后日期一起算错 | 明确的原日期断言失败 |
| 不把 412 预览标为过期 | 重复确认拒绝断言失败 |
| 忽略影响范围 hash 的变化 | 旧确认拒绝断言失败 |
| 阶段更新忽略取消状态 | stage 参数用例失败 |
| 候选落库忽略取消状态 | persistence 参数用例失败 |
| 落库前忽略 catalog revision 变化 | 过期输入拒绝断言失败 |

这是对本轮关键契约的定向验证，不是全项目变异覆盖率。生产源码与工作区保持一致，所有临时缺陷均已恢复。

## 23 项处理对照

以下编号对应实施前各文件内的用例序号；链接指向实施后的文件和可用行号。

| 原位置 | 已落实的处理 |
| --- | --- |
| [chat-http.test.ts #7](/Users/leslielau/project/dev/timetable/apps/agent/tests/chat-http.test.ts:317) | 将不确定写入的重试与明确过期预览拆开；新增 412 后再次确认返回 ACTION_EXPIRED、后端只收到一次写入的场景。 |
| [chat-store.test.ts #8](/Users/leslielau/project/dev/timetable/apps/agent/tests/chat-store.test.ts:229) | 每轮包含真实结构的用户消息、工具调用和返回值；按已知轮次 ID 校验保留的 20 轮完整对应。 |
| [diagnostic-data.test.ts #2](/Users/leslielau/project/dev/timetable/apps/agent/tests/diagnostic-data.test.ts:18) | 改为校验全部片段的连续 offset，保留无损重组，去掉固定 2000 字符分片大小。 |
| [tools.test.ts #1](/Users/leslielau/project/dev/timetable/apps/agent/tests/tools.test.ts:78) | 删除工具名称正则，保留旧入口的唯一解析、预览及未执行 bulk 验证。 |
| [CatalogImpactTest.php #1](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/CatalogImpactTest.php:29) | 确认后改变任课课时，验证旧 impact_hash 被拒绝、资源仍启用；取得新确认后才允许停用。 |
| [LongTermChangeWorkbenchTest.php #14](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/LongTermChangeWorkbenchTest.php:187) | 收窄标题为教师文本、状态及日期交叠筛选，去掉未被 fixture 证明的分页主张。 |
| [ScheduleRunReliabilityTest.php #1](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/ScheduleRunReliabilityTest.php:27) | 标题改为快照与耐久队列；移除 backoff 固定数组，tries 和锁超时改为与可重试、任务超时相关的关系断言。 |
| [ScheduleRunReliabilityTest.php #6](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/ScheduleRunReliabilityTest.php:165) | 以首个候选完成阶段切换失败注入，去掉前 24 次调用的硬编码。 |
| [ScheduleRunReliabilityTest.php #7](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/ScheduleRunReliabilityTest.php:205) | 断言三个候选的失败排名和最终无解状态，移除 72 次内部调用计数。 |
| [ScheduleRunReliabilityTest.php #9](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/ScheduleRunReliabilityTest.php:295) | 使用排课阶段定位取消时点；同一测试覆盖阶段更新前及落库前两种情况，去掉第 3 次 SQL 的计数依赖。 |
| [ScheduleRunReliabilityTest.php #10](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/ScheduleRunReliabilityTest.php:341) | 在准备生成候选阶段改变 catalog revision，验证落库前拒绝；标题明确实际检查范围。 |
| [SchedulingConstraintTest.php #3](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/SchedulingConstraintTest.php:167) | 标题限定为草稿接口接受的软规则类别，避免把创建成功宣称成求解器执行验证。 |
| [SchoolSettingsTest.php #1](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/SchoolSettingsTest.php:12) | 写入非默认名称和标语，再精确校验公开字段，保留完整配置接口的未登录拒绝。 |
| [TimetableVersionTest.php #5](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/TimetableVersionTest.php:290) | 加入选定草稿的锁定课次及更新的空草稿；校验结果仍保留指定课次、星期、课节和锁状态。 |
| [grouped-assignments-view.test.ts #4](/Users/leslielau/project/dev/timetable/apps/web/src/components/grouped-assignments-view.test.ts:91) | 各教室分组同时断言任课关系 ID 集合，防止桶名正确但课程归错组。 |
| [adjustment-detail.test.ts #3](/Users/leslielau/project/dev/timetable/apps/web/src/lib/adjustment-detail.test.ts:79) | 核对两行交换详情的前后日期都为 9/14，去掉输出字段之间的自我比较。 |
| [candidate-quality.test.ts #2](/Users/leslielau/project/dev/timetable/apps/web/src/lib/candidate-quality.test.ts:54) | 增加硬冲突、未排齐、综合分及各启用维度的拒绝输入，同时校验最低分边界合法。 |
| [grade-timetable.test.ts #3](/Users/leslielau/project/dev/timetable/apps/web/src/lib/grade-timetable.test.ts:56) | 先明确要求三行班级，再检查无缺课或冲突，空数组不能通过。 |
| [scheduling-constraint-support.test.ts #1](/Users/leslielau/project/dev/timetable/apps/web/src/lib/scheduling-constraint-support.test.ts:5) | 标题限定为前端规则表单可选择的类别。 |
| [scheduling-constraint-support.test.ts #2](/Users/leslielau/project/dev/timetable/apps/web/src/lib/scheduling-constraint-support.test.ts:21) | 标题限定为前端规则表单禁止选择的类别。 |
| [chat-title.test.ts #3](/Users/leslielau/project/dev/timetable/apps/agent/tests/chat-title.test.ts) | 移除重复的迟到 AI 标题覆盖测试；保留 HTTP 手动改名流程与存储 request-id 并发验证。 |
| [chat-tools.test.ts #10](/Users/leslielau/project/dev/timetable/apps/agent/tests/chat-tools.test.ts) | 移除按工具名称匹配敏感单词的整条测试；保留真实确认与写入行为测试。 |
| [LongTermChangeWorkbenchTest.php #7](/Users/leslielau/project/dev/timetable/apps/api/tests/Feature/LongTermChangeWorkbenchTest.php:126) | 合并公共消息已读及越权读取验证至临时调整用例；长期变更增加双方收件人 ID 校验，保留实际教师及消息类型。 |
