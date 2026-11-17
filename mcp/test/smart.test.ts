// 智能提示、@人、待办收件箱：内存假 Loom，不依赖网络。
import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.ts";
import { findSimilar, similarity, taskHints } from "../src/hints.ts";
import { htmlToMd, mdToHtml } from "../src/markdown.ts";

const people = [
  { id: "u1", name: "小明" },
  { id: "u2", name: "张三" },
];

test("相似度：同题高、异题低", () => {
  assert.ok(similarity("订单导出功能设计", "订单导出功能 设计") > 0.9);
  assert.ok(similarity("订单导出功能设计", "官网首页改版") < 0.2);
  assert.equal(findSimilar("登录页改版", [{ key: "A", name: "登录页改版方案" }, { key: "B", name: "支付回调" }]).length, 1);
});

test("@姓名变成提及标签，往返保留；代码里的不动", () => {
  const html = mdToHtml("请 @张三 看一下，`@张三` 不变", { members: people });
  assert.match(html, /<mention-component [^>]*entity_identifier="u2" entity_name="user_mention">/);
  assert.match(html, /<code>@张三<\/code>/);
  assert.match(htmlToMd(html, people), /请 @张三 看一下/);
});

test("任务提示：没指派、没验收标准、重复", () => {
  const h = taskHints({ title: "订单导出", description: "导出", assignees: 0, hasParent: false, hasModule: false, mentioned: 0, otherMembers: 2, similar: [{ key: "D-1", name: "订单导出" }] });
  const all = h.join("\n");
  assert.match(all, /已有相近/);
  assert.match(all, /没有指派人/);
  assert.match(all, /验收标准/);
});

const now = new Date().toISOString();
const states = [
  { id: "s1", name: "待开始", group: "unstarted", color: "" },
  { id: "s2", name: "待审查", group: "started", color: "" },
];
const items = [
  { id: "i1", name: "修复支付回调", sequence_id: 1, description_html: "", state: "s1", priority: "none", assignees: ["u1"], labels: [], project: "p1", created_at: now, updated_at: now },
  { id: "i2", name: "登录页改版", sequence_id: 2, description_html: "", state: "s2", priority: "none", assignees: ["u2"], labels: [], project: "p1", created_at: now, updated_at: now, created_by: "u1" },
];
const created: Record<string, unknown>[] = [];
const plane = {
  workspace: "w",
  webUrl: (p: string) => `http://loom/w/${p}`,
  me: async () => ({ id: "u1", email: "a@b.c", display_name: "小明" }),
  listProjects: async () => [{ id: "p1", name: "Demo", identifier: "DEMO", is_member: true, team_repos: [] }],
  listProjectMembers: async () => [
    { id: "u1", display_name: "小明" },
    { id: "u2", display_name: "张三" },
  ],
  listStates: async () => states,
  listWorkItems: async () => items,
  listModules: async () => [],
  listPages: async () => [{ id: "pg1", name: "订单导出方案", updated_at: now, owned_by_id: "u1", parent_id: null }],
  listPageIssues: async () => [],
  listIntakePending: async () => ["有人想要导出功能"],
  createWorkItem: async (_p: string, b: Record<string, unknown>) => { created.push(b); return { id: "i9", sequence_id: 9, ...b }; },
  createPage: async (_p: string, name: string, html: string) => { created.push({ name, html }); return { id: "pg9", name, parent_id: null }; },
};

async function connect(remind?: number) {
  const server = createServer({ config: { baseUrl: "http://x", token: "tok-" + Math.random(), workspace: "w", webUrl: "http://loom" } as never, plane: plane as never, local: false, remindEveryHours: remind });
  const client = new Client({ name: "t", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(b), client.connect(a)]);
  return client;
}
const textOf = (r: unknown) => ((r as { content: { text: string }[] }).content ?? []).map((c) => c.text).join("\n");

test("my_inbox 汇总待办", async () => {
  const c = await connect();
  const out = textOf(await c.callTool({ name: "my_inbox", arguments: { all_projects: true } }));
  assert.match(out, /等你审查（1）/);
  assert.match(out, /指派给你的未完成任务（1）/);
  assert.match(out, /收集里待分诊（1）/);
});

test("每隔几小时在其他工具结果后带一次提醒", async () => {
  const c = await connect(4);
  const first = textOf(await c.callTool({ name: "list_modules", arguments: {} }).catch(() => ({ content: [] })));
  const second = textOf(await c.callTool({ name: "list_modules", arguments: {} }).catch(() => ({ content: [] })));
  assert.match(first, /待办提醒/);
  assert.doesNotMatch(second, /待办提醒/);
});

test("create_task 返回提示并生成提及标签", async () => {
  const c = await connect();
  const out = textOf(await c.callTool({ name: "create_task", arguments: { project: "DEMO", title: "订单导出支持 CSV", description: "## 目标\n\n导出订单，@张三 配合\n\n## 验收标准\n\n- 能导出 csv 文件并打开" } }));
  assert.match(out, /已新建 DEMO-9/);
  assert.match(out, /没有指派人/);
  assert.match(String(created.at(-1)?.description_html), /mention-component/);
});
