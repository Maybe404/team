// 团队工作流规则：状态定义、谁能改什么。状态本身由 Loom 二开在建项目时创建（任务工作流 / 经验审核）。
import type { State } from "./plane.ts";

export type StateDef = { name: string; group: string; color: string; agentCanSet: boolean; isDefault?: boolean };

// 任务项目的状态
export const TASK_STATES: StateDef[] = [
  { name: "待办", group: "backlog", color: "#A3A3A3", agentCanSet: true },
  { name: "待开始", group: "unstarted", color: "#3A3A3A", agentCanSet: true, isDefault: true },
  { name: "进行中", group: "started", color: "#F59E0B", agentCanSet: true },
  { name: "待审查", group: "started", color: "#8B5CF6", agentCanSet: true },
  { name: "阻塞", group: "started", color: "#EF4444", agentCanSet: true },
  { name: "待决定", group: "started", color: "#EC4899", agentCanSet: true },
  { name: "已完成", group: "completed", color: "#16A34A", agentCanSet: true },
  { name: "已取消", group: "cancelled", color: "#9CA3AF", agentCanSet: true },
];

// 经验库项目的状态：Agent 只能提交到“待审核”，采纳和驳回只能由人在网页上操作。
export const LESSON_STATES: StateDef[] = [
  { name: "草稿", group: "backlog", color: "#A3A3A3", agentCanSet: true },
  { name: "待审核", group: "unstarted", color: "#F59E0B", agentCanSet: true, isDefault: true },
  { name: "修订中", group: "started", color: "#8B5CF6", agentCanSet: true },
  { name: "已采纳", group: "completed", color: "#16A34A", agentCanSet: false },
  { name: "已驳回", group: "cancelled", color: "#9CA3AF", agentCanSet: false },
];

export const HUMAN_ONLY_HINT = "这个状态只能由人在 Loom 网页上设置（验收或采纳属于人的决定）。";

const order = (n: string) => {
  const i = [...TASK_STATES, ...LESSON_STATES].findIndex((d) => d.name === n);
  return i < 0 ? 99 : i;
};

export function findState(states: State[], name: string): State {
  const s = states.find((x) => x.name === name);
  if (!s) {
    throw new Error(`项目里没有状态「${name}」。可选状态：${[...states].sort((a, b) => order(a.name) - order(b.name)).map((x) => x.name).join("、")}`);
  }
  return s;
}

export function agentCanSet(name: string, defs: StateDef[] = TASK_STATES): boolean {
  // 不在工作流定义里的名字交给 findState 报“没有这个状态”，不在这里误报成“只能由人设置”
  const d = defs.find((x) => x.name === name);
  return d ? d.agentCanSet : true;
}
