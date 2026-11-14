// 团队工作流规则：状态定义、谁能改什么、项目初始化。
import type { Plane, Project, State } from "./plane.ts";

export type StateDef = { name: string; group: string; color: string; from?: string[]; agentCanSet: boolean; isDefault?: boolean };

// 任务项目的状态。from 是 Plane 默认状态名，初始化时改名复用，不重复创建。
export const TASK_STATES: StateDef[] = [
  { name: "待办", group: "backlog", color: "#A3A3A3", from: ["Backlog"], agentCanSet: true },
  { name: "待开始", group: "unstarted", color: "#3A3A3A", from: ["Todo"], agentCanSet: true, isDefault: true },
  { name: "进行中", group: "started", color: "#F59E0B", from: ["In Progress"], agentCanSet: true },
  { name: "待审查", group: "started", color: "#8B5CF6", agentCanSet: true },
  { name: "阻塞", group: "started", color: "#EF4444", agentCanSet: true },
  { name: "待决定", group: "started", color: "#EC4899", agentCanSet: true },
  { name: "已完成", group: "completed", color: "#16A34A", from: ["Done"], agentCanSet: false },
  { name: "已取消", group: "cancelled", color: "#9CA3AF", from: ["Cancelled"], agentCanSet: false },
];

// 经验库项目的状态：Agent 只能提交到“待审核”，采纳和驳回只能由人在网页上操作。
export const LESSON_STATES: StateDef[] = [
  { name: "草稿", group: "backlog", color: "#A3A3A3", from: ["Backlog"], agentCanSet: true },
  { name: "待审核", group: "unstarted", color: "#F59E0B", from: ["Todo"], agentCanSet: true, isDefault: true },
  { name: "已采纳", group: "completed", color: "#16A34A", from: ["Done"], agentCanSet: false },
  { name: "已驳回", group: "cancelled", color: "#9CA3AF", from: ["Cancelled"], agentCanSet: false },
];
const LESSON_EXTRA_FROM = ["In Progress"]; // Plane 默认的“进行中”在经验库里用不上，改名为“修订中”
export const LESSON_REVISING = "修订中";

export const HUMAN_ONLY_HINT = "这个状态只能由人在 Plane 网页上设置（验收或采纳属于人的决定）。";

export async function ensureStates(plane: Plane, project: Project, defs: StateDef[], extra?: { from: string[]; name: string }) {
  const states = await plane.listStates(project.id);
  const changes: string[] = [];
  for (const d of defs) {
    if (states.some((s) => s.name === d.name)) continue;
    const old = states.find((s) => d.from?.includes(s.name));
    if (old) {
      await plane.updateState(project.id, old.id, { name: d.name, color: d.color });
      old.name = d.name;
      changes.push(`状态「${d.from?.join("/")}」改名为「${d.name}」`);
    } else {
      const s = await plane.createState(project.id, { name: d.name, group: d.group, color: d.color });
      states.push(s);
      changes.push(`新增状态「${d.name}」`);
    }
  }
  if (extra) {
    const old = states.find((s) => extra.from.includes(s.name));
    if (old) {
      await plane.updateState(project.id, old.id, { name: extra.name });
      changes.push(`状态「${old.name}」改名为「${extra.name}」`);
    }
  }
  const def = defs.find((d) => d.isDefault);
  const defState = (await plane.listStates(project.id)).find((s) => s.name === def?.name);
  if (defState) await plane.updateState(project.id, defState.id, { default: true }).catch(() => undefined);
  return changes;
}

export function ensureLessonStates(plane: Plane, project: Project) {
  return ensureStates(plane, project, LESSON_STATES, { from: LESSON_EXTRA_FROM, name: LESSON_REVISING });
}

export function findState(states: State[], name: string): State {
  const s = states.find((x) => x.name === name);
  if (!s) {
    throw new Error(`项目里没有状态「${name}」。先调用 setup_project 初始化。现有状态：${states.map((x) => x.name).join("、")}`);
  }
  return s;
}

export function agentCanSet(name: string, defs: StateDef[] = TASK_STATES): boolean {
  const d = defs.find((x) => x.name === name);
  return d ? d.agentCanSet : false;
}
