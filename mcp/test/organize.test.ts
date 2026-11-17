// 模块、视图、任务筛选：用内存里的假 Loom 跑 MCP 工具，不依赖网络和数据库。
import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.ts";

const REPO = "git@github.com:org/demo.git";
const states = [
  { id: "s1", name: "待开始", group: "unstarted", color: "" },
  { id: "s2", name: "进行中", group: "started", color: "" },
  { id: "s3", name: "已完成", group: "completed", color: "" },
];
const now = "2026-11-16T00:00:00Z";
const mkItem = (n: number, state: string, name: string) => ({
  id: `i${n}`, name, sequence_id: n, description_html: "", state, priority: "none", assignees: ["u1"], labels: [], project: "p1", created_at: now, updated_at: now,
});
const items = [mkItem(1, "s2", "登录页改版"), mkItem(2, "s1", "订单导出"), mkItem(3, "s2", "修复支付回调")];
const modules = [
  { id: "m1", name: "v1.2 登录改版", status: "in-progress", total_issues: 1, completed_issues: 0 },
  { id: "m2", name: "v1.2 订单导出", status: "planned", total_issues: 1, completed_issues: 0 },
];
const members: Record<string, Set<string>> = { m1: new Set(["i1"]), m2: new Set(["i2"]) };
const views: Record<string, unknown>[] = [];
const calls: string[] = [];

const plane = {
  workspace: "w",
  webUrl: (p: string) => `http://loom/w/${p}`,
  me: async () => ({ id: "u1", email: "a@b.c", display_name: "小明" }),
  listProjects: async () => [{ id: "p1", name: "Demo", identifier: "DEMO", is_member: true, team_repos: ["github.com/org/demo"] }],
  listProjectMembers: async () => [{ id: "u1", email: "a@b.c", display_name: "小明" }],
  listStates: async () => states,
  listLabels: async () => [],
  listWorkItems: async () => items,
  getWorkItemByKey: async (k: string) => items.find((i) => `DEMO-${i.sequence_id}` === k)!,
  listComments: async () => [],
  listLinks: async () => [],
  listIssuePages: async () => [],
  listModules: async () => modules,
  listModuleIssueIds: async (_p: string, m: string) => [...(members[m] ?? [])],
  addModuleIssues: async (_p: string, m: string, ids: string[]) => { calls.push(`add ${m} ${ids}`); ids.forEach((i) => members[m].add(i)); },
  removeModuleIssue: async (_p: string, m: string, id: string) => { calls.push(`remove ${m} ${id}`); members[m].delete(id); },
  createModule: async (_p: string, b: Record<string, unknown>) => { calls.push(`createModule ${JSON.stringify(b)}`); return { id: "m3", ...b }; },
  updateModule: async (_p: string, id: string, b: unknown) => { calls.push(`updateModule ${id} ${JSON.stringify(b)}`); return { id }; },
  listCycles: async () => [{ id: "c1", name: "第 1 周" }],
  listCycleIssueIds: async () => ["i3"],
  listViews: async () => views,
  createView: async (_p: string, b: Record<string, unknown>) => { const v = { id: "v1", description: "", access: 1, owned_by_id: "u1", display_filters: {}, ...b }; views.push(v); return v; },
  updateView: async (_p: string, id: string, b: Record<string, unknown>) => { const v = views.find((x) => x.id === id)!; Object.assign(v, b); return v; },
  updateWorkItem: async () => ({}),
  createWorkItem: async (_p: string, b: Record<string, unknown>) => { items.push(mkItem(4, "s1", String(b.name))); return items[3]; },
};

const [ct, st] = InMemoryTransport.createLinkedPair();
const server = createServer({ config: { token: "t", workspace: "w", webUrl: "http://loom", baseUrl: "http://loom" } as never, plane: plane as never, local: false });
await server.connect(st);
const client = new Client({ name: "test", version: "0" });
await client.connect(ct);
const call = async (name: string, args: Record<string, unknown>) => {
  const r = (await client.callTool({ name, arguments: { repo: REPO, ...args } })) as { content: { text: string }[]; isError?: boolean };
  return { text: r.content[0].text, error: !!r.isError };
};

