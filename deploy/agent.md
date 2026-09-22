# TypeScript Agent 部署

Agent 使用 Node.js 24.19.0，独立于 Laravel PHP-FPM 和排课队列。前端、API 和 Agent 对浏览器使用同一个 HTTPS 域名。无用户 AI 配额模块。

## 本地运行

在项目根目录安装依赖并执行业务迁移：

```bash
vp install --frozen-lockfile
php apps/api/artisan migrate
cp apps/agent/.env.example apps/agent/.env
```

在本机编辑 `apps/agent/.env`，设置 `DEEPSEEK_API_KEY`，不通过聊天或前端配置传递密钥。已有环境文件时直接编辑，不覆盖。默认模型为 `deepseek-flash`，Chat 默认使用 `max` 思考强度，单次请求的推理与答复共享 `393216` tokens 输出上限，思考过程不展示给用户。

```bash
vp run dev
```

该命令同时启动 Laravel、原有排课队列、管理端、教师端和 Agent。单独启动 Agent 可用 `vp run dev:agent`。访问管理端默认地址 `http://127.0.0.1:5173`。默认 Agent 监听 `127.0.0.1:8010`。

没有密钥时 Agent 仍可启动，助手返回“服务尚未启用”，其他功能保持可用。Agent `.env` 修改后重启进程。

