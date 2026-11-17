// team-mcp：团队协作 MCP 的服务定义（stdio 和 HTTP 两种入口共用）。
// 任务和文档存在 Loom，经验库存在 Loom 的经验库项目（私人经验在本机），
// 所有写入都要先过规范闸门（norms），不合规的会被退回给调用方 Agent 修改。
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Config } from "./config.ts";
import { matchProjects, normalizeRepoUrl, notBoundMessage, repoRemotes, workDirs, type RepoScope } from "./binding.ts";
import { z } from "zod";
import { formatLessons, GENERAL, proposeTeamLesson, savePrivateLesson, searchLessons } from "./lessons.ts";
import { parseTaskKey } from "./taskKey.ts";
import { htmlToMd, importInlineImages, mdToHtml } from "./markdown.ts";
import { COMMENT_KINDS, formatGate, gate, gatePlain, LESSON_GUIDE, SELF_CHECK, TEMPLATES, templateGuide, WRITING_GUIDE, type DocType } from "./norms/index.ts";
import { Loom, PlaneError, type Member, type Module, type Project, type View, type WorkItem } from "./plane.ts";
import { fullToneReport, SKILL_DIR } from "./norms/tone.ts";
import { buildDigest, publishDigest } from "./review.ts";
import { usageGuide } from "./usage.ts";
import { agentCanSet, findState, HUMAN_ONLY_HINT, TASK_STATES } from "./workflow.ts";

