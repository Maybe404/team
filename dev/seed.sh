#!/usr/bin/env bash
# 建本地测试账号/工作区/Token，结果追加进 dev/.secrets（已忽略）。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/plane/apps/api"
set -a; source .env; set +a
export DJANGO_SETTINGS_MODULE=plane.settings.local
out=$(.venv/bin/python manage.py shell < "$ROOT/dev/seed_dev.py")
grep -v -E '^(SEED_|PLANE_)' "$ROOT/dev/.secrets" > "$ROOT/dev/.secrets.tmp" 2>/dev/null || true
grep -E '^SEED_PASSWORD' "$ROOT/dev/.secrets" >> "$ROOT/dev/.secrets.tmp" 2>/dev/null || true
echo "$out" | grep -E '^(SEED_|PLANE_)' | grep -v -F -x -f "$ROOT/dev/.secrets.tmp" >> "$ROOT/dev/.secrets.tmp" || true
mv "$ROOT/dev/.secrets.tmp" "$ROOT/dev/.secrets"
echo "已写入 dev/.secrets：$(grep -oE '^[A-Z_]+' "$ROOT/dev/.secrets" | tr '\n' ' ')"
