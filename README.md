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