export const VERSION = (JSON.parse(readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8")) as { version: string }).version;

export type Env = {
  config: Config;
  plane: Loom;
  /** true：本机 stdio 进程，能读本地目录的 git remote；false：远程 HTTP 服务，靠调用方传 repo 参数 */
  local: boolean;
  /** 远程无状态服务拿不到 initialize 里的客户端名，用 User-Agent 的产品名代替（如 claude-code） */
  clientName?: string;
};

const REPO_PARAM = z
  .string()
  .optional()
  .describe("当前仓库 git remote get-url origin 的输出，每次都带");
const NO_REPO = new Set(["get_guide", "check_text"]);
const WRITE_TOOLS = new Set(["create_task", "update_task", "comment_task", "write_doc", "propose_lesson", "save_module", "save_view"]);

export function createServer({ config: CONFIG, plane, local, clientName }: Env) {

// 没配置或 Token 失效时不让进程崩掉，而是在每次调用时告诉使用者怎么配
function setupGuide(reason: string) {
  const web = CONFIG.webUrl.replace(/\/$/, "");
  return `${reason}

首次使用按下面做（每个人用自己的账号和 Token，Loom 上的操作会记在你名下）：
1. 请管理员在 ${web} 的工作区设置里邀请你的邮箱，你用这个邮箱注册并接受邀请。
2. 打开 ${web}/settings/profile/api-tokens 新建一个 API Token，页面上会显示带好 Token 的添加命令。
3. 在终端执行那条命令（或在 Agent 的 MCP 设置里按页面上的字段手动添加），然后重启 Agent。
4. 调用 whoami 确认。`;
}
const webUrl = (path: string) => plane.webUrl(path);

const server = new McpServer(
  { name: "loom", version: VERSION },
  {
    instructions: `团队协作 MCP。任务、文档、经验都通过这里读写，不要绕过它直接改。
规则：
1. 第一次写入前读一次规范（get_guide topic=writing），同一次对话里读过就不用再读；不合规的写入会被退回并说明原因。
2. 去 AI 味：页面、任务描述、评论、经验这四类写入，落笔前都要按「去 AI 味」的规则写，写完先用 check_text 预检，按提示改；整篇 500 汉字以上的页面再用 analyze_tone 出整篇报告，按报告改写后再写入。写入时服务端还会再检查一遍，被退回时逐条改完重交，不要换个说法绕过检查。
3. 只做团队工作时使用。每次调用工具都要把当前仓库的 git remote 地址（git remote get-url origin 的输出）填进 repo 参数，不在 git 仓库里就省略。项目分两类：登记了代码仓库的项目（项目管理员在 Loom「项目设置 → 关联代码仓库」登记），只能在对应仓库里读写；没登记仓库的项目（文档、运营、设计等不对应代码的项目），在任何目录里都能读写，用 project 参数指定。读写不了时按提示办，不要换项目或填别的仓库地址来蒙混。
4. 团队任务动手前先 search_lessons 查相关经验，结束后经用户同意用 propose_lesson 提交新经验，团队经验需要人审核才会生效。
5. 状态“已完成”“已取消”只能由人设置；Agent 做完后用 update_task 改成“待审查”，同时在 comment 里写带证据的结论。
6. 只写团队工作。个人笔记、密钥和个人信息不要写进来。
7. 没有删除、成员管理、项目设置类工具，这些由人在网页上做；不再需要的内容由人在网页上归档。
8. 这里的内容由 Agent 写、人来看：写法以人能一眼看懂、能核验为准，标题讲结论，结构清楚，证据写全。提交经验前先读 get_guide（topic=lessons），只提值得沉淀的，宁缺毋滥。
9. 别人的工作项和文档只能评论，不能改（创建人、指派人、作者、管理员才能改）；别人建的模块只能查看（创建人、负责人、管理员才能改），但可以把任务放进模块；被拒绝时用 comment_task 提建议，不要换个办法硬改。写交付文档时用 write_doc 的 task 参数或 link_doc 把它关联到任务。
10. 项目里按版本或需求整理任务用模块：建任务前先 list_modules，有合适的放进去（create_task、update_task 的 modules 参数），没有再 save_module 新建；用户想经常看某种筛选时用 save_view 建视图。
11. 用户不熟悉这个产品，或问到周期、模块、视图、页面该怎么用时，先调用 get_guide（topic=usage），按里面的说明引导，并明确告诉用户哪些要去网页上操作。`,
  },
);

// 给除规范类以外的工具统一加 repo 参数，并在调用前记下来，供仓库范围判断使用。
// 每个 HTTP 请求都新建一个 server，所以这个变量不会跨请求串。
let repoArg: string | undefined;
const register = server.registerTool.bind(server) as unknown as (name: string, cfg: Record<string, unknown>, cb: (...a: unknown[]) => unknown) => unknown;
(server as unknown as { registerTool: typeof register }).registerTool = (name, cfg, cb) => {
  if (NO_REPO.has(name)) return register(name, cfg, cb);
  // 写入类工具的说明里带上自检清单：代码检查之外，让 Agent 提交前自己也过一遍
  if (WRITE_TOOLS.has(name)) cfg = { ...cfg, description: `${cfg.description ?? ""}\n${SELF_CHECK}` };
  return register(name, { ...cfg, inputSchema: { ...((cfg.inputSchema as object) ?? {}), repo: REPO_PARAM } }, (args, extra) => {
    repoArg = (args as { repo?: string })?.repo;
    return cb(args, extra);
  });
};

const DOC_TYPES = Object.keys(TEMPLATES) as [DocType, ...DocType[]];
const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const fail = (t: string) => ({ content: [{ type: "text" as const, text: t }], isError: true });

async function run(fn: () => Promise<ReturnType<typeof text>>) {
  if (!CONFIG.token || !CONFIG.workspace) {
    return fail(setupGuide(`Loom MCP 还没配置：缺少 ${[!CONFIG.token && "PLANE_API_TOKEN", !CONFIG.workspace && "PLANE_WORKSPACE"].filter(Boolean).join("、")}。`));
  }
  try {
    return await fn();
  } catch (e) {
    if (e instanceof PlaneError && (e.status === 401 || /token is not valid|credentials were not provided/i.test(e.body)))
      return fail(setupGuide("Loom 拒绝了这个 API Token（401），可能已被删除或填错。"));
    if (e instanceof PlaneError && e.status === 400 && /Modules are not enabled/.test(e.body))
      return fail("这个项目没有开启「模块」功能，需要项目管理员在网页上打开：项目设置 → 功能 → 模块。");
    if (e instanceof PlaneError && e.status === 400 && /没有开启/.test(e.body))
      return fail(e.body.match(/"error"\s*:\s*"([^"]+)"/)?.[1] ?? "这个项目没有开启对应功能，请项目管理员在项目设置 → 功能 里打开。");
    if (e instanceof PlaneError && e.status === 403 && /只能评论|只能阅读|只能查看|建立关联/.test(e.body)) {
      const m = e.body.match(/"(?:detail|error)"\s*:\s*"([^"]+)"/);
      return fail(`${m?.[1] ?? "没有权限"}\n想改别人的内容，可以用 comment_task 评论，提出修改建议。`);
    }
    if (e instanceof PlaneError && e.status === 403 && /^GET workspaces\/[^/]+\/projects\/$/.test(e.path.replace(/^GET /, "GET ").split("?")[0]))
      return fail(`这个 Token 对应的账号不是工作区「${CONFIG.workspace}」的有效成员（或工作区名填错了），连项目列表都读不了。请确认：1) PLANE_WORKSPACE 是否正确；2) 管理员在「工作区设置 → 成员」里能看到这个账号且未被停用；3) Token 是不是这个账号自己生成的。可以先调用 whoami 看当前身份。`);
    if (e instanceof PlaneError && e.status === 403) return fail(`没有权限：${e.path}。${/API Token/.test(e.body) ? "Agent 不能做这类操作，请由人在网页上完成。" : "这个操作需要更高的项目角色，请找项目管理员。"}`);
    if (e instanceof TypeError && /fetch failed/.test(e.message)) return fail(`连不上 Loom（${CONFIG.baseUrl}）。确认服务已启动、PLANE_BASE_URL 正确。`);
    if (e instanceof NotBound) return fail(e.message);
    return fail(e instanceof Error ? e.message : String(e));
  }
}

// 署名绑定到 Token 对应的账号和调用方客户端：「实现者 · bob 的 claude-code」
let meCache: Promise<{ display_name: string }> | undefined;
async function signature(role?: string) {
  const me = await (meCache ??= plane.me());
  const client = server.server.getClientVersion()?.name || clientName || "Agent";
  return [role?.trim(), `${me.display_name} 的 ${client}`].filter(Boolean).join(" · ");
}

const STATE_COMMENT_KIND: Record<string, (typeof COMMENT_KINDS)[number]> = { 待审查: "结论", 阻塞: "阻塞", 待决定: "决策" };

/** 对人展示的名字：优先姓名，其次显示名；不显示编号和邮箱 */
const personName = (m: Pick<Member, "display_name" | "first_name" | "last_name">) =>
  `${m.first_name ?? ""}${m.last_name ?? ""}`.trim() ? `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim() : m.display_name;
const nameMap = (members: Member[]) => new Map(members.map((m) => [m.id, personName(m)]));
const memberName = (m: Member) => personName(m);

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
      `${hit.length ? `「${ref}」匹配到多个成员，请用邮箱区分` : `项目里没有成员「${ref}」`}。项目成员：${members.map(memberName).join("、") || "无"}`,
    );
  });
}

function checkOrReject(md: string, type: DocType, opts: Parameters<typeof gate>[2] = {}) {
  const r = gate(md, type, opts);
  // 被退回时再提醒一次自检：代码只能查规则，语义和可读性要 Agent 自己把关
  return { ok: r.ok, report: r.ok ? formatGate(r) : `${formatGate(r)}\n\n${SELF_CHECK}` };
}

async function resolveTask(ref: string, mode: "read" | "write" = "read"): Promise<{ project: Project; item: WorkItem; key: string }> {
  const m = parseTaskKey(ref);
  if (!m) {
    let eg = "DEMO-12";
    try {
      const first = (await plane.listProjects()).find((p) => p.is_member !== false);
      if (first) eg = `${first.identifier}-12`;
    } catch {
      /* 取不到项目就用默认示例 */
    }
    throw new Error(`任务编号格式是「项目标识-序号」，例如 ${eg}，收到「${ref}」。编号可以用 list_tasks 查到。`);
  }
  const project = await projectFor(m.identifier, mode);
  const item = await plane.getWorkItemByKey(`${project.identifier}-${m.seq}`).catch((e) => {
    if (e instanceof PlaneError && e.status === 404) throw new Error(`找不到任务 ${project.identifier}-${m.seq}。可以用 list_tasks 查编号。`);
    throw e;
  });
  return { project, item, key: `${project.identifier}-${item.sequence_id}` };
}


// ---------- 模块、周期、视图 ----------

const MODULE_STATUS: Record<string, string> = {
  backlog: "未排期",
  planned: "已计划",
  "in-progress": "进行中",
  paused: "已暂停",
  completed: "已完成",
  cancelled: "已取消",
};
const MODULE_STATUS_BY_NAME = Object.fromEntries(Object.entries(MODULE_STATUS).map(([k, v]) => [v, k]));
// 和任务一样，“已完成”“已取消”是人的决定
const HUMAN_ONLY_MODULE_STATUS = new Set(["已完成", "已取消"]);

/** 按 ID、名称（忽略大小写）或唯一的名称片段找一项，找不到或有歧义时报出现有的名字。 */
function pickByName<T extends { id: string; name: string }>(list: T[], ref: string, what: string, hint = ""): T {
  const r = ref.trim();
  const k = r.toLowerCase();
  const hit = list.find((x) => x.id === r) ?? list.find((x) => x.name.toLowerCase() === k);
  if (hit) return hit;
  const like = list.filter((x) => x.name.toLowerCase().includes(k));
  if (like.length === 1) return like[0];
  throw new Error(
    `${like.length ? `「${ref}」匹配到多个${what}，请写完整名称` : `项目里没有${what}「${ref}」`}。现有${what}：${list.map((x) => x.name).join("、") || "无"}。${hint}`,
  );
}

const NO_MODULE_HINT = "要新建模块用 save_module。";

/** 项目里各模块包含哪些工作项（模块数量有限，逐个取一次）。 */
async function moduleIndex(projectId: string) {
  const modules = await plane.listModules(projectId);
  const members = new Map<string, Set<string>>();
  await Promise.all(
    modules.slice(0, 40).map(async (m) => members.set(m.id, new Set(await plane.listModuleIssueIds(projectId, m.id)))),
  );
  const namesOf = (issueId: string) => modules.filter((m) => members.get(m.id)?.has(issueId)).map((m) => m.name);
  return { modules, members, namesOf };
}

const FILTER_FIELDS = z
  .object({
    states: z.array(z.string()).optional().describe("状态名，例如 [\"进行中\",\"阻塞\"]"),
    state_groups: z.array(z.enum(["backlog", "unstarted", "started", "completed", "cancelled"])).optional(),
    assignees: z.array(z.string()).optional().describe("me、邮箱或显示名"),
    priorities: z.array(z.enum(["urgent", "high", "medium", "low", "none"])).optional(),
    labels: z.array(z.string()).optional().describe("标签名"),
    modules: z.array(z.string()).optional().describe("模块名"),
    cycles: z.array(z.string()).optional().describe("周期名"),
  })
  .describe("视图的筛选条件，各项之间是“并且”，同一项里的多个值是“或者”");
type ViewFilters = z.infer<typeof FILTER_FIELDS>;

async function buildRichFilters(p: Project, f: ViewFilters) {
  const conds: Record<string, string>[] = [];
  const add = (key: string, ids: string[]) => ids.length && conds.push({ [`${key}__in`]: ids.join(",") });
  if (f.states?.length) {
    const st = await plane.listStates(p.id);
    add("state_id", f.states.map((n) => findState(st, n).id));
  }
  if (f.state_groups?.length) add("state_group", f.state_groups);
  if (f.assignees?.length) add("assignee_id", (await resolveMembers(p.id, f.assignees)).map((m) => m.id));
  if (f.priorities?.length) add("priority", f.priorities);
  if (f.labels?.length) {
    const labels = await plane.listLabels(p.id);
    add("label_id", f.labels.map((n) => pickByName(labels, n, "标签").id));
  }
  if (f.modules?.length) {
    const modules = await plane.listModules(p.id);
    add("module_id", f.modules.map((n) => pickByName(modules, n, "模块", NO_MODULE_HINT).id));
  }
  if (f.cycles?.length) {
    const cycles = await plane.listCycles(p.id);
    add("cycle_id", f.cycles.map((n) => pickByName(cycles, n, "周期", "周期只能在网页上建。").id));
  }
  return conds.length ? { and: conds } : {};
}

/** 把视图里存的筛选条件翻成人能看懂的一句话。 */
async function describeFilters(p: Project, v: View): Promise<string> {
  const conds = (v.rich_filters as { and?: Record<string, string>[] }).and ?? (Object.keys(v.rich_filters).length ? [v.rich_filters as Record<string, string>] : []);
  if (!conds.length) return "无筛选（全部工作项）";
  const [st, members, labels, modules, cycles] = await Promise.all([
    plane.listStates(p.id),
    plane.listProjectMembers(p.id),
    plane.listLabels(p.id),
    plane.listModules(p.id).catch(() => []),
    plane.listCycles(p.id).catch(() => []),
  ]);
  const name = (list: { id: string; name: string }[], id: string) => list.find((x) => x.id === id)?.name ?? id;
  const LABEL: Record<string, [string, (id: string) => string]> = {
    state_id: ["状态", (id) => name(st, id)],
    state_group: ["状态组", (id) => id],
    assignee_id: ["负责人", (id) => nameMap(members).get(id) ?? "未知成员"],
    priority: ["优先级", (id) => id],
    label_id: ["标签", (id) => name(labels, id)],
    module_id: ["模块", (id) => name(modules, id)],
    cycle_id: ["周期", (id) => name(cycles, id)],
  };
  return conds
    .map((c) =>
      Object.entries(c)
        .map(([k, val]) => {
          const [field, op] = k.split("__");
          const [label, fmt] = LABEL[field] ?? [field, (x: string) => x];
          return `${label}${op === "in" || op === "exact" ? "是" : `（${op}）`} ${String(val).split(",").map(fmt).join(" 或 ")}`;
        })
        .join("，"),
    )
    .join("；并且 ");
}

// ---------- 仓库范围 ----------
// 当前仓库的 git remote 对上了哪些项目的“关联代码仓库”，Agent 就只能读写这些项目；
// 经验库和每日回顾是全员共享的，只要当前仓库属于某个团队项目就能读，经验只能经 propose_lesson 提交。

class NotBound extends Error {}

const SHARED = [process.env.TEAM_LESSONS_PROJECT || "LESSON", process.env.TEAM_REVIEW_PROJECT || "REVIEW"].map((x) => x.toUpperCase());

async function repoScope(): Promise<RepoScope & { all: Project[]; open: Project[] }> {
  let dirs: string[] = [];
  let remotes: string[] = [];
  if (local) {
    const caps = server.server.getClientCapabilities();
    dirs = await workDirs(caps?.roots ? () => server.server.listRoots() : undefined);
    remotes = dirs.flatMap(repoRemotes);
  }
  // 调用方传来的 repo：可以有多个，用空白或逗号分开
  remotes = [...new Set([...remotes, ...(repoArg ?? "").split(/[\s,]+/).filter(Boolean).map(normalizeRepoUrl)])];
  const all = await plane.listProjects();
  // 没登记代码仓库的项目（文档、运营、设计这类不对应代码仓库的项目）不受仓库限制，在任何目录里用 project 参数指定即可
  const open = all.filter((p) => p.is_member !== false && !(p.team_repos ?? []).length && !SHARED.includes(p.identifier.toUpperCase()));
  return { dirs, remotes, projects: matchProjects(all, remotes).filter((p) => p.is_member !== false), all, open };
}

/**
 * 能用的项目 = 当前仓库对上的项目（matched）+ 没登记仓库的项目（open）。
 * 一个都没有时抛 NotBound。projects 是两者合并，供经验检索、回顾等按“能用的项目”过滤。
 */
async function boundProjects(): Promise<{ projects: Project[]; matched: Project[]; open: Project[]; shared: Project[] }> {
  const sc = await repoScope();
  if (!sc.projects.length && !sc.open.length) {
    const unjoined = matchProjects(sc.all, sc.remotes).filter((p) => p.is_member === false);
    if (unjoined.length) {
      throw new NotBound(`当前仓库关联的是 ${unjoined.map((p) => `${p.identifier}（${p.name}）`).join("、")}，但你还不是成员。请项目管理员在网页上把你加进项目。`);
    }
    throw new NotBound(notBoundMessage(sc, CONFIG.webUrl, local));
  }
  const shared = sc.all.filter((p) => SHARED.includes(p.identifier.toUpperCase()) && p.is_member !== false);
  return { projects: [...sc.projects, ...sc.open], matched: sc.projects, open: sc.open, shared };
}

/**
 * 选项目：
 * - 不传：当前仓库关联的唯一项目；没有关联项目时，如果只有一个不绑定仓库的项目就用它，多个则要求用 project 指定。
 * - 传了：必须是当前仓库关联的项目，或不绑定仓库的项目。绑定了别的仓库的项目在这里不能读写。
 * mode=read 时也允许经验库、每日回顾这两个共享项目。
 */
async function projectFor(ref: string | undefined, mode: "read" | "write" = "write"): Promise<Project> {
  const { projects, matched, open, shared } = await boundProjects();
  const pool = mode === "read" ? [...projects, ...shared] : projects;
  const fmt = (l: Project[]) => l.map((p) => `${p.identifier}（${p.name}）`).join("、");
  if (!ref) {
    if (matched.length === 1) return matched[0];
    if (matched.length > 1) throw new Error(`当前仓库关联了多个项目：${fmt(matched)}。请用 project 参数指定一个。`);
    if (open.length === 1) return open[0];
    throw new Error(`当前仓库没有关联项目。请用 project 参数指定一个不绑定代码仓库的项目：${fmt(open)}。`);
  }
  const key = ref.trim().toLowerCase();
  const hit = pool.find((p) => p.id === ref || p.identifier.toLowerCase() === key || p.name.toLowerCase() === key);
  if (!hit) {
    const reach = `${fmt(projects)}${mode === "read" && shared.length ? `，以及共享的 ${shared.map((p) => p.identifier).join("、")}` : ""}`;
    throw new Error(
      `没有「${ref}」可用。这里能${mode === "read" ? "读写" : "写入"}：${reach}。如果它绑定了别的代码仓库，要到那个仓库里用；如果它不对应代码仓库，请项目管理员在「项目设置 → 关联代码仓库」里把地址清空。`,
    );
  }
  return hit;
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
  "team-usage",
  { title: "产品使用指南", description: "任务、页面、周期、模块、视图、经验库分别怎么用，哪些要去网页上做" },
  () => ({ messages: [{ role: "user", content: { type: "text", text: `${usageGuide(CONFIG.webUrl, CONFIG.workspace)}\n\n按上面的指南，结合我当前的情况，告诉我该怎么用。` } }] }),
);

server.registerPrompt(
  "team-lessons",
  { title: "哪些内容该沉淀为经验", description: "经验库的收录标准、怎么写、怎么归属项目" },
  () => ({ messages: [{ role: "user", content: { type: "text", text: `${LESSON_GUIDE}\n\n按上面的标准，判断刚才这次工作里有没有值得沉淀的经验。有的话先告诉我理由，我同意再提交。` } }] }),
);

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
    argsSchema: { doc: z.string().describe("要清理的文档：Loom 文档 ID，或直接贴正文") },
  },
  ({ doc }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `${readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8")}\n\n---\n\n按上面的 skill 处理这篇文档：${doc}\n\n脚本检测用 Loom MCP 的 analyze_tone 工具代替 \`python3 scripts/detect.py\`；语义层判据读资源 team://skills/less-ai-tone/semantic-criteria。先交付改前报告，等我回复再改。`,
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
      project: z.string().optional().describe("读取 Loom 文档时的项目，默认当前仓库关联的项目"),
      doc_id: z.string().optional().describe("读取 Loom 文档时的文档 ID"),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ markdown, project, doc_id }) =>
    run(async () => {
      let md = markdown;
      if (!md && doc_id) {
        const p = await projectFor(project, "read");
        md = htmlToMd((await plane.getPage(p.id, doc_id)).description_html);
      }
      if (!md) return fail("传 markdown，或者 doc_id（可加 project）");
      const file = join(mkdtempSync(join(tmpdir(), "team-tone-")), "doc.md");
      writeFileSync(file, md, "utf8");
      try {
        return text(fullToneReport(md, file));
      } finally {
        rmSync(dirname(file), { recursive: true, force: true });
      }
    }),
);

