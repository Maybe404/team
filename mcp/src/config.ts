// 连接配置：环境变量优先，其次是安装脚本写的 ~/.config/team-mcp/config.json（权限 600）。
// 这样 Token 不用写进 Claude Code、Cursor 等客户端的配置文件里。
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const CONFIG_FILE =
  process.env.TEAM_MCP_CONFIG || join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "team-mcp", "config.json");

type FileConfig = { url?: string; webUrl?: string; workspace?: string; token?: string };

function readFile(): FileConfig {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf8")) as FileConfig;
  } catch {
    return {};
  }
}

export function loadConfig() {
  const f = readFile();
  const baseUrl = (process.env.PLANE_BASE_URL || process.env.PLANE_URL || f.url || "http://localhost:47080").replace(/\/$/, "");
  return {
    baseUrl,
    webUrl: (process.env.PLANE_WEB_URL || f.webUrl || baseUrl).replace(/\/$/, ""),
    workspace: process.env.PLANE_WORKSPACE || f.workspace || "",
    token: process.env.PLANE_API_TOKEN || f.token || "",
  };
}
