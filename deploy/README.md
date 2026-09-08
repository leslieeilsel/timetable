# 宝塔面板 Linux 部署指南（无 Docker）

本文档说明如何在 Linux 服务器上通过宝塔面板部署本项目。所有命令和配置均为操作参考，本文档本身不会执行部署。

> **上线状态提示：**仓库根目录当前明确标注“项目正在开发中，请勿直接用于生产环境”。因此，以下方案适合预发布、内测或在完成测试、安全审查、备份恢复演练后作为正式部署基线；不能仅因服务器能够启动，就认定系统已经满足生产上线条件。

## 1. 部署结论与架构

项目由两个运行单元组成：

- `apps/web`：React 19 + Vite+ 构建的纯静态 SPA，构建产物位于 `apps/web/dist`；
- `apps/api`：PHP 8.4 + Laravel 13 API，通过 PHP-FPM 运行；
- MySQL 8.4 LTS：生产数据库；
- Laravel 数据库队列：执行自动排课任务，必须有常驻队列进程；
- Laravel Scheduler：由宝塔计划任务每分钟触发一次。当前代码尚无自定义定时任务，但架构设计要求保留该入口，便于后续版本增加任务时不漏执行。

推荐只使用一个 HTTPS 域名，例如 `timetable.example.com`：

```text
浏览器
  └─ HTTPS / timetable.example.com
      └─ 宝塔 Nginx
          ├─ /api/*、/sanctum/csrf-cookie → Laravel public/index.php → PHP 8.4 FPM
          └─ 其他路径                     → apps/web/dist（React SPA）

Laravel → MySQL 8.4
队列守护进程 → database 队列 → 自动排课任务
宝塔计划任务 → artisan schedule:run
```

采用同域部署的理由是：前端使用相对路径访问 `/api/*` 和 `/sanctum/csrf-cookie`，认证使用 Sanctum Session Cookie。这样不需要额外修改前端 API 地址，也不需要引入跨域 Cookie 和 CORS 配置。

## 2. 服务器与宝塔组件要求

建议使用仍在安全支持期内的 64 位 Linux 发行版。宝塔“软件商店”中准备以下组件：

| 组件 | 要求 | 说明 |
| --- | --- | --- |
| Nginx | 宝塔当前稳定版 | 提供 HTTPS、静态文件和 FastCGI 转发 |
| PHP | **8.4** | `apps/api/composer.json` 要求 `^8.4`，不能降到 8.3 |
| MySQL | **8.4 LTS** | 项目架构和生产数据库测试基线；不建议用 SQLite 或未经验证的 MariaDB 替代 |
| Composer | 2.x | 安装 Laravel 生产依赖时必须实际使用 PHP 8.4 |
| Node.js | **24.19.0** | 只在构建前端时需要，不作为常驻 Web 服务运行 |
| Vite+ | **0.2.9** | 项目的前端工具链入口，命令为 `vp` |
| 进程守护管理器 | 宝塔 Supervisor/进程守护插件 | 常驻运行 Laravel 队列 worker |

PHP 扩展至少启用：

- 必需：`intl`、`mbstring`、`zip`、`pdo_mysql`、`fileinfo`、`openssl`、`tokenizer`、`ctype`、`dom`/`xml`、`iconv`；
- 队列 CLI 强烈建议：`pcntl`、`posix`。自动排课 Job 的超时为 300 秒，`pcntl` 有助于队列 worker 正确执行超时和优雅退出；
- 推荐开启 OPcache。

可在宝塔终端检查：

```bash
php -v
php -m
composer --version
node --version
vp --version
mysql --version
```

预期版本至少包含 `PHP 8.4`、`Node v24.19.0`、`Vite+ 0.2.9` 和 `MySQL 8.4.x`。宝塔网站所选的 PHP 版本与终端中的 `php` 可能不是同一个；执行 Composer 和 Artisan 前必须确认终端实际调用的是 PHP 8.4。宝塔 PHP 8.4 的 CLI 常见路径为 `/www/server/php/84/bin/php`，但应以服务器实际安装路径为准。