server.registerResource("usage-guide", "team://guide/usage", { title: "产品使用指南", mimeType: "text/markdown" }, async (uri) => ({
  contents: [{ uri: uri.href, mimeType: "text/markdown", text: usageGuide(CONFIG.webUrl, CONFIG.workspace) }],
}));

server.registerResource("lesson-guide", "team://guide/lessons", { title: "哪些内容该沉淀为经验", mimeType: "text/markdown" }, async (uri) => ({
  contents: [{ uri: uri.href, mimeType: "text/markdown", text: LESSON_GUIDE }],
}));

server.registerTool(
  "get_guide",
  {
    title: "读取指南",
    description:
      "按需读取指南，不要一次全读。writing=写作规范（第一次写入前读，传 type 附该类文档模板）；lessons=哪些内容该沉淀为经验（提交经验前读）；usage=任务、页面、周期、模块、视图怎么用（用户问怎么用或不熟悉产品时读）。",
    inputSchema: {
      topic: z.enum(["writing", "lessons", "usage"]),
      type: z.enum(DOC_TYPES).optional().describe("topic=writing 时可选：文档类型，附上模板"),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ topic, type }) =>
    text(
      topic === "lessons"
        ? LESSON_GUIDE
        : topic === "usage"
          ? usageGuide(CONFIG.webUrl, CONFIG.workspace)
          : type
            ? `${WRITING_GUIDE}\n\n${templateGuide(type)}`
            : WRITING_GUIDE,
    ),
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
    title: "当前账号和仓库",
    description: "确认 Loom MCP 连的是哪个 Loom、以哪个账号操作，以及当前仓库关联了哪些团队项目。首次使用或报错时先调用它。",
    annotations: { readOnlyHint: true },
  },
  async () =>
    run(async () => {
      const [me, sc] = await Promise.all([plane.me(), repoScope()]);
      const unjoined = matchProjects(sc.all, sc.remotes).filter((p) => p.is_member === false);
      const fmt = (l: Project[]) => l.map((p) => `${p.identifier}（${p.name}）`).join("、");
      const openNote = sc.open.length ? `；不绑定代码仓库的项目（任何目录里用 project 参数指定）：${fmt(sc.open)}` : "";
      const repo = sc.projects.length
        ? `已关联 ${fmt(sc.projects)}，可以读写${openNote}`
        : sc.open.length
          ? `当前仓库没有关联项目${openNote}`
        : unjoined.length
          ? `关联的是 ${unjoined.map((p) => p.identifier).join("、")}，但你还不是成员，请项目管理员在网页上把你加进项目`
          : `未关联。${notBoundMessage(sc, CONFIG.webUrl, local)}`;
      return text(
        `账号：${me.display_name}（${me.email}）\n工作区：${CONFIG.workspace}\nLoom：${CONFIG.webUrl}${local ? `（API ${CONFIG.baseUrl}）` : ""}\nLoom MCP：${VERSION}（${local ? "本机" : "远程"}）\n仓库：${sc.remotes.join("、") || "未提供"}\n团队项目：${repo}\n不熟悉怎么用？调用 get_guide（topic=usage）看任务、页面、周期、模块、视图的用法。`,
      );
    }),
);

