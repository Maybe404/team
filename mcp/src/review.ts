// 定时回顾：扫出需要人关注的任务，生成一份 Markdown 日报。
import { getLessonProject } from "./lessons.ts";
import { mdToHtml } from "./markdown.ts";
import { assertMember, type Loom, type WorkItem } from "./plane.ts";

type Row = { key: string; name: string; state: string; days: number; url: string; project: string; who: string[] };
/** projectIds：只扫这些项目（MCP 里传当前仓库关联的项目）；不传时扫你加入的所有项目（定时回顾用）。 */
export type DigestOpts = { staleDays: number; onlyMine: boolean; team?: boolean; projectIds?: string[] };

const DAY = 86_400_000;

/** team=true 是团队回顾（定时任务用），最后一节按人列出手上的任务；否则是个人回顾，最后一节是“指派给我的”。 */
export async function buildDigest(plane: Loom, opts: DigestOpts) {
  const me = await plane.me();
  const lessonProject = await getLessonProject(plane).catch(() => undefined);
  const reviewIdent = (process.env.TEAM_REVIEW_PROJECT || "REVIEW").toUpperCase();
  // 只扫自己加入了的项目：没加入的读不到，也不归你管
  const projects = (await plane.listProjects()).filter(
    (p) =>
      p.is_member !== false &&
      p.id !== lessonProject?.id &&
      p.identifier !== reviewIdent &&
      (!opts.projectIds || opts.projectIds.includes(p.id)),
  );
  const now = Date.now();

  const needsYou: Row[] = [];
  const blocked: Row[] = [];
  const review: Row[] = [];
  const stale: Row[] = [];
  const mine: Row[] = [];

  for (const p of projects) {
    const [items, states, members] = await Promise.all([
      plane.listWorkItems(p.id),
      plane.listStates(p.id),
      plane.listProjectMembers(p.id).catch(() => []),
    ]);
    const st = new Map(states.map((s) => [s.id, s]));
    const names = new Map(members.map((m) => [m.id, m.display_name]));
    for (const it of items as WorkItem[]) {
      const s = st.get(it.state);
      if (!s || s.group === "completed" || s.group === "cancelled") continue;
      if (opts.onlyMine && it.assignees.length && !it.assignees.includes(me.id)) continue;
      const key = `${p.identifier}-${it.sequence_id}`;
      const row: Row = {
        key,
        name: it.name,
        state: s.name,
        days: Math.floor((now - new Date(it.updated_at).getTime()) / DAY),
        url: plane.webUrl(`browse/${key}`),
        project: p.name,
        who: it.assignees.map((a) => names.get(a) ?? "?"),
      };
      if (s.name === "待决定") needsYou.push(row);
      else if (s.name === "阻塞") blocked.push(row);
      else if (s.name === "待审查") review.push(row);
      else if (s.group === "started" && row.days >= opts.staleDays) stale.push(row);
      if (s.group !== "backlog" && (opts.team ? it.assignees.length > 0 : it.assignees.includes(me.id))) mine.push(row);
    }
  }

  const [lessonItems, lessonStates] = lessonProject
    ? await Promise.all([plane.listWorkItems(lessonProject.id), plane.listStates(lessonProject.id)])
    : [[], []];
  const pendingId = lessonStates.find((s) => s.name === "待审核")?.id;
  const pendingLessons = lessonItems
    .filter((i) => i.state === pendingId)
    .map((i) => ({ key: `${lessonProject!.identifier}-${i.sequence_id}`, name: i.name }));

  const section = (title: string, rows: Row[], empty: string) =>
    `## ${title}（${rows.length}）\n\n${
      rows.length
        ? rows
            .sort((a, b) => b.days - a.days)
            .map((r) => `- [${r.key}](${r.url}) ${r.name}（${r.project}，${r.who.length ? `${r.who.join("、")}，` : "未指派，"}${r.state}，${r.days} 天没动）`)
            .join("\n")
        : empty
    }`;

  const date = new Date().toLocaleDateString("sv-SE");
  const total = needsYou.length + blocked.length + review.length + stale.length + pendingLessons.length;
  const md = [
    `${date} 回顾：${total ? `有 ${total} 项需要关注` : "没有需要关注的事项"}。`,
    section("等你决定", needsYou, "无"),
    section("阻塞中", blocked, "无"),
    section("待审查", review, "无"),
    section(`超过 ${opts.staleDays} 天没动的进行中任务`, stale, "无"),
    `## 待审核的经验（${pendingLessons.length}）\n\n${
      pendingLessons.length
        ? pendingLessons.map((l) => `- [${l.key}](${plane.webUrl(`browse/${l.key}`)}) ${l.name}`).join("\n")
        : "无"
    }`,
    opts.team ? byPerson(mine) : section("指派给我的未完成任务", mine, "无"),
  ].join("\n\n");

  return { md, total };
}

function byPerson(rows: Row[]): string {
  const groups = new Map<string, Row[]>();
  for (const r of rows) for (const w of r.who) groups.set(w, [...(groups.get(w) ?? []), r]);
  const body = [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([w, rs]) => `### ${w}（${rs.length}）\n\n${rs.map((r) => `- [${r.key}](${r.url}) ${r.name}（${r.state}）`).join("\n")}`)
    .join("\n\n");
  return `## 各人手上的任务\n\n${body || "无"}`;
}

// ---------- 发布到 Loom ----------

export async function getReviewProject(plane: Loom) {
  const ident = (process.env.TEAM_REVIEW_PROJECT || "REVIEW").toUpperCase();
  const hit = (await plane.listProjects()).find((p) => p.identifier === ident);
  return hit ? assertMember(hit) : (await plane.createProject("每日回顾", ident, "team-mcp 每天生成的回顾，列出需要人关注的任务和待审核的经验。"));
}

export function digestTitle(name?: string) {
  const date = new Date().toLocaleDateString("sv-SE");
  return name ? `回顾 ${date} · ${name}` : `回顾 ${date}`;
}

/** 生成当天的回顾并写成 Page；同一天重复执行会更新同一篇。团队回顾和每个人的个人回顾各是一篇，互不覆盖。 */
export async function publishDigest(plane: Loom, opts: DigestOpts & { webUrl: (p: string) => string }) {
  const { md, total } = await buildDigest(plane, opts);
  const project = await getReviewProject(plane);
  const title = digestTitle(opts.team ? undefined : (await plane.me()).display_name);
  const html = mdToHtml(md);
  const existing = (await plane.listPages(project.id)).find((p) => p.name === title);
  const page = existing
    ? await plane.updatePage(project.id, existing.id, { description_html: html })
    : await plane.createPage(project.id, title, html);
  return { md, total, url: opts.webUrl(`projects/${project.id}/pages/${page.id}`), title, updated: Boolean(existing) };
}
