<p align="center">
  <img src="apps/web/public/brand/logo-mark.svg" alt="教务排课系统 Logo" width="72" height="72">
</p>

<h1 align="center">教务排课系统</h1>

面向学校教务场景的排课系统，用于维护学年、学期、班级、教师、课程、教室与任课关系，并完成自动排课、课表调整、版本管理和日常调课。

> 本项目正在开发中，请勿直接用于生产环境。

## 运行要求

- PHP 8.4，并启用 `intl`、`mbstring`、`zip` 和 `pdo_sqlite` 扩展
- Composer
- Vite+ CLI（终端中可以使用 `vp` 命令）

项目默认使用 SQLite，无需单独安装数据库服务。Node.js 24.19.0 和 pnpm 11.23.0 由 Vite+ 按项目配置自动管理。

## 启动

```bash
vp env on
vp env install
vp install
composer --working-dir=apps/api install

cp apps/api/.env.example apps/api/.env
php apps/api/artisan key:generate
touch apps/api/database/database.sqlite
php apps/api/artisan migrate
php apps/api/artisan timetable:create-admin

vp run dev
```

管理端地址为 `http://localhost:5173`，教师端地址为 `http://localhost:5175`。
开发端口被占用时启动会直接报错，请使用已运行的实例，或停止占用端口的旧实例后重新启动。
如需自定义教师端端口，请设置 `TEACHER_WEB_PORT`，并同时更新 `apps/api/.env` 中的 `SANCTUM_STATEFUL_DOMAINS`，加入实际访问的主机名和端口；后端已缓存配置时，还需运行 `php apps/api/artisan config:clear`。

AI 助手由独立的 TypeScript Agent（pi + DeepSeek）运行，Laravel 只提供业务 API。
复制 `apps/agent/.env.example` 到 `apps/agent/.env`，在服务端填写 `DEEPSEEK_API_KEY` 后，
`vp run dev` 会一并启动 Agent。管理端侧栏的「AI 助手」打开独立 Chat 页面，支持自由问答、历史会话、业务查询、问卷续聊和确认规则草稿。规则页和失败任务页会将需求带入聊天输入框。对话存储在 Agent 自有 SQLite 中。
没有密钥时原有排课功能仍可使用。详细说明见 [AI 助手设计](docs/architecture/ai-assistant-design.md) 和 [Agent 部署](deploy/agent.md)。