// ---------- 项目 ----------

// ---------- 任务 ----------

server.registerTool(
  "list_tasks",
  {
    title: "列出任务",
    description:
      "列出某个项目的任务，可按状态、模块、周期、负责人过滤，每条任务后面会标出所属模块。默认不含已完成和已取消。按版本或需求看任务时，先用 list_modules 看有哪些模块，再用 module 过滤。",
    inputSchema: {
      project: z.string().optional().describe("项目标识，默认当前仓库关联的项目"),
      states: z.array(z.string()).optional().describe("只看这些状态，例如 [\"进行中\",\"阻塞\"]"),
      include_closed: z.boolean().optional(),
      search: z.string().optional().describe("标题关键词"),
      assignee: z.string().optional().describe("只看指派给某人的：me、邮箱或显示名"),
      module: z.string().optional().describe("只看这个模块里的任务：模块名或 ID，可用 list_modules 查"),
      cycle: z.string().optional().describe("只看这个周期里的任务：周期名或 ID（周期在网页上建）"),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ project, states, include_closed, search, assignee, module, cycle }) =>
    run(async () => {
      const p = await projectFor(project, "read");
      const [items, st, members, mi] = await Promise.all([
        plane.listWorkItems(p.id),
        plane.listStates(p.id),
        plane.listProjectMembers(p.id),
        moduleIndex(p.id).catch(() => undefined),
      ]);
      let inModule: Set<string> | undefined;
      if (module) {
        const m = pickByName(mi?.modules ?? [], module, "模块", NO_MODULE_HINT);
        inModule = mi?.members.get(m.id) ?? new Set();
      }
      let inCycle: Set<string> | undefined;
      if (cycle) {
        const c = pickByName(await plane.listCycles(p.id), cycle, "周期", "周期只能在网页上建。");
        inCycle = new Set(await plane.listCycleIssueIds(p.id, c.id));
      }
      const byId = new Map(st.map((s) => [s.id, s]));
      const names = nameMap(members);
      const who = assignee ? (await resolveMembers(p.id, [assignee]))[0].id : undefined;
      const rows = items
        .filter((i) => {
          const s = byId.get(i.state);
          if (!include_closed && (s?.group === "completed" || s?.group === "cancelled")) return false;
          if (states?.length && !states.includes(s?.name ?? "")) return false;
          if (search && !i.name.toLowerCase().includes(search.toLowerCase())) return false;
          if (who && !i.assignees.includes(who)) return false;
          if (inModule && !inModule.has(i.id)) return false;
          if (inCycle && !inCycle.has(i.id)) return false;
          return true;
        })
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .map((i) => {
          const people = i.assignees.map((a) => names.get(a) ?? "未知成员").join("、");
          const mods = mi?.namesOf(i.id) ?? [];
          return `- ${p.identifier}-${i.sequence_id} [${byId.get(i.state)?.name ?? "?"}] ${i.name}（${people ? `${people}，` : ""}${mods.length ? `模块：${mods.join("、")}，` : ""}更新于 ${i.updated_at.slice(0, 10)}）`;
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
      const [st, cs, members, links, pages, all, mi] = await Promise.all([
        plane.listStates(project.id),
        plane.listComments(project.id, item.id),
        plane.listProjectMembers(project.id),
        plane.listLinks(project.id, item.id).catch(() => []),
        plane.listIssuePages(project.id, item.id).catch(() => []),
        plane.listWorkItems(project.id),
        moduleIndex(project.id).catch(() => undefined),
      ]);
      const itemModules = mi?.namesOf(item.id) ?? [];
      const state = st.find((s) => s.id === item.state)?.name ?? "?";
      const stateName = new Map(st.map((s) => [s.id, s.name]));
      const names = nameMap(members);
      const parent = item.parent ? all.find((i) => i.id === item.parent) : undefined;
      const children = all.filter((i) => i.parent === item.id).sort((a, b) => a.sequence_id - b.sequence_id);
      const meta = [
        `指派：${item.assignees.map((a) => names.get(a) ?? "未知成员").join("、") || "无"}`,
        parent ? `父任务：${project.identifier}-${parent.sequence_id} ${parent.name}` : "",
        `模块：${itemModules.join("、") || "无"}`,
      ].filter(Boolean).join("　");
      const extra = [
        children.length
          ? `## 子任务（${children.length}）\n\n${children.map((c) => `- ${project.identifier}-${c.sequence_id} [${stateName.get(c.state) ?? "?"}] ${c.name}`).join("\n")}`
          : "",
        pages.length
          ? `## 关联文档（${pages.length}）\n\n${pages.map((d) => `- [${d.name}](${webUrl(`projects/${project.id}/pages/${d.id}`)})${d.owned_by ? `　作者：${d.owned_by}` : ""}　（文档 ID ${d.id}）`).join("\n")}`
          : "",
        links.length ? `## 链接\n\n${links.map((l) => `- [${l.title || l.url}](${l.url})`).join("\n")}` : "",
      ].filter(Boolean).join("\n\n");
      const timeline = cs
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .slice(-(comments ?? 20))
        .map((c) => `### ${names.get(c.actor) ?? "未知成员"} · ${c.created_at.slice(0, 16).replace("T", " ")}\n\n${htmlToMd(c.comment_html)}`)
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
      project: z.string().optional().describe("项目标识，默认当前仓库关联的项目"),
      title: z.string().min(4),
      description: z.string().describe("Markdown，按任务模板"),
      priority: z.enum(["urgent", "high", "medium", "low", "none"]).optional(),
      state: z.string().optional().describe("初始状态，默认“待开始”"),
      assignees: z.array(z.string()).optional().describe("指派给谁：me、邮箱或显示名"),
      parent: z.string().optional().describe("父任务编号，用于拆分子任务，例如 DEMO-3"),
      modules: z.array(z.string()).optional().describe("放进哪些模块（版本或需求），模块名或 ID；先用 list_modules 看现有的，没有再用 save_module 建。一个任务可以在多个模块里"),
    },
  },
  async ({ project, title, description, priority, state, assignees, parent, modules }) =>
    run(async () => {
      const g = checkOrReject(description, "task", { title });
      if (!g.ok) return fail(g.report);
      const p = await projectFor(project, "write");
      const st = await plane.listStates(p.id);
      const target = state ?? "待开始";
      if (!agentCanSet(target)) return fail(HUMAN_ONLY_HINT);
      const people = await resolveMembers(p.id, assignees ?? []);
      const parentTask = parent ? await resolveTask(parent, "write") : undefined;
      const allModules = modules?.length ? await plane.listModules(p.id) : [];
      const wantModules = (modules ?? []).map((n) => pickByName(allModules, n, "模块", NO_MODULE_HINT));
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
      if (wantModules.length) await Promise.all(wantModules.map((m) => plane.addModuleIssues(p.id, m.id, [item.id])));
      const extras = [
        people.length ? `指派给 ${people.map(personName).join("、")}` : "",
        parentTask ? `挂在 ${parentTask.key} 下` : "",
        wantModules.length ? `放进模块 ${wantModules.map((m) => m.name).join("、")}` : "",
      ].filter(Boolean).join("，");
      return text(`已新建 ${key}${extras ? `（${extras}）` : ""}：${webUrl(`browse/${key}`)}${g.report ? `\n\n${g.report}` : ""}`);
    }),
);

server.registerTool(
  "update_task",
  {
    title: "更新任务",
    description: `改任务的状态、标题、描述、优先级、指派人、父任务，或把任务放进、移出模块。Agent 可设的状态：${TASK_STATES.filter((s) => s.agentCanSet).map((s) => s.name).join("、")}；“已完成”“已取消”只能由人设置。改成“待审查”“阻塞”“待决定”时必须在 comment 里说明（分别写成结论、阻塞、决策评论；结论要带验证证据）。`,
    inputSchema: {
      task: z.string(),
      state: z.string().optional(),
      title: z.string().optional(),
      description: z.string().optional().describe("完整的新描述（Markdown），会整体替换"),
      priority: z.enum(["urgent", "high", "medium", "low", "none"]).optional(),
      assignees: z.array(z.string()).optional().describe("新的指派人列表，整体替换；传 [] 清空"),
      parent: z.string().optional().describe("改挂到哪个父任务下；传 none 取消父任务"),
      modules: z.array(z.string()).optional().describe("再放进这些模块（模块名或 ID），已在的不受影响；一个任务可以在多个模块里"),
      remove_modules: z.array(z.string()).optional().describe("从这些模块里移出（模块名或 ID），任务本身不会被删"),
      comment: z
        .string()
        .optional()
        .describe(
          "改状态时的说明，会写成一条评论。改成待审查/阻塞/待决定时必填。格式：第一行是一句话结论（不要用标题、不要写“结论：”这类提示语），空一行后写细节；待审查要写跑了什么命令、结果如何，没跑的写“未运行”。",
        ),
      role: z.string().optional().describe("你在这个任务里的角色，用于评论署名"),
    },
  },
  async ({ task, state, title, description, priority, assignees, parent, modules, remove_modules, comment, role }) =>
    run(async () => {
      const { project, item, key } = await resolveTask(task, "write");
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
          const pt = await resolveTask(parent, "write");
          if (pt.item.id === item.id) return fail("任务不能挂在自己下面");
          body.parent = pt.item.id;
        }
      }
      const moduleChanges: string[] = [];
      let toAdd: Module[] = [];
      let toRemove: Module[] = [];
      if (modules?.length || remove_modules?.length) {
        const all = await plane.listModules(project.id);
        toAdd = (modules ?? []).map((n) => pickByName(all, n, "模块", NO_MODULE_HINT));
        toRemove = (remove_modules ?? []).map((n) => pickByName(all, n, "模块"));
        if (toAdd.some((m) => toRemove.some((r) => r.id === m.id))) return fail("同一个模块不能既放进又移出");
        if (toAdd.length) moduleChanges.push(`放进模块 ${toAdd.map((m) => m.name).join("、")}`);
        if (toRemove.length) moduleChanges.push(`移出模块 ${toRemove.map((m) => m.name).join("、")}`);
      }
      if (!Object.keys(body).length && !comment && !moduleChanges.length) return fail("没有要改的字段");
      if (Object.keys(body).length) await plane.updateWorkItem(project.id, item.id, body);
      await Promise.all(toAdd.map((m) => plane.addModuleIssues(project.id, m.id, [item.id])));
      await Promise.all(toRemove.map((m) => plane.removeModuleIssue(project.id, m.id, item.id).catch(() => undefined)));
      if (comment) {
        await plane.createComment(project.id, item.id, mdToHtml(`**${commentKind}** · ${await signature(role)}\n\n${comment.trim()}`));
      }
      return text(`已更新 ${key}${state ? `，状态改为「${state}」` : ""}${moduleChanges.length ? `，${moduleChanges.join("，")}` : ""}${comment ? `，并写入「${commentKind}」评论` : ""}。${notes.length ? `\n\n${notes.join("\n")}` : ""}`);
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
      const { project, item, key } = await resolveTask(task, "write");
      const signed = `**${kind}** · ${await signature(role)}\n\n${markdown.trim()}`;
      await plane.createComment(project.id, item.id, mdToHtml(signed));
      return text(`已在 ${key} 写入「${kind}」评论。${g.report ? `\n\n${g.report}` : ""}`);
    }),
);

