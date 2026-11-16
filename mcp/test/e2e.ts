// 端到端测试：用 MCP 客户端通过 stdio 启动 team-mcp，对本地开发 Plane 走一遍完整流程。
// 前置：dev/run.sh 已启动，dev/seed.sh 已生成 dev/.secrets。
// 用法：npm run e2e
// 建项目、登记仓库、加成员这些“管理员在网页上做的事”用 Django shell 代替，MCP 本身做不了。
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { spawn } from "node:child_process";

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

const run = Date.now().toString(36).slice(-4).toUpperCase();
const PROJECT = `E2E${run}`;
const REPO = `git.example.com/e2e/repo-${run.toLowerCase()}`;
let passed = 0;
let failed = 0;

/** 以管理员身份直接改数据库（代替网页操作）。 */
function django(code: string): string {
  const api = join(root, "plane/apps/api");
  const r = spawnSync(
    "bash",
    ["-c", "set -a && source .env && set +a && DJANGO_SETTINGS_MODULE=plane.settings.local .venv/bin/python manage.py shell"],
    { cwd: api, input: code, encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error(`django shell 失败：${r.stderr.slice(-800)}`);
  return r.stdout
    .split("\n")
    .filter((l) => l.trim() && !/objects imported automatically/.test(l))
    .join("\n");
}
const git = (...args: string[]) => {
  const r = spawnSync("git", args, { cwd: workDir, encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
};

const privateDir = mkdtempSync(join(tmpdir(), "team-lessons-"));
// Agent 的工作目录：一开始不是 git 仓库，测试里再 git init、加 remote、由“管理员”登记
const workDir = mkdtempSync(join(tmpdir(), "team-repo-"));

// E2E_HTTP=1：走 HTTP 入口（团队实际使用的方式）。服务读不到本地目录，所以像真实 Agent 一样，
// 每次调用把工作目录里 git remote 的地址填进 repo 参数。
const HTTP = process.env.E2E_HTTP === "1";
const HTTP_PORT = 47991;
const planeEnv = {
  PLANE_BASE_URL: `http://localhost:${ports.API_PORT}`,
  PLANE_WEB_URL: `http://localhost:${ports.WEB_PORT}`,
};
if (HTTP) {
  const child = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", join(import.meta.dirname, "..", "src/http.ts")], {
    env: { ...process.env, ...planeEnv, PORT: String(HTTP_PORT), TEAM_PRIVATE_LESSONS_DIR: privateDir } as Record<string, string>,
    stdio: "inherit",
  });
  process.on("exit", () => child.kill());
  for (let i = 0; i < 50; i++) {
    if (await fetch(`http://localhost:${HTTP_PORT}/healthz`).then((r) => r.ok).catch(() => false)) break;
    await new Promise((r) => setTimeout(r, 200));
  }
}
const agentRepo = () => {
  const r = spawnSync("git", ["remote", "get-url", "origin"], { cwd: workDir, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : undefined;
};

async function connect(token: string, name: string) {
  const transport = HTTP
    ? new StreamableHTTPClientTransport(new URL(`http://localhost:${HTTP_PORT}/mcp/${secrets.PLANE_WORKSPACE}`), {
        requestInit: { headers: { Authorization: `Bearer ${token}`, "User-Agent": `${name}/0.0.1` } },
      })
    : new StdioClientTransport({
    command: process.execPath,
    args: ["--experimental-strip-types", "--no-warnings", join(import.meta.dirname, "..", "src/index.ts")],
    cwd: workDir,
    env: {
      ...process.env,
      PLANE_BASE_URL: `http://localhost:${ports.API_PORT}`,
      PLANE_WEB_URL: `http://localhost:${ports.WEB_PORT}`,
      PLANE_API_TOKEN: token,
      PLANE_WORKSPACE: secrets.PLANE_WORKSPACE,
      TEAM_PRIVATE_LESSONS_DIR: privateDir,
    } as Record<string, string>,
  });
  const c = new Client({ name, version: "0.0.1" });
  await c.connect(transport);
  const fn = async (tool: string, args: Record<string, unknown>) => {
    const repo = HTTP ? agentRepo() : undefined;
    const r = (await c.callTool({ name: tool, arguments: repo && !("repo" in args) ? { ...args, repo } : args })) as { content: { text: string }[]; isError?: boolean };
    return { text: r.content.map((x) => x.text).join("\n"), isError: Boolean(r.isError) };
  };
  return Object.assign(fn, { client: c });
}
const call = await connect(secrets.PLANE_API_TOKEN, "e2e");
const client = call.client;
const bob = await connect(secrets.PLANE_MEMBER_TOKEN, "e2e-bob");

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
  for (const t of ["create_task", "write_doc", "propose_lesson", "search_lessons", "review_digest", "check_text", "analyze_tone", "whoami", "get_guide", "link_doc"]) {
    expect(tools.includes(t), `缺少工具 ${t}`);
  }
  for (const t of ["bind_repo", "setup_project", "invite_member", "add_project_member", "list_members", "list_projects", "search_tasks", "get_writing_guide", "get_usage_guide"]) expect(!tools.includes(t), `不该有工具 ${t}`);
  const res = await client.readResource({ uri: "team://guide/writing" });
  expect(String((res.contents[0] as { text: string }).text).includes("团队写作规范"), "写作规范资源为空");
  const prompts = (await client.listPrompts()).prompts.map((p) => p.name);
  expect(prompts.includes("team-write") && prompts.includes("less-ai-tone"), "缺少提示词");
  const skill = await client.readResource({ uri: "team://skills/less-ai-tone" });
  expect(String((skill.contents[0] as { text: string }).text).includes("去AI味"), "skill 资源为空");
  return `${tools.length} 个工具`;
});

await step("不是 git 仓库时只能用 whoami 和规范类工具", async () => {
  const who = await call("whoami", {});
  expect(!who.isError && who.text.includes("未关联") && who.text.includes(secrets.SEED_EMAIL), who.text);
  const list = await call("list_tasks", { project: "DEMO" });
  expect(list.isError && list.text.includes("不是 git 仓库"), list.text);
  const guide = await call("get_guide", { topic: "writing" });
  expect(!guide.isError && guide.text.includes("团队写作规范"), guide.text);
  const les = await call("get_guide", { topic: "lessons" });
  expect(les.text.includes("哪些内容该沉淀"), les.text);
});

await step("管理员建项目：默认就是团队工作流和自动归档", async () => {
  const out = django(`
from plane.db.models import Workspace, User, Project, ProjectMember, State
from plane.utils.team_shared import default_states_for
ws = Workspace.objects.get(slug="${secrets.PLANE_WORKSPACE}")
admin = User.objects.get(email="${secrets.SEED_EMAIL}")
p = Project.objects.create(workspace=ws, name="E2E 测试 ${run}", identifier="${PROJECT}", created_by=admin)
ProjectMember.objects.create(project=p, member=admin, role=20)
for st in default_states_for(p):
    State.objects.create(project=p, workspace=ws, name=st["name"], color=st["color"], sequence=st["sequence"], group=st["group"], default=st.get("default", False))
print("archive_in", p.archive_in)
`);
  expect(out.includes("archive_in 1"), out);
});

await step("仓库没登记时读写都被拒绝，并提示去项目设置登记", async () => {
  git("init", "-q");
  git("remote", "add", "origin", `git@${REPO.replace("/", ":").replace("e2e/", "E2E/")}.git`);
  const r = await call("create_task", { project: PROJECT, title: "修复订单分页重复", description: goodTask });
  expect(r.isError && r.text.includes("没有登记") && r.text.includes("关联代码仓库"), r.text);
  const read = await call("list_tasks", { project: PROJECT });
  expect(read.isError && read.text.includes("没有登记"), read.text);
  const lesson = await call("search_lessons", { query: "分页" });
  expect(lesson.isError, lesson.text);
});

await step("管理员在项目设置里登记仓库后可以读写，其他项目仍然拒绝", async () => {
  const out = django(`
from plane.db.models import Project
p = Project.objects.get(identifier="${PROJECT}", workspace__slug="${secrets.PLANE_WORKSPACE}")
p.team_repos = ["https://${REPO}/"]
p.save()
print(p.team_repos)
`);
  expect(out.includes(REPO), out);
  const who = await call("whoami", {});
  expect(who.text.includes(`已关联 ${PROJECT}`), who.text);
  const other = await call("create_task", { project: "DEMO", title: "不该写进去的任务", description: goodTask });
  expect(other.isError && other.text.includes(`只能写入 ${PROJECT}`), other.text);
  const ls = await call("list_tasks", {});
  expect(!ls.isError, ls.text);
});

await step("Agent Token 不能改项目设置、加成员、删除（即使是管理员）", async () => {
  const base = `http://localhost:${ports.API_PORT}/api/v1/workspaces/${secrets.PLANE_WORKSPACE}`;
  const h = { "X-API-Key": secrets.PLANE_API_TOKEN, "Content-Type": "application/json" };
  const pid = django(`from plane.db.models import Project; print(Project.objects.get(identifier="${PROJECT}", workspace__slug="${secrets.PLANE_WORKSPACE}").id)`);
  const patch = await fetch(`${base}/projects/${pid}/`, { method: "PATCH", headers: h, body: JSON.stringify({ team_repos: ["x/y/z"] }) });
  const add = await fetch(`${base}/projects/${pid}/members/`, { method: "POST", headers: h, body: JSON.stringify({ member: pid, role: 15 }) });
  const del = await fetch(`${base}/projects/${pid}/`, { method: "DELETE", headers: h });
  expect(patch.status === 403 && add.status === 403 && del.status === 403, `${patch.status} ${add.status} ${del.status}`);
});

await step("密钥、手机号、本机图片被拒绝", async () => {
  const r = await call("check_text", {
    type: "task",
    markdown: `${goodTask}\n配置 OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456，联系 13812345678。\n\n![截图](/Users/someone/Desktop/a.png)\n`,
  });
  expect(r.text.includes("[密钥]") && r.text.includes("[个人信息]") && r.text.includes("[本机文件]"), r.text);
  expect(!r.text.includes("abcdefghij"), "报告里不能回显完整密钥");
  const ok = await call("check_text", { type: "task", markdown: `${goodTask}\n密钥放在环境变量 \`OPENAI_API_KEY=<API_KEY>\` 里。\n` });
  expect(ok.text.startsWith("通过"), ok.text);
});

await step("带套话的任务被拒绝", async () => {
  const r = await call("create_task", {
    project: PROJECT,
    title: "修复订单分页",
    description: `${goodTask}\n说白了，问题不是分页参数，而是游标没有排序 🚀`,
  });
  expect(r.isError, "应该被拒绝");
  expect(r.text.includes("翻案腔") && r.text.includes("起手式") && r.text.includes("emoji"), r.text);
});

await step("合规任务创建成功", async () => {
  const r = await call("create_task", { title: "修复订单分页重复", description: goodTask, priority: "high" });
  expect(!r.isError, r.text);
  taskKey = r.text.match(/已新建 ([A-Z0-9]+-\d+)/)?.[1] ?? "";
  expect(taskKey, r.text);
  return taskKey;
});

await step("成员还没加进项目时，他的 Agent 读不到；管理员加进去后可以", async () => {
  const before = await bob("list_tasks", {});
  expect(before.isError && before.text.includes("还不是成员"), before.text);
  const no = await call("create_task", { title: "拆分：游标排序", description: goodTask, assignees: ["bob@team.test"] });
  expect(no.isError && no.text.includes("项目里没有成员"), no.text);
  django(`
from plane.db.models import Project, ProjectMember, User
p = Project.objects.get(identifier="${PROJECT}", workspace__slug="${secrets.PLANE_WORKSPACE}")
ProjectMember.objects.create(project=p, member=User.objects.get(email="bob@team.test"), role=15)
`);
  const after = await bob("list_tasks", {});
  expect(!after.isError && after.text.includes(taskKey), after.text);
});

await step("成员自动进入经验库和每日回顾，经验库是审核状态", async () => {
  const out = django(`
from plane.db.models import Project, ProjectMember, State
p = Project.objects.get(identifier="LESSON", workspace__slug="${secrets.PLANE_WORKSPACE}")
print(ProjectMember.objects.filter(project=p, member__email="bob@team.test", is_active=True).exists())
print(",".join(State.objects.filter(project=p).order_by("sequence").values_list("name", flat=True)))
`);
  expect(out.startsWith("True") && out.includes("待审核") && out.includes("已采纳"), out);
});

await step("成员的 Agent 写评论，署名是成员自己", async () => {
  const r = await bob("comment_task", { task: taskKey, kind: "进展", markdown: "游标排序的子任务我来接，今天先补测试。" });
  expect(!r.isError, r.text);
  const t = await call("get_task", { task: taskKey });
  expect(t.text.includes("bob 的 e2e-bob") || t.text.includes("的 e2e-bob"), t.text);
});

await step("子任务：parent + 指派，父任务能看到子任务", async () => {
  const r = await call("create_task", { project: PROJECT, title: "拆分：游标排序", description: goodTask, parent: taskKey, assignees: ["me", "bob"] });
  expect(!r.isError && r.text.includes(`挂在 ${taskKey} 下`), r.text);
  const child = r.text.match(/已新建 ([A-Z0-9]+-\d+)/)![1];
  const parent = await call("get_task", { task: taskKey });
  expect(parent.text.includes("## 子任务（1）") && parent.text.includes(child), parent.text);
  const mine = await call("list_tasks", { project: PROJECT, assignee: "bob" });
  expect(mine.text.includes(child) && !mine.text.includes(`${taskKey} `), mine.text);
  return child;
});

await step("不存在的状态给出可选列表，而不是误报“只能由人设置”", async () => {
  const r = await call("update_task", { task: taskKey, state: "做着呢" });
  expect(r.isError && r.text.includes("可选状态：待办、待开始、进行中"), r.text);
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
    role: "实现者",
    markdown: "分页改为游标实现，第二页不再重复。\n\n跑了 `pnpm test order`，18 个用例通过。",
  });
  expect(!r.isError, r.text);
});

