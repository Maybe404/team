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
  archiveEntity: async (_p: string, t: string, id: string, a: boolean) => { calls.push(`archive ${t} ${id} ${a}`); return { archived_at: a ? "2026-11-18" : null }; },
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
  listVersions: async (_p: string, id: string, kind = "pages") => { calls.push(`vlist ${kind} ${id}`); return { versions: [{ id: "v1", last_saved_at: now, owned_by: "u1", is_locked: true, label: "定稿", source: "manual" }], current_matches: true }; },
  saveVersion: async (_p: string, id: string, b: { label?: string }, kind = "pages") => { calls.push(`vsave ${kind} ${id} ${b.label}`); return { id: "v2", last_saved_at: now, owned_by: "u1", is_locked: false, label: b.label ?? "", source: "manual", created: true }; },
  listTemplates: async () => ({ templates: tpls.map(({ body: _b, ...t }) => t) }),
  getTemplate: async (id: string) => tpls.find((t) => t.id === id)!,
  createTemplate: async (b: { kind: "page" | "issue"; name: string; body?: string; description?: string; project_id?: string }) => {
    const t = { id: `t${tpls.length + 1}`, kind: b.kind, name: b.name, description: b.description ?? "", project_id: b.project_id ?? null, created_by: "u1", updated_at: now, body: b.body ?? "" };
    tpls.push(t);
    return t;
  },
  updateTemplate: async (id: string, b: Record<string, string>) => Object.assign(tpls.find((t) => t.id === id)!, b),
  getProjectSettings: async () => ({ is_pinned: settings.pinned, logo_props: settings.logo }),
  patchProjectSettings: async (_p: string, b: { is_pinned?: boolean; logo_props?: Record<string, unknown> }) => {
    if (b.is_pinned !== undefined) settings.pinned = b.is_pinned;
    if (b.logo_props !== undefined) settings.logo = b.logo_props;
    return { is_pinned: settings.pinned, logo_props: settings.logo };
  },
  listIntake: async () => intake,
  createIntake: async (_p: string, issue: { name: string; description_html: string; priority?: string }) => {
    const row = { id: `in${intake.length + 1}`, issue: `x${intake.length + 1}`, status: -2, created_by: "u1", issue_detail: { name: issue.name, description_html: issue.description_html, priority: issue.priority } };
    intake.push(row);
    calls.push(`intake ${issue.name}`);
    return row;
  },
  decideIntake: async (_p: string, id: string, b: Record<string, unknown>) => { calls.push(`decide ${id} ${JSON.stringify(b)}`); const r = intake.find((x) => x.issue === id)!; Object.assign(r, b); return r; },
  createComment: async (_p: string, id: string, html: string) => { calls.push(`comment ${id} ${html.includes("拒绝原因")}`); return {}; },
};
const tpls: { id: string; kind: "page" | "issue"; name: string; description: string; project_id: string | null; created_by: string | null; updated_at: string; body: string }[] = [];
const settings: { pinned: boolean; logo: Record<string, unknown> } = { pinned: false, logo: {} };
const intake: { id: string; issue: string; status: number; created_by: string; issue_detail: { name: string; description_html: string; priority?: string } }[] = [];

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