建议的 PHP 配置基线：

```ini
memory_limit = 512M
max_execution_time = 120
upload_max_filesize = 20M
post_max_size = 24M
date.timezone = Asia/Shanghai
```

不要开放 MySQL 公网端口。服务器防火墙只对外开放业务所需的 80/443；宝塔面板和 SSH 端口应限制可信 IP，并优先使用 SSH 密钥登录。

## 3. 目录、域名和数据库

本文后续统一使用以下示例值，实际部署时必须替换：

| 项目 | 示例值 |
| --- | --- |
| 域名 | `timetable.example.com` |
| 项目目录 | `/www/wwwroot/timetable/current` |
| Laravel 目录 | `/www/wwwroot/timetable/current/apps/api` |
| 前端产物目录 | `/www/wwwroot/timetable/current/apps/web/dist` |
| 数据库 | `timetable` |
| 数据库用户 | `timetable` |
| PHP-FPM Socket | `/tmp/php-cgi-84.sock`（以宝塔生成配置为准） |

### 3.1 上传代码

可以使用 Git 拉取受信任的发布 Tag/Commit，或在本地打包后通过宝塔上传。不要把本地的 `apps/api/.env`、测试数据库、`node_modules`、开发日志或其他秘密文件上传到服务器。

建议让项目路径固定为：

```text
/www/wwwroot/timetable/current
```

发布前记录实际 Commit，并尽量只部署已经通过 CI/测试的 Tag，不要直接部署一个仍在变化的开发分支。

### 3.2 创建 MySQL 数据库

在宝塔“数据库”中创建独立数据库和独立用户，不要让应用使用 `root`。密码使用随机生成的高强度值。项目要求：

- MySQL 8.4；
- InnoDB；
- 字符集 `utf8mb4`；
- 排序规则 `utf8mb4_0900_as_cs`；
- 严格 SQL Mode；
- MySQL 默认时区为 UTC。

如果面板不能选择目标排序规则，可由数据库管理员在**确认数据库名无误**后执行：

```sql
ALTER DATABASE timetable
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_as_cs;
```

项目没有在 Laravel 连接配置中单独设置 MySQL Session 时区，因此 MySQL 服务应配置：

```ini
[mysqld]
default-time-zone = '+00:00'
default-storage-engine = InnoDB
```

修改 MySQL 全局时区可能影响同一实例上的其他应用。若服务器共用 MySQL，必须先评估其他应用；不能统一使用 UTC 时，需要先修改并验证本项目的数据库连接配置，不能忽略该差异继续上线。

## 4. 安装依赖和构建前端

下列命令仅应在代码来源、版本和当前目录均确认无误后执行。

### 4.1 准备 Vite+

如果服务器尚无 `vp`，先在 Node.js 24.19.0 环境安装项目锁定的版本：

```bash
npm install --global vite-plus@0.2.9
vp --version
```

进入项目目录，让 Vite+ 按根目录 `package.json` 中的 `devEngines` 准备准确的 Node.js 和 pnpm 版本：

```bash
cd /www/wwwroot/timetable/current
vp env setup
vp env on
vp env install
vp env current
```

宝塔终端重新打开后若找不到 Vite+ 管理的 Node，请先按 `vp env print` 的提示加载当前 Shell 环境，或在宝塔 Node 版本管理器中直接选择 Node.js 24.19.0。

### 4.2 构建 Web 静态文件

构建工具位于 `devDependencies`，所以这里不能使用 `--prod`：

```bash
cd /www/wwwroot/timetable/current
vp install --frozen-lockfile
vp run build:web
test -f apps/web/dist/index.html
```

`--frozen-lockfile` 可防止服务器静默修改依赖锁文件。生产运行时不需要启动 `vp dev`、`vp preview` 或 Node 常驻进程，Nginx 直接提供 `apps/web/dist`。

