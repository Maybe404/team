#!/usr/bin/env bash
# 本地长期运行：用二开源码构建镜像，docker compose 常驻（容器随 Docker 自动重启）。
#   deploy/team.sh build     构建全部镜像（首次 10～20 分钟）
#   deploy/team.sh up        启动（数据在 docker volume 里，重启不丢）
#   deploy/team.sh down      停止（保留数据）
#   deploy/team.sh logs api  看日志
#   deploy/team.sh ps
# 配置在 deploy/plane/.env（从 variables.example.env 复制，已忽略）。定时回顾需要在 .env 里填
# TEAM_REVIEW_WORKSPACE、TEAM_REVIEW_TOKEN（管理员的 API Token），然后 `deploy/team.sh up` 会一起启动。
set -euo pipefail
cd "$(dirname "$0")/plane"
DC=(docker compose -p team -f docker-compose.yml -f docker-compose.team.yml --env-file .env)
profiles=()
if grep -qE '^TEAM_REVIEW_TOKEN=.+' .env 2>/dev/null; then profiles=(--profile review); fi
case "${1:-}" in
  build)
    (cd ../../mcp && npm run build >/dev/null)
    "${DC[@]}" --profile review build "${@:2}" ;;
  up) "${DC[@]}" "${profiles[@]}" up -d "${@:2}" ;;
  down) "${DC[@]}" --profile review down "${@:2}" ;;
  logs) "${DC[@]}" --profile review logs -f --tail=100 "${@:2}" ;;
  ps) "${DC[@]}" --profile review ps ;;
  *) sed -n 2,9p "$0"; exit 1 ;;
esac