// ---------- 模块 ----------

server.registerTool(
  "list_modules",
  {
    title: "列出模块",
    description:
      "列出项目的模块（版本或需求的分组）：名称、状态、起止日期、负责人、任务完成进度。按版本或需求整理、查看任务前先看这个。模块是项目管理的主要分组方式。",
    inputSchema: { project: z.string().optional().describe("项目标识，默认当前仓库关联的项目") },
    annotations: { readOnlyHint: true },
  },
  async ({ project }) =>
    run(async () => {
      const p = await projectFor(project, "read");
      const [modules, members] = await Promise.all([plane.listModules(p.id), plane.listProjectMembers(p.id)]);
      if (!modules.length) return text(`项目 ${p.identifier} 还没有模块。按版本或需求分组任务时，用 save_module 新建（名称写成“版本号 需求名”，例如“v1.2 登录改版”）。`);
      const lead = nameMap(members);
      const rows = modules.map((m) => {
        const done = m.completed_issues ?? 0;
        const total = m.total_issues ?? 0;
        const dates = [m.start_date, m.target_date].filter(Boolean).join(" → ");
        const meta = [
          MODULE_STATUS[m.status] ?? m.status,
          total ? `完成 ${done}/${total}` : "还没有任务",
          dates,
          m.lead ? `负责人 ${lead.get(m.lead) ?? "?"}` : "",
        ].filter(Boolean).join("，");
        return `- **${m.name}**（${meta}）${m.description ? `\n  ${m.description.replace(/\n+/g, " ").slice(0, 120)}` : ""}\n  ${webUrl(`projects/${p.id}/modules/${m.id}`)}`;
      });
      return text(`项目 ${p.identifier} 共 ${modules.length} 个模块：\n\n${rows.join("\n")}`);
    }),
);