await step("get_task 能读到描述和评论", async () => {
  const r = await call("get_task", { task: taskKey });
  expect(r.text.includes("验收标准") && r.text.includes("- [ ] 翻页不再重复"), r.text);
  expect(r.text.includes("游标实现") && r.text.includes("实现者 · dev-admin 的 e2e"), r.text);
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

await step("改成待审查必须附带证据的结论，并关联交付文档", async () => {
  const none = await call("update_task", { task: taskKey, state: "待审查" });
  expect(none.isError && none.text.includes("comment"), none.text);
  const weak = await call("update_task", { task: taskKey, state: "待审查", comment: "做完了。" });
  expect(weak.isError && weak.text.includes("缺少证据"), weak.text);
  const r = await call("update_task", {
    task: taskKey,
    state: "待审查",
    role: "实现者",
    comment: "分页改成游标实现，第二页不再重复。\n\n跑了 `pnpm test order`，18 个用例通过。",
  });
  expect(!r.isError && r.text.includes("待审查") && r.text.includes("结论"), r.text);
  const t = await call("get_task", { task: taskKey });
  expect(t.text.includes("## 关联文档") && t.text.includes("订单分页方案") && t.text.includes("状态：待审查"), t.text);
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

await step("文档和任务双向关联：任务页和文档页都能看到", async () => {
  const t = await call("get_task", { task: taskKey });
  expect(t.text.includes("## 关联文档") && t.text.includes("订单分页方案"), t.text);
  const d = await call("read_doc", { project: PROJECT, doc_id: docId });
  expect(d.text.includes("## 关联工作项") && d.text.includes(taskKey), d.text);
});

await step("别人的工作项只能评论：成员不能改管理员的任务", async () => {
  const r = await bob("update_task", { task: taskKey, state: "进行中" });
  expect(r.isError && r.text.includes("只能评论"), r.text);
  const c = await bob("comment_task", { task: taskKey, kind: "进展", markdown: "我看了一下，分页方案里的索引还要再确认一遍。" });
  expect(!c.isError, c.text);
});

await step("别人的文档只能阅读：成员不能改管理员的文档", async () => {
  const r = await bob("write_doc", { project: PROJECT, type: "design", title: "订单分页方案", doc_id: docId, markdown: goodDesign });
  expect(r.isError && r.text.includes("只能阅读"), r.text);
});

await step("成员自己的文档可以关联到别人的任务；和自己都无关的不行", async () => {
  const mine = await bob("write_doc", { project: PROJECT, type: "design", title: "游标排序补充", markdown: goodDesign, task: taskKey });
  expect(!mine.isError && mine.text.includes("已关联到任务"), mine.text);
  const t = await call("get_task", { task: taskKey });
  expect(t.text.includes("游标排序补充"), t.text);
  const other = await bob("link_doc", { task: taskKey, doc_id: docId, project: PROJECT });
  expect(other.isError && other.text.includes("建立关联"), other.text);
});

await step("管理员能改成员的文档", async () => {
  const id = (await bob("list_docs", { project: PROJECT })).text.match(/游标排序补充.*?([0-9a-f-]{36})/s)?.[1];
  expect(id, "没找到成员的文档");
  const r = await call("write_doc", { project: PROJECT, type: "design", title: "游标排序补充", doc_id: id, markdown: `${goodDesign}\n## 验证\n\n管理员补了一段验证说明。\n` });
  expect(!r.isError, r.text);
});

await step("list_docs 能按正文搜索", async () => {
  expect(docId, "前一步没有拿到文档 ID");
  const r = await call("list_docs", { search: "游标" });
  expect(r.text.includes(docId), r.text);
});

const lessonTitle = `分页接口用游标而不是 offset（${run}）`;
const lessonBody = "## 场景\n\n列表接口在翻页期间会有新数据写入。\n\n## 做法\n\n用 `(created_at, id)` 做游标分页，接口返回 `next_cursor`。\n";

await step("团队经验提交到待审核", async () => {
  const r = await call("propose_lesson", { title: lessonTitle, markdown: lessonBody, tags: ["分页", "api"], scope: "team", source_task: taskKey });
  expect(!r.isError && r.text.includes("待审核"), r.text);
  return r.text.match(/LESSON-\d+/)?.[0];
});

await step("经验按项目归属：默认当前项目，也可以归通用", async () => {
  const g = await call("propose_lesson", { title: `通用的小坑 ${run}`, markdown: lessonBody, tags: ["杂项"], scope: "team", source_task: taskKey, project: "通用" });
  expect(!g.isError && g.text.includes("通用"), g.text);
  const bad = await call("propose_lesson", { title: `写错项目 ${run}`, markdown: lessonBody, tags: ["杂项"], scope: "team", source_task: taskKey, project: "NOPE" });
  expect(bad.isError && bad.text.includes("没有「NOPE」"), bad.text);
  const s = await call("search_lessons", { query: `游标 ${run}`, include_pending: true });
  expect(s.text.includes(`项目：${PROJECT}`), s.text);
  const g2 = await call("search_lessons", { query: `通用的小坑 ${run}`, include_pending: true });
  expect(g2.text.includes("项目：通用"), g2.text);
});

await step("团队经验没有来源会被退回", async () => {
  const r = await call("propose_lesson", { title: `没有来源的经验 ${run}`, markdown: lessonBody, tags: ["分页"], scope: "team" });
  expect(r.isError && r.text.includes("来源"), r.text);
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
  if (HTTP) {
    expect(r.isError && r.text.includes("远程服务"), r.text);
    return "远程服务拒绝私人经验";
  }
  expect(!r.isError && r.text.includes(privateDir), r.text);
  const s = await call("search_lessons", { query: "端口", tags: ["本地开发"] });
  expect(s.text.includes("私人"), s.text);
});

await step("review_digest 生成回顾", async () => {
  const r = await call("review_digest", { stale_days: 1 });
  expect(!r.isError && r.text.includes("待审核的经验") && r.text.includes(lessonTitle), r.text);
  expect(r.text.includes(`http://localhost:${ports.WEB_PORT}/`), "链接应指向网页地址");
});

await step("review_digest 发布为当天文档，重复执行只更新", async () => {
  const first = await call("review_digest", { publish: true });
  expect(!first.isError && /已(发布|更新)「回顾 \d{4}-\d{2}-\d{2} · [^」]+」/.test(first.text), first.text);
  const second = await call("review_digest", { publish: true });
  expect(second.text.includes("已更新"), second.text);
  return first.text.match(/http\S+/)?.[0];
});

await step("analyze_tone 对长文出整篇报告，短文提示字数不够", async () => {
  const short = await call("analyze_tone", { markdown: goodDesign });
  expect(short.text.includes("汉字过少"), short.text);
  const long = await call("analyze_tone", { markdown: Array(6).fill(goodDesign).join("\n") });
  expect(!long.isError && /翻案腔|A|B/.test(long.text) && long.text.length > 200, long.text.slice(0, 300));
});

console.log(`\n${passed} 通过，${failed} 失败。测试项目：${PROJECT}`);
process.exit(failed ? 1 : 0);
