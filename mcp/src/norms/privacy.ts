// 隐私闸门：写进团队空间之前拦住密钥、个人信息和本机文件。
// 代码块里也查：密钥写在代码块里一样会泄露。
import type { Issue } from "./style.ts";

type Rule = { rule: string; level: "error" | "warn"; pattern: RegExp; message: string; skip?: (m: string) => boolean };

const PLACEHOLDER = /^(<[^>]+>|\$\{?[A-Z_]+\}?|x{3,}|\*{3,}|\.{3}|your[-_]|example|changeme|placeholder|test|dummy|redacted)/i;

const RULES: Rule[] = [
  { rule: "密钥", level: "error", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g, message: "不要把私钥写进团队空间" },
  {
    rule: "密钥",
    level: "error",
    pattern: /\b(sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|plane_api_[0-9a-f]{32}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g,
    message: "疑似 API Key / Token，改成占位符（例如 `<API_KEY>`），真实值放到本机环境变量或密码管理器",
  },
  {
    rule: "密钥",
    level: "error",
    pattern: /\b(password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|密码|口令)\s*[:=：]\s*["'`]?([^\s"'`，。]{6,})/gi,
    message: "疑似把密码或密钥写成了明文，改成占位符",
    skip: (m) => PLACEHOLDER.test(m.replace(/^[^:=：]+[:=：]\s*["'`]?/, "")),
  },
  { rule: "个人信息", level: "error", pattern: /(?<![\d.])1[3-9]\d{9}(?![\d.])/g, message: "疑似手机号，团队文档里不写个人联系方式" },
  { rule: "个人信息", level: "error", pattern: /(?<!\d)[1-9]\d{5}(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx](?!\d)/g, message: "疑似身份证号" },
  { rule: "个人信息", level: "warn", pattern: /(?<![\d.])[3-6]\d{15,18}(?![\d.])/g, message: "疑似银行卡号，确认后再写" },
  {
    rule: "本机文件",
    level: "error",
    pattern: /!\[[^\]]*\]\((file:\/\/|\/Users\/|\/home\/|~\/|[A-Za-z]:\\)[^)]*\)/g,
    message: "图片指向本机文件，别人打不开，也可能带出私人文件。需要的图片请在织机网页上传",
  },
  {
    rule: "本机路径",
    level: "warn",
    pattern: /(\/Users\/|\/home\/|C:\\Users\\)[A-Za-z0-9._-]+/g,
    message: "本机绝对路径会暴露用户名和目录结构，改成仓库内的相对路径",
  },
];

export function checkPrivacy(md: string): Issue[] {
  const issues: Issue[] = [];
  const lines = md.split("\n");
  lines.forEach((line, i) => {
    for (const r of RULES) {
      for (const m of line.matchAll(r.pattern)) {
        if (r.skip?.(m[0])) continue;
        const shown = r.rule === "密钥" ? `${m[0].slice(0, 6)}…` : m[0].slice(0, 40);
        issues.push({ rule: r.rule, level: r.level, message: r.message, excerpt: shown, line: i + 1 });
      }
    }
  });
  return issues;
}