server.registerTool(
  "save_module",
  {
    title: "新建或修改模块",
    description:
      "新建模块，或修改已有模块（module 传现有模块名或 ID 就是修改）。模块用来把同一个版本或同一个需求的任务归在一起，名称写成“版本号 需求名”，例如“v1.2 登录改版”。状态“已完成”“已取消”只能由人在网页上设置。没有删除，不用的模块由人在网页上归档。把任务放进或移出模块用 create_task、update_task 的 modules 参数。",
    inputSchema: {
      project: z.string().optional().describe("项目标识，默认当前仓库关联的项目"),
      module: z.string().optional().describe("要修改的模块名或 ID；不传就是新建"),
      name: z.string().min(2).optional().describe("模块名称，新建时必填；改名时传新名称"),
      description: z.string().optional().describe("一两句话说明这个模块要交付什么、做到什么算完成"),
      status: z.enum(["未排期", "已计划", "进行中", "已暂停", "已完成", "已取消"]).optional(),
      start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("开始日期 YYYY-MM-DD"),
      target_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("目标完成日期 YYYY-MM-DD"),
      lead: z.string().optional().describe("负责人：me、邮箱或显示名"),
    },
  },
  async ({ project, module, name, description, status, start_date, target_date, lead }) =>
    run(async () => {
      const p = await projectFor(project, "write");
      for (const [label, v] of [["名称", name], ["说明", description]] as const) {
        if (!v) continue;
        const r = gatePlain(v);
        if (!r.ok) return fail(`模块${label}${formatGate(r)}\n\n${SELF_CHECK}`);
      }
      if (status && HUMAN_ONLY_MODULE_STATUS.has(status)) return fail(HUMAN_ONLY_HINT);
      const body: Record<string, unknown> = {};
      if (name) body.name = name;
      if (description !== undefined) body.description = description;
      if (status) body.status = MODULE_STATUS_BY_NAME[status];
      if (start_date) body.start_date = start_date;
      if (target_date) body.target_date = target_date;
      if (lead) body.lead = (await resolveMembers(p.id, [lead]))[0].id;
      if (start_date && target_date && start_date > target_date) return fail("开始日期不能晚于目标日期");
      if (module) {
        const m = pickByName(await plane.listModules(p.id), module, "模块", NO_MODULE_HINT);
        if (!Object.keys(body).length) return fail("没有要改的字段");
        await plane.updateModule(p.id, m.id, body);
        return text(`已更新模块「${name ?? m.name}」：${webUrl(`projects/${p.id}/modules/${m.id}`)}`);
      }
      if (!name) return fail("新建模块要传 name");
      const exists = (await plane.listModules(p.id)).find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (exists) return fail(`已经有同名模块「${exists.name}」，要修改它请传 module 参数。`);
      const created = await plane.createModule(p.id, body);
      return text(`已新建模块「${name}」：${webUrl(`projects/${p.id}/modules/${created.id}`)}\n把任务放进来：create_task 或 update_task 的 modules 参数。`);
    }),
);

// ---------- 视图 ----------

