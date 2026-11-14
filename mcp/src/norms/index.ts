// 规范闸门：所有写入工具在调用 Plane 之前都要经过 gate()。
import { checkStyle, type Issue } from "./style.ts";
import { checkComment, checkTemplate, TEMPLATES, type CommentKind, type DocType } from "./templates.ts";

export { TEMPLATES, COMMENT_KINDS, type DocType, type CommentKind } from "./templates.ts";
export type { Issue } from "./style.ts";

export type GateResult = { ok: boolean; errors: Issue[]; warnings: Issue[] };

export function gate(markdown: string, type: DocType, opts: { commentKind?: CommentKind; title?: string } = {}): GateResult {
  const issues: Issue[] = [...checkStyle(markdown)];
  if (opts.title) {
    issues.push(...checkStyle(opts.title).map((i) => ({ ...i, message: `标题：${i.message}`, line: undefined })));
  }
  issues.push(...(type === "comment" ? checkComment(opts.commentKind ?? "进展", markdown) : checkTemplate(type, markdown)));
  const errors = issues.filter((i) => i.level === "error");
  return { ok: errors.length === 0, errors, warnings: issues.filter((i) => i.level === "warn") };
}

export function formatGate(result: GateResult): string {
  const fmt = (i: Issue) =>
    `- [${i.rule}]${i.line ? ` 第 ${i.line} 行` : ""}${i.excerpt ? ` 「${i.excerpt}」` : ""}：${i.message}`;
  const parts: string[] = [];
  if (result.errors.length) parts.push(`未通过规范检查，没有写入。请按下面逐条修改后重新提交：\n${result.errors.map(fmt).join("\n")}`);
  if (result.warnings.length) parts.push(`建议修改：\n${result.warnings.map(fmt).join("\n")}`);
  return parts.join("\n\n");
}

export const WRITING_GUIDE = `# 团队写作规范

所有通过 team-mcp 写入的任务、评论、文档和经验都要符合这份规范。服务端会逐条检查，不符合的会被退回。

## 基本要求

1. 结论先行：第一段或第一行直接给结论，细节放后面。
2. 写事实和证据，不写感受：说“跑了 \`pnpm test\`，42 个用例全部通过”，不说“测试情况良好”。
3. 一个意思说一次。不写引子，不写结尾总结，不写客套话。
4. 读者可能是人，也可能是另一个 Agent：路径、命令、编号写全，不用“上面提到的那个”。

## 不要出现的写法（会被拒绝）

- 套话：“值得注意的是”“让我们深入探讨”“总而言之”“综上所述”“希望对你有帮助”“如有问题请随时联系”
- 空泛形容：“至关重要”“无缝”“赋能”“闭环”“一站式”
- “首先/其次/最后”式铺陈：改用编号列表
- 模型自述：“作为 AI”“我为你……”“以下是……的总结：”
- emoji
- 大量加粗：每千字不超过 8 处，只给关键结论加粗

## 格式

- 正文从二级标题（##）开始，标题单独传入，不要在正文写一级标题。
- 标题层级不跳级。
- 中文句子用全角标点；代码、命令、路径、字段名用反引号。
- 不用感叹号。

## 各类文档

${Object.values(TEMPLATES)
  .map(
    (t) =>
      `### ${t.name}（type: \`${t.type}\`）\n\n${t.purpose}。${
        t.required.length ? `必填章节：${t.required.map((s) => `「${s.title}」`).join("、")}。` : ""
      }${t.optional?.length ? `可选章节：${t.optional.map((s) => `「${s.title}」`).join("、")}。` : ""}${
        t.minChars ? `至少 ${t.minChars} 字。` : ""
      }`,
  )
  .join("\n\n")}

## 任务评论

评论第一行是一句话结论，后面写细节。类型有：进展、结论、阻塞、决策、验收、派发、审查。
“结论”和“验收”必须写验证证据（命令和结果）；没跑的检查写“未运行”。
`;

export function templateGuide(type: DocType): string {
  const t = TEMPLATES[type];
  return `# ${t.name}模板（type: ${t.type}）\n\n用途：${t.purpose}\n\n${
    t.required.length ? `必填章节：\n${t.required.map((s) => `- ${s.title}：${s.hint}`).join("\n")}\n\n` : ""
  }${t.optional?.length ? `可选章节：\n${t.optional.map((s) => `- ${s.title}：${s.hint}`).join("\n")}\n\n` : ""}骨架：\n\n\`\`\`markdown\n${t.skeleton}\`\`\`\n`;
}
