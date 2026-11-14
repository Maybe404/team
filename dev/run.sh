#!/usr/bin/env bash
# 从源码启动 Plane 全部服务（基础设施用 dev/infra.compose.yml 起在 Docker 里）。
# 用法：dev/run.sh            启动 api/worker/beat/live/web/admin/space
#       dev/run.sh api web     只启动指定服务
# 日志写到 dev/logs/<服务>.log，Ctrl+C 停止全部。
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/dev/ports.env"
P="$ROOT/plane"
LOGS="$ROOT/dev/logs"; mkdir -p "$LOGS"
SERVICES=("$@"); [ ${#SERVICES[@]} -eq 0 ] && SERVICES=(api worker beat live web admin space)

docker compose -f "$ROOT/dev/infra.compose.yml" up -d >/dev/null 2>&1 || { echo "基础设施启动失败，检查 Docker"; exit 1; }
[ -f "$P/apps/api/.env" ] || "$ROOT/dev/setup-env.sh"

# 预览工具等外部环境可能注入 PORT，会让 live 绑错端口
unset PORT
API_ENV='set -a && source .env && set +a && export DJANGO_SETTINGS_MODULE=plane.settings.local'

start() {
  local name=$1; shift
  ( "$@" ) >"$LOGS/$name.log" 2>&1 &
  PIDS+=($!); echo "· $name 已启动（日志 dev/logs/$name.log）"
}

PIDS=()
trap 'echo; echo "正在停止…"; kill ${PIDS[@]} 2>/dev/null; pkill -P $$ 2>/dev/null; wait; exit 0' INT TERM

for s in "${SERVICES[@]}"; do
  case $s in
    api)    start api    bash -c "cd '$P/apps/api' && $API_ENV && .venv/bin/python manage.py runserver 127.0.0.1:$API_PORT --noreload" ;;
    worker) start worker bash -c "cd '$P/apps/api' && $API_ENV && .venv/bin/celery -A plane worker -l info" ;;
    beat)   start beat   bash -c "cd '$P/apps/api' && $API_ENV && .venv/bin/celery -A plane beat -l info" ;;
    live)   start live   bash -c "cd '$P/apps/live' && pnpm exec tsdown && node --env-file=.env ." ;;
    web)    start web    bash -c "cd '$P/apps/web' && pnpm exec react-router dev --port $WEB_PORT --strictPort" ;;
    admin)  start admin  bash -c "cd '$P/apps/admin' && pnpm exec react-router dev --port $ADMIN_PORT --strictPort" ;;
    space)  start space  bash -c "cd '$P/apps/space' && pnpm exec react-router dev --port $SPACE_PORT --strictPort" ;;
    *) echo "未知服务：$s" ;;
  esac
done
echo
echo "网页     http://localhost:$WEB_PORT"
echo "管理后台 http://localhost:$ADMIN_PORT/god-mode/"
echo "API      http://localhost:$API_PORT/api/v1/"
wait
