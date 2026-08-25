# 教务排课中心最终设计稿

本目录包含当前 14 个真实路由对应的桌面端最终设计稿。所有页面以同一套视觉系统为基础，但根据页面任务分别处理信息层级、操作密度和状态反馈。

## 页面清单

| 序号 | 路由 | 页面 | 设计稿 |
| --- | --- | --- | --- |
| 01 | `/login` | 登录 | [01-login.png](01-login.png) |
| 02 | `/change-password` | 修改密码 | [02-change-password.png](02-change-password.png) |
| 03 | `/` | 工作台 | [03-dashboard.png](03-dashboard.png) |
| 04 | `/resources/grades` | 年级 | [04-grades.png](04-grades.png) |
| 05 | `/resources/teachers` | 教师 | [05-teachers.png](05-teachers.png) |
| 06 | `/resources/courses` | 课程 | [06-courses.png](06-courses.png) |
| 07 | `/resources/rooms` | 教室 | [07-rooms.png](07-rooms.png) |
| 08 | `/years` | 学年与班级 | [08-academic-years.png](08-academic-years.png) |
| 09 | `/years/:yearId` | 学年详情 | [09-academic-year-detail.png](09-academic-year-detail.png) |
| 10 | `/semester/setup`、`/semesters/:semesterId/setup` | 学期配置 | [10-semester-setup.png](10-semester-setup.png) |
| 11 | `/semester/tasks`、`/semesters/:semesterId/tasks` | 教学任务 | [11-teaching-tasks.png](11-teaching-tasks.png) |
| 12 | `/semester/timetable`、`/semesters/:semesterId/timetable` | 排课工作台 | [12-timetable.png](12-timetable.png) |
| 13 | `/users` | 用户管理 | [13-users.png](13-users.png) |
| 14 | `/settings` | 系统设置 | [14-settings.png](14-settings.png) |

## 统一视觉基础

- 页面基底使用暖白和冷灰，不用渐变、玻璃效果或大面积阴影。
- 靛蓝只承担导航选中、焦点和主要操作；绿色、橙色、红色仅表达业务状态。
- 正文字号以 14–16px 为基线，表格行高约 52–56px，点击目标不小于 40px。
- 优先用间距、对齐、文字层级和分隔线组织内容，避免卡片套卡片。
- 同一屏只保留一个主要操作；次要动作降为描边按钮、文字按钮或溢出菜单。
- 状态同时使用图标、文字和颜色，不以颜色作为唯一信息载体。

## 列表与分页规范

- 所有可能增长的数据表格都保留分页区，显示总数、每页条数、当前页和前后翻页。
- 教师、课程、教室、班级、教学任务、用户等列表按真实查找需求提供搜索和必要筛选。
- 年级、学年等小集合不强塞搜索框，但仍沿用一致的分页位置和交互结构。
- 筛选、排序和分页属于同一查询状态；翻页后必须保留搜索条件和排序。
- 表头在长列表滚动时固定，行操作位置统一，删除和停用不作为高亮主操作。
- 加载使用骨架屏；空状态说明原因并给出下一步；错误状态提供原地重试。

## 关键体验决策

- 工作台回答“当前进度、下一步、是否有阻塞”，不展示无决策价值的装饰图表。
- 基础资料使用可展开父菜单和独立子页面，避免把不同对象塞进页内标签页。
- 学年详情、学期配置保留业务内部标签页，因为它们属于同一上下文中的紧密步骤。
- 教学任务用高密度表格和批量确认承载大数据，不将每条任务做成卡片。
- 排课工作台以周课表网格为唯一视觉主角；班级、教师、教室只是观察视角。
- 系统设置只包含当前系统已有的“当前学期”和“学校时区”，不虚构设置项。

## 生成说明

设计稿通过内置图像生成工具逐页独立生成。提示集以现有路由、页面字段、中型学校测试数据、已批准工作台视觉语言和 2026-08-25 日期为约束；每张图都要求准确的中文、真实业务内容、克制的桌面端设计以及对应的数据密度。
