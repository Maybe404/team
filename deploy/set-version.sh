#!/usr/bin/env bash
# 把仓库根目录 VERSION 里的版本号写进各个 package.json（网页、API、MCP 都从它们读版本）。
# 发版只改 VERSION；team.sh build 会自动调用本脚本。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
V="$(tr -d '[:space:]' < "$ROOT/VERSION")"
[[ "$V" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "VERSION 格式应为 x.y.z，现在是「$V」" >&2; exit 1; }
for f in plane/package.json plane/apps/web/package.json plane/apps/admin/package.json plane/apps/space/package.json plane/apps/api/package.json mcp/package.json; do
  [ -f "$ROOT/$f" ] || continue
  node -e '
    const fs = require("fs"); const [f, v] = process.argv.slice(1);
    const raw = fs.readFileSync(f, "utf8"); const j = JSON.parse(raw);
    if (j.version !== v) { fs.writeFileSync(f, raw.replace(/("version"\s*:\s*)"[^"]*"/, `$1"${v}"`)); console.log(f + " → " + v); }
  ' "$ROOT/$f" "$V"
done
# 网页的更新日志读 public/changelog.md，随版本一起提交，服务器构建时不用再复制
cp "$ROOT/CHANGELOG.md" "$ROOT/plane/apps/web/public/changelog.md"
echo "$V"
