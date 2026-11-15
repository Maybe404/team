#!/usr/bin/env node
// team-mcp：团队协作 MCP。
// 任务和文档存在 Plane，经验库存在 Plane 的经验库项目（私人经验在本机），
// 所有写入都要先过规范闸门（norms），不合规的会被退回给调用方 Agent 修改。
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { BINDING_FILE, checkWritable, readBinding, workDirs, writeBinding } from "./binding.ts";
import { z } from "zod";
import { formatLessons, getLessonProject, proposeTeamLesson, savePrivateLesson, searchLessons } from "./lessons.ts";
import { htmlToMd, mdToHtml } from "./markdown.ts";
import { COMMENT_KINDS, formatGate, gate, TEMPLATES, templateGuide, WRITING_GUIDE, type DocType } from "./norms/index.ts";
import { Plane, PlaneError, type Member, type Project, type WorkItem } from "./plane.ts";
import { fullToneReport, SKILL_DIR } from "./norms/tone.ts";
import { buildDigest, getReviewProject, publishDigest } from "./review.ts";
import { agentCanSet, ensureStates, findState, HUMAN_ONLY_HINT, TASK_STATES } from "./workflow.ts";

const CONFIG = {
  baseUrl: process.env.PLANE_BASE_URL || "http://localhost:47800",
  token: process.env.PLANE_API_TOKEN || "",
  workspace: process.env.PLANE_WORKSPACE || "",
  webUrl: process.env.PLANE_WEB_URL || "http://localhost:47300",
};
const plane = new Plane(CONFIG);

// 没配置或 Token 失效时不让进程崩掉，而是在每次调用时告诉使用者怎么配
function setupGuide(reason: string) {
  const web = CONFIG.webUrl.replace(/\/$/, "");
  return `${reason}

首次使用按下面做（每个人用自己的账号和 Token，Plane 上的操作会记在你名下）：
1. 打开 ${web} 登录。没有账号的话请管理员用 invite_member 邀请你的邮箱，再用这个邮箱注册，注册后在网页上接受工作区邀请。
2. 进入 ${web}/${CONFIG.workspace || "<工作区>"}/settings/account/api-tokens 新建一个 API Token。
3. 在 MCP 配置里设置环境变量：PLANE_API_TOKEN=<刚才的 Token>、PLANE_WORKSPACE=${CONFIG.workspace || "<工作区 slug，网址里第一段>"}、PLANE_BASE_URL=${CONFIG.baseUrl}、PLANE_WEB_URL=${web}，然后重启 Agent。
4. 调用 whoami 确认。`;
}
const webUrl = (path: string) => plane.webUrl(path);

const server = new McpServer(
  { name: "team-mcp", version: "0.1.0" },
  {
    instructions: `团队协作 MCP。任务、文档、经验都通过这里读写，不要绕过它直接改。
规则：
1. 写之前先读规范：资源 team://guide/writing，或调用 get_writing_guide。
2. 所有写入都会做规范检查，被退回时按提示逐条改完重交，不要换个说法绕过检查。
3. 只在团队项目里工作时使用（whoami 能看到当前仓库是否绑定）；个人项目里不要调用这些工具。团队任务动手前先 search_lessons 查相关经验，结束后经用户同意用 propose_lesson 提交新经验，团队经验需要人审核才会生效。
4. 状态“已完成”“已取消”只能由人设置；Agent 做完后用 update_task 改成“待审查”，同时在 comment 里写带证据的结论。
5. 只写团队工作。只有绑定了团队项目的仓库（根目录有 ${BINDING_FILE}）里才能写入；没绑定时不要自己调用 bind_repo，先问用户。个人项目、私人笔记、密钥和个人信息不要写进来。
6. 没有删除工具，也不要让用户去网页删除；不再需要的内容由人在网页上归档。
7. 写入前不用每次都问用户，但新建项目、邀请成员、绑定仓库、提交团队经验之前要征得用户同意。`,
  },
);

const DOC_TYPES = Object.keys(TEMPLATES) as [DocType, ...DocType[]];
const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const fail = (t: string) => ({ content: [{ type: "text" as const, text: t }], isError: true });

async function run(fn: () => Promise<ReturnType<typeof text>>) {
  if (!CONFIG.token || !CONFIG.workspace) {
    return fail(setupGuide(`team-mcp 还没配置：缺少 ${[!CONFIG.token && "PLANE_API_TOKEN", !CONFIG.workspace && "PLANE_WORKSPACE"].filter(Boolean).join("、")}。`));
  }
  try {
    return await fn();
  } catch (e) {
    if (e instanceof PlaneError && (e.status === 401 || /token is not valid|credentials were not provided/i.test(e.body)))
      return fail(setupGuide("Plane 拒绝了这个 API Token（401），可能已被删除或填错。"));
    if (e instanceof PlaneError && e.status === 403) return fail(`没有权限：${e.path}。这个操作需要更高的项目或工作区角色，请找管理员。`);
    if (e instanceof TypeError && /fetch failed/.test(e.message)) return fail(`连不上 Plane（${CONFIG.baseUrl}）。确认服务已启动、PLANE_BASE_URL 正确。`);
    return fail(e instanceof Error ? e.message : String(e));
  }
}

