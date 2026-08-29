# 教务排课中心 UX、视觉与动效审计

日期：2026-08-30

分支：`codex/ui-ux-motion-audit`

工作树：`/Users/leslielau/project/dev/timetable-ui-ux-motion-audit`

本地验收地址：<http://127.0.0.1:5174/>

## Verdict

```text
VERDICT: Incomplete（严格 ux-audit 证据口径）
产品修复验收: 核心流程通过
Critical: 0
High: 0
Console errors / warnings: 0 / 0
Network 5xx: 0
Layout collapse: 0（已覆盖的 16 路由与移动端探针）
Axe Critical / Serious: 0 / 0
本地性能预算: 通过
Interaction Manifest: incomplete
```

`Incomplete` 不是指当前产品仍有阻断问题，而是指没有为每个路由保存 `$ux-audit` 要求的完整逐元素、逐时间戳 Interaction Manifest，也没有执行需要额外账号、数据工厂或破坏性授权的全部 11 个场景。任何更高 verdict 都会夸大证据。当前可准确声明：已修复发现的问题，并重新验证登录、导航、搜索、任课编辑入口、临时调课、教师请假和课表浏览等核心流程。

## 审计对象与覆盖

主要人物是学校排课员：需要在一个学期中维护基础数据、班级与任课关系、约束、生成方案，并处理日常调课和请假。

真实站点通过本地 API 与 Vite 前端启动，使用演示排课员账户。遍历了以下 16 个产品路由：工作台、年级班级、教师、课程、教室、学年列表、学年详情、学期配置、准备检查、课程与任课矩阵、规则与约束、方案生成、课表调整与诊断、临时调课、请假与代课、修改密码。

覆盖内容包括：

- 桌面端 1440×900 与移动端 375/390px 浏览、输入、点击和滚动。
- 登录错误与成功、首个键盘焦点、跳到主内容、搜索提交和筛选状态保留。
- 任课详情模态框、课表视角标签、课表课程详情、调课/请假预览前置校验。
- 下拉菜单、选择器、模态框、标签、折叠、加载、成功和错误状态动效。
- 慢网络、离线错误、深色主题、打印媒体、减少动态效果和移动端触控目标。
- 16 路由 axe 扫描、控制台与请求检查、构建、类型/格式检查及单元测试。

## 最重要的 5 个改进

1. **重建窄屏信息层级。** 修复工作台五步流程被挤成逐字竖排的问题，将主 CTA 设为全宽并把次要操作并列；修改密码页也在移动端去掉重复规则区，先呈现表单。
2. **阻止无效操作。** 临时调课和请假表单只有在类型相关必填项、时间范围与原因有效时才允许预览，并解释按钮为何禁用；空表单不再向 API 发出会返回 422 的请求。
3. **补齐可访问结构。** 新增跳到主内容、导航地标、加载状态语义、正确的必填/错误标记，修复标签对比度和无效 ARIA；16 个认证路由当前无 axe violation。
4. **统一反馈与状态过渡。** 菜单、选择器和模态框使用克制的 250ms 进入/退出；表单错误使用 280ms 提示；标签指示器、折叠箭头、一次性骨架屏与成功/错误状态具有一致反馈，并完全尊重 `prefers-reduced-motion`。
5. **改善触控、密集数据与打印。** 代表性移动流程中的交互目标均达到至少 48×48px；任课矩阵和课表明确提示可横向滑动并提供可聚焦滚动区；打印视图强制白底深色文字，避免深色主题耗墨和低对比。

## 已关闭发现

### F-01 · Interaction · High（已修复）

- Surface：`/`，375×812，排课员。
- Reproduce：登录后打开工作台，将视口缩至 375px，查看五步排课流程。
- Observed：步骤标题列宽被压缩到单字宽度，形成纵向文字；三个 CTA 缺少稳定主次关系。
- Expected：标题和进度能按正常阅读方向扫读，主任务优先且可一手点击。
- Evidence：[优化前移动工作台](../output/playwright/ux-audit-2026-08-30/before/mobile-dashboard.png)；[优化后移动工作台](../output/playwright/ux-audit-2026-08-30/after/mobile-dashboard-viewport.png)。
- Suspected location：`apps/web/src/pages/dashboard-page.tsx`。
- Smallest patch：把步骤行改为固定编号加弹性内容列，并将移动端主 CTA 占满一行。

### F-02 · Feedback · High（已修复）