test("save_module：新建、改名、可设已完成", async () => {
  const c = await call("save_module", { name: "v1.3 权限管理", description: "上线角色和权限配置，管理员能给成员分配角色。", status: "已计划" });
  assert.match(c.text, /已新建模块/);
  assert.ok(calls.some((x) => x.startsWith("createModule") && x.includes('"status":"planned"')));
  const dup = await call("save_module", { name: "v1.2 登录改版" });
  assert.ok(dup.error);
  const done = await call("save_module", { module: "v1.2 登录改版", status: "已完成" });
  assert.ok(!done.error, done.text);
  assert.ok(calls.some((x) => x.startsWith("updateModule") && x.includes("completed")));
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


// ---- 文档层级 ----
import { formatDocTree } from "../src/doctree.ts";

test("list_docs 按层级缩进，父文档不在结果里的当顶层", () => {
  const d = (id: string, parent: string | null) => ({ id, name: `文档${id}`, updated_at: "2026-11-16T00:00:00Z", parent_id: parent });
  const out = formatDocTree([d("a", null), d("b", "a"), d("c", "b"), d("x", "gone")]);
  const lines = out.split("\n");
  assert.match(lines[0], /^- a　文档a.*1 个子页面/);
  assert.match(lines[1], /^  - b　/);
  assert.match(lines[2], /^    - c　/);
  assert.match(lines[3], /^- x　/);
  // 成环不死循环
  assert.ok(formatDocTree([d("p", "q"), d("q", "p")]).length >= 0);
});


test("收集：提交、查看、接受、拒绝（带原因留痕）", async () => {
  const sub = await call("intake_submit", { project: "DEMO", title: "也许要支持离线导出", description: "背景：客户在内网环境，导出要走离线。\n\n不确定：是否值得做。", priority: "low" });
  assert.ok(!sub.error, sub.text);
  assert.match(sub.text, /条目 ID：x1/);
  await call("intake_submit", { project: "DEMO", title: "导出按钮位置不统一", description: "三个页面的导出按钮位置不同。" });
  const list = await call("intake_list", { project: "DEMO" });
  assert.match(list.text, /x1.*待处理.*也许要支持离线导出/);
  assert.match(list.text, /x2/);
  const ok = await call("intake_decide", { project: "DEMO", item: "x1", action: "accept" });
  assert.ok(!ok.error, ok.text);
  assert.ok(calls.some((c) => c === 'decide x1 {"status":1}'));
  const no = await call("intake_decide", { project: "DEMO", item: "x2", action: "reject", reason: "和现有设计规范重复，已经统一过。" });
  assert.ok(!no.error, no.text);
  assert.ok(calls.some((c) => c === 'decide x2 {"status":-1}'));
  assert.ok(calls.includes("comment x2 true"));
  const pending = await call("intake_list", { project: "DEMO" });
  assert.match(pending.text, /没有待处理/);
  const snooze = await call("intake_decide", { project: "DEMO", item: "x2", action: "snooze" });
  assert.ok(snooze.error);
});


test("task_versions：工作项描述版本走 issues 路径，和文档版本共用逻辑", async () => {
  const l = await call("task_versions", { task: "DEMO-1", action: "list" });
  assert.ok(!l.error, l.text);
  assert.match(l.text, /v1.*小明.*🔒.*「定稿」.*手动保存/);
  assert.ok(calls.includes("vlist issues i1"));
  const sv = await call("task_versions", { task: "DEMO-1", action: "save", label: "评审前" });
  assert.ok(!sv.error, sv.text);
  assert.ok(calls.includes("vsave issues i1 评审前"));
  const d = await call("doc_versions", { doc_id: "pg1", action: "list" });
  assert.ok(calls.includes("vlist pages pg1"), d.text);
});


test("收集：状态没变要报错，评论失败要提示；搜索范围为空不调接口", async () => {
  const row = { id: "inx", issue: "x9", status: -2, created_by: "u1", issue_detail: { name: "忽略型", description_html: "" } };
  intake.push(row);
  const orig = plane.decideIntake;
  plane.decideIntake = async () => row; // 模拟服务端忽略了改动，仍返回 200 和旧状态
  const r = await call("intake_decide", { project: "DEMO", item: "x9", action: "accept" });
  assert.ok(r.error && /没有改动成功/.test(r.text), r.text);
  plane.decideIntake = orig;
  const oc = plane.createComment;
  plane.createComment = async () => { throw new Error("boom"); };
  const w = await call("intake_decide", { project: "DEMO", item: "x9", action: "reject", reason: "和现有设计规范重复，已经统一过。" });
  assert.ok(!w.error && /原因评论没有写进去/.test(w.text), w.text);
  plane.createComment = oc;
});


test("模板：保存、列出、按名称读取", async () => {
  const empty = await call("list_templates", {});
  assert.match(empty.text, /还没有模板/);
  const c = await call("save_template", { kind: "page", name: "周报", description: "每周五写", body: "## 本周完成\n\n<!-- 写已经合入的事 -->\n\n## 下周计划" });
  assert.ok(!c.error, c.text);
  const l = await call("list_templates", { kind: "page" });
  assert.match(l.text, /t1 \[文档\] 周报（工作区通用）：每周五写/);
  const g = await call("get_template", { template: "周报" });
  assert.match(g.text, /write_doc/);
  assert.match(g.text, /## 本周完成/);
  const u = await call("save_template", { template_id: "t1", description: "每周四写" });
  assert.match(u.text, /已更新模板/);
  const miss = await call("get_template", { template: "不存在" });
  assert.ok(miss.error);
});

test("project_settings：置顶、设置表情图标、移除", async () => {
  const pin = await call("project_settings", { project: "DEMO", action: "pin" });
  assert.match(pin.text, /已置顶/);
  const e = await call("project_settings", { project: "DEMO", action: "set_icon", emoji: "🚀" });
  assert.match(e.text, /表情 🚀/);
  assert.deepEqual(settings.logo, { in_use: "emoji", emoji: { value: "128640" } });
  const i = await call("project_settings", { project: "DEMO", action: "set_icon", icon: "Briefcase", color: "#3f76ff" });
  assert.match(i.text, /图标 Briefcase/);
  const r = await call("project_settings", { project: "DEMO", action: "remove_icon" });
  assert.match(r.text, /图标：无/);
  const bad = await call("project_settings", { project: "DEMO", action: "set_icon" });
  assert.ok(bad.error);
});

test("update_task：已完成、已取消要写依据；archive 归档和恢复", async () => {
  const noc = await call("update_task", { task: "DEMO-3", state: "已完成" });
  assert.ok(noc.error);
  assert.match(noc.text, /comment/);
  const ok = await call("update_task", { task: "DEMO-3", state: "已完成", comment: "导出筛选已实现。\n\n跑了 `npm test`，12 项全过。" });
  assert.ok(!ok.error, ok.text);
  const a = await call("archive", { type: "task", id: "DEMO-3" });
  assert.match(a.text, /已归档/);
  assert.ok(calls.some((x) => x.startsWith("archive issue") && x.endsWith("true")));
  const u = await call("archive", { type: "task", id: "DEMO-3", action: "unarchive" });
  assert.match(u.text, /已取消归档/);
  const d = await call("archive", { type: "doc", id: "11111111-1111-1111-1111-111111111111" });
  assert.match(d.text, /已归档文档/);
  assert.ok(calls.some((x) => x.startsWith("archive page") && x.endsWith("true")));
});

test("create_task 不能直接建成已完成或已取消；write_doc 退回有问题的局部块", async () => {
  const c = await call("create_task", { title: "导出筛选", description: "## 目标\n\n订单导出页支持按状态筛选。\n\n## 验收标准\n\n- [ ] 选择状态后导出的文件只含该状态的订单", state: "已完成" });
  assert.ok(c.error);
  assert.match(c.text, /update_task/);
  const w = await call("write_doc", { type: "note", title: "测试", markdown: "## 背景\n\n```html-embed ref=\"没有的原型\" focus=\"#a\"\n```\n" });
  assert.ok(w.error);
  assert.match(w.text, /局部块有问题/);
});
