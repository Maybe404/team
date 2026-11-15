#!/usr/bin/env bash
# 安装 team-mcp：编译、保存连接配置、注册到 Claude Code（其他客户端打印配置片段）。
#
#   mcp/install.sh                       交互式，按提示填
#   PLANE_URL=http://plane.example.com PLANE_WORKSPACE=team PLANE_API_TOKEN=xxx mcp/install.sh   非交互
#
# 连接信息存在 ~/.config/team-mcp/config.json（权限 600），不写进客户端配置。
# 重新运行即可换 Token 或换地址。
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
CONF_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/team-mcp"
CONF="$CONF_DIR/config.json"

say() { printf '%s\n' "$*"; }
die() { printf '错误：%s\n' "$*" >&2; exit 1; }

command -v node >/dev/null || die "需要 Node.js 20 以上：https://nodejs.org"
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' || die "Node.js 版本太低（$(node -v)），需要 20 以上"
command -v python3 >/dev/null || say "提示：没找到 python3，去 AI 味检查会跳过（只给警告，不影响使用）"

say "== 1/3 编译 team-mcp"
(cd "$DIR" && npm ci --silent --no-audit --no-fund && npm run --silent build)

say "== 2/3 连接 Plane"
old_url="" old_ws=""
if [ -f "$CONF" ]; then
  old_url=$(node -e 'try{process.stdout.write(require(process.argv[1]).url||"")}catch{}' "$CONF")
  old_ws=$(node -e 'try{process.stdout.write(require(process.argv[1]).workspace||"")}catch{}' "$CONF")
fi
url="${PLANE_URL:-}"
if [ -z "$url" ]; then
  read -r -p "Plane 地址 [${old_url:-http://localhost:47080}]: " url
  url="${url:-${old_url:-http://localhost:47080}}"
fi
url="${url%/}"
ws="${PLANE_WORKSPACE:-}"
if [ -z "$ws" ]; then
  read -r -p "工作区 slug（网址里第一段，例如 $url/team/ 里的 team）[${old_ws}]: " ws
  ws="${ws:-$old_ws}"
fi
[ -n "$ws" ] || die "工作区不能为空"
token="${PLANE_API_TOKEN:-}"
if [ -z "$token" ]; then
  say "在 $url/$ws/settings/account/api-tokens 新建一个 API Token，粘贴到这里（输入不显示）："
  read -r -s token
  say ""
fi
[ -n "$token" ] || die "Token 不能为空"

me=$(curl -fsS -H "X-API-Key: $token" "$url/api/v1/users/me/" 2>/dev/null) || die "连不上 $url，或者 Token 无效"
name=$(node -e 'const j=JSON.parse(process.argv[1]);process.stdout.write(`${j.display_name}（${j.email}）`)' "$me")
curl -fsS -o /dev/null -H "X-API-Key: $token" "$url/api/v1/workspaces/$ws/projects/" 2>/dev/null || die "账号 $name 不在工作区 $ws 里，或者工作区名写错了"

mkdir -p "$CONF_DIR"
umask 077
node -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify({url:process.argv[2],workspace:process.argv[3],token:process.argv[4]},null,2)+"\n",{mode:0o600})' "$CONF" "$url" "$ws" "$token"
chmod 600 "$CONF"
say "已连接：$name，工作区 $ws。配置保存在 $CONF"

say "== 3/3 注册到 Agent"
ENTRY="$DIR/dist/index.js"
if command -v claude >/dev/null; then
  claude mcp remove team -s user >/dev/null 2>&1 || true
  claude mcp add team -s user -- node "$ENTRY" >/dev/null
  say "已注册到 Claude Code（用户级，所有目录可见；只有在登记过的团队仓库里才能读写 Plane）。"
else
  say "没找到 claude 命令，跳过 Claude Code。"
fi
cat <<EOF

其他客户端（Cursor、Codex 等）手动加一个 stdio MCP：
  命令：node
  参数：$ENTRY
例如 JSON 配置：
  "team": { "command": "node", "args": ["$ENTRY"] }

下一步：
1. 重启 Agent，在团队项目的仓库里让它调用 whoami。
2. 如果显示“未关联”，请项目管理员在 Plane「项目设置 → 关联代码仓库」里填上这个仓库的地址（git remote -v 里的地址）。
EOF
