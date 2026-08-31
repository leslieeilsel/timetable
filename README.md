# 教务排课系统

面向小学与初中的教务排课工作台。前端采用 React 19、Vite+、shadcn 与 Base UI；后端采用 Laravel 13、Sanctum 与强 ETag 并发控制；生产数据库基线为 MySQL 8.4 LTS。

## 功能范围

- 管理员、排课员、查看者三类本地账号，首次登录强制修改临时密码；
- 学年、上下学期、学年班级、CSV 预检与选择性导入；
- 年级、教师、任教课程、课程与教室资料；
- 学期班级固定教室、班主任、统一作息、任课矩阵、教学组与跨学期复制；
- 排课准备检查、硬约束/软规则、固定安排、自动排课任务和多候选方案比较；
- 可版本化的班级/教师/教室周课表，手工放置、交换、即时诊断、撤销重做、锁定、局部重排和版本恢复；
- 按实际日期处理临时调课、停课、补课、换教师/教室，以及带资格和负载解释的请假代课推荐；
- UTF-8 安全 CSV、带元数据 XLSX、打印/PDF、版本差异、资源停用影响确认、审计日志和组合 ETag 并发保护；
- 所有可能增长的普通列表使用服务端筛选与分页，并把可分享的筛选和页码保存在 URL 中。

需求和架构原文保留在 `docs/requirements` 与 `docs/architecture`，HTTP 契约位于 `contracts/openapi.yaml`。

## 本地初始化

要求 PHP 8.4（intl、mbstring、pdo_sqlite/pdo_mysql）、Composer、Docker，以及由 Vite+ 管理的 Node 24.19.0 与 pnpm 11.23.0。团队命令不直接调用底层 JavaScript 包管理器。

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

若需要本地验收数据，可执行可重复运行的中型初中演示 Seeder。它会保留非演示账号和原有学年，并重建 Seeder 自己拥有的演示学期数据：

```bash
php apps/api/artisan db:seed --class='Database\Seeders\MediumSchoolSeeder'
```

演示数据包含 3 个年级、每年 24 个班、80 名在职教师、完整教室和任教关系、一个关闭历史学年、一个当前学年、4 个学期，以及 3 份无冲突完整课表。固定测试账号如下：

| 角色 | 账号 | 密码 |
| --- | --- | --- |
| 管理员 | `demo-admin@example.test` | `DemoAdmin2026!` |
| 排课员 | `demo-scheduler@example.test` | `DemoScheduler2026!` |
| 查看者 | `demo-viewer@example.test` | `DemoViewer2026!` |
| 首次改密排课员 | `demo-temporary@example.test` | `Temporary2026!` |

另有停用账号 `demo-inactive@example.test`，用于验证禁用登录。以上均仅用于本地演示，不能作为生产账号。

默认开发入口为 `http://localhost:5173`。Vite 将 `/api` 和 `/sanctum` 同源代理到 `127.0.0.1:8000`；不要在同一登录会话中混用 `localhost` 与 `127.0.0.1`。

自动排课使用可恢复的数据库队列。`pnpm dev` 会同时启动 Web、API 与数据库队列 Worker；也可用 `pnpm dev:queue` 单独启动 Worker。Worker 的 `--timeout=300` 必须小于 `DB_QUEUE_RETRY_AFTER=360`，避免同一任务被两个进程同时执行。

生产部署完成 Migration 后，需由进程管理器持续守护以下命令：

```bash
php apps/api/artisan queue:work database --queue=default --tries=3 --timeout=300
```

发布新代码后执行 `php apps/api/artisan queue:restart`。失败任务会写入 `failed_jobs`，可使用 `queue:failed` 检查，并在确认输入仍有效后按运维流程重试。

若使用 MySQL，本地容器固定为 8.4.11：

```bash
docker compose up -d mysql
```

然后把 `apps/api/.env` 的数据库连接改为 MySQL，默认宿主端口为 3307，并执行 Migration。

## 日常命令

```bash
vp run dev
vp run check
vp run test
vp run build:web
vp run contract:lint
vp run contract:generate
vp run test:e2e
composer --working-dir=apps/api test:mysql
```

`timetable:create-admin` 默认安全地交互读取密码。自动化环境可只传密码环境变量的名字：

```bash
php apps/api/artisan timetable:create-admin --name="管理员" --email="admin@example.test" --password-env=TIMETABLE_ADMIN_PASSWORD
```

不要把真实密码写进命令参数、仓库、镜像或 Seeder。

## 并发与数据安全

基础资料写入必须携带列表响应的全局 ETag；学期写入必须携带同一次学期级读取响应的组合 ETag。收到 `412` 后应刷新而不是覆盖。关闭学期后默认只读；锁定课程不能移动、删除或迁移。删除被引用的资料会被拒绝，应使用停用并确认其开放学期影响。

生产采用同源反向代理：`/` 返回 Web 静态资源，`/api` 与 `/sanctum` 转发 Laravel/PHP-FPM。上线前必须完成 CI、MySQL Migration、备份演练、HTTPS/Secure Cookie、安全响应头和每分钟 Scheduler 配置。