### 4.3 安装 Laravel 生产依赖

确认 Composer 正在使用 PHP 8.4，然后执行：

```bash
cd /www/wwwroot/timetable/current/apps/api
composer install \
  --no-dev \
  --prefer-dist \
  --optimize-autoloader \
  --no-interaction
composer check-platform-reqs --no-dev
```

禁止用 `--ignore-platform-reqs` 绕过 PHP 或扩展要求。若终端默认 PHP 不是 8.4，应通过宝塔 Composer 界面选择 PHP 8.4，或使用服务器上 PHP 8.4 的真实 CLI 路径执行 Composer。

## 5. Laravel 生产环境配置

复制模板并编辑：

```bash
cd /www/wwwroot/timetable/current/apps/api
cp .env.example .env
```

推荐的 `.env` 基线如下。域名、数据库密码、版本号和 Commit 必须替换；`APP_KEY` 先留空：

```dotenv
APP_NAME="教务排课系统"
APP_ENV=production
APP_KEY=
APP_DEBUG=false
APP_URL=https://timetable.example.com
APP_VERSION=2026.09.01
APP_COMMIT=replace-with-deployed-git-commit

APP_LOCALE=en
APP_FALLBACK_LOCALE=en
APP_FAKER_LOCALE=en_US
SCHOOL_TIMEZONE=Asia/Shanghai

APP_MAINTENANCE_DRIVER=file
BCRYPT_ROUNDS=12

LOG_CHANNEL=stack
LOG_STACK=daily
LOG_LEVEL=info
LOG_DAILY_DAYS=14
LOG_DEPRECATIONS_CHANNEL=null

DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=timetable
DB_USERNAME=timetable
DB_PASSWORD="replace-with-a-random-database-password"
DB_CHARSET=utf8mb4
DB_COLLATION=utf8mb4_0900_as_cs

SESSION_DRIVER=database
SESSION_LIFETIME=120
SESSION_ENCRYPT=false
SESSION_PATH=/
SESSION_DOMAIN=null
SESSION_SECURE_COOKIE=true
SESSION_HTTP_ONLY=true
SESSION_SAME_SITE=lax
SESSION_COOKIE=timetable_session
SANCTUM_STATEFUL_DOMAINS=timetable.example.com

CACHE_STORE=database
QUEUE_CONNECTION=database
DB_QUEUE=default
DB_QUEUE_RETRY_AFTER=360
QUEUE_FAILED_DRIVER=database-uuids

BROADCAST_CONNECTION=log
FILESYSTEM_DISK=local
MAIL_MAILER=log
```

说明：

- `.env` 是服务器秘密文件，不提交到 Git、不放在前端目录、不通过聊天或工单传递；
- `APP_DEBUG` 在生产环境必须为 `false`；
- `APP_URL` 必须使用最终的 HTTPS 域名；
- `SESSION_DOMAIN=null` 会生成仅限当前主机的 Cookie，适合本指南的单域名部署；
- `SANCTUM_STATEFUL_DOMAINS` 只写主机名；如果使用非标准端口才附加端口，不要带 `https://`；
- `DB_QUEUE_RETRY_AFTER=360` 必须大于队列任务的 `--timeout=300`，避免同一任务被提前重复领取；
- 如果数据库密码包含空格、`#` 等字符，应保留双引号并确认 Laravel 能正确读取。

只在首次部署、`APP_KEY` 为空时生成密钥：

```bash
cd /www/wwwroot/timetable/current/apps/api
php artisan key:generate --force
```

此后应备份并永久保留 `APP_KEY`。更新或重启时不要重新生成，否则现有 Session 和其他加密数据会失效。

## 6. 文件权限

宝塔默认 Nginx/PHP-FPM 用户通常是 `www`，应以服务器实际用户为准。代码只需可读，只有 Laravel 的 `storage` 和 `bootstrap/cache` 需要 Web/队列进程写入：

