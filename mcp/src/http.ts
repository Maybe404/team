#!/usr/bin/env node
// team-mcp 的 HTTP 入口：长期运行的服务，成员只填一个网址和自己的 Plane API Token 就能用，不用在本机装任何东西。
//
//   POST /mcp/<工作区 slug>    Authorization: Bearer <Plane API Token>
//
// 无状态：每个请求新建一个 server，Token 只用于转发给 Plane，不落盘。Plane 上的所有权限仍由 Plane 判断，
// 操作记在 Token 所属的账号名下。
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Plane } from "./plane.ts";
import { createServer, VERSION } from "./server.ts";

const PORT = Number(process.env.PORT || 3000);
const baseUrl = (process.env.PLANE_BASE_URL || "http://localhost:47080").replace(/\/$/, "");
const webUrl = (process.env.PLANE_WEB_URL || baseUrl).replace(/\/$/, "");
const defaultWorkspace = process.env.PLANE_WORKSPACE || "";
const MAX_BODY = 5 * 1024 * 1024;

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}
const rpcError = (res: ServerResponse, status: number, message: string, headers?: Record<string, string>) =>
  send(res, status, { jsonrpc: "2.0", error: { code: -32000, message }, id: null }, headers);

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new Error("请求体太大");
    chunks.push(c as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : undefined;
}

function tokenOf(req: IncomingMessage): string {
  const auth = String(req.headers.authorization || "");
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return (m?.[1] || String(req.headers["x-api-key"] || "")).trim();
}

function clientOf(req: IncomingMessage): string | undefined {
  const m = String(req.headers["user-agent"] || "").match(/^([A-Za-z][\w.-]{1,40})\//);
  return m?.[1];
}

const http = createHttpServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://x");
  if (url.pathname === "/healthz") return send(res, 200, { ok: true, version: VERSION });

  const m = url.pathname.match(/^\/mcp(?:\/([A-Za-z0-9_-]+))?\/?$/);
  if (!m) return send(res, 404, { error: "not found" });
  const workspace = m[1] || defaultWorkspace;
  if (!workspace) return rpcError(res, 400, "地址里要带工作区，例如 /mcp/team");

  // 无状态服务：不支持服务端推送流和会话
  if (req.method !== "POST") return rpcError(res, 405, "只支持 POST", { Allow: "POST" });

  const token = tokenOf(req);
  if (!token) {
    return rpcError(res, 401, `缺少 Plane API Token。到 ${webUrl}/settings/profile/api-tokens 新建一个，按页面上的命令添加。`, {
      "WWW-Authenticate": 'Bearer realm="team-mcp"',
    });
  }

  try {
    const body = await readBody(req);
    const config = { baseUrl, webUrl, workspace, token };
    const server = createServer({ config, plane: new Plane(config), local: false, clientName: clientOf(req) });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (e) {
    console.error("请求处理失败：", e instanceof Error ? e.message : e);
    if (!res.headersSent) rpcError(res, e instanceof SyntaxError ? 400 : 500, e instanceof SyntaxError ? "请求不是合法 JSON" : "服务内部错误");
  }
});

http.listen(PORT, () => console.log(`team-mcp ${VERSION} 监听 :${PORT}，Plane ${baseUrl}`));
