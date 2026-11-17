#!/usr/bin/env bash
# 本地长期运行：用二开源码构建镜像，docker compose 常驻（容器随 Docker 自动重启）。
#   deploy/team.sh build     构建全部镜像（首次 10～20 分钟）
#   deploy/team.sh up        启动（数据在 docker volume 里，重启不丢）
#   deploy/team.sh down      停止（保留数据）
#   deploy/team.sh logs api  看日志
#   deploy/team.sh ps
#   deploy/team.sh version   当前版本和提交
# 配置在 deploy/plane/.env（从 variables.example.env 复制，已忽略）。定时回顾需要在 .env 里填
# TEAM_REVIEW_WORKSPACE、TEAM_REVIEW_TOKEN（管理员的 API Token），然后 `deploy/team.sh up` 会一起启动。
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# 版本号只在仓库根目录 VERSION 里改；镜像按版本打标签，网页、API、MCP 都显示它
LOOM_VERSION="$(tr -d '[:space:]' < "$HERE/../VERSION")"
LOOM_COMMIT="$(git -C "$HERE" rev-parse --short HEAD 2>/dev/null || echo unknown)$(git -C "$HERE" diff --quiet HEAD 2>/dev/null || echo -dirty)"
export LOOM_VERSION LOOM_COMMIT
cd "$HERE/plane"
DC=(docker compose -p team -f docker-compose.yml -f docker-compose.team.yml --env-file .env)
profiles=()
if grep -qE '^TEAM_REVIEW_TOKEN=.+' .env 2>/dev/null; then profiles=(--profile review); fi
case "${1:-}" in
  build)
    "$HERE/set-version.sh" >/dev/null
    (cd ../../mcp && npm run build >/dev/null)
    "${DC[@]}" --profile review build "${@:2}" ;;
  up)
    "${DC[@]}" "${profiles[@]}" up -d "${@:2}"
    # 本机开发不想让容器随 Docker/OrbStack 启动而自启：在 .env 里写 TEAM_NO_AUTOSTART=1（服务器不要写）
    if grep -qE '^TEAM_NO_AUTOSTART=1' .env 2>/dev/null; then
      docker update --restart=no $(docker ps -aq --filter label=com.docker.compose.project=team) >/dev/null
    fi
    ;;
  down) "${DC[@]}" --profile review down "${@:2}" ;;
  logs) "${DC[@]}" --profile review logs -f --tail=100 "${@:2}" ;;
  ps) "${DC[@]}" --profile review ps ;;
  version) echo "Loom $LOOM_VERSION ($LOOM_COMMIT)" ;;
  *) sed -n 2,10p "$0"; exit 1 ;;
esac