```bash
cd /www/wwwroot/timetable/current/apps/api
chown root:www .env
chmod 640 .env

chown -R www:www storage bootstrap/cache
find storage bootstrap/cache -type d -exec chmod 775 {} +
find storage bootstrap/cache -type f -exec chmod 664 {} +
```

不要把整个项目设置为 `777`，也不要让 `.env` 可被所有用户读取。每次更新依赖或切换代码版本后，都应重新确认上述两个可写目录的属主。

宝塔网站的“防跨站攻击（open_basedir）”必须允许 PHP 访问完整项目目录和 `/tmp`，例如：

```text
/www/wwwroot/timetable/current/:/tmp/
```

原因是站点静态根目录在 `apps/web/dist`，而 PHP 入口位于同一项目下的 `apps/api/public/index.php`。不要简单关闭 open_basedir；应把允许范围设置为项目目录。由于实际 PHP 入口不在面板显示的静态根目录中，还要确认限制最终写入 `apps/api/public/.user.ini` 或对应的 PHP-FPM Pool 配置，而不只是写进一个 PHP 不会扫描到的目录。改动后应验证 PHP-FPM 能读取后端代码和 `storage`。

## 7. 初始化数据库和管理员

先确认 `.env` 中连接的是**新建的目标生产数据库**。然后以 PHP-FPM 相同用户执行迁移：

```bash
cd /www/wwwroot/timetable/current/apps/api
runuser -u www -- php artisan migrate:status
runuser -u www -- php artisan migrate --force
```

如 `runuser` 环境中的 `php` 不是 8.4，请把命令中的 `php` 替换为宝塔 PHP 8.4 的真实 CLI 路径，例如 `/www/server/php/84/bin/php`。

不要在生产环境运行 `php artisan db:seed`。当前默认 Seeder 会写入一套中型学校演示数据。

首次部署通过交互方式创建管理员，避免密码进入 Shell 历史：

```bash
cd /www/wwwroot/timetable/current/apps/api
runuser -u www -- php artisan timetable:create-admin
```

临时密码必须至少 12 位，包含大小写字母和数字；管理员首次登录后会被要求修改密码。

最后生成生产缓存：

```bash
cd /www/wwwroot/timetable/current/apps/api
runuser -u www -- php artisan config:cache
runuser -u www -- php artisan view:cache
```

修改 `.env` 后必须重新执行 `config:cache`。本文不建议盲目使用 `php artisan optimize`，因为它还会缓存路由等额外内容；应先在与生产一致的环境验证后再启用。

## 8. 在宝塔创建网站和配置 Nginx

### 8.1 面板设置

1. 在宝塔“网站”中新建 PHP 站点，绑定 `timetable.example.com`；
2. PHP 版本选择 8.4；
3. 面板中的网站目录先设为 `/www/wwwroot/timetable/current`，便于 open_basedir 覆盖前后端完整目录；
4. 不创建 FTP，不开放数据库远程访问；
5. 在“SSL”中申请证书并开启强制 HTTPS；
6. 编辑站点 Nginx 配置，把实际 `root` 改为前端构建目录。

在面板里再次修改“网站目录”可能覆盖手写的 Nginx `root`，修改后必须复查完整站点配置。

### 8.2 Nginx 配置示例

下面是应放在该站点 `server { ... }` 中的核心配置。宝塔生成的 `listen`、`server_name`、证书路径、访问日志和错误日志保留不变；不要重复添加另一个 `server` 块。