- Surface：`/semesters/3/adjustments`、`/semesters/3/leaves`，桌面与移动端。
- Reproduce：打开新建临时调整或登记请假，不填写任何字段，尝试预览。
- Observed：修复前按钮可触发请求，服务端返回 422；错误发生得晚且不能指导用户补齐哪个字段。
- Expected：只有表单达到可预览状态才发请求，按钮旁直接说明缺失条件。
- Evidence：[核心回归脚本](../output/playwright/ux-audit-2026-08-30/core-regression.js) 当前返回 `passed: true`、`previewRequests: []`。
- Suspected location：`apps/web/src/pages/daily-adjustments-page.tsx`、`apps/web/src/pages/teacher-leaves-page.tsx`。
- Smallest patch：按调整类型计算 readiness，禁用预览并显示上下文帮助文本。

### F-03 · Architecture / Interaction · High（已修复）

- Surface：全局导航、登录、日期选择器、课表标签与认证路由。
- Reproduce：键盘进入站点并运行 axe；检查必填日期控件、标签选中态和地标。
- Observed：缺少跳到主内容；部分按钮带不适用的 `aria-required`；页面主区域/导航结构不足；标签文字对比度不稳定。
- Expected：首个 Tab 可跳过全局导航，语义结构和 ARIA 有效，Critical/Serious 为零。
- Evidence：[axe 16 路由脚本](../output/playwright/ux-audit-2026-08-30/axe-authenticated.js) 当前所有路由 `violations: []`；核心回归确认跳转链接把焦点送到 `#main-content`。
- Suspected location：`workspace-shell.tsx`、`date-picker.tsx`、`tabs.tsx`、`timetable-page.tsx`。
- Smallest patch：增加 skip link 与地标；把必填信息并入可访问名称；修复标签颜色。

### F-04 · Feedback / Delight · Medium（已修复）

- Surface：懒加载、下拉、选择、模态、标签、折叠、错误与 reduced-motion。
- Reproduce：慢速打开受保护路由；依次打开用户菜单、选择器、详情模态，提交空登录表单并切换标签；再启用 reduced motion。
- Observed：修复前主要状态缺少统一过渡，慢速会话恢复只有空泛 spinner，减少动态效果没有全局兜底。
- Expected：状态变化清楚但不过度；加载布局接近目标页面；减少动态效果时动画持续时间为零。
- Evidence：[动效探针](../output/playwright/ux-audit-2026-08-30/motion-probe.js)、[减少动态效果探针](../output/playwright/ux-audit-2026-08-30/reduced-motion-probe.js)、[慢网络骨架屏](../output/playwright/ux-audit-2026-08-30/after/teachers-slow-network.png)。
- Suspected location：`index.css`、`dialog.tsx`、`dropdown-menu.tsx`、`select.tsx`、`tabs.tsx`、`workspace-loading-state.tsx`。
- Smallest patch：复用 transitions.dev 的短时长状态类并加全局 reduced-motion 覆盖，使用结构化骨架屏替换空 spinner。

### F-05 · Visual / Interaction · Medium（已修复）

- Surface：移动端任课矩阵、课表、通用控件与打印。
- Reproduce：375/390px 打开矩阵和课表；检查首屏可操作项；在深色主题下打印预览。
- Observed：密集表格可以滚动但缺少明显提示；小控件触控面积不足；深色主题打印会保留大面积深底。
- Expected：用户无需猜测即可发现横向内容，触控目标达到技能标准，打印保持高对比且节墨。
- Evidence：[移动任课矩阵](../output/playwright/ux-audit-2026-08-30/after/mobile-assignments.png)、[移动课表](../output/playwright/ux-audit-2026-08-30/after/mobile-timetable.png)、[打印媒体](../output/playwright/ux-audit-2026-08-30/after/timetable-print-media.png)、[48px 触控探针](../output/playwright/ux-audit-2026-08-30/touch-target-probe.js)。
- Suspected location：`table.tsx`、`timetable-grid.tsx`、`course-assignment-matrix-page.tsx`、`button.tsx`、`input.tsx`、`app.css`。
- Smallest patch：增加滚动提示与区域语义，统一移动端 48px 点击面，覆盖打印背景和文字颜色。

## 核心流程复验

