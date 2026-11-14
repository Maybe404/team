#!/usr/bin/env node
// team-mcp：团队协作 MCP。
// 任务和文档存在 Plane，经验库存在 Plane 的经验库项目（私人经验在本机），
// 所有写入都要先过规范闸门（norms），不合规的会被退回给调用方 Agent 修改。
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { formatLessons, proposeTeamLesson, savePrivateLesson, searchLessons } from "./lessons.ts";
import { htmlToMd, mdToHtml } from "./markdown.ts";
import { COMMENT_KINDS, formatGate, gate, TEMPLATES, templateGuide, WRITING_GUIDE, type DocType } from "./norms/index.ts";
import { Plane, type Project, type WorkItem } from "./plane.ts";
import { buildDigest } from "./review.ts";
import { agentCanSet, ensureStates, findState, HUMAN_ONLY_HINT, TASK_STATES } from "./workflow.ts";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`缺少环境变量 ${name}`);
  return v;
}

const plane = new Plane({
  baseUrl: process.env.PLANE_BASE_URL || "http://localhost:47800",
  token: requireEnv("PLANE_API_TOKEN"),
  workspace: requireEnv("PLANE_WORKSPACE"),
});
const WEB_URL = process.env.PLANE_WEB_URL || "http://localhost:47300";
const webUrl = (path: string) => `${WEB_URL.replace(/\/$/, "")}/${plane.workspace}/${path.replace(/^\//, "")}`;

const server = new McpServer(
  { name: "team-mcp", version: "0.1.0" },
  {
    instructions: `团队协作 MCP。任务、文档、经验都通过这里读写，不要绕过它直接改。
规则：
1. 写之前先读规范：资源 team://guide/writing，或调用 get_writing_guide。
2. 所有写入都会做规范检查，被退回时按提示逐条改完重交，不要换个说法绕过检查。
3. 动手做任务前先 search_lessons 查相关经验；任务结束后用 propose_lesson 提交新经验，团队经验需要人审核才会生效。
4. 状态“已完成”“已取消”只能由人设置；Agent 做完后把任务改成“待审查”并写一条“结论”评论。`,
  },
);

const DOC_TYPES = Object.keys(TEMPLATES) as [DocType, ...DocType[]];
const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const fail = (t: string) => ({ content: [{ type: "text" as const, text: t }], isError: true });