server.registerTool(
  "list_views",
  {
    title: "列出视图",
    description: "列出项目里保存的视图（保存下来的筛选，例如“指派给我且进行中”），每个视图的筛选条件会翻成一句话。",
    inputSchema: { project: z.string().optional().describe("项目标识，默认当前仓库关联的项目") },
    annotations: { readOnlyHint: true },
  },
  async ({ project }) =>
    run(async () => {
      const p = await projectFor(project, "read");
      const views = await plane.listViews(p.id);
      if (!views.length) return text(`项目 ${p.identifier} 还没有视图。用 save_view 按需求新建。`);
      const rows = await Promise.all(
        views.map(async (v) => {
          const display = v.display_filters as { layout?: string; group_by?: string | null; order_by?: string };
          return `- **${v.name}**${v.description ? `：${v.description}` : ""}\n  筛选：${await describeFilters(p, v)}\n  展示：${[display.layout, display.group_by ? `按 ${display.group_by} 分组` : "", display.order_by ? `排序 ${display.order_by}` : ""].filter(Boolean).join("，")}\n  ${webUrl(`projects/${p.id}/views/${v.id}`)}`;
        }),
      );
      return text(`项目 ${p.identifier} 共 ${views.length} 个视图：\n\n${rows.join("\n")}`);
    }),
);

server.registerTool(
  "save_view",
  {
    title: "新建或修改视图",
    description:
      "新建视图，或修改自己创建的视图（view 传现有视图名或 ID 就是修改）。用户说“我想经常看 XX”“帮我建一个看板看本版本的任务”时用它：把需求翻成筛选条件（状态、负责人、优先级、标签、模块、周期），选好展示方式。修改时传了 filters 就整体替换原筛选。没有删除，不用的视图由人在网页上删。",
    inputSchema: {
      project: z.string().optional().describe("项目标识，默认当前仓库关联的项目"),
      view: z.string().optional().describe("要修改的视图名或 ID；不传就是新建"),
      name: z.string().min(2).optional().describe("视图名称，要让人一眼看出看的是什么，例如“v1.2 进行中的任务”"),
      description: z.string().optional().describe("一句话说明这个视图给谁看、看什么"),
      filters: FILTER_FIELDS.optional(),
      layout: z.enum(["list", "kanban", "calendar", "spreadsheet", "gantt_chart"]).optional().describe("list 列表、kanban 看板、calendar 日历、spreadsheet 表格、gantt_chart 甘特图"),
      group_by: z.enum(["state", "priority", "labels", "assignees", "created_by", "cycle", "module"]).nullable().optional().describe("分组方式，null 取消分组；看板常按 state"),
      order_by: z.enum(["-created_at", "created_at", "-updated_at", "updated_at", "-priority", "priority", "sort_order", "-start_date", "start_date", "-target_date", "target_date"]).optional(),
    },
  },
  async ({ project, view, name, description, filters, layout, group_by, order_by }) =>
    run(async () => {
      const p = await projectFor(project, "write");
      for (const [label, v] of [["名称", name], ["说明", description]] as const) {
        if (!v) continue;
        const r = gatePlain(v);
        if (!r.ok) return fail(`视图${label}${formatGate(r)}\n\n${SELF_CHECK}`);
      }
      const body: Record<string, unknown> = {};
      if (name) body.name = name;
      if (description !== undefined) body.description = description;
      if (filters) body.rich_filters = await buildRichFilters(p, filters);
      const display: Record<string, unknown> = {};
      if (layout) display.layout = layout;
      if (group_by !== undefined) display.group_by = group_by;
      if (order_by) display.order_by = order_by;
      if (Object.keys(display).length) body.display_filters = display;
      const all = await plane.listViews(p.id);
      if (view) {
        const v = pickByName(all.map((x) => ({ ...x })), view, "视图");
        if (!Object.keys(body).length) return fail("没有要改的字段");
        const saved = await plane.updateView(p.id, v.id, body);
        return text(`已更新视图「${saved.name}」：${webUrl(`projects/${p.id}/views/${v.id}`)}\n筛选：${await describeFilters(p, saved)}`);
      }
      if (!name) return fail("新建视图要传 name");
      const dup = all.find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (dup) return fail(`已经有同名视图「${dup.name}」，要修改它请传 view 参数。`);
      const saved = await plane.createView(p.id, body);
      return text(`已新建视图「${saved.name}」：${webUrl(`projects/${p.id}/views/${saved.id}`)}\n筛选：${await describeFilters(p, saved)}`);
    }),
);

// ---------- 文档 ----------

server.registerTool(
  "list_docs",
  {
    title: "列出文档",
    description: "列出项目里的文档（Loom Page），可按关键词搜索标题和正文",
    inputSchema: { project: z.string().optional().describe("默认当前仓库关联的项目"), search: z.string().optional() },
    annotations: { readOnlyHint: true },
  },
  async ({ project, search }) =>
    run(async () => {
      const p = await projectFor(project, "read");
      const pages = await plane.listPages(p.id, search);
      return text(pages.map((d) => `- ${d.id}　${d.name}（更新于 ${d.updated_at.slice(0, 10)}）`).join("\n") || "没有文档");
    }),
);

server.registerTool(
  "read_doc",
  {
    title: "读取文档",
    description: "以 Markdown 读取一篇文档",
    inputSchema: { project: z.string().optional().describe("默认当前仓库关联的项目"), doc_id: z.string() },
    annotations: { readOnlyHint: true },
  },
  async ({ project, doc_id }) =>
    run(async () => {
      const p = await projectFor(project, "read");
      const d = await plane.getPage(p.id, doc_id).catch((e) => {
        if (e instanceof PlaneError && e.status === 404) throw new Error(`项目 ${p.identifier} 里没有文档 ${doc_id}，或者它是别人的私有文档。用 list_docs 查。`);
        throw e;
      });
      const issues = await plane.listPageIssues(p.id, d.id).catch(() => []);
      const rel = issues.length ? `\n\n## 关联工作项（${issues.length}）\n\n${issues.map((i) => `- ${i.key} [${i.state}] ${i.name}`).join("\n")}` : "";
      return text(`# ${d.name}\n\n链接：${webUrl(`projects/${p.id}/pages/${d.id}`)}\n\n${htmlToMd(d.description_html)}${rel}`);
    }),
);

server.registerTool(
  "write_doc",
  {
    title: "写文档",
    description:
      "新建或整篇更新一篇文档。不传 doc_id 是新建，传了是更新（按段落做增量合并，正在网页上打开的人会实时看到）。正文必须符合对应 type 的模板，写之前先读 get_guide（topic=writing）。",
    inputSchema: {
      project: z.string().optional().describe("默认当前仓库关联的项目"),
      type: z.enum(DOC_TYPES).describe("文档类型，决定检查哪个模板"),
      title: z.string(),
      markdown: z.string().describe("正文，从二级标题开始，不要写一级标题"),
      doc_id: z.string().optional(),
      parent_id: z.string().optional().describe("新建时挂在哪篇文档下面"),
      task: z.string().optional().describe("关联的任务编号，写完自动把文档关联到这个任务（任务页和文档页都能看到）"),
    },
  },
  async ({ project, type, title, markdown, doc_id, parent_id, task }) =>
    run(async () => {
      const g = checkOrReject(markdown.replace(/\(data:image\/[^)]{0,}\)/g, "(data:image)"), type, { title });
      if (!g.ok) return fail(g.report);
      const p = await projectFor(project, "write");
      const t = task ? await resolveTask(task, "write") : undefined;
      const imported = await importInlineImages(markdown, (name, type, b64) => plane.uploadPageImage(p.id, name, type, b64));
      const html = mdToHtml(imported.md);
      const d = doc_id
        ? await plane.updatePage(p.id, doc_id, { name: title, description_html: html })
        : await plane.createPage(p.id, title, html, parent_id);
      const url = webUrl(`projects/${p.id}/pages/${d.id}`);
      let linked = "";
      if (t) {
        linked = await plane
          .linkPage(t.project.id, t.item.id, d.id)
          .then(() => `\n已关联到任务 ${t.key}，任务页和文档页里都能看到。`)
          .catch((e) => `\n文档已写入，但没能关联到 ${t.key}：${e instanceof PlaneError ? (e.body.match(/"(?:detail|error)"\s*:\s*"([^"]+)"/)?.[1] ?? e.body) : e}`);
      }
      return text(
        `${doc_id ? "已更新" : "已新建"}文档「${title}」（${d.id}）：${url}${d.live_editing ? "\n有人正在网页上编辑这篇文档，改动已实时合并。" : ""}${imported.count ? `\n已把 ${imported.count} 张图片（SVG/PNG 等）导入文档。` : ""}${linked}${g.report ? `\n\n${g.report}` : ""}`,
      );
    }),
);