// 署名绑定到 Token 对应的账号和调用方客户端：「实现者 · bob 的 claude-code」
let meCache: Promise<{ display_name: string }> | undefined;
async function signature(role?: string) {
  const me = await (meCache ??= plane.me());
  const client = server.server.getClientVersion()?.name || "Agent";
  return [role?.trim(), `${me.display_name} 的 ${client}`].filter(Boolean).join(" · ");
}

const STATE_COMMENT_KIND: Record<string, (typeof COMMENT_KINDS)[number]> = { 待审查: "结论", 阻塞: "阻塞", 待决定: "决策" };

const ROLES = { admin: 20, member: 15, guest: 5 } as const;
const roleName = (r?: number) => (r === 20 ? "管理员" : r === 15 ? "成员" : r === 5 ? "访客" : "未知");
const memberName = (m: Member) => `${m.display_name}${m.email ? `（${m.email}）` : ""}`;

/** 把 "me"、邮箱、显示名、姓名解析成项目成员 ID。 */
async function resolveMembers(projectId: string, refs: string[]): Promise<Member[]> {
  if (!refs.length) return [];
  const [members, me] = await Promise.all([plane.listProjectMembers(projectId), plane.me()]);
  return refs.map((ref) => {
    const r = ref.trim().toLowerCase();
    if (r === "me" || r === "我") {
      const hit = members.find((m) => m.id === me.id);
      if (!hit) throw new Error("你不是这个项目的成员，不能指派给自己。请项目管理员把你加进项目。");
      return hit;
    }
    const hit = members.filter(
      (m) =>
        m.email?.toLowerCase() === r ||
        m.display_name.toLowerCase() === r ||
        `${m.first_name ?? ""}${m.last_name ?? ""}`.toLowerCase() === r ||
        `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim().toLowerCase() === r,
    );
    if (hit.length === 1) return hit[0];
    throw new Error(
      `${hit.length ? `「${ref}」匹配到多个成员，请用邮箱` : `项目里没有成员「${ref}」`}。项目成员：${members.map(memberName).join("、") || "无"}`,
    );
  });
}

function checkOrReject(md: string, type: DocType, opts: Parameters<typeof gate>[2] = {}) {
  const r = gate(md, type, opts);
  return { ok: r.ok, report: formatGate(r) };
}

async function resolveTask(ref: string): Promise<{ project: Project; item: WorkItem; key: string }> {
  const m = ref.trim().match(/^([A-Za-z][A-Za-z0-9]*)-(\d+)$/);
  if (!m) throw new Error(`任务编号格式是「项目标识-序号」，例如 DEMO-12，收到「${ref}」`);
  const project = await plane.resolveProject(m[1]);
  const item = await plane.getWorkItemByKey(`${project.identifier}-${m[2]}`).catch((e) => {
    if (e instanceof PlaneError && e.status === 404) throw new Error(`找不到任务 ${project.identifier}-${m[2]}。可以用 list_tasks 或 search_tasks 查编号。`);
    throw e;
  });
  return { project, item, key: `${project.identifier}-${item.sequence_id}` };
}

// ---------- 写入范围 ----------

async function currentDirs() {
  const caps = server.server.getClientCapabilities();
  return workDirs(caps?.roots ? () => server.server.listRoots() : undefined);
}

/** 返回拒绝原因；可以写时返回 undefined。 */
async function guardWrite(projectIdentifier: string): Promise<string | undefined> {
  const dirs = await currentDirs();
  return checkWritable(readBinding(dirs), CONFIG.workspace, projectIdentifier, dirs);
}

// ---------- 规范 ----------

server.registerResource("writing-guide", "team://guide/writing", { title: "团队写作规范", mimeType: "text/markdown" }, async (uri) => ({
  contents: [{ uri: uri.href, mimeType: "text/markdown", text: WRITING_GUIDE }],
}));
for (const t of DOC_TYPES) {
  server.registerResource(
    `template-${t}`,
    `team://templates/${t}`,
    { title: `${TEMPLATES[t].name}模板`, mimeType: "text/markdown" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: templateGuide(t) }] }),
  );
}

server.registerPrompt(
  "team-write",
  {
    title: "按团队规范写文档",
    description: "加载写作规范和指定类型的模板",
    argsSchema: { type: z.enum(DOC_TYPES).describe("文档类型") },
  },
  ({ type }) => ({
    messages: [{ role: "user", content: { type: "text", text: `${WRITING_GUIDE}\n\n${templateGuide(type)}\n\n按上面的规范和模板写。` } }],
  }),
);

server.registerResource(
  "skill-less-ai-tone",
  "team://skills/less-ai-tone",
  { title: "去 AI 味 v2（lieflat-less-ai-tone，CC BY-NC 4.0）", mimeType: "text/markdown" },
  async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "text/markdown", text: readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8") }],
  }),
);
server.registerResource(
  "skill-less-ai-tone-criteria",
  "team://skills/less-ai-tone/semantic-criteria",
  { title: "去 AI 味：语义层判据", mimeType: "text/markdown" },
  async (uri) => ({
    contents: [
      { uri: uri.href, mimeType: "text/markdown", text: readFileSync(join(SKILL_DIR, "references", "semantic-criteria.md"), "utf8") },
    ],
  }),
);

