// 端到端测试：用 MCP 客户端通过 stdio 启动 team-mcp，对本地开发 Plane 走一遍完整流程。
// 前置：dev/run.sh 已启动，dev/seed.sh 已生成 dev/.secrets。
// 用法：npm run e2e
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = join(import.meta.dirname, "..", "..");
const secrets = Object.fromEntries(
  readFileSync(join(root, "dev/.secrets"), "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const ports = Object.fromEntries(
  readFileSync(join(root, "dev/ports.env"), "utf8")
    .split("\n")
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => l.split("=")),
);

const privateDir = mkdtempSync(join(tmpdir(), "team-lessons-"));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["--experimental-strip-types", "--no-warnings", join(import.meta.dirname, "..", "src/index.ts")],
  env: {
    ...process.env,
    PLANE_BASE_URL: `http://localhost:${ports.API_PORT}`,
    PLANE_WEB_URL: `http://localhost:${ports.WEB_PORT}`,
    PLANE_API_TOKEN: secrets.PLANE_API_TOKEN,
    PLANE_WORKSPACE: secrets.PLANE_WORKSPACE,
    TEAM_PRIVATE_LESSONS_DIR: privateDir,
  } as Record<string, string>,
});
const client = new Client({ name: "e2e", version: "0.0.1" });
await client.connect(transport);

const run = Date.now().toString(36).slice(-4).toUpperCase();
const PROJECT = `E2E${run}`;
let passed = 0;
let failed = 0;

async function call(name: string, args: Record<string, unknown>) {
  const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  return { text: r.content.map((c) => c.text).join("\n"), isError: Boolean(r.isError) };
}

async function step(title: string, fn: () => Promise<string | void>) {
  try {
    const note = await fn();
    passed++;
    console.log(`ok   ${title}${note ? `　${note}` : ""}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${title}\n     ${e instanceof Error ? e.message : e}`);
  }
}