server.registerTool(
  "link_doc",
  {
    title: "关联文档到任务",
    description: "把已有的文档关联到任务，不改文档内容。关联后任务页的「关联文档」和文档页的「关联工作项」里都能看到。创建人、指派人、文档作者或管理员才能关联。",
    inputSchema: {
      task: z.string().describe("任务编号"),
      doc_id: z.string().describe("文档 ID，list_docs 或 get_task 里能查到"),
      project: z.string().optional().describe("默认当前仓库关联的项目"),
    },
  },
  async ({ task, doc_id, project }) =>
    run(async () => {
      const t = await resolveTask(task, "write");
      const p = await projectFor(project ?? t.project.identifier, "read");
      const d = await plane.getPage(p.id, doc_id).catch((e) => {
        if (e instanceof PlaneError && e.status === 404) throw new Error(`项目 ${p.identifier} 里没有文档 ${doc_id}，或者它是别人的私有文档。用 list_docs 查。`);
        throw e;
      });
      await plane.linkPage(t.project.id, t.item.id, d.id);
      return text(`已把文档「${d.name}」关联到 ${t.key}：${webUrl(`browse/${t.key}`)}`);
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
      project: z.string().optional().describe("只看这个项目的经验（加上通用的）。默认是当前仓库关联的项目"),
      all_projects: z.boolean().optional().describe("不按项目筛，查所有项目的经验"),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ query, tags, include_pending, project, all_projects }) =>
    run(async () => {
      const { projects } = await boundProjects();
      const scope = all_projects ? undefined : project ? [project] : projects.map((p) => p.identifier);
      return text(formatLessons(await searchLessons(plane, query, tags ?? [], { includePending: include_pending, skipPrivate: !local, projects: scope })));
    }),
);

server.registerTool(
  "propose_lesson",
  {
    title: "提交经验",
    description:
      "沉淀一条经验。先读 get_guide（topic=lessons）判断值不值得提：要可复用、不明显、有代价、已验证；任务进展、能直接查到的事实、个人偏好、重复的都不要提。团队经验必须有来源（source_task 或 ## 来源），人靠它核验。scope=team 提交到团队经验库的“待审核”，由人在 Loom 上决定采纳或驳回；scope=private 只存在本机（仅本机 stdio 版可用，远程服务不支持）。提交前应先征得用户同意。",
    inputSchema: {
      title: z.string().describe("一句话说清经验，例如“Django 迁移里不要直接 import 模型”"),
      markdown: z.string().describe("按经验模板：## 场景、## 做法，可选 ## 原因、## 来源"),
      tags: z.array(z.string()).min(1),
      scope: z.enum(["team", "private"]),
      source_task: z.string().optional().describe("来源任务编号"),
      project: z
        .string()
        .optional()
        .describe("这条经验属于哪个项目（项目标识）。不传时用当前仓库关联的项目；临时的、不属于任何项目的经验传「通用」"),
    },
  },
  async ({ title, markdown, tags, scope, source_task, project }) =>
    run(async () => {
      const md = source_task && !/##\s*来源/.test(markdown) ? `${markdown.trim()}\n\n## 来源\n\n${source_task}\n` : markdown;
      const g = checkOrReject(md, "lesson", { title });
      if (!g.ok) return fail(g.report);
      if (scope === "team" && !/^#{2,3}\s*来源/m.test(md)) {
        return fail("团队经验必须写明来源，人要靠它核验：传 source_task（任务编号），或在正文里加「## 来源」，写任务编号、文档链接或报错原文。没有来源说明还没验证过，先不要提交。");
      }
      if (scope === "private") {
        if (!local) return fail("远程服务没有“本机”，不能存私人经验。私人内容请自己记在本地笔记里；要给团队用的经验用 scope=team 提交。");
        const path = await savePrivateLesson(title, md, tags);
        return text(`已存为私人经验：${path}`);
      }
      const { projects } = await boundProjects();
      let belongs: string;
      const pr = project?.trim();
      if (pr && (pr === GENERAL || pr.toLowerCase() === "general")) belongs = GENERAL;
      else if (pr) {
        const hit = projects.find((p) => p.identifier.toLowerCase() === pr.toLowerCase() || p.name === pr);
        if (!hit) return fail(`当前仓库关联的项目是 ${projects.map((p) => p.identifier).join("、")}，没有「${project}」。不属于任何项目的经验，project 传「${GENERAL}」。`);
        belongs = hit.identifier;
      } else if (projects.length === 1) belongs = projects[0].identifier;
      else return fail(`当前仓库关联了多个项目：${projects.map((p) => p.identifier).join("、")}。请用 project 指定这条经验属于哪个，或传「${GENERAL}」。`);
      const similar = (await searchLessons(plane, title, tags, { includePending: true, skipPrivate: true })).filter((l) => l.scope === "team").slice(0, 3);
      const r = await proposeTeamLesson(plane, title, md, tags, belongs);
      const dup = similar.length ? `\n\n库里已有相近的经验，如果重复，请用户在网页上把其中一条驳回：\n${similar.map((l) => `- ${l.key} ${l.title}（${l.status}）${l.url}`).join("\n")}` : "";
      return text(`已提交团队经验 ${r.key}（${belongs === GENERAL ? "通用，不属于具体项目" : `项目 ${belongs}`}），状态“待审核”，需要人在 Loom 上采纳后才会被检索到：${webUrl(`browse/${r.key}`)}${dup}`);
    }),
);

// ---------- 回顾 ----------

server.registerTool(
  "review_digest",
  {
    title: "生成回顾",
    description:
      "扫一遍当前仓库关联的项目，列出等你决定、阻塞、待审查、长期没动的任务和待审核的经验。publish=true 时写成「每日回顾」项目里你当天的个人回顾（「回顾 日期 · 你的名字」，同一天重复执行会更新）。全员的团队回顾由 team-review 定时生成。",
    inputSchema: {
      stale_days: z.number().int().min(1).max(60).optional().describe("多少天没更新算“没动”，默认 3"),
      only_mine: z.boolean().optional().describe("只看指派给我或未指派的任务"),
      publish: z.boolean().optional().describe("写成 Loom 文档"),
    },
  },
  async ({ stale_days, only_mine, publish }) =>
    run(async () => {
      const { projects } = await boundProjects();
      const opts = { staleDays: stale_days ?? 3, onlyMine: only_mine ?? false, projectIds: projects.map((p) => p.id) };
      if (!publish) return text((await buildDigest(plane, opts)).md);
      const r = await publishDigest(plane, { ...opts, webUrl });
      return text(`${r.updated ? "已更新" : "已发布"}「${r.title}」：${r.url}\n\n${r.md}`);
    }),
);

  return server;
}