test("list_tasks 按模块、周期筛选，并标出所属模块", async () => {
  const all = await call("list_tasks", {});
  assert.match(all.text, /DEMO-1 .*模块：v1\.2 登录改版/);
  const byModule = await call("list_tasks", { module: "登录改版" });
  assert.match(byModule.text, /DEMO-1/);
  assert.doesNotMatch(byModule.text, /DEMO-2|DEMO-3/);
  const byCycle = await call("list_tasks", { cycle: "第 1 周" });
  assert.match(byCycle.text, /DEMO-3/);
  assert.doesNotMatch(byCycle.text, /DEMO-1/);
  const bad = await call("list_tasks", { module: "不存在" });
  assert.ok(bad.error);
  assert.match(bad.text, /现有模块：v1\.2 登录改版、v1\.2 订单导出/);
});

test("update_task 放进、移出模块", async () => {
  const r = await call("update_task", { task: "DEMO-3", modules: ["订单导出"], remove_modules: [] });
  assert.match(r.text, /放进模块 v1\.2 订单导出/);
  assert.ok(calls.includes("add m2 i3"));
  const r2 = await call("update_task", { task: "DEMO-3", remove_modules: ["v1.2 订单导出"] });
  assert.match(r2.text, /移出模块 v1\.2 订单导出/);
  assert.ok(calls.includes("remove m2 i3"));
  const both = await call("update_task", { task: "DEMO-3", modules: ["v1.2 订单导出"], remove_modules: ["v1.2 订单导出"] });
  assert.ok(both.error);
});

test("create_task 可以直接放进模块", async () => {
  const r = await call("create_task", {
    title: "导出加上筛选条件",
    description: "## 目标\n\n订单导出页支持按状态筛选。\n\n## 验收标准\n\n- [ ] 选择状态后导出的文件只含该状态的订单",
    modules: ["v1.2 订单导出"],
  });
  assert.match(r.text, /放进模块 v1\.2 订单导出/);
  assert.ok(calls.includes("add m2 i4"));
});

test("save_module：新建、改名、已完成只能人设置", async () => {
  const c = await call("save_module", { name: "v1.3 权限管理", description: "上线角色和权限配置，管理员能给成员分配角色。", status: "已计划" });
  assert.match(c.text, /已新建模块/);
  assert.ok(calls.some((x) => x.startsWith("createModule") && x.includes('"status":"planned"')));
  const dup = await call("save_module", { name: "v1.2 登录改版" });
  assert.ok(dup.error);
  const done = await call("save_module", { module: "v1.2 登录改版", status: "已完成" });
  assert.ok(done.error);
  assert.match(done.text, /只能由人/);
  const up = await call("save_module", { module: "登录改版", target_date: "2026-12-01" });
  assert.match(up.text, /已更新模块/);
});

test("save_view：把需求翻成筛选条件，list_views 翻回人话", async () => {
  const c = await call("save_view", {
    name: "v1.2 进行中的任务",
    description: "看 v1.2 两个需求里正在做的任务。",
    filters: { states: ["进行中"], modules: ["v1.2 登录改版", "v1.2 订单导出"], assignees: ["me"] },
    layout: "kanban",
    group_by: "state",
  });
  assert.match(c.text, /已新建视图/);
  const v = views[0] as { rich_filters: { and: Record<string, string>[] }; display_filters: Record<string, unknown> };
  assert.deepEqual(v.rich_filters.and, [{ state_id__in: "s2" }, { assignee_id__in: "u1" }, { module_id__in: "m1,m2" }]);
  assert.equal(v.display_filters.layout, "kanban");
  const l = await call("list_views", {});
  assert.match(l.text, /状态是 进行中.*负责人是 小明.*模块是 v1\.2 登录改版 或 v1\.2 订单导出/);
  const dup = await call("save_view", { name: "v1.2 进行中的任务" });
  assert.ok(dup.error);
  const up = await call("save_view", { view: "v1.2 进行中", filters: { priorities: ["urgent"] } });
  assert.match(up.text, /优先级是 urgent/);
});