async function run(fn: () => Promise<ReturnType<typeof text>>) {
  try {
    return await fn();
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

function checkOrReject(md: string, type: DocType, opts: Parameters<typeof gate>[2] = {}) {
  const r = gate(md, type, opts);
  return { ok: r.ok, report: formatGate(r) };
}

async function resolveTask(ref: string): Promise<{ project: Project; item: WorkItem; key: string }> {
  const m = ref.trim().match(/^([A-Za-z][A-Za-z0-9]*)-(\d+)$/);
  if (!m) throw new Error(`任务编号格式是「项目标识-序号」，例如 DEMO-12，收到「${ref}」`);
  const project = await plane.resolveProject(m[1]);
  const item = await plane.getWorkItemByKey(`${project.identifier}-${m[2]}`);
  return { project, item, key: `${project.identifier}-${item.sequence_id}` };
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

// ---------- 项目 ----------

server.registerTool(
  "list_projects",
  { title: "列出项目", description: "列出工作区里的所有项目", annotations: { readOnlyHint: true } },
  async () =>
    run(async () => {
      const ps = await plane.listProjects();
      return text(ps.map((p) => `- ${p.identifier}：${p.name}${p.description ? `（${p.description}）` : ""}`).join("\n") || "没有项目");
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
    },
    annotations: { readOnlyHint: true },
  },
  async ({ project, states, include_closed, search }) =>
    run(async () => {
      const p = await plane.resolveProject(project);
      const [items, st] = await Promise.all([plane.listWorkItems(p.id), plane.listStates(p.id)]);
      const byId = new Map(st.map((s) => [s.id, s]));
      const rows = items
        .filter((i) => {
          const s = byId.get(i.state);
          if (!include_closed && (s?.group === "completed" || s?.group === "cancelled")) return false;
          if (states?.length && !states.includes(s?.name ?? "")) return false;
          if (search && !i.name.toLowerCase().includes(search.toLowerCase())) return false;
          return true;
        })
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .map((i) => `- ${p.identifier}-${i.sequence_id} [${byId.get(i.state)?.name ?? "?"}] ${i.name}（更新于 ${i.updated_at.slice(0, 10)}）`);
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
      const [st, cs] = await Promise.all([plane.listStates(project.id), plane.listComments(project.id, item.id)]);
      const state = st.find((s) => s.id === item.state)?.name ?? "?";
      const timeline = cs
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .slice(-(comments ?? 20))
        .map((c) => `### ${c.created_at.slice(0, 16).replace("T", " ")}\n\n${htmlToMd(c.comment_html)}`)
        .join("\n\n");
      return text(
        `# ${key} ${item.name}\n\n状态：${state}　优先级：${item.priority}　链接：${webUrl(`browse/${key}`)}\n\n${htmlToMd(item.description_html) || "（无描述）"}\n\n## 评论（${cs.length}）\n\n${timeline || "无"}`,
      );
    }),
);

server.registerTool(
  "create_task",
  {
    title: "新建任务",
    description: "新建任务。描述必须符合任务模板（## 目标、## 验收标准）。建任务前建议先 search_lessons，把相关经验写进「相关」章节。",
    inputSchema: {
      project: z.string(),
      title: z.string().min(4),
      description: z.string().describe("Markdown，按任务模板"),
      priority: z.enum(["urgent", "high", "medium", "low", "none"]).optional(),
      state: z.string().optional().describe("初始状态，默认“待开始”"),
    },
  },
  async ({ project, title, description, priority, state }) =>
    run(async () => {
      const g = checkOrReject(description, "task", { title });
      if (!g.ok) return fail(g.report);
      const p = await plane.resolveProject(project);
      const st = await plane.listStates(p.id);
      const target = state ?? "待开始";
      if (!agentCanSet(target)) return fail(HUMAN_ONLY_HINT);
      const item = await plane.createWorkItem(p.id, {
        name: title,
        description_html: mdToHtml(description),
        priority: priority ?? "none",
        state: findState(st, target).id,
      });
      const key = `${p.identifier}-${item.sequence_id}`;
      return text(`已新建 ${key}：${webUrl(`browse/${key}`)}${g.report ? `\n\n${g.report}` : ""}`);
    }),
);

server.registerTool(
  "update_task",
  {
    title: "更新任务",
    description: `改任务的状态、标题、描述或优先级。Agent 可设的状态：${TASK_STATES.filter((s) => s.agentCanSet).map((s) => s.name).join("、")}。“已完成”“已取消”只能由人设置。改状态时请同时用 comment_task 写明原因。`,
    inputSchema: {
      task: z.string(),
      state: z.string().optional(),
      title: z.string().optional(),
      description: z.string().optional().describe("完整的新描述（Markdown），会整体替换"),
      priority: z.enum(["urgent", "high", "medium", "low", "none"]).optional(),
    },
  },
  async ({ task, state, title, description, priority }) =>
    run(async () => {
      const { project, item, key } = await resolveTask(task);
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
      if (!Object.keys(body).length) return fail("没有要改的字段");
      await plane.updateWorkItem(project.id, item.id, body);
      return text(`已更新 ${key}${state ? `，状态改为「${state}」` : ""}。${notes.length ? `\n\n${notes.join("\n")}` : ""}`);
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
      markdown: z.string(),
      author: z.string().optional().describe("署名，例如“实现者 · claude-code/opus”。默认 Agent"),
    },
  },
  async ({ task, kind, markdown, author }) =>
    run(async () => {
      const g = checkOrReject(markdown, "comment", { commentKind: kind });
      if (!g.ok) return fail(g.report);
      const { project, item, key } = await resolveTask(task);
      const signed = `**${kind}** · ${author ?? "Agent"}\n\n${markdown.trim()}`;
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
      const d = await plane.getPage(p.id, doc_id);
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
      const r = await proposeTeamLesson(plane, title, md, tags);
      return text(`已提交团队经验 ${r.key}，状态“待审核”，需要人在 Plane 上采纳后才会被检索到：${webUrl(`browse/${r.key}`)}`);
    }),
);

// ---------- 回顾 ----------

server.registerTool(
  "review_digest",
  {
    title: "生成回顾",
    description: "扫一遍所有项目，列出等你决定、阻塞、待审查、长期没动的任务和待审核的经验。适合每天跑一次。",
    inputSchema: {
      stale_days: z.number().int().min(1).max(60).optional().describe("多少天没更新算“没动”，默认 3"),
      only_mine: z.boolean().optional().describe("只看指派给我或未指派的任务"),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ stale_days, only_mine }) =>
    run(async () => text((await buildDigest(plane, { staleDays: stale_days ?? 3, onlyMine: only_mine ?? false })).md)),
);

await server.connect(new StdioServerTransport());
