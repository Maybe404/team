// 待办收件箱：把需要这个人处理的事汇总在一起。my_inbox 工具直接看，另外每隔几小时在任意工具结果后面带一句提醒。
import { getLessonProject } from "./lessons.ts";
import { assertMember, type Loom, type WorkItem } from "./plane.ts";

type Row = { key: string; name: string; state: string; days: number; url: string; project: string };
export type Inbox = {
  md: string;
  total: number;
  counts: { access: number; decide: number; review: number; blocked: number; todo: number; intake: number; lessons: number };
};

const DAY = 86_400_000;

export async function buildInbox(plane: Loom, projectIds?: string[]): Promise<Inbox> {
  const me = await plane.me();
  const lessonProject = await getLessonProject(plane).catch(() => undefined);
  const reviewIdent = (process.env.TEAM_REVIEW_PROJECT || "REVIEW").toUpperCase();
  const projects = (await plane.listProjects()).filter(
    (p) => p.is_member !== false && p.id !== lessonProject?.id && p.identifier !== reviewIdent && (!projectIds || projectIds.includes(p.id)),
  );
  const decide: Row[] = [];
  const review: Row[] = [];
  const blocked: Row[] = [];
  const todo: Row[] = [];
  const intake: { project: string; url: string; names: string[] }[] = [];
  const now = Date.now();

  for (const p of projects) {
    assertMember(p);
    const [items, states, pending] = await Promise.all([
      plane.listWorkItems(p.id),
      plane.listStates(p.id),
      plane.listIntakePending?.(p.id).catch(() => []) ?? Promise.resolve([]),
    ]);
    const st = new Map(states.map((s) => [s.id, s]));
    for (const it of items as (WorkItem & { created_by?: string })[]) {
      const s = st.get(it.state);
      if (!s || s.group === "completed" || s.group === "cancelled" || s.group === "backlog") continue;
      const mine = it.assignees.includes(me.id);
      const made = it.created_by === me.id;
      if (!mine && !made) continue;
      const key = `${p.identifier}-${it.sequence_id}`;
      const row: Row = { key, name: it.name, state: s.name, days: Math.floor((now - new Date(it.updated_at).getTime()) / DAY), url: plane.webUrl(`browse/${key}`), project: p.name };
      if (s.name === "待决定") decide.push(row);
      else if (s.name === "待审查") review.push(row);
      else if (s.name === "阻塞" && mine) blocked.push(row);
      else if (mine) todo.push(row);
    }
    if (pending.length) intake.push({ project: p.name, url: plane.webUrl(`projects/${p.id}/intake`), names: pending.slice(0, 5) });
  }

  let lessons = 0;
  if (lessonProject) {
    const [items, states] = await Promise.all([plane.listWorkItems(lessonProject.id), plane.listStates(lessonProject.id)]);
    const pendingId = states.find((s) => s.name === "待审核")?.id;
    lessons = items.filter((i) => i.state === pendingId).length;
  }

  const rows = (r: Row[], limit = 8) =>
    r.length
      ? r
          .sort((a, b) => b.days - a.days)
          .slice(0, limit)
          .map((x) => `- [${x.key}](${x.url}) ${x.name}（${x.project}，${x.state}，${x.days} 天没动）`)
          .join("\n") + (r.length > limit ? `\n- …还有 ${r.length - limit} 项` : "")
      : "无";
  const access = ((await plane.pendingAccess?.().catch(() => [])) ?? []).filter((r) => !projectIds || projectIds.includes(r.project_id));
  const counts = { access: access.length, decide: decide.length, review: review.length, blocked: blocked.length, todo: todo.length, intake: intake.reduce((n, i) => n + i.names.length, 0), lessons };
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const md = [
    `待办收件箱：${total ? `有 ${total} 项等你处理` : "现在没有等你处理的事"}。`,
    `## 等你决定（${decide.length}）\n\n${rows(decide)}`,
    `## 等你审查（${review.length}）\n\n${rows(review)}`,
    `## 阻塞中（${blocked.length}）\n\n${rows(blocked)}`,
    `## 指派给你的未完成任务（${todo.length}）\n\n${rows(todo)}`,
    `## 等你审批的编辑申请（${access.length}）\n\n${access.length ? access.slice(0, 8).map((r) => `- ${r.requester?.name ?? "有人"} 申请编辑「${r.title}」（doc_access decide：type=${r.entity_type === "page" ? "page" : "issue"} id=${r.entity_type === "page" ? r.entity_id : (r.key ?? r.entity_id)} request_id=${r.id}）`).join("\n") : "无"}`,
    `## 收集里待分诊（${counts.intake}）\n\n${intake.length ? intake.map((i) => `- ${i.project}：${i.names.join("、")}（${i.url}）`).join("\n") : "无"}`,
    `## 待审核的经验（${lessons}）\n\n${lessons ? "在网页「经验库」项目里采纳或驳回。" : "无"}`,
  ].join("\n\n");
  return { md, total, counts };
}

export function reminderLine(i: Inbox): string {
  const c = i.counts;
  const parts = [
    c.access && `编辑申请待审批 ${c.access}`,
    c.decide && `等你决定 ${c.decide}`,
    c.review && `等你审查 ${c.review}`,
    c.blocked && `阻塞 ${c.blocked}`,
    c.todo && `指派给你的未完成 ${c.todo}`,
    c.intake && `收集待分诊 ${c.intake}`,
    c.lessons && `待审核经验 ${c.lessons}`,
  ].filter(Boolean);
  return `待办提醒：${parts.join("，")}。用 my_inbox 看明细；把这条提醒转告用户，问他要不要现在处理。`;
}
