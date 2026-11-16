// 文风规则（去 AI 味）。所有写入 Loom 的文字都要过这里。
// level: error 拒绝写入；warn 提示但放行。
// 规则只做确定性检查，改写由调用方 Agent 自己完成。

export type Issue = {
  rule: string;
  level: "error" | "warn";
  message: string;
  excerpt?: string;
  line?: number;
};

type PhraseRule = { pattern: RegExp; hint: string };

// 对话助手的残留：文档里不该出现的客套、引子和收尾。
// 句式层面的 AI 腔（翻案腔、提示语冒号、翻译腔等）交给 less-ai-tone 检查，见 tone.ts。
// 注意：「首先/其次」「赋能/闭环」这类词表、「这意味着」在 less-ai-tone 的配对实测里不是 AI 味，不要加回来。
const FILLER_PHRASES: PhraseRule[] = [
  { pattern: /让我们(一起)?(来)?(深入)?(探讨|了解|看看|分析)/g, hint: "删掉引子，直接写内容" },
  { pattern: /希望(这|以上|本文)?(些|篇)?(内容|信息)?(对你|对您|能)(有所|有)?(帮助|用)/g, hint: "删掉客套话" },
  { pattern: /如(有|果有)(任何)?(问题|疑问)[，,]?(请|欢迎)?(随时)?(联系|告诉|提出)/g, hint: "删掉客套话" },
  { pattern: /(great question|happy to help|I hope this helps|let'?s dive)/gi, hint: "删掉英文客套话" },
];

// 只会出现在模型自述里的话
const SELF_REFERENCE: PhraseRule[] = [
  { pattern: /作为(一个)?(AI|人工智能|语言模型|助手)/g, hint: "文档里不出现写作者身份" },
  { pattern: /我(已经|刚刚)?(为你|帮你)/g, hint: "文档面向读者，不写“我帮你”" },
  { pattern: /以下是[^。\n]{0,20}(的)?(内容|总结|说明|方案)[：:]/g, hint: "删掉“以下是……”，直接给内容" },
];

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}\u{2B50}\u{2705}\u{274C}]/gu;

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

function stripCode(md: string): string {
  // 代码块和行内代码里的内容不做文风检查，用等长空白占位，保证行号不变
  return md
    .replace(/(`{3,})[^\n]*\n[\s\S]*?\n\1`*/g, (m) => m.replace(/[^\n]/g, " ")) // 围栏可能多于三个反引号（html-embed 里含 ``` 时）
    .replace(/`[^`\n]*`/g, (m) => " ".repeat(m.length));
}

function scanPhrases(text: string, rules: PhraseRule[], rule: string, level: Issue["level"]): Issue[] {
  const out: Issue[] = [];
  for (const r of rules) {
    for (const m of text.matchAll(r.pattern)) {
      out.push({ rule, level, message: r.hint, excerpt: m[0], line: lineOf(text, m.index ?? 0) });
    }
  }
  return out;
}

export function checkStyle(markdown: string): Issue[] {
  const text = stripCode(markdown);
  const issues: Issue[] = [];

  issues.push(...scanPhrases(text, FILLER_PHRASES, "套话", "error"));
  issues.push(...scanPhrases(text, SELF_REFERENCE, "模型自述", "error"));

  for (const m of text.matchAll(EMOJI)) {
    issues.push({ rule: "emoji", level: "error", message: "文档里不用 emoji", excerpt: m[0], line: lineOf(text, m.index ?? 0) });
  }

  // 加粗：只用于标签和真正的关键结论
  const bolds = [...text.matchAll(/\*\*[^*\n]+\*\*/g)];
  const chars = text.replace(/\s/g, "").length || 1;
  const boldPer1k = (bolds.length * 1000) / chars;
  if (bolds.length > 3 && boldPer1k > 8) {
    issues.push({
      rule: "加粗过多",
      level: "error",
      message: `共 ${bolds.length} 处加粗（每千字 ${boldPer1k.toFixed(1)} 处）。只给真正的关键结论加粗，每千字不超过 8 处`,
    });
  }

  // 感叹号
  const bangs = [...text.matchAll(/[！!](?!\[)/g)].filter((m) => text[(m.index ?? 0) - 1] !== "!");
  if (bangs.length > 0) {
    issues.push({ rule: "感叹号", level: "warn", message: "技术文档不用感叹号", line: lineOf(text, bangs[0].index ?? 0) });
  }

  // 结尾总结段：最后一个标题是“总结/小结/结语”
  const headings = [...text.matchAll(/^#{1,6}\s+(.+)$/gm)];
  const last = headings.at(-1);
  if (last && /^(总结|小结|结语|写在最后)\s*$/.test(last[1].trim())) {
    issues.push({
      rule: "结尾总结",
      level: "warn",
      message: "不要用“总结”收尾重复前文；要点放在开头的结论里",
      line: lineOf(text, last.index ?? 0),
    });
  }

  // 标题层级跳级
  let prevLevel = 0;
  for (const h of text.matchAll(/^(#{1,6})\s+/gm)) {
    const level = h[1].length;
    if (prevLevel && level > prevLevel + 1) {
      issues.push({ rule: "标题跳级", level: "warn", message: `标题从 H${prevLevel} 跳到 H${level}`, line: lineOf(text, h.index ?? 0) });
    }
    prevLevel = level;
  }

  // 中文标点：中文句子里用了英文逗号/句号
  for (const m of text.matchAll(/[一-龥][,;:?](?=[一-龥])/g)) {
    issues.push({ rule: "标点", level: "warn", message: "中文句子用全角标点", excerpt: m[0], line: lineOf(text, m.index ?? 0) });
  }

  return issues;
}