| 流程 | 结果 | 证据 |
|---|---:|---|
| 空登录错误 → 正确登录 | 通过 | 两条可读错误；错误反馈 280ms；最终进入工作台 |
| 键盘首焦点 → 跳到主内容 | 通过 | 焦点从 skip link 进入 `#main-content` |
| 教师搜索 | 通过 | 输入“胡静”并按 Enter，命中 1 条 |
| 任课矩阵搜索 → 打开详情 | 通过 | 命中并保持输入值与 URL `q=胡静` |
| 临时调课空表单 | 通过 | 预览禁用；0 个预览请求 |
| 教师请假空表单 | 通过 | 预览禁用；0 个预览请求 |
| 课表标签 → 课程详情 | 通过 | 班级/教师标签状态正确；模态可打开并 Escape 关闭 |
| 16 路由移动遍历 | 通过 | 无文档级横向溢出、纵向文字、控制台 warning 或失败请求 |

两项早期怀疑经复验判定为假阳性：资源搜索设计为按 Enter 提交，并未损坏；任课详情打开后搜索条件仍保留，没有状态丢失。

## 自动化与质量门

- `pnpm --filter @timetable/web check`：通过，99 个文件格式正确，88 个文件无 lint/type error。
- `pnpm --filter @timetable/web test`：通过，10 个测试文件、51 个测试。
- `pnpm --filter @timetable/web build`：通过。
- `git diff --check`：通过。
- Axe：16 个认证路由 `violations: []`；登录页 `violations: []`。多数复杂路由仍有 1 个 axe `incomplete` 项，需人工判断，不等同于 violation。
- 触控：8 个代表性移动路由的可见按钮、链接、输入框、选择器和标签均无小于 48px 的目标。
- 控制台：最终干净浏览器会话 0 error、0 warning。
- 动效：菜单/选择/模态为 250ms；错误提示 280ms；reduced-motion 探针未发现非零时长动画。
- 慢网络：会话恢复期间显示 32 个结构化 skeleton 节点和加载文案。
- 本地开发环境性能：工作台 LCP 432ms、CLS 0、INP 48ms、TTFB 4ms；课表 LCP 532ms、CLS 0、INP 64ms、TTFB 2ms。
- Impeccable 最终检测：0 条源码反模式；检测器因 HTML parser 模块不可用退化为 regex 模式，因此仅作补充，浏览器证据优先。

## 场景电池与证据边界

- 已覆盖：First Contact 的导航理解、Keyboard Only 的主入口/模态/skip link、Wrong Turn Recovery 的筛选与返回、Returning User 的工作台状态、Round-Trip 的矩阵筛选保留、慢网络、离线、reduced motion、打印和代表性重数据表。
- 未完整覆盖：500+/1000+ 独立数据量、第二角色、Founder/Invitee/Later Joiner 生命周期、Day 0/1/7/30 数据 seasoning。
- Destructive Confidence 未执行实际删除、发布或批量写入，因为该场景需要用户明确授权；本次没有变更共享演示数据。
- 因以上缺口和 Interaction Manifest 缺失，严格 verdict 保持 `Incomplete`。

## 独立复核与自我批评

独立审查者未发现当前截图或实时页面中仍存的 Critical/Severe 问题，并确认窄屏流程排版、横向滚动提示和面包屑不换行均已生效。复核同时发现最初两张补充截图曾误用根路由/过早截取；它们已在全新登录会话中用真实 `/semesters/3/assignments` 与 `/semesters/3/timetable` 路径重拍。

这次工作最容易夸大的地方有三处：把 44px 探针称为 48px、把代表性动效实例称为“每个实例”、把 16 路由遍历称为完整 ux-audit Pass。前者已通过将基础控件提升至 48px 并重新探测解决；后两者在本报告中明确限定范围。

## 仍未解决的问题

1. 密集任课矩阵和周课表在手机上仍依赖横向滚动；提示已经清楚，但还不是专门为小屏重组的卡片/日视图体验。
2. 打印只通过 Chromium 打印媒体模拟和计算样式检查，尚未在实体打印机及 Safari/Firefox PDF 流程交叉验证。
3. 性能数据来自本地开发环境，不能代表生产网络、生产数据规模和后端并发负载。
4. 缺少多角色、生命周期与时间分布数据种子，因而无法完成严格 `$ux-audit` 的全部场景和 Interaction Manifest。

## Hold this in your hands

如果这是我的产品，我会先把当前版本交给 2–3 名真实排课员完成一次从“准备检查”到“处理请假”的观察式测试，因为最大的剩余风险已经不是按钮是否能点，而是密集课表在真实压力下是否足够快地被理解。下一步优先做移动端单日/单班级课表视图，再补生产 RUM、打印跨浏览器基线，以及可重复的多角色和 Day 0/1/7/30 数据种子；这些工作会把本次“核心流程修复验收通过”升级为可合法复现的完整审计 Pass。