server.registerPrompt(
  "less-ai-tone",
  {
    title: "去 AI 味（成稿清理）",
    description: "按 lieflat-less-ai-tone 的流程：先检测出报告，等用户回复后再改写",
    argsSchema: { doc: z.string().describe("要清理的文档：Plane 文档 ID，或直接贴正文") },
  },
  ({ doc }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `${readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8")}\n\n---\n\n按上面的 skill 处理这篇文档：${doc}\n\n脚本检测用 team-mcp 的 analyze_tone 工具代替 \`python3 scripts/detect.py\`；语义层判据读资源 team://skills/less-ai-tone/semantic-criteria。先交付改前报告，等我回复再改。`,
        },
      },
    ],
  }),
);

server.registerTool(
  "analyze_tone",
  {
    title: "去 AI 味整篇检测",
    description:
      "对一篇长文（≥500 汉字）跑 less-ai-tone 的整篇检测，返回分级报告（A/B/C/F/X）。用于成稿清理，配合提示词 less-ai-tone 使用。短文本的逐句检查已经内置在所有写入工具里。",
    inputSchema: {
      markdown: z.string().optional().describe("正文"),
      project: z.string().optional().describe("读取 Plane 文档时的项目"),
      doc_id: z.string().optional().describe("读取 Plane 文档时的文档 ID"),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ markdown, project, doc_id }) =>
    run(async () => {
      let md = markdown;
      if (!md && project && doc_id) {
        const p = await plane.resolveProject(project);
        md = htmlToMd((await plane.getPage(p.id, doc_id)).description_html);
      }
      if (!md) return fail("传 markdown，或者 project + doc_id");
      const file = join(mkdtempSync(join(tmpdir(), "team-tone-")), "doc.md");
      writeFileSync(file, md, "utf8");
      try {
        return text(fullToneReport(md, file));
      } finally {
        rmSync(dirname(file), { recursive: true, force: true });
      }
    }),
);

server.registerTool(
  "get_writing_guide",
  {
    title: "读取写作规范",
    description: "返回团队写作规范；传 type 时附上该类文档的模板。写任何内容之前先读一遍。",
    inputSchema: { type: z.enum(DOC_TYPES).optional().describe("文档类型") },
    annotations: { readOnlyHint: true },
  },
  async ({ type }) => text(type ? `${WRITING_GUIDE}\n\n${templateGuide(type)}` : WRITING_GUIDE),
);

server.registerTool(
  "check_text",
  {
    title: "预检文字",
    description: "只做规范检查，不写入。提交前可以先用它自查。",
    inputSchema: {
      markdown: z.string(),
      type: z.enum(DOC_TYPES),
      comment_kind: z.enum(COMMENT_KINDS).optional(),
      title: z.string().optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ markdown, type, comment_kind, title }) => {
    const r = checkOrReject(markdown, type, { commentKind: comment_kind, title });
    return text(r.ok ? `通过规范检查。${r.report ? `\n\n${r.report}` : ""}` : r.report);
  },
);

// ---------- 账号与成员 ----------

server.registerTool(
  "whoami",
  {
    title: "当前账号",
    description: "确认 team-mcp 连的是哪个 Plane、哪个工作区、以哪个账号操作。首次使用或报权限错误时先调用它。",
    annotations: { readOnlyHint: true },
  },
  async () =>
    run(async () => {
      const me = await plane.me();
      const role = await plane
        .listWorkspaceMembers()
        .then((ms) => roleName(ms.find((m) => m.id === me.id)?.role))
        .catch(() => "成员或访客");
      const dirs = await currentDirs();
      const b = readBinding(dirs);
      const bound = b
        ? `已绑定：${b.projects === "*" ? "工作区所有项目" : b.projects.join("、")}（${b.file}）`
        : `未绑定（${dirs.join("、")}），只能读，不能写`;
      return text(
        `账号：${me.display_name}（${me.email}）\n工作区：${CONFIG.workspace}，角色：${role}\nPlane：${CONFIG.webUrl}（API ${CONFIG.baseUrl}）\n当前仓库：${bound}`,
      );
    }),
);

server.registerTool(
  "bind_repo",
  {
    title: "绑定仓库",
    description: `把当前仓库绑定到团队项目，绑定后才能在这个仓库里写任务、文档和团队经验。会在仓库根目录写 ${BINDING_FILE}。只有用户明确说这是团队项目时才能调用，不要自行判断。`,
    inputSchema: { projects: z.array(z.string()).min(1).describe("项目标识，例如 [\"ORDER\"]") },
  },
  async ({ projects }) =>
    run(async () => {
      for (const p of projects) await plane.resolveProject(p);
      const dir = (await currentDirs())[0];
      const top = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: dir, encoding: "utf8" });
      const root = top.status === 0 ? top.stdout.trim() : dir;
      const f = writeBinding(root, CONFIG.workspace, projects);
      return text(`已绑定，写入 ${f}。建议把它提交到仓库，团队其他人的 Agent 也会按这个绑定写入。`);
    }),
);

