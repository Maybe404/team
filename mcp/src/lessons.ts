// 经验库：团队经验存在 Loom 的经验库项目（每条一个工作项），私人经验存在本机。
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { htmlToMd, mdToHtml } from "./markdown.ts";
import { assertMember, type Label, type Loom, type Project, type WorkItem } from "./plane.ts";
import { findState } from "./workflow.ts";

export type Lesson = {
  scope: "team" | "private";
  title: string;
  tags: string[];
  /** 所属项目标识；“通用”表示不属于某个项目；私人经验没有 */
  project?: string;
  body: string;
  key?: string;
  url?: string;
  path?: string;
  status?: string;
};

export const GENERAL = "通用";
const PROJECT_LABEL = "项目:";
export const projectLabel = (ident: string) => `${PROJECT_LABEL}${ident.toUpperCase()}`;

export function privateDir(): string {
  return process.env.TEAM_PRIVATE_LESSONS_DIR || join(homedir(), ".team", "lessons");
}

function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[\s,，、/|]+/)
    .filter(Boolean);
}

function score(text: string, tags: string[], tokens: string[], wantTags: string[]): number {
  const t = text.toLowerCase();
  let s = 0;
  for (const tok of tokens) if (t.includes(tok)) s += 1;
  for (const tag of wantTags) if (tags.map((x) => x.toLowerCase()).includes(tag.toLowerCase())) s += 2;
  return s;
}

function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "lesson"
  );
}

export async function getLessonProject(plane: Loom): Promise<Project> {
  const ident = (process.env.TEAM_LESSONS_PROJECT || "LESSON").toUpperCase();
  const projects = await plane.listProjects();
  const hit = projects.find((p) => p.identifier === ident);
  if (hit) return assertMember(hit);
  // Loom 二开会给经验库建审核状态，并把工作区成员都加进来
  return plane.createProject("经验库", ident, "团队共享的踩坑记录、有效做法和检查项。Agent 提交到“待审核”，由人决定是否采纳。");
}

async function ensureLabels(plane: Loom, projectId: string, names: string[]): Promise<Label[]> {
  const existing = await plane.listLabels(projectId);
  const out: Label[] = [];
  for (const n of names) {
    const hit = existing.find((l) => l.name.toLowerCase() === n.toLowerCase());
    out.push(hit ?? (await plane.createLabel(projectId, n)));
  }
  return out;
}

/** belongs：所属项目标识，或 GENERAL（不属于任何项目）。用标签「项目:XXX」/「通用」记录，网页上能直接按它筛选。 */
export async function proposeTeamLesson(plane: Loom, title: string, bodyMd: string, tags: string[], belongs: string) {
  const project = await getLessonProject(plane);
  const states = await plane.listStates(project.id);
  const labels = await ensureLabels(plane, project.id, [...tags, belongs === GENERAL ? GENERAL : projectLabel(belongs)]);
  const item = await plane.createWorkItem(project.id, {
    name: title,
    description_html: mdToHtml(bodyMd),
    state: findState(states, "待审核").id,
    labels: labels.map((l) => l.id),
  });
  return { project, item, key: `${project.identifier}-${item.sequence_id}` };
}

export async function savePrivateLesson(title: string, bodyMd: string, tags: string[]) {
  const dir = privateDir();
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${new Date().toISOString().slice(0, 10)}-${slugify(title)}.md`);
  const fm = `---\ntitle: ${JSON.stringify(title)}\ntags: ${JSON.stringify(tags)}\ncreated: ${new Date().toISOString()}\n---\n\n`;
  await writeFile(path, fm + bodyMd.trim() + "\n", "utf8");
  return path;
}

async function readPrivateLessons(): Promise<Lesson[]> {
  const dir = privateDir();
  let files: string[] = [];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
  const out: Lesson[] = [];
  for (const f of files) {
    const raw = await readFile(join(dir, f), "utf8");
    const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    const meta = m?.[1] ?? "";
    const title = JSON.parse(meta.match(/^title:\s*(.+)$/m)?.[1] ?? JSON.stringify(f));
    const tags = JSON.parse(meta.match(/^tags:\s*(.+)$/m)?.[1] ?? "[]");
    out.push({ scope: "private", title, tags, body: (m?.[2] ?? raw).trim(), path: join(dir, f) });
  }
  return out;
}

export async function searchLessons(
  plane: Loom,
  query: string,
  tags: string[],
  opts: { includePending?: boolean; limit?: number; skipPrivate?: boolean; projects?: string[] } = {},
): Promise<Lesson[]> {
  const tokens = tokenize(query);
  const results: { l: Lesson; s: number }[] = [];

  const project = await getLessonProject(plane);
  const [items, states, labels] = await Promise.all([
    plane.listWorkItems(project.id),
    plane.listStates(project.id),
    plane.listLabels(project.id),
  ]);
  const stateName = new Map(states.map((s) => [s.id, s.name]));
  const labelName = new Map(labels.map((l) => [l.id, l.name]));
  const allowed = new Set(["已采纳", ...(opts.includePending ? ["待审核"] : [])]);
  for (const it of items as WorkItem[]) {
    const status = stateName.get(it.state) ?? "";
    if (!allowed.has(status)) continue;
    const allLabels = it.labels.map((id) => labelName.get(id) ?? "").filter(Boolean);
    const projLabel = allLabels.find((n) => n.startsWith(PROJECT_LABEL));
    const belongs = projLabel ? projLabel.slice(PROJECT_LABEL.length) : allLabels.includes(GENERAL) ? GENERAL : undefined;
    // 按项目筛：属于指定项目的、通用的、还没标项目的（旧数据）都算
    if (opts.projects && belongs && belongs !== GENERAL && !opts.projects.map((x) => x.toUpperCase()).includes(belongs.toUpperCase())) continue;
    const itTags = allLabels.filter((n) => n !== projLabel && n !== GENERAL);
    const body = htmlToMd(it.description_html);
    const s = score(`${it.name}\n${body}`, itTags, tokens, tags);
    if (s > 0 || (!tokens.length && !tags.length)) {
      results.push({
        s,
        l: {
          scope: "team",
          title: it.name,
          tags: itTags,
          project: belongs,
          body,
          status,
          key: `${project.identifier}-${it.sequence_id}`,
          url: plane.webUrl(`browse/${project.identifier}-${it.sequence_id}`),
        },
      });
    }
  }

  for (const l of opts.skipPrivate ? [] : await readPrivateLessons()) {
    const s = score(`${l.title}\n${l.body}`, l.tags, tokens, tags);
    if (s > 0 || (!tokens.length && !tags.length)) results.push({ l, s });
  }

  return results
    .sort((a, b) => b.s - a.s)
    .slice(0, opts.limit ?? 8)
    .map((r) => r.l);
}

export function formatLessons(lessons: Lesson[]): string {
  if (!lessons.length) return "没有找到相关经验。";
  return lessons
    .map((l) => {
      const head = l.scope === "team" ? `[团队 ${l.key}${l.status !== "已采纳" ? `，${l.status}` : ""}]` : `[私人 ${l.path}]`;
      return `### ${l.title}\n${head}${l.project ? ` 项目：${l.project}` : ""}${l.tags.length ? ` 标签：${l.tags.join("、")}` : ""}\n\n${l.body}`;
    })
    .join("\n\n---\n\n");
}