// ---- 没登记代码仓库的项目：任何目录里都能用 ----
const openProjects = [
  { id: "p9", name: "运营文档", identifier: "OPS", is_member: true, team_repos: [] },
  { id: "p1", name: "Demo", identifier: "DEMO", is_member: true, team_repos: ["github.com/org/demo"] },
];
async function connectWith(projects: unknown[]) {
  const [c, s] = InMemoryTransport.createLinkedPair();
  const srv = createServer({ config: { token: "t", workspace: "w", webUrl: "http://loom", baseUrl: "http://loom" } as never, plane: { ...plane, listProjects: async () => projects } as never, local: false });
  await srv.connect(s);
  const cl = new Client({ name: "t2", version: "0" });
  await cl.connect(c);
  return async (name: string, args: Record<string, unknown>) => {
    const r = (await cl.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    return { text: r.content[0].text, error: !!r.isError };
  };
}

test("没登记仓库的项目：不在 git 仓库里也能读写，要用 project 指定", async () => {
  const c = await connectWith(openProjects);
  const who = await c("whoami", {});
  assert.match(who.text, /不绑定代码仓库的项目.*OPS/);
  // 没有仓库、没传 project：只有一个开放项目时自动用它
  const auto = await c("list_modules", {});
  assert.doesNotMatch(auto.text, /没有关联项目/);
  const ok = await c("list_modules", { project: "OPS" });
  assert.ok(!ok.error);
  // 绑定了别的仓库的项目，在别处读写被拒绝
  const denied = await c("list_modules", { project: "DEMO", repo: "git@github.com:org/other.git" });
  assert.ok(denied.error);
  assert.match(denied.text, /绑定了别的代码仓库/);
  // 在对的仓库里，登记了仓库的项目照常可用
  const bound = await c("list_modules", { repo: REPO });
  assert.ok(!bound.error);
});

test("有多个不绑定仓库的项目时，不传 project 要求指定", async () => {
  const c = await connectWith([...openProjects, { id: "p8", name: "设计", identifier: "DES", is_member: true, team_repos: [] }]);
  const r = await c("list_modules", {});
  assert.ok(r.error);
  assert.match(r.text, /OPS.*DES|DES.*OPS/);
});

// ---- 项目标识是纯数字或中文时，任务编号照样能用 ----
import { parseTaskKey } from "../src/taskKey.ts";

test("parseTaskKey：字母、数字、中文标识都能解析，缺序号的不行", () => {
  assert.deepEqual(parseTaskKey("DEMO-12"), { identifier: "DEMO", seq: "12" });
  assert.deepEqual(parseTaskKey(" 2025-7 "), { identifier: "2025", seq: "7" });
  assert.deepEqual(parseTaskKey("明见-3"), { identifier: "明见", seq: "3" });
  assert.equal(parseTaskKey("DEMO"), undefined);
  assert.equal(parseTaskKey("12"), undefined);
  assert.equal(parseTaskKey("-12"), undefined);
});

test("任务工具能用数字标识的任务编号；格式不对时用真实标识举例", async () => {
  const numeric = [{ id: "p5", name: "明见", identifier: "2025", is_member: true, team_repos: [] }];
  const item = { ...mkItem(7, "s2", "核对口径"), project: "p5" };
  const [c, s] = InMemoryTransport.createLinkedPair();
  const srv = createServer({
    config: { token: "t", workspace: "w", webUrl: "http://loom", baseUrl: "http://loom" } as never,
    plane: { ...plane, listProjects: async () => numeric, listWorkItems: async () => [item], getWorkItemByKey: async (k: string) => (k === "2025-7" ? item : Promise.reject(Object.assign(new Error("x"), { status: 404 }))) } as never,
    local: false,
  } as never);
  await srv.connect(s);
  const cl = new Client({ name: "t3", version: "0" });
  await cl.connect(c);
  const call2 = async (name: string, args: Record<string, unknown>) => {
    const r = (await cl.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    return { text: r.content[0].text, error: !!r.isError };
  };
  const ok = await call2("get_task", { task: "2025-7" });
  assert.ok(!ok.error, ok.text);
  assert.match(ok.text, /2025-7 核对口径/);
  const bad = await call2("get_task", { task: "核对口径" });
  assert.ok(bad.error);
  assert.match(bad.text, /例如 2025-12/);
});