server.registerTool(
  "list_members",
  {
    title: "列出成员",
    description: "传 project 时列出项目成员（指派任务用）；不传时列出工作区成员和待接受的邀请（需要管理员）。",
    inputSchema: { project: z.string().optional() },
    annotations: { readOnlyHint: true },
  },
  async ({ project }) =>
    run(async () => {
      if (project) {
        const p = await plane.resolveProject(project);
        const ms = await plane.listProjectMembers(p.id);
        return text(`${p.identifier} 项目成员（${ms.length}）：\n${ms.map((m) => `- ${memberName(m)}`).join("\n")}`);
      }
      const [ms, invites] = await Promise.all([plane.listWorkspaceMembers(), plane.listInvites().catch(() => [])]);
      const pending = invites.filter((i) => !i.accepted);
      return text(
        `工作区成员（${ms.length}）：\n${ms.map((m) => `- ${memberName(m)}，${roleName(m.role)}`).join("\n")}${
          pending.length ? `\n\n待接受的邀请：\n${pending.map((i) => `- ${i.email}，${roleName(i.role)}`).join("\n")}` : ""
        }`,
      );
    }),
);

server.registerTool(
  "invite_member",
  {
    title: "邀请成员",
    description:
      "邀请一个邮箱加入工作区（需要工作区所有者的 Token）。对方用这个邮箱在 Plane 注册并接受邀请后，再用 add_project_member 加进项目。调用前要征得用户同意。",
    inputSchema: {
      email: z.string().email(),
      role: z.enum(["admin", "member", "guest"]).optional().describe("默认 member"),
    },
  },
  async ({ email, role }) =>
    run(async () => {
      const existing = await plane.listWorkspaceMembers().catch(() => []);
      if (existing.some((m) => m.email?.toLowerCase() === email.toLowerCase())) return text(`${email} 已经是工作区成员。`);
      const inv = await plane.createInvite(email, ROLES[role ?? "member"]);
      return text(
        `已邀请 ${inv.email}（${roleName(inv.role)}）。请对方：\n1. 用这个邮箱在 ${CONFIG.webUrl} 注册并登录，在首页接受「${CONFIG.workspace}」的邀请；\n2. 在 ${CONFIG.webUrl}/${CONFIG.workspace}/settings/account/api-tokens 生成自己的 API Token，配到自己的 team-mcp 里。\n接受后用 add_project_member 把他加进需要的项目。`,
      );
    }),
);

server.registerTool(
  "add_project_member",
  {
    title: "加入项目",
    description: "把已在工作区里的成员加进项目，加入后才能被指派任务。需要项目管理员权限。",
    inputSchema: {
      project: z.string(),
      member: z.string().describe("邮箱或显示名"),
      role: z.enum(["admin", "member", "guest"]).optional().describe("默认 member"),
    },
  },
  async ({ project, member, role }) =>
    run(async () => {
      const p = await plane.resolveProject(project);
      const r = member.trim().toLowerCase();
      const ms = await plane.listWorkspaceMembers();
      const hit = ms.find((m) => m.email?.toLowerCase() === r || m.display_name.toLowerCase() === r);
      if (!hit) return fail(`工作区里没有「${member}」。还没加入的人先用 invite_member 邀请。工作区成员：${ms.map(memberName).join("、")}`);
      const done: string[] = [];
      // 经验库和每日回顾是全员共享的，加人进任何项目时顺带加进去
      const shared = [p, await getLessonProject(plane), await getReviewProject(plane)];
      for (const proj of shared.filter((x, i) => shared.findIndex((y) => y.id === x.id) === i)) {
        if ((await plane.listProjectMembers(proj.id)).some((m) => m.id === hit.id)) continue;
        await plane.addProjectMember(proj.id, hit.id, proj.id === p.id ? ROLES[role ?? "member"] : ROLES.member);
        done.push(proj.identifier);
      }
      return text(done.length ? `已把 ${memberName(hit)} 加进 ${done.join("、")}。` : `${memberName(hit)} 已在 ${p.identifier} 里。`);
    }),
);

// ---------- 项目 ----------

server.registerTool(
  "list_projects",
  { title: "列出项目", description: "列出工作区里的所有项目", annotations: { readOnlyHint: true } },
  async () =>
    run(async () => {
      const ps = await plane.listProjects();
      return text(
        ps.map((p) => `- ${p.identifier}：${p.name}${p.description ? `（${p.description}）` : ""}${p.is_member === false ? "　[你未加入]" : ""}`).join("\n") ||
          "没有项目",
      );
    }),
);

