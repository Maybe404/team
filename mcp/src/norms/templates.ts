// 各类文档的结构模板。必填章节缺失会拒绝写入。
// 章节用二级标题（## ）匹配，别名都算数。

import type { Issue } from "./style.ts";

export type DocType = "task" | "comment" | "design" | "api" | "guide" | "retro" | "lesson" | "note";

type Section = { title: string; aliases?: string[]; hint: string };

export type Template = {
  type: DocType;
  name: string;
  purpose: string;
  required: Section[];
  optional?: Section[];
  minChars?: number;
  skeleton: string;
};

export const COMMENT_KINDS = ["进展", "结论", "阻塞", "决策", "验收", "派发", "审查"] as const;
export type CommentKind = (typeof COMMENT_KINDS)[number];

export const TEMPLATES: Record<DocType, Template> = {
  task: {
    type: "task",
    name: "任务描述",
    purpose: "让接手的人或 Agent 不用再问就能开工",
    required: [
      { title: "目标", aliases: ["背景与目标", "背景"], hint: "要解决什么问题，为什么现在做" },
      { title: "验收标准", aliases: ["完成标准", "验收"], hint: "可检查的条目，最好用勾选清单" },
    ],
    optional: [
      { title: "范围", aliases: ["不做什么", "边界"], hint: "能改什么、不能碰什么" },
      { title: "相关", aliases: ["参考", "相关资料"], hint: "文档、任务、经验的链接" },
    ],
    skeleton: "## 目标\n\n<要解决的问题和原因>\n\n## 验收标准\n\n- [ ] <可检查的条目>\n\n## 范围\n\n<能改什么，不能碰什么>\n",
  },
  comment: {
    type: "comment",
    name: "任务评论",
    purpose: "任务时间线上的一个关键节点",
    required: [],
    minChars: 10,
    skeleton: "<第一行：一句话说清这次的结论或进展>\n\n<细节：做了什么、证据（命令和结果）、下一步>\n",
  },
  design: {
    type: "design",
    name: "设计文档",
    purpose: "动手前把方案和取舍讲清楚",
    required: [
      { title: "背景", aliases: ["背景与目标", "目标"], hint: "要解决的问题" },
      { title: "方案", aliases: ["设计", "设计方案", "实现方案"], hint: "怎么做" },
      { title: "取舍", aliases: ["备选方案", "权衡", "替代方案"], hint: "考虑过但没选的做法和原因" },
    ],
    optional: [
      { title: "风险", aliases: ["风险与回滚"], hint: "可能出什么问题，怎么回滚" },
      { title: "验证", aliases: ["测试计划", "验证方式"], hint: "怎么证明它是对的" },
    ],
    minChars: 200,
    skeleton: "## 背景\n\n## 方案\n\n## 取舍\n\n## 风险\n\n## 验证\n",
  },
  api: {
    type: "api",
    name: "接口说明",
    purpose: "调用方照着就能接入",
    required: [
      { title: "概述", aliases: ["说明", "简介"], hint: "这个接口做什么、谁会调用" },
      { title: "请求", aliases: ["请求参数", "入参"], hint: "方法、路径、参数" },
      { title: "响应", aliases: ["返回", "响应示例", "出参"], hint: "返回结构和示例" },
      { title: "错误", aliases: ["错误码", "异常"], hint: "可能的错误和处理方式" },
    ],
    skeleton: "## 概述\n\n## 请求\n\n```http\nPOST /path\n```\n\n## 响应\n\n```json\n{}\n```\n\n## 错误\n\n| 状态码 | 含义 | 处理 |\n|---|---|---|\n",
  },
  guide: {
    type: "guide",
    name: "操作指南",
    purpose: "照着步骤能做完一件事",
    required: [
      { title: "适用场景", aliases: ["场景", "什么时候用"], hint: "什么情况下看这篇" },
      { title: "步骤", aliases: ["操作步骤", "做法"], hint: "编号步骤，每步可执行" },
    ],
    optional: [{ title: "常见问题", aliases: ["排查", "FAQ"], hint: "容易卡住的地方" }],
    skeleton: "## 适用场景\n\n## 步骤\n\n1. \n\n## 常见问题\n",
  },
  retro: {
    type: "retro",
    name: "复盘",
    purpose: "把一次任务或事故的经验留下来",
    required: [
      { title: "经过", aliases: ["发生了什么", "时间线"], hint: "事实，不评价" },
      { title: "原因", aliases: ["根因", "根本原因"], hint: "为什么会这样" },
      { title: "改进", aliases: ["行动项", "后续"], hint: "具体要改的地方，最好对应任务" },
    ],
    skeleton: "## 经过\n\n## 原因\n\n## 改进\n\n- [ ] \n",
  },
  lesson: {
    type: "lesson",
    name: "经验",
    purpose: "下次遇到同类任务时能直接用上",
    required: [
      { title: "场景", aliases: ["什么时候会遇到", "背景"], hint: "在什么任务、什么条件下会遇到" },
      { title: "做法", aliases: ["正确做法", "怎么做", "解决办法"], hint: "应该怎么做，最好能直接照做" },
    ],
    optional: [
      { title: "原因", aliases: ["为什么"], hint: "为什么这样做" },
      { title: "来源", aliases: ["出处"], hint: "来自哪个任务" },
    ],
    minChars: 40,
    skeleton: "## 场景\n\n<在什么任务、什么条件下会遇到>\n\n## 做法\n\n<应该怎么做>\n\n## 原因\n\n<为什么>\n\n## 来源\n\n<任务编号>\n",
  },
  note: {
    type: "note",
    name: "笔记",
    purpose: "不属于以上类型的资料",
    required: [],
    skeleton: "",
  },
};

