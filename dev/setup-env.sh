#!/usr/bin/env bash
# 生成 Plane 各应用的本地 .env（已被 git 忽略）。重复执行会保留已生成的密钥。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/dev/ports.env"
P="$ROOT/plane"
SECRET_FILE="$ROOT/dev/.secrets"
[ -f "$SECRET_FILE" ] || { echo "SECRET_KEY=$(openssl rand -hex 32)"; echo "LIVE_SECRET=$(openssl rand -hex 32)"; } > "$SECRET_FILE"
source "$SECRET_FILE"
H=http://localhost
cat > "$P/apps/api/.env" <<E
DEBUG=1
SECRET_KEY=$SECRET_KEY
CORS_ALLOWED_ORIGINS="$H:$WEB_PORT,$H:$ADMIN_PORT,$H:$SPACE_PORT,$H:$LIVE_PORT"
DATABASE_URL=postgresql://plane:plane@localhost:$PG_PORT/plane
REDIS_URL=redis://localhost:$REDIS_PORT/
AMQP_URL=amqp://plane:plane@localhost:$MQ_PORT/plane
AWS_REGION=""
AWS_ACCESS_KEY_ID=plane-access
AWS_SECRET_ACCESS_KEY=plane-secret-key
AWS_S3_ENDPOINT_URL=$H:$MINIO_PORT
AWS_S3_BUCKET_NAME=uploads
USE_MINIO=1
MINIO_ENDPOINT_SSL=0
FILE_SIZE_LIMIT=5242880
WEB_URL=$H:$WEB_PORT
APP_BASE_URL=$H:$WEB_PORT
APP_BASE_PATH=""
ADMIN_BASE_URL=$H:$ADMIN_PORT
ADMIN_BASE_PATH=/god-mode
SPACE_BASE_URL=$H:$SPACE_PORT
SPACE_BASE_PATH=/spaces
LIVE_BASE_URL=$H:$LIVE_PORT
LIVE_BASE_PATH=/live
LIVE_SERVER_SECRET_KEY=$LIVE_SECRET
API_KEY_RATE_LIMIT=600/minute
E
for app in web admin space; do
cat > "$P/apps/$app/.env" <<E
VITE_API_BASE_URL=$H:$API_PORT
VITE_WEB_BASE_URL=$H:$WEB_PORT
VITE_ADMIN_BASE_URL=$H:$ADMIN_PORT
VITE_ADMIN_BASE_PATH=/god-mode
VITE_SPACE_BASE_URL=$H:$SPACE_PORT
VITE_SPACE_BASE_PATH=/spaces
VITE_LIVE_BASE_URL=$H:$LIVE_PORT
VITE_LIVE_BASE_PATH=/live
E
done
cat > "$P/apps/live/.env" <<E
PORT=$LIVE_PORT
API_BASE_URL=$H:$API_PORT
WEB_BASE_URL=$H:$WEB_PORT
LIVE_BASE_URL=$H:$LIVE_PORT
LIVE_BASE_PATH=/live
LIVE_SERVER_SECRET_KEY=$LIVE_SECRET
REDIS_URL=redis://localhost:$REDIS_PORT/
E
echo "env 已生成"