server.registerTool(
  "setup_project",
  {
    title: "初始化项目",
    description: "新建项目（不存在时）并把状态整理成团队工作流：待办、待开始、进行中、待审查、阻塞、待决定、已完成、已取消。可重复执行。",
    inputSchema: {
      identifier: z.string().regex(/^[A-Z][A-Z0-9]{1,11}$/).describe("项目标识，大写字母开头，2～12 位，例如 ORDER"),
      name: z.string().optional().describe("新建时的项目名"),
      description: z.string().optional(),
    },
  },
  async ({ identifier, name, description }) =>
    run(async () => {
      let project = (await plane.listProjects()).find((p) => p.identifier === identifier);
      const created = !project;
      if (!project) project = await plane.createProject(name || identifier, identifier, description);
      const changes = await ensureStates(plane, project, TASK_STATES);
      // 已完成、已取消的任务一个月后自动归档，列表保持干净
      if (!project.archive_in) await plane.updateProject(project.id, { archive_in: 1 }).then(() => changes.push("已完成和已取消的任务 1 个月后自动归档")).catch(() => undefined);
      return text(`${created ? "已新建" : "已存在"}项目 ${project.identifier}（${project.name}）。${changes.length ? `\n${changes.join("\n")}` : "\n状态已是团队工作流，无需调整。"}`);
    }),
);

// ---------- 任务 ----------

server.registerTool(
  "list_tasks",
  {
    title: "列出任务",
    description: "列出某个项目的任务，可按状态过滤。默认不含已完成和已取消。",
    inputSchema: {
      project: z.string().describe("项目标识或名称"),
      states: z.array(z.string()).optional().describe("只看这些状态，例如 [\"进行中\",\"阻塞\"]"),
      include_closed: z.boolean().optional(),
      search: z.string().optional().describe("标题关键词"),
      assignee: z.string().optional().describe("只看指派给某人的：me、邮箱或显示名"),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ project, states, include_closed, search, assignee }) =>
    run(async () => {
      const p = await plane.resolveProject(project);
      const [items, st, members] = await Promise.all([plane.listWorkItems(p.id), plane.listStates(p.id), plane.listProjectMembers(p.id)]);
      const byId = new Map(st.map((s) => [s.id, s]));
      const names = new Map(members.map((m) => [m.id, m.display_name]));
      const who = assignee ? (await resolveMembers(p.id, [assignee]))[0].id : undefined;
      const rows = items
        .filter((i) => {
          const s = byId.get(i.state);
          if (!include_closed && (s?.group === "completed" || s?.group === "cancelled")) return false;
          if (states?.length && !states.includes(s?.name ?? "")) return false;
          if (search && !i.name.toLowerCase().includes(search.toLowerCase())) return false;
          if (who && !i.assignees.includes(who)) return false;
          return true;
        })
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .map((i) => {
          const people = i.assignees.map((a) => names.get(a) ?? "?").join("、");
          return `- ${p.identifier}-${i.sequence_id} [${byId.get(i.state)?.name ?? "?"}] ${i.name}（${people ? `${people}，` : ""}更新于 ${i.updated_at.slice(0, 10)}）`;
        });
      return text(rows.join("\n") || "没有符合条件的任务");
    }),
);

server.registerTool(
  "get_task",
  {
    title: "读取任务",
    description: "读取任务详情和评论时间线（Markdown）。",
    inputSchema: { task: z.string().describe("任务编号，例如 DEMO-12"), comments: z.number().int().min(0).max(100).optional().describe("最多返回几条评论，默认 20") },
    annotations: { readOnlyHint: true },
  },
  async ({ task, comments }) =>
    run(async () => {
      const { project, item, key } = await resolveTask(task);
      const [st, cs, members, links, all] = await Promise.all([
        plane.listStates(project.id),
        plane.listComments(project.id, item.id),
        plane.listProjectMembers(project.id),
        plane.listLinks(project.id, item.id).catch(() => []),
        plane.listWorkItems(project.id),
      ]);
      const state = st.find((s) => s.id === item.state)?.name ?? "?";
      const stateName = new Map(st.map((s) => [s.id, s.name]));
      const names = new Map(members.map((m) => [m.id, m.display_name]));
      const parent = item.parent ? all.find((i) => i.id === item.parent) : undefined;
      const children = all.filter((i) => i.parent === item.id).sort((a, b) => a.sequence_id - b.sequence_id);
      const meta = [
        `指派：${item.assignees.map((a) => names.get(a) ?? "?").join("、") || "无"}`,
        parent ? `父任务：${project.identifier}-${parent.sequence_id} ${parent.name}` : "",
      ].filter(Boolean).join("　");
      const extra = [
        children.length
          ? `## 子任务（${children.length}）\n\n${children.map((c) => `- ${project.identifier}-${c.sequence_id} [${stateName.get(c.state) ?? "?"}] ${c.name}`).join("\n")}`
          : "",
        links.length ? `## 链接\n\n${links.map((l) => `- [${l.title || l.url}](${l.url})`).join("\n")}` : "",
      ].filter(Boolean).join("\n\n");
      const timeline = cs
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .slice(-(comments ?? 20))
        .map((c) => `### ${c.created_at.slice(0, 16).replace("T", " ")}\n\n${htmlToMd(c.comment_html)}`)
        .join("\n\n");
      return text(
        `# ${key} ${item.name}\n\n状态：${state}　优先级：${item.priority}　${meta}\n链接：${webUrl(`browse/${key}`)}\n\n${htmlToMd(item.description_html) || "（无描述）"}\n\n${extra ? `${extra}\n\n` : ""}## 评论（${cs.length}）\n\n${timeline || "无"}`,
      );
    }),
);

