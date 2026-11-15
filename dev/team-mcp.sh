#!/usr/bin/env bash
# 本地试用 team-mcp：用 dev/.secrets 里的测试账号连本地 Plane。
# 正式使用时每个人在自己的 MCP 配置里填自己的 PLANE_API_TOKEN，不用这个脚本。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
set -a
source "$ROOT/dev/ports.env"
source "$ROOT/dev/.secrets"
set +a
export PLANE_BASE_URL="http://localhost:$API_PORT" PLANE_WEB_URL="http://localhost:$WEB_PORT"
# TEAM_MCP_AS=member 时用普通成员 bob 的身份，方便试多人协作
[ "${TEAM_MCP_AS:-}" = member ] && export PLANE_API_TOKEN="$PLANE_MEMBER_TOKEN"
exec node "$ROOT/mcp/dist/index.js"