质量优先的正文配置为 `DEEPSEEK_THINKING_LEVEL=max`、`DEEPSEEK_MAX_TOKENS=393216`。这是 DeepSeek 官方文档的 384K 上限（384 × 1024），不是要求每次生成这么多 tokens；模型可提前结束，SDK 会根据剩余上下文缩减本次可用额度。保持模型采样默认值，不把温度调到最大。标题生成仍使用独立的短输出和关闭思考，交付格式修复也只关闭该次请求的思考。[DeepSeek 参数说明](https://api-docs.deepseek.com/zh-cn/api/create-chat-completion/)

修改 `.env` 后，停止原 Agent 进程并在项目根目录运行 `vp run dev:agent`（若使用 `vp run dev`，重启原开发进程即可，勿同时启动第二个 Agent）。生产环境重新构建并重启守护进程。

## 生产配置

先按主部署指南配置 Laravel 和静态站点，再构建 Agent：

```bash
vp install --frozen-lockfile
vp run build:web
vp run build:agent
php apps/api/artisan migrate --force
```

保留 monorepo 的 `node_modules` 及 workspace 链接；Agent 构建产物仍依赖已安装的 pi 与 zod 包，不是单文件独立可执行程序。

服务端 `apps/agent/.env` 示例：

```dotenv
HOST=127.0.0.1
PORT=8010
PUBLIC_ORIGINS=https://timetable.example.com
LARAVEL_BASE_URL=https://timetable.example.com
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-flash
DEEPSEEK_THINKING_LEVEL=max
DEEPSEEK_MAX_TOKENS=393216
AGENT_DATABASE_PATH=/var/lib/timetable-agent/chat.sqlite
```

将真实密钥填入受限的服务端文件，或通过守护进程环境注入。不要复用 Laravel `.env`。Node 运行用户需要读取项目依赖、构建产物及自己的配置，并读写 Agent 自有 SQLite 目录；不需要 Laravel 业务数据库凭据或 APP_KEY。

`PUBLIC_ORIGINS` 是逗号分隔的精确 origin，包含协议及必要端口，不含末尾斜杠。Laravel 同时配置 `SANCTUM_STATEFUL_DOMAINS=timetable.example.com`、安全 Session Cookie 和正确 HTTPS URL。`LARAVEL_BASE_URL` 可使用固定内网 HTTP 入口，但必须路由到本项目 Laravel；不能填写 PHP-FPM Socket。

## Nginx 与常驻进程

在同域站点中增加以下 location，保留原 `/api/`、`/sanctum/` 和 SPA 配置：

```nginx
location ^~ /agent/ {
    proxy_pass http://127.0.0.1:8010;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Connection "";
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_cache off;
    gzip off;
    proxy_read_timeout 330s;
    proxy_send_timeout 15s;
    client_max_body_size 32k;
}
```

默认转发 Cookie、Origin、Referer、X-XSRF-TOKEN 及响应 Set-Cookie，不要在代理层删改这些头。330 秒是相邻读取之间的空闲超时；Agent 每 10 秒发送 SSE 心跳，正常的长任务不会因此被中断。外部仅开放站点 HTTPS 端口。

使用专用运行用户 `timetable-agent` 并赋予必要读权限。Supervisor 示例中的 Node 路径按服务器实际位置替换：

```ini
[program:timetable-agent]
directory=/www/wwwroot/timetable/current/apps/agent
command=/absolute/path/to/node --env-file=.env dist/server.js
user=timetable-agent
numprocs=1
autostart=true
autorestart=true
stopasgroup=true
killasgroup=true
stopwaitsecs=15
environment=NODE_ENV="production"
redirect_stderr=true
stdout_logfile=/var/log/timetable-agent.log
stdout_logfile_maxbytes=10MB
stdout_logfile_backups=3
```

发布更新后重新构建并重启 Agent。SIGTERM 会取消正在生成的回答，部分文本会保留并标为中断。已确认的业务操作通过原操作编号恢复结果，不能因为网络中断换一个编号重复保存。修改模型名称前确认锁定 pi 版本的模型目录支持该名称。

## 会话数据与升级

首版只运行一个 Agent 实例（`numprocs=1`），不能在同一数据库上启动第二个进程或使用 cluster 多 worker。需要多实例时再迁移共享存储及分布式锁。

本地默认数据库是 `apps/agent/storage/chat.sqlite`（从 Agent 工作目录启动）。生产应使用上面示例的绝对路径，放在持久目录而非每次更换的发布目录。目录需归运行用户所有，建议权限 0700；禁止 Nginx 将数据库、WAL 和备份目录作为静态文件暴露。SQLite 包含用户会话、查询事实和操作状态，备份按学校业务数据管理。Cookie、CSRF 和 API Key 不写入会话。

首次访问 Chat 时自动建表。服务重启会把未完成轮次标为中断，待回答问卷和待确认规则会恢复。备份时使用 SQLite backup API，或停止 Agent 后备份整个数据库目录（包含尚未检查点合并的 WAL）；不要运行中只复制主文件。保留数据库可恢复会话及确认操作的幂等编号。

每次历史请求和续聊都重新验证 Laravel 身份；不要在代理层缓存 `/agent/` 响应。普通对话无学期也可使用，业务查询由模型查询上下文或询问用户。不设用户配额、工具调用次数上限或整轮执行时限，直到回答完成、需要用户操作、用户停止、连接中断或发生无法继续的错误。单次业务网络请求仍有 15 秒超时。旧配置 `AGENT_MAX_TURNS`、`AGENT_RUN_TIMEOUT_MS` 已停用，即使仍在本地环境文件中也不会生效。

## 回答失败诊断

`turns.transcript_json` 在每次模型回复和工具结果结束时写入检查点，成功、失败和主动停止都会保留。本字段包括服务端 pi 消息、工具调用参数、返回内容和错误状态，不通过聊天接口返回。`turns.diagnostics_json` 保存本轮状态、错误码、每次模型请求的开始/结束时间、首个流事件耗时、实际输出上限、HTTP 状态、标准化及原始停止原因、token 用量，以及工具调用编号、状态和耗时。可用调用编号关联完整工具结果。

用量分为未缓存输入 `input`、输出 `output`、缓存读取 `cache_read`、缓存写入 `cache_write`、推理 `reasoning` 和总量 `total`。推理已经包含在输出中，不重复相加。整轮合计仅累计服务商已返回的数据；未报告用量时为 `null`，`usage_complete=false`，不根据耗时猜测。推理明细没有返回时为 `null`。自动标题生成不计入正文用量。记录的是模型报告的用量，不替代服务商账单。

`MODEL_OUTPUT_LIMIT` 表示模型以 `length` 停止（可能触及输出或上下文上限）；`MODEL_REQUEST_FAILED` 的具体服务商停止原因和错误留在服务端记录中。异常重启会标记 `AGENT_RESTARTED`，保留已完成检查点，无法收到的结束时间和用量保持未知。过去已丢弃的失败 transcript 无法事后还原。

排查指定会话时，对数据库使用只读连接，避免实例化 `ChatStore` 触发启动恢复：

```bash
sqlite3 -readonly apps/agent/storage/chat.sqlite
```

```sql
SELECT seq, status,
       json_extract(diagnostics_json, '$.error_code') AS error_code,
       json_extract(diagnostics_json, '$.stop_reason') AS stop_reason,
       json_extract(diagnostics_json, '$.usage') AS reported_usage,
       json_extract(diagnostics_json, '$.usage_complete') AS usage_complete,
       json_extract(diagnostics_json, '$.requests') AS model_requests,
       json_extract(diagnostics_json, '$.tools') AS tool_timings
FROM turns WHERE conversation_id = '替换为会话 UUID' ORDER BY seq;

SELECT turns.seq, message.value AS tool_result
FROM turns, json_each(turns.transcript_json) AS message
WHERE turns.conversation_id = '替换为会话 UUID'
  AND json_extract(message.value, '$.role') = 'toolResult'
ORDER BY turns.seq, message.key;
```

## 验证

```bash
curl -fsS https://timetable.example.com/agent/health
vp run check:agent
vp run test:agent
```

健康检查的 ready 只表示已配置密钥，不验证 DeepSeek 是否可用。登录管理端，从侧栏「AI 助手」打开 `/ai`，先完成一次普通问答和追问，刷新确认历史恢复。再生成一次规则预览，确认“保存为草稿”之前规则数不变；确认保存后只出现一批草稿。再使用一条已有失败排课任务检查解释和原始依据。

真实模型验收还应检查重名教师、上午/下午实际课节、临时日期要求、取消及 DeepSeek 故障时的提示。日常自动化测试使用模拟模型，不产生模型费用。前端不会收到密钥、原始 pi 事件或思考内容。

可手动执行 `vp run @timetable/agent#eval:chat` 做 8 个真实模型对话场景的抽样评测，包括任教课程、用户纠正、空数据与查询失败、重名和简洁表达。该命令读取 Agent 服务端密钥，会产生模型调用费用；业务数据全部合成，不连接学校业务服务，也不保存对话或修改业务数据。`DEEPSEEK_THINKING_LEVEL` 支持 `off/low/high/max`，默认 `max`；`DEEPSEEK_MAX_TOKENS` 默认 `393216`，可设置为 1—393216 的整数。调整后重新评测效果与响应时间。

| 现象                 | 检查                                                                 |
| -------------------- | -------------------------------------------------------------------- |
| AI 服务尚未启用      | Agent 环境变量和工作目录，修改配置后是否重启                         |
| 401 / 403 / 419      | 当前登录、角色、Origin 白名单、Sanctum stateful 域、Cookie/CSRF 转发 |
| 请求结束前看不到进度 | Nginx 缓冲、缓存、压缩是否关闭                                       |
| 502 / 连接失败       | Node 守护进程、监听端口、Nginx `/agent/` 路由                        |
| 模型配置不可用       | DEEPSEEK_MODEL 是否存在于锁定 pi 版本目录                            |
| 保存提示数据变化     | 在聊天中重新生成预览，再由用户确认                                   |