server.registerTool(
  "create_task",
  {
    title: "新建任务",
    description:
      "新建任务。描述必须符合任务模板（## 目标、## 验收标准）。拆分大任务时传 parent 建子任务。建任务前建议先 search_lessons，把相关经验写进「相关」章节。",
    inputSchema: {
      project: z.string(),
      title: z.string().min(4),
      description: z.string().describe("Markdown，按任务模板"),
      priority: z.enum(["urgent", "high", "medium", "low", "none"]).optional(),
      state: z.string().optional().describe("初始状态，默认“待开始”"),
      assignees: z.array(z.string()).optional().describe("指派给谁：me、邮箱或显示名"),
      parent: z.string().optional().describe("父任务编号，用于拆分子任务，例如 DEMO-3"),
    },
  },
  async ({ project, title, description, priority, state, assignees, parent }) =>
    run(async () => {
      const g = checkOrReject(description, "task", { title });
      if (!g.ok) return fail(g.report);
      const p = await plane.resolveProject(project);
      const denied = await guardWrite(p.identifier);
      if (denied) return fail(denied);
      const st = await plane.listStates(p.id);
      const target = state ?? "待开始";
      if (!agentCanSet(target)) return fail(HUMAN_ONLY_HINT);
      const people = await resolveMembers(p.id, assignees ?? []);
      const parentTask = parent ? await resolveTask(parent) : undefined;
      if (parentTask && parentTask.project.id !== p.id) return fail(`父任务 ${parentTask.key} 不在项目 ${p.identifier} 里，子任务要和父任务在同一个项目。`);
      const item = await plane.createWorkItem(p.id, {
        name: title,
        description_html: mdToHtml(description),
        priority: priority ?? "none",
        state: findState(st, target).id,
        assignees: people.map((m) => m.id),
        ...(parentTask ? { parent: parentTask.item.id } : {}),
      });
      const key = `${p.identifier}-${item.sequence_id}`;
      const extras = [people.length ? `指派给 ${people.map((m) => m.display_name).join("、")}` : "", parentTask ? `挂在 ${parentTask.key} 下` : ""].filter(Boolean).join("，");
      return text(`已新建 ${key}${extras ? `（${extras}）` : ""}：${webUrl(`browse/${key}`)}${g.report ? `\n\n${g.report}` : ""}`);
    }),
);

server.registerTool(
  "update_task",
  {
    title: "更新任务",
    description: `改任务的状态、标题、描述、优先级、指派人或父任务。Agent 可设的状态：${TASK_STATES.filter((s) => s.agentCanSet).map((s) => s.name).join("、")}；“已完成”“已取消”只能由人设置。改成“待审查”“阻塞”“待决定”时必须在 comment 里说明（分别写成结论、阻塞、决策评论；结论要带验证证据）。`,
    inputSchema: {
      task: z.string(),
      state: z.string().optional(),
      title: z.string().optional(),
      description: z.string().optional().describe("完整的新描述（Markdown），会整体替换"),
      priority: z.enum(["urgent", "high", "medium", "low", "none"]).optional(),
      assignees: z.array(z.string()).optional().describe("新的指派人列表，整体替换；传 [] 清空"),
      parent: z.string().optional().describe("改挂到哪个父任务下；传 none 取消父任务"),
      comment: z
        .string()
        .optional()
        .describe(
          "改状态时的说明，会写成一条评论。改成待审查/阻塞/待决定时必填。格式：第一行是一句话结论（不要用标题、不要写“结论：”这类提示语），空一行后写细节；待审查要写跑了什么命令、结果如何，没跑的写“未运行”。",
        ),
      role: z.string().optional().describe("你在这个任务里的角色，用于评论署名"),
    },
  },
  async ({ task, state, title, description, priority, assignees, parent, comment, role }) =>
    run(async () => {
      const { project, item, key } = await resolveTask(task);
      const denied = await guardWrite(project.identifier);
      if (denied) return fail(denied);
      const kind = state ? STATE_COMMENT_KIND[state] : undefined;
      if (kind && !comment) return fail(`改成「${state}」时要在 comment 里写${kind}说明${kind === "结论" ? "（做了什么、怎么验证的、结果如何）" : ""}。`);
      const commentKind = kind ?? "进展";
      if (comment) {
        const cg = checkOrReject(comment, "comment", { commentKind });
        if (!cg.ok) return fail(cg.report);
      }
      const body: Record<string, unknown> = {};
      const notes: string[] = [];
      if (description !== undefined) {
        const g = checkOrReject(description, "task", { title: title ?? item.name });
        if (!g.ok) return fail(g.report);
        if (g.report) notes.push(g.report);
        body.description_html = mdToHtml(description);
      }
      if (state) {
        if (!agentCanSet(state)) return fail(HUMAN_ONLY_HINT);
        body.state = findState(await plane.listStates(project.id), state).id;
      }
      if (title) body.name = title;
      if (priority) body.priority = priority;
      if (assignees) body.assignees = (await resolveMembers(project.id, assignees)).map((m) => m.id);
      if (parent) {
        if (parent.toLowerCase() === "none") body.parent = null;
        else {
          const pt = await resolveTask(parent);
          if (pt.item.id === item.id) return fail("任务不能挂在自己下面");
          body.parent = pt.item.id;
        }
      }
      if (!Object.keys(body).length && !comment) return fail("没有要改的字段");
      if (Object.keys(body).length) await plane.updateWorkItem(project.id, item.id, body);
      if (comment) {
        await plane.createComment(project.id, item.id, mdToHtml(`**${commentKind}** · ${await signature(role)}\n\n${comment.trim()}`));
      }
      return text(`已更新 ${key}${state ? `，状态改为「${state}」` : ""}${comment ? `，并写入「${commentKind}」评论` : ""}。${notes.length ? `\n\n${notes.join("\n")}` : ""}`);
    }),
);