function expect(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const goodTask = "## 目标\n\n订单列表翻到第二页时会出现重复数据，需要修复分页游标。\n\n## 验收标准\n\n- [ ] 翻页不再重复\n- [ ] 新增回归测试\n";
const goodDesign = `## 背景

订单列表用 offset 分页，翻页期间有新订单写入时，第二页会出现第一页已经展示过的数据。

## 方案

改成按 \`(created_at, id)\` 的游标分页：接口返回 \`next_cursor\`，前端翻页时带上它。数据库在 \`orders(created_at, id)\` 上已有联合索引，查询计划不变。旧的 \`page\` 参数保留两个版本，期间两种方式都能用，之后再下线。

## 取舍

考虑过在前端去重，但无法解决漏数据的问题，所以没有选。快照分页需要额外存储，当前数据量不值得。
`;
let taskKey = "";
let docId = "";

await step("工具、资源、提示词都已注册", async () => {
  const tools = (await client.listTools()).tools.map((t) => t.name);
  for (const t of ["create_task", "write_doc", "propose_lesson", "search_lessons", "review_digest", "check_text"]) {
    expect(tools.includes(t), `缺少工具 ${t}`);
  }
  const res = await client.readResource({ uri: "team://guide/writing" });
  expect(String((res.contents[0] as { text: string }).text).includes("团队写作规范"), "写作规范资源为空");
  const prompts = (await client.listPrompts()).prompts.map((p) => p.name);
  expect(prompts.includes("team-write"), "缺少 team-write 提示词");
  return `${tools.length} 个工具`;
});

await step("setup_project 新建项目并整理状态", async () => {
  const r = await call("setup_project", { identifier: PROJECT, name: `E2E 测试 ${run}` });
  expect(!r.isError, r.text);
  expect(r.text.includes("待审查") && r.text.includes("待决定"), r.text);
  const again = await call("setup_project", { identifier: PROJECT });
  expect(again.text.includes("无需调整"), `重复执行应无变化：${again.text}`);
});

await step("带套话的任务被拒绝", async () => {
  const r = await call("create_task", {
    project: PROJECT,
    title: "修复订单分页",
    description: `${goodTask}\n值得注意的是，这个问题至关重要 🚀`,
  });
  expect(r.isError, "应该被拒绝");
  expect(r.text.includes("套话") && r.text.includes("emoji"), r.text);
});

await step("合规任务创建成功", async () => {
  const r = await call("create_task", { project: PROJECT, title: "修复订单分页重复", description: goodTask, priority: "high" });
  expect(!r.isError, r.text);
  taskKey = r.text.match(/已新建 ([A-Z0-9]+-\d+)/)?.[1] ?? "";
  expect(taskKey, r.text);
  return taskKey;
});

await step("Agent 不能把任务设成已完成", async () => {
  const r = await call("update_task", { task: taskKey, state: "已完成" });
  expect(r.isError && r.text.includes("只能由人"), r.text);
});

await step("Agent 可以改成进行中", async () => {
  const r = await call("update_task", { task: taskKey, state: "进行中" });
  expect(!r.isError, r.text);
});

await step("没有证据的结论评论被拒绝", async () => {
  const r = await call("comment_task", { task: taskKey, kind: "结论", markdown: "分页问题已经修好了，应该没问题。" });
  expect(r.isError && r.text.includes("证据"), r.text);
});

await step("带证据的结论评论写入成功", async () => {
  const r = await call("comment_task", {
    task: taskKey,
    kind: "结论",
    author: "实现者 · e2e",
    markdown: "分页改为游标实现，第二页不再重复。\n\n跑了 `pnpm test order`，18 个用例通过。",
  });
  expect(!r.isError, r.text);
});

await step("get_task 能读到描述和评论", async () => {
  const r = await call("get_task", { task: taskKey });
  expect(r.text.includes("验收标准") && r.text.includes("- [ ] 翻页不再重复"), r.text);
  expect(r.text.includes("游标实现") && r.text.includes("实现者 · e2e"), r.text);
  expect(r.text.includes("状态：进行中"), r.text);
});

await step("缺章节的设计文档被拒绝", async () => {
  const r = await call("write_doc", { project: PROJECT, type: "design", title: "分页方案", markdown: "## 方案\n\n用游标分页。" });
  expect(r.isError && r.text.includes("背景") && r.text.includes("取舍"), r.text);
});

await step("合规设计文档写入并关联任务", async () => {
  const r = await call("write_doc", { project: PROJECT, type: "design", title: "订单分页方案", markdown: goodDesign, task: taskKey });
  expect(!r.isError, r.text);
  docId = r.text.match(/（([0-9a-f-]{36})）/)?.[1] ?? "";
  expect(docId, r.text);
});

await step("read_doc 读回 Markdown", async () => {
  expect(docId, "前一步没有拿到文档 ID");
  const r = await call("read_doc", { project: PROJECT, doc_id: docId });
  expect(r.text.includes("## 取舍") && r.text.includes("`(created_at, id)`"), r.text);
});

await step("write_doc 整篇更新", async () => {
  const r = await call("write_doc", {
    project: PROJECT,
    type: "design",
    title: "订单分页方案",
    doc_id: docId,
    markdown: `${goodDesign}\n## 验证\n\n回归测试覆盖翻页期间插入新订单的场景。\n`,
  });
  expect(!r.isError, r.text);
  const back = await call("read_doc", { project: PROJECT, doc_id: docId });
  expect(back.text.includes("## 验证") && back.text.match(/## 背景/g)?.length === 1, back.text);
});

await step("list_docs 能按正文搜索", async () => {
  expect(docId, "前一步没有拿到文档 ID");
  const r = await call("list_docs", { project: PROJECT, search: "游标" });
  expect(r.text.includes(docId), r.text);
});

const lessonTitle = `分页接口用游标而不是 offset（${run}）`;
const lessonBody = "## 场景\n\n列表接口在翻页期间会有新数据写入。\n\n## 做法\n\n用 `(created_at, id)` 做游标分页，接口返回 `next_cursor`。\n";

await step("团队经验提交到待审核", async () => {
  const r = await call("propose_lesson", { title: lessonTitle, markdown: lessonBody, tags: ["分页", "api"], scope: "team", source_task: taskKey });
  expect(!r.isError && r.text.includes("待审核"), r.text);
  return r.text.match(/LESSON-\d+/)?.[0];
});

await step("未采纳的团队经验默认查不到", async () => {
  const r = await call("search_lessons", { query: `游标 ${run}` });
  expect(!r.text.includes(lessonTitle), r.text);
  const pending = await call("search_lessons", { query: `游标 ${run}`, include_pending: true });
  expect(pending.text.includes(lessonTitle) && pending.text.includes("待审核"), pending.text);
});

await step("私人经验存本机并能查到", async () => {
  const r = await call("propose_lesson", {
    title: `本机调试用 47xxx 端口（${run}）`,
    markdown: "## 场景\n\n本地同时跑多个项目时端口冲突。\n\n## 做法\n\n开发环境统一用 47xxx 段端口，配置写在 `dev/ports.env`。\n",
    tags: ["本地开发"],
    scope: "private",
  });
  expect(!r.isError && r.text.includes(privateDir), r.text);
  const s = await call("search_lessons", { query: "端口", tags: ["本地开发"] });
  expect(s.text.includes("私人"), s.text);
});

await step("review_digest 生成回顾", async () => {
  const r = await call("review_digest", { stale_days: 1 });
  expect(!r.isError && r.text.includes("待审核的经验") && r.text.includes(lessonTitle), r.text);
});

console.log(`\n${passed} 通过，${failed} 失败。测试项目：${PROJECT}`);
await client.close();
process.exit(failed ? 1 : 0);
