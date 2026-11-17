// 写入后的「智能提示」：不拦截写入，只在结果里提醒 Agent 有没有漏掉关联、有没有重复或不合理的地方，
// 让 Agent 拿不准时回头问用户。全部是纯函数，方便测试。
import { wideTables } from "./layout.ts";

const norm = (s: string) => s.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");

/** 两个标题的相似度（字的二元组 Jaccard），0~1。 */
export function similarity(a: string, b: string): number {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const grams = (s: string) => new Set(Array.from({ length: s.length - 1 }, (_, i) => s.slice(i, i + 2)));
  const gx = grams(x);
  const gy = grams(y);
  let inter = 0;
  for (const g of gx) if (gy.has(g)) inter++;
  return inter / (gx.size + gy.size - inter);
}

export type Named = { key: string; name: string };

/** 已有的相近条目，相似度从高到低，最多 3 条。 */
export function findSimilar(title: string, others: Named[], threshold = 0.5): Named[] {
  return others
    .map((o) => ({ o, s: similarity(title, o.name) }))
    .filter((r) => r.s >= threshold)
    .sort((a, b) => b.s - a.s)
    .slice(0, 3)
    .map((r) => r.o);
}

const plain = (md: string) =>
  md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*`|\-\s]+/g, " ")
    .trim();

type DocInput = {
  title: string;
  markdown: string;
  isUpdate: boolean;
  hasTask: boolean;
  hasParent: boolean;
  /** 同项目里已有的其他文档数量 */
  otherDocs: number;
  mentioned: number;
  /** 项目里除自己外的成员数 */
  otherMembers: number;
  similar: Named[];
};

export function docHints(i: DocInput): string[] {
  const out: string[] = [];
  if (i.similar.length && !i.isUpdate)
    out.push(`已有相近的文档：${i.similar.map((s) => `「${s.name}」（${s.key}）`).join("、")}。这篇是不是重复了？问用户：更新已有的（doc_id）、挂成它的子文档，还是确实要单独新建。不要自己合并或覆盖。`);
  if (!i.hasTask) out.push("没有关联工作项：这篇文档是为哪个任务写的？告诉用户并用 link_doc 关联；确实不属于任何任务就不用管。");
  if (!i.hasParent && i.otherDocs > 0 && !i.isUpdate)
    out.push("没有挂到主题页下面：先 list_docs 看现有的树，有对应主题就用 parent_id 挂过去，别让文档平铺。");
  if (!i.mentioned && i.otherMembers > 0)
    out.push("没有 @ 任何人：需要谁评审、决策或知晓，就在正文里写 @姓名（会变成提及标签），不确定要 @ 谁就问用户。");
  const len = plain(i.markdown).length;
  if (len < 120) out.push(`正文只有 ${len} 个字，信息可能不够：补上背景、结论和依据，或者问用户是否值得单独成文。`);
  if (i.title.length > 40) out.push("标题偏长，标题要一句话讲结论，压到 30 字以内更好找。");
  if (wideTables(i.markdown)) out.push("有表格超过 7 列：网页上会挤成一团或要左右拖，拆成两张表，或把次要的列改写进正文。");
  return out;
}

type TaskInput = {
  title: string;
  description: string;
  assignees: number;
  hasParent: boolean;
  hasModule: boolean;
  mentioned: number;
  otherMembers: number;
  similar: Named[];
};

export function taskHints(i: TaskInput): string[] {
  const out: string[] = [];
  if (i.similar.length)
    out.push(`已有相近的工作项：${i.similar.map((s) => `${s.key}「${s.name}」`).join("、")}。是不是重复了？问用户：用已有的、挂成它的子任务，还是确实要新建。`);
  if (!i.assignees) out.push("没有指派人：这件事谁来做？问用户，用 update_task 的 assignees 补上（没人认领就保持未指派）。");
  if (!i.hasModule && !i.hasParent) out.push("没有放进任何模块，也没有父任务：按版本或需求归类，先 list_modules 看有没有合适的。");
  if (!/验收|完成标准|完成条件|做到|标准/.test(i.description)) out.push("描述里没有写验收标准：怎样算做完？补一两条能核验的，写给负责的人看。");
  if (plain(i.description).length < 30) out.push("描述太短，别人看不懂要做什么：补上背景和目标。");
  if (i.title.length < 4) out.push("标题太短，看不出要做什么。");
  if (i.title.length > 40) out.push("标题偏长，一件事一句话；如果包含好几件事，拆成多个任务。");
  if (!i.mentioned && i.otherMembers > 0) out.push("需要别人配合或知晓的话，在描述里用 @姓名 提到对方。");
  return out;
}

export function formatHints(hints: string[]): string {
  return hints.length ? `\n\n提示（只是提醒，不影响已写入的内容；拿不准就问用户，别擅自改）：\n${hints.map((h) => `- ${h}`).join("\n")}` : "";
}
