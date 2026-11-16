#!/usr/bin/env node
// team-mcp 的本机 stdio 入口：开发和测试用，能读本地目录的 git remote。
// 团队日常使用的是 HTTP 入口（http.ts），见 README。
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.ts";
import { 织机 } from "./plane.ts";
import { createServer } from "./server.ts";

const config = loadConfig();
await createServer({ config, plane: new 织机(config), local: true }).connect(new StdioServerTransport());