server.registerTool(
  "comment_task",
  {
    title: "写任务评论",
    description: "在任务时间线上写一条评论。第一行是一句话结论；“结论”“验收”类评论必须带验证证据。",
    inputSchema: {
      task: z.string(),
      kind: z.enum(COMMENT_KINDS).describe("评论类型"),
      markdown: z.string().describe("第一行是一句话结论（不要用标题），空一行后写细节。结论、验收类要写验证命令和结果"),
      role: z.string().optional().describe("你在这个任务里的角色，例如 实现者、审查者。署名里的账号和客户端会自动填"),
    },
  },
  async ({ task, kind, markdown, role }) =>
    run(async () => {
      const g = checkOrReject(markdown, "comment", { commentKind: kind });
      if (!g.ok) return fail(g.report);
      const { project, item, key } = await resolveTask(task);
      const denied = await guardWrite(project.identifier);
      if (denied) return fail(denied);
      const signed = `**${kind}** · ${await signature(role)}\n\n${markdown.trim()}`;
      await plane.createComment(project.id, item.id, mdToHtml(signed));
      return text(`已在 ${key} 写入「${kind}」评论。${g.report ? `\n\n${g.report}` : ""}`);
    }),
);

server.registerTool(
  "search_tasks",
  {
    title: "搜索任务",
    description: "在整个工作区按关键词搜索任务",
    inputSchema: { query: z.string() },
    annotations: { readOnlyHint: true },
  },
  async ({ query }) =>
    run(async () => {
      const r = await plane.searchWorkItems(query);
      return text(r.issues.map((i) => `- ${i.project__identifier}-${i.sequence_id} ${i.name}`).join("\n") || "没有匹配的任务");
    }),
);

// ---------- 文档 ----------

server.registerTool(
  "list_docs",
  {
    title: "列出文档",
    description: "列出项目里的文档（Plane Page），可按关键词搜索标题和正文",
    inputSchema: { project: z.string(), search: z.string().optional() },
    annotations: { readOnlyHint: true },
  },
  async ({ project, search }) =>
    run(async () => {
      const p = await plane.resolveProject(project);
      const pages = await plane.listPages(p.id, search);
      return text(pages.map((d) => `- ${d.id}　${d.name}（更新于 ${d.updated_at.slice(0, 10)}）`).join("\n") || "没有文档");
    }),
);

server.registerTool(
  "read_doc",
  {
    title: "读取文档",
    description: "以 Markdown 读取一篇文档",
    inputSchema: { project: z.string(), doc_id: z.string() },
    annotations: { readOnlyHint: true },
  },
  async ({ project, doc_id }) =>
    run(async () => {
      const p = await plane.resolveProject(project);
      const d = await plane.getPage(p.id, doc_id).catch((e) => {
        if (e instanceof PlaneError && e.status === 404) throw new Error(`项目 ${p.identifier} 里没有文档 ${doc_id}，或者它是别人的私有文档。用 list_docs 查。`);
        throw e;
      });
      return text(`# ${d.name}\n\n链接：${webUrl(`projects/${p.id}/pages/${d.id}`)}\n\n${htmlToMd(d.description_html)}`);
    }),
);

server.registerTool(
  "write_doc",
  {
    title: "写文档",
    description:
      "新建或整篇更新一篇文档。不传 doc_id 是新建，传了是更新（按段落做增量合并，正在网页上打开的人会实时看到）。正文必须符合对应 type 的模板，写之前先 get_writing_guide。",
    inputSchema: {
      project: z.string(),
      type: z.enum(DOC_TYPES).describe("文档类型，决定检查哪个模板"),
      title: z.string(),
      markdown: z.string().describe("正文，从二级标题开始，不要写一级标题"),
      doc_id: z.string().optional(),
      parent_id: z.string().optional().describe("新建时挂在哪篇文档下面"),
      task: z.string().optional().describe("关联的任务编号，会在任务上加链接"),
    },
  },
  async ({ project, type, title, markdown, doc_id, parent_id, task }) =>
    run(async () => {
      const g = checkOrReject(markdown, type, { title });
      if (!g.ok) return fail(g.report);
      const p = await plane.resolveProject(project);
      const denied = await guardWrite(p.identifier);
      if (denied) return fail(denied);
      const html = mdToHtml(markdown);
      const d = doc_id
        ? await plane.updatePage(p.id, doc_id, { name: title, description_html: html })
        : await plane.createPage(p.id, title, html, parent_id);
      const url = webUrl(`projects/${p.id}/pages/${d.id}`);
      if (task) {
        const t = await resolveTask(task);
        await plane.addLink(t.project.id, t.item.id, url, `文档：${title}`).catch(() => undefined);
      }
      return text(
        `${doc_id ? "已更新" : "已新建"}文档「${title}」（${d.id}）：${url}${d.live_editing ? "\n有人正在网页上编辑这篇文档，改动已实时合并。" : ""}${g.report ? `\n\n${g.report}` : ""}`,
      );
    }),
);

