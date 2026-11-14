// 定时回顾：扫出需要人关注的任务，生成一份 Markdown 日报。
import { getLessonProject } from "./lessons.ts";
import type { Plane, WorkItem } from "./plane.ts";

type Row = { key: string; name: string; state: string; days: number; url: string; project: string };

const DAY = 86_400_000;

export async function buildDigest(plane: Plane, opts: { staleDays: number; onlyMine: boolean }) {
  const me = await plane.me();
  const lessonProject = await getLessonProject(plane);
  const projects = (await plane.listProjects()).filter((p) => p.id !== lessonProject.id);
  const now = Date.now();

  const needsYou: Row[] = [];
  const blocked: Row[] = [];
  const review: Row[] = [];
  const stale: Row[] = [];
  const mine: Row[] = [];

  for (const p of projects) {
    const [items, states] = await Promise.all([plane.listWorkItems(p.id), plane.listStates(p.id)]);
    const st = new Map(states.map((s) => [s.id, s]));
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
      };
      if (s.name === "待决定") needsYou.push(row);
      else if (s.name === "阻塞") blocked.push(row);
      else if (s.name === "待审查") review.push(row);
      else if (s.group === "started" && row.days >= opts.staleDays) stale.push(row);
      if (it.assignees.includes(me.id) && s.group !== "backlog") mine.push(row);
    }
  }

  const [lessonItems, lessonStates] = await Promise.all([
    plane.listWorkItems(lessonProject.id),
    plane.listStates(lessonProject.id),
  ]);
  const pendingId = lessonStates.find((s) => s.name === "待审核")?.id;
  const pendingLessons = lessonItems
    .filter((i) => i.state === pendingId)
    .map((i) => ({ key: `${lessonProject.identifier}-${i.sequence_id}`, name: i.name }));

  const section = (title: string, rows: Row[], empty: string) =>
    `## ${title}（${rows.length}）\n\n${
      rows.length
        ? rows
            .sort((a, b) => b.days - a.days)
            .map((r) => `- [${r.key}](${r.url}) ${r.name}（${r.project}，${r.state}，${r.days} 天没动）`)
            .join("\n")
        : empty
    }`;

  const date = new Date().toISOString().slice(0, 10);
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
    section("指派给我的未完成任务", mine, "无"),
  ].join("\n\n");

  return { md, total };
}