```nginx
root /www/wwwroot/timetable/current/apps/web/dist;
index index.html;

client_max_body_size 20m;

# API 必须全部交给 Laravel，而不是按前端静态文件查找。
location ^~ /api/ {
    try_files __timetable_api_never_exists__ @timetable_laravel;
}

# Sanctum 的 CSRF Cookie 初始化端点不在 /api 下，必须单独转发。
location = /sanctum/csrf-cookie {
    try_files __timetable_sanctum_never_exists__ @timetable_laravel;
}

location @timetable_laravel {
    include fastcgi_params;
    fastcgi_pass unix:/tmp/php-cgi-84.sock;
    fastcgi_index index.php;

    fastcgi_param SCRIPT_FILENAME /www/wwwroot/timetable/current/apps/api/public/index.php;
    fastcgi_param SCRIPT_NAME /index.php;
    fastcgi_param DOCUMENT_ROOT /www/wwwroot/timetable/current/apps/api/public;
    fastcgi_param HTTP_AUTHORIZATION $http_authorization;
    fastcgi_param HTTPS $https if_not_empty;
    fastcgi_param HTTP_PROXY "";

    fastcgi_connect_timeout 30s;
    fastcgi_send_timeout 300s;
    fastcgi_read_timeout 300s;
}

# Vite 生成的带哈希资源可长期缓存。
location ^~ /assets/ {
    try_files $uri =404;
    access_log off;
    expires 1y;
    add_header Cache-Control "public, immutable";
}

# React Router 使用 BrowserRouter，深层路由必须回退到 index.html。
location / {
    try_files $uri $uri/ /index.html;
    add_header Cache-Control "no-cache";
}

# 不允许从静态站点目录直接执行任意 PHP 文件。
location ~ \.php(?:/|$) {
    return 404;
}

# 允许 ACME 验证，其余隐藏文件拒绝访问。
location ~ /\.(?!well-known/) {
    deny all;
}

add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header X-Frame-Options "DENY" always;
```

`/tmp/php-cgi-84.sock` 只是宝塔常见值。应打开宝塔自动生成的 `enable-php-84.conf` 或现有站点 PHP 配置，复制其中真实的 `fastcgi_pass`；Socket 不匹配会导致 `502 Bad Gateway`。

保存前使用宝塔的“配置文件检查”，或执行 Nginx 配置测试；只有测试通过才重载 Nginx。先确认 HTTPS 完全正常，再考虑开启 HSTS；错误的 HSTS 配置会让浏览器在证书或域名配置错误时也拒绝 HTTP 回退。

## 9. 配置队列守护进程

自动排课通过 `GenerateScheduleCandidates` 数据库队列 Job 执行。没有队列 worker 时，请求会一直停留在“等待中”。

在宝塔 Supervisor/进程守护管理器中新建 `timetable-queue`：

| 字段 | 建议值 |
| --- | --- |
| 工作目录 | `/www/wwwroot/timetable/current/apps/api` |
| 启动用户 | `www` |
| 进程数 | `1`（先按单进程运行，确认 CPU/内存余量后再评估） |
| 自动启动/重启 | 开启 |
| 停止等待时间 | 至少 `360` 秒 |

启动命令：

```bash
/www/server/php/84/bin/php artisan queue:work database --queue=default --sleep=3 --tries=3 --timeout=300 --max-time=3600
```

如果插件支持原生 Supervisor 配置，可参考：

```ini
[program:timetable-queue]
process_name=%(program_name)s_%(process_num)02d
directory=/www/wwwroot/timetable/current/apps/api
command=/www/server/php/84/bin/php artisan queue:work database --queue=default --sleep=3 --tries=3 --timeout=300 --max-time=3600
user=www
numprocs=1
autostart=true
autorestart=true
stopasgroup=true
killasgroup=true
stopwaitsecs=360
redirect_stderr=true
stdout_logfile=/www/wwwroot/timetable/current/apps/api/storage/logs/queue-worker.log
stdout_logfile_maxbytes=20MB
stdout_logfile_backups=5
```

确认 `stopwaitsecs` 和 `.env` 的 `DB_QUEUE_RETRY_AFTER` 均大于 300 秒。更新代码时执行 `php artisan queue:restart`，让旧 worker 完成当前 Job 后退出，再由守护进程拉起新进程。

## 10. 配置宝塔计划任务

在宝塔“计划任务”中新增 Shell 脚本：

