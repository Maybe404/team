// 去 AI 味检查：调用 skills/less-ai-tone（第三方 skill，CC BY-NC 4.0）的规则。
// 规则定义在 skill 的 scripts/detect.py 里，这里通过 skills/tone_bridge.py 逐行扫描，不重复维护。
//
// 分级映射（依据 skill 的两轮实测，见 skills/less-ai-tone/SKILL.md）：
//   翻案腔、提示语冒号、起手式：两轮实测同向且改动不碰语义，拒绝写入
//   其余 A 级、B 级：给出建议，不阻止写入
//   H 人审、X 已否决：不报告
//   破折号：密度 >2/千字时提示（F 指纹）
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import type { Issue } from "./style.ts";

const PKG_ROOT = join(import.meta.dirname, "..", "..");
export const SKILL_DIR = join(PKG_ROOT, "skills", "less-ai-tone");
const BRIDGE = join(PKG_ROOT, "skills", "tone_bridge.py");
const BLOCKING = new Set(["翻案腔", "提示语冒号", "起手式"]);

type BridgeHit = { level: string; rule: string; line: number; excerpt: string; advice: string };
type BridgeOut = { hanzi: number; hits: BridgeHit[]; chars: Record<string, number> };

function python(): string {
  return process.env.TEAM_PYTHON || "python3";
}

export function checkTone(markdown: string): Issue[] {
  const r = spawnSync(python(), ["-I", BRIDGE], { input: markdown, encoding: "utf8", timeout: 10_000 });
  if (r.error || r.status !== 0) {
    return [
      {
        rule: "去AI味检查",
        level: "warn",
        message: `没能运行去 AI 味检查（需要 python3）：${r.error?.message ?? r.stderr.trim().split("\n").at(-1)}`,
      },
    ];
  }
  const out = JSON.parse(r.stdout) as BridgeOut;
  const issues: Issue[] = [];
  for (const h of out.hits) {
    if (h.level === "H" || h.level === "X") continue;
    issues.push({
      rule: h.rule,
      level: BLOCKING.has(h.rule) ? "error" : "warn",
      message: h.advice,
      excerpt: h.excerpt,
      line: h.line,
    });
  }
  const dash = out.chars["破折号"] ?? 0;
  if (out.hanzi >= 200 && (dash * 1000) / out.hanzi > 2) {
    issues.push({
      rule: "破折号",
      level: "warn",
      message: `破折号 ${dash} 处（${((dash * 1000) / out.hanzi).toFixed(1)}/千字，人类参考 0.80）。逐处检查，能直接写成完整句子的就改`,
    });
  }
  return issues;
}

export function fullToneReport(markdown: string, tmpFile: string): string {
  const r = spawnSync(python(), ["-I", BRIDGE, "--full", tmpFile], { encoding: "utf8", timeout: 30_000 });
  if (r.error) return `没能运行检测：${r.error.message}`;
  return r.stdout || r.stderr;
}
