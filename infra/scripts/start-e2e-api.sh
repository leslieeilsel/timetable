#!/usr/bin/env sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
api_root="$project_root/apps/api"
e2e_database="${E2E_DB_PATH:-$api_root/storage/e2e.sqlite}"
e2e_web_port="${E2E_WEB_PORT:-5174}"

if [ ! -f "$api_root/.env" ]; then
  cp "$api_root/.env.example" "$api_root/.env"
  php "$api_root/artisan" key:generate --force
fi

: "${E2E_ADMIN_PASSWORD:?E2E_ADMIN_PASSWORD is required}"
rm -f "$e2e_database"
touch "$e2e_database"

export APP_ENV=testing
export APP_DEBUG=false
export DB_CONNECTION=sqlite
export DB_DATABASE="$e2e_database"
export SESSION_DRIVER=database
export CACHE_STORE=database
export SANCTUM_STATEFUL_DOMAINS="localhost:$e2e_web_port"
export TIMETABLE_E2E_PASSWORD="$E2E_ADMIN_PASSWORD"

php "$api_root/artisan" migrate:fresh --force
php "$api_root/artisan" timetable:create-admin \
  --name="端到端管理员" \
  --email="e2e-admin@example.test" \
  --password-env=TIMETABLE_E2E_PASSWORD
exec php "$api_root/artisan" serve --host=127.0.0.1 --port=8001