- 名称：`timetable-scheduler`；
- 周期：每 1 分钟；
- 执行用户：`www`（如果面板支持选择）；
- 脚本：

```bash
cd /www/wwwroot/timetable/current/apps/api && /www/server/php/84/bin/php artisan schedule:run >> /dev/null 2>&1
```

当前版本 `routes/console.php` 尚未注册自定义定时任务，因此该命令现在通常不会执行额外业务。保留它是为了满足项目架构基线和后续版本兼容。若面板只能用 `root` 执行计划任务，应通过 `runuser -u www --` 调用 Artisan，避免生成 root 属主的缓存或日志。

## 11. 首次启动后的验收

按顺序检查，任一步失败都不要继续对用户开放：

### 11.1 服务和配置

```bash
cd /www/wwwroot/timetable/current/apps/api
php artisan about --only=environment
php artisan migrate:status
php artisan queue:failed
```

确认：

- 环境是 `production`，Debug 为关闭；
- 数据库迁移全部为 `Ran`；
- PHP-FPM、Nginx、MySQL、队列守护进程均在运行；
- 队列日志和 `storage/logs/laravel.log` 没有持续报错。

### 11.2 HTTP 健康检查

```bash
curl -fsS https://timetable.example.com/api/v1/health
curl -I https://timetable.example.com/
curl -sS -o /dev/null -w '%{http_code}\n' \
  https://timetable.example.com/sanctum/csrf-cookie
```

`/api/v1/health` 应返回 HTTP 200，JSON 中 `status` 为 `ready`，并显示配置的版本和 Commit。首页应返回 200；Sanctum 端点通常返回 204。健康检查返回 503 时应先查看数据库连接、迁移状态和 `app_settings` 初始化情况。

### 11.3 浏览器业务验收

1. 使用首个管理员登录；
2. 首次登录后完成密码修改；
3. 刷新一个 React 深层页面，确认没有 Nginx 404；
4. 创建少量测试学年/学期数据；
5. 发起一次最小规模的自动排课，确认状态能从“等待中”继续推进；
6. 测试 CSV/XLSX/ZIP 导出；
7. 退出后确认受保护 API 返回未认证状态；
8. 查看 Nginx、PHP、Laravel 和队列日志，确认没有秘密、Session 或 CSRF 值泄漏。

## 12. 日常发布更新

正式更新前，先在预发布环境执行项目测试，并阅读新版本 Migration。推荐流程：

1. 在宝塔备份 MySQL、`apps/api/.env` 和 `apps/api/storage/app`；
2. 记录当前 Git Commit/发布包版本；
3. 让 Laravel 进入维护模式；
4. 停止或平滑退出队列 worker；
5. 更新到已验证的 Tag/Commit；
6. 重新执行 `vp install --frozen-lockfile` 和 `vp run build:web`；
7. 重新执行 Composer 生产安装和 `composer check-platform-reqs --no-dev`；
8. 修正 `storage`、`bootstrap/cache` 权限；
9. 执行 `php artisan migrate --force`；
10. 执行 `php artisan config:cache`、`php artisan view:cache` 和 `php artisan queue:restart`；
11. 恢复队列守护进程并退出维护模式；
12. 完成健康检查和浏览器冒烟测试，再结束观察期。

维护模式命令：

```bash
cd /www/wwwroot/timetable/current/apps/api
runuser -u www -- php artisan down
# 更新、迁移、检查完成后
runuser -u www -- php artisan up
```

数据库迁移不一定可以仅靠切换旧代码安全回滚。发生问题时，应根据该版本 Migration 的兼容性选择“旧代码 + 保持已扩展数据库结构”，或在维护模式下恢复部署前的数据库备份；不要在未评估数据损失时执行 `migrate:rollback`。

## 13. 备份、监控与故障定位

### 13.1 备份

至少配置：

- MySQL 每日自动备份，保留 7～30 天；
- `apps/api/.env` 的加密离线备份，重点保留 `APP_KEY`；
- `apps/api/storage/app` 的文件备份；
- 每月至少做一次恢复演练，并确认备份不只存在于同一块服务器磁盘。

