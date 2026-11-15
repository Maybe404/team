// 规范闸门：所有写入工具在调用 Plane 之前都要经过 gate()。
import { checkStyle, type Issue } from "./style.ts";
import { checkTone } from "./tone.ts";
import { checkPrivacy } from "./privacy.ts";
import { checkComment, checkTemplate, TEMPLATES, type CommentKind, type DocType } from "./templates.ts";

export { TEMPLATES, COMMENT_KINDS, type DocType, type CommentKind } from "./templates.ts";
export type { Issue } from "./style.ts";

export type GateResult = { ok: boolean; errors: Issue[]; warnings: Issue[] };

export function gate(markdown: string, type: DocType, opts: { commentKind?: CommentKind; title?: string } = {}): GateResult {
  const issues: Issue[] = [...checkPrivacy(markdown), ...checkStyle(markdown), ...checkTone(markdown)];
  if (opts.title) {
    issues.push(
      ...[...checkPrivacy(opts.title), ...checkStyle(opts.title), ...checkTone(opts.title)].map((i) => ({ ...i, message: `标题：${i.message}`, line: undefined })),
    );
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
3. 一个意思说一次。不写引子和客套话。
4. 读者可能是人，也可能是另一个 Agent：路径、命令、编号写全，不用“上面提到的那个”。

## 去 AI 味

句式检查用第三方 skill「去 AI 味 v2」（lieflat-less-ai-tone，CC BY-NC 4.0，规则基于 629 篇对照和 270 对配对实测）。完整说明见资源 \`team://skills/less-ai-tone\`。

会被拒绝的（两轮实测同向、改动不碰语义）：

- 翻案腔：先立一个读者没有的误解再推翻。「不是……而是……」「与其说……不如说……」。直接正面下判断。
- 提示语冒号：「一句话总结：」「核心是：」「原因如下：」。删掉提示语直接写，前半句承接上文时只换标点。
- 起手式：「说白了，」「说穿了，」「先说结论，」。删掉。

会提示、不阻止的：「当……时，」前置从句、「对于……来说」话题壳、段首「然而，/因此，/此外，」、一句里三项以上顿号并列、过长前置定语、破折号过密。

不要为了"像人写的"去改这些（实测不是 AI 味）：序数词小标题、「这意味着」、冒号引出列表、「首先/其次」、「赋能/闭环」这类词、句长长短。

另外，文档里不出现对话助手的残留：

- 客套话：「希望对你有帮助」「如有问题请随时联系」「让我们深入探讨」
- 模型自述：「作为 AI」「我为你……」「以下是……的总结：」
- emoji
- 大量加粗：每千字不超过 8 处，只给关键结论加粗

## 隐私

团队空间里所有成员都能看到，写之前确认内容属于团队工作。服务端会拦：

- 密钥：API Key、Token、私钥、明文密码。用占位符（例如 \`<API_KEY>\`），真实值放本机环境变量。
- 个人信息：手机号、身份证号、银行卡号。
- 本机文件：指向本机的图片和文件链接。需要的图片在 Plane 网页上传。
- 本机绝对路径（提示）：改成仓库内的相对路径。

私人项目、私人笔记、和团队无关的内容不要写进来；私人经验用 propose_lesson 的 scope=private，只存在本机。

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