server.registerTool(
  "link_doc",
  {
    title: "关联文档",
    description: "把已有文档关联到任务上（任务页的链接区会出现这篇文档）。任务交付时把设计、接口、复盘等文档都关联上。write_doc 传 task 时会自动关联，不用再调这个。",
    inputSchema: { task: z.string(), project: z.string().describe("文档所在项目"), doc_id: z.string() },
  },
  async ({ task, project, doc_id }) =>
    run(async () => {
      const t = await resolveTask(task);
      const denied = await guardWrite(t.project.identifier);
      if (denied) return fail(denied);
      const p = await plane.resolveProject(project);
      const d = await plane.getPage(p.id, doc_id);
      const url = webUrl(`projects/${p.id}/pages/${d.id}`);
      const links = await plane.listLinks(t.project.id, t.item.id).catch(() => []);
      if (links.some((l) => l.url === url)) return text(`${t.key} 已经关联了「${d.name}」。`);
      await plane.addLink(t.project.id, t.item.id, url, `文档：${d.name}`);
      return text(`已把「${d.name}」关联到 ${t.key}。`);
    }),
);

// ---------- 经验库 ----------

server.registerTool(
  "search_lessons",
  {
    title: "查经验",
    description: "按关键词和标签搜索经验：团队经验库里已采纳的，加上本机的私人经验。开始任务前先查一次。",
    inputSchema: {
      query: z.string().describe("关键词，空格分隔"),
      tags: z.array(z.string()).optional().describe("技术栈、项目、类型等标签"),
      include_pending: z.boolean().optional().describe("包含还在待审核的团队经验"),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ query, tags, include_pending }) =>
    run(async () => text(formatLessons(await searchLessons(plane, query, tags ?? [], { includePending: include_pending })))),
);

server.registerTool(
  "propose_lesson",
  {
    title: "提交经验",
    description:
      "沉淀一条经验。scope=team 提交到团队经验库的“待审核”，由人在 Plane 上决定采纳或驳回；scope=private 只存在本机。提交前应先征得用户同意。",
    inputSchema: {
      title: z.string().describe("一句话说清经验，例如“Django 迁移里不要直接 import 模型”"),
      markdown: z.string().describe("按经验模板：## 场景、## 做法，可选 ## 原因、## 来源"),
      tags: z.array(z.string()).min(1),
      scope: z.enum(["team", "private"]),
      source_task: z.string().optional().describe("来源任务编号"),
    },
  },
  async ({ title, markdown, tags, scope, source_task }) =>
    run(async () => {
      const md = source_task && !/##\s*来源/.test(markdown) ? `${markdown.trim()}\n\n## 来源\n\n${source_task}\n` : markdown;
      const g = checkOrReject(md, "lesson", { title });
      if (!g.ok) return fail(g.report);
      if (scope === "private") {
        const path = await savePrivateLesson(title, md, tags);
        return text(`已存为私人经验：${path}`);
      }
      const dirs = await currentDirs();
      const b = readBinding(dirs);
      if (!b) return fail(checkWritable(b, CONFIG.workspace, "LESSON", dirs)!);
      const r = await proposeTeamLesson(plane, title, md, tags);
      return text(`已提交团队经验 ${r.key}，状态“待审核”，需要人在 Plane 上采纳后才会被检索到：${webUrl(`browse/${r.key}`)}`);
    }),
);

// ---------- 回顾 ----------

server.registerTool(
  "review_digest",
  {
    title: "生成回顾",
    description:
      "扫一遍你加入的项目，列出等你决定、阻塞、待审查、长期没动的任务和待审核的经验。publish=true 时写成「每日回顾」项目里你当天的个人回顾（「回顾 日期 · 你的名字」，同一天重复执行会更新）。全员的团队回顾由 team-review 定时生成。",
    inputSchema: {
      stale_days: z.number().int().min(1).max(60).optional().describe("多少天没更新算“没动”，默认 3"),
      only_mine: z.boolean().optional().describe("只看指派给我或未指派的任务"),
      publish: z.boolean().optional().describe("写成 Plane 文档"),
    },
  },
  async ({ stale_days, only_mine, publish }) =>
    run(async () => {
      const opts = { staleDays: stale_days ?? 3, onlyMine: only_mine ?? false };
      if (!publish) return text((await buildDigest(plane, opts)).md);
      const r = await publishDigest(plane, { ...opts, webUrl });
      return text(`${r.updated ? "已更新" : "已发布"}「${r.title}」：${r.url}\n\n${r.md}`);
    }),
);

await server.connect(new StdioServerTransport());