备份文件包含敏感业务数据，应加密并限制下载权限。不要只验证“备份任务显示成功”，必须实际验证备份可以恢复。

### 13.2 监控

建议监控：

- `GET /api/v1/health` 的状态码和响应时间；
- Nginx 5xx、PHP-FPM 错误、Laravel `error`/`critical` 日志；
- `jobs` 表积压数量、最老任务等待时间、`failed_jobs` 数量；
- 队列守护进程存活状态；
- MySQL 磁盘、连接数和慢查询；
- 服务器 CPU、内存和磁盘空间。

常用只读检查：

```bash
cd /www/wwwroot/timetable/current/apps/api
php artisan queue:failed
tail -n 100 storage/logs/laravel.log
tail -n 100 storage/logs/queue-worker.log
```

不要直接执行 `queue:flush`，它会删除失败任务记录。失败任务重试前，应先定位失败原因并确认任务具备安全重试条件。

### 13.3 常见故障

| 现象 | 优先检查 |
| --- | --- |
| 502 Bad Gateway | `fastcgi_pass` Socket 是否与宝塔 PHP 8.4 实际配置一致，PHP-FPM 是否运行 |
| API 返回 404/HTML | `/api/` 是否进入 `@timetable_laravel`，是否误被 SPA `index.html` 接管 |
| 登录或写操作返回 419 | `/sanctum/csrf-cookie` 是否转发，HTTPS、`APP_URL`、`SANCTUM_STATEFUL_DOMAINS`、Secure Cookie 是否匹配 |
| 登录后立即 401 | `sessions` 表、数据库 Session 配置、Cookie 域名、系统时间是否正常 |
| 健康检查 503 | MySQL 连接、Migration、`app_settings` 记录、数据库权限 |
| 自动排课一直等待 | 队列守护进程、`jobs`/`failed_jobs`、worker 使用的代码目录和 `.env` |
| 深层页面刷新 404 | Nginx 的 `try_files $uri $uri/ /index.html` 是否存在 |
| Laravel 无法写日志/缓存 | `storage`、`bootstrap/cache` 的属主和权限，宝塔 open_basedir |
| 上传返回 413 | Nginx `client_max_body_size` 与 PHP `upload_max_filesize`/`post_max_size` |
| 修改 `.env` 不生效 | 清除并重新生成 Laravel 配置缓存，然后平滑重启队列 worker |

## 14. 上线前最终清单

- [ ] 已部署固定 Tag/Commit，且通过与生产数据库一致的 MySQL 8.4 测试；
- [ ] PHP 8.4 及必需扩展通过 `composer check-platform-reqs --no-dev`；
- [ ] `APP_ENV=production`、`APP_DEBUG=false`、`APP_URL` 为最终 HTTPS 地址；
- [ ] MySQL 使用独立最小权限账号、InnoDB、`utf8mb4_0900_as_cs` 和 UTC；
- [ ] `.env` 权限正确，`APP_KEY` 已加密备份且没有重新生成；
- [ ] Nginx 只暴露前端静态产物，并正确转发 `/api/*` 与 Sanctum CSRF 端点；
- [ ] HTTPS 证书、自动续期和强制 HTTPS 已验证；
- [ ] 队列 worker 常驻，300/360 秒的超时关系正确；
- [ ] 宝塔 Scheduler 计划任务每分钟运行；
- [ ] 首个管理员使用交互命令创建，并已修改临时密码；
- [ ] 未在生产运行演示 Seeder；
- [ ] 数据库、`.env`、`storage/app` 已备份，并完成恢复演练；
- [ ] 健康检查、登录、深层路由、自动排课、导出均通过；
- [ ] 宝塔面板、SSH、MySQL 和服务器防火墙按最小暴露原则配置；
- [ ] 已接受仓库仍处于开发阶段的风险，或已完成正式上线所需的额外审查。