function headingSet(markdown: string): string[] {
  return [...markdown.matchAll(/^#{2,3}\s+(.+?)\s*#*\s*$/gm)].map((m) => m[1].trim());
}

export function checkTemplate(type: DocType, markdown: string): Issue[] {
  const t = TEMPLATES[type];
  const issues: Issue[] = [];
  const headings = headingSet(markdown);
  for (const s of t.required) {
    const names = [s.title, ...(s.aliases ?? [])];
    if (!headings.some((h) => names.some((n) => h === n || h.startsWith(n)))) {
      issues.push({
        rule: "缺少章节",
        level: "error",
        message: `${t.name}缺少「${s.title}」章节（## ${s.title}）：${s.hint}`,
      });
    }
  }
  const len = markdown.replace(/\s/g, "").length;
  if (t.minChars && len < t.minChars) {
    issues.push({ rule: "内容过短", level: "error", message: `${t.name}至少 ${t.minChars} 字，当前 ${len} 字` });
  }
  if (/^#\s+/m.test(markdown) && type !== "comment") {
    issues.push({ rule: "一级标题", level: "warn", message: "正文不要写一级标题，标题单独传入" });
  }
  return issues;
}

export function checkComment(kind: CommentKind, markdown: string): Issue[] {
  const issues: Issue[] = [];
  const first = markdown.trim().split("\n")[0] ?? "";
  if (/^#/.test(first)) {
    issues.push({ rule: "评论首行", level: "error", message: "评论第一行是一句话结论，不要用标题" });
  }
  if (first.length > 120) {
    issues.push({ rule: "评论首行", level: "warn", message: "第一行控制在 120 字以内，细节放到后面" });
  }
  if ((kind === "结论" || kind === "验收") && !/(`[^`]+`|```|通过|失败|未运行|PASS|FAIL)/i.test(markdown)) {
    issues.push({
      rule: "缺少证据",
      level: "error",
      message: `「${kind}」评论要写验证证据：跑了什么命令、结果如何；没跑的写“未运行”`,
    });
  }
  if (kind === "阻塞" && !/(需要|等待|卡在|缺少)/.test(markdown)) {
    issues.push({ rule: "阻塞说明", level: "warn", message: "写清楚卡在哪、需要谁做什么" });
  }
  return issues;
}
