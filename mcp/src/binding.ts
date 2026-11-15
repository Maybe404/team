// 仓库绑定：只有绑定了团队项目的仓库里，Agent 才能往 Plane 写任务、评论、文档和团队经验。
// 防止在个人项目、私人目录里工作时把无关内容写进团队空间。
//
// 仓库根目录放 .team.json：{ "workspace": "team", "projects": ["ORDER", "PAY"] }，projects 也可以是 "*"（该工作区所有项目）。
// 没有工作目录的客户端（例如桌面聊天）可以用环境变量 TEAM_ALLOWED_PROJECTS=ORDER,PAY 显式放行。
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const BINDING_FILE = ".team.json";
export type Binding = { workspace?: string; projects: string[] | "*"; file: string };

function findUp(start: string): string | undefined {
  let dir = resolve(start);
  for (;;) {
    const f = join(dir, BINDING_FILE);
    if (existsSync(f)) return f;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export function readBinding(dirs: string[]): Binding | undefined {
  const envList = process.env.TEAM_ALLOWED_PROJECTS;
  if (envList) {
    const ps = envList.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    return { projects: ps.includes("*") ? "*" : ps, file: "环境变量 TEAM_ALLOWED_PROJECTS" };
  }
  for (const d of dirs) {
    const f = findUp(d);
    if (!f) continue;
    try {
      const j = JSON.parse(readFileSync(f, "utf8")) as { workspace?: string; projects?: string[] | string };
      const projects = j.projects === "*" ? "*" : (Array.isArray(j.projects) ? j.projects : []).map((p) => p.toUpperCase());
      return { workspace: j.workspace, projects, file: f };
    } catch {
      throw new Error(`${f} 不是合法的 JSON`);
    }
  }
  return undefined;
}

/** 客户端声明的工作目录（MCP roots），拿不到就用进程的工作目录。 */
export async function workDirs(listRoots?: () => Promise<{ roots: { uri: string }[] }>): Promise<string[]> {
  if (listRoots) {
    try {
      const { roots } = await listRoots();
      const dirs = roots.filter((r) => r.uri.startsWith("file://")).map((r) => fileURLToPath(r.uri));
      if (dirs.length) return dirs;
    } catch {
      // 客户端不支持 roots
    }
  }
  return [process.cwd()];
}

export function checkWritable(binding: Binding | undefined, workspace: string, project: string, dirs: string[]): string | undefined {
  if (!binding) {
    return `当前工作目录（${dirs.join("、")}）没有绑定团队项目，为了避免把个人项目或私人内容写进团队空间，这次没有写入。
如果这确实是团队工作，请先问用户，用户同意后调用 bind_repo 把仓库绑定到对应项目（会在仓库根目录生成 ${BINDING_FILE}，建议提交到仓库）。
和团队无关的内容不要写进来；私人经验用 propose_lesson 的 scope=private。`;
  }
  if (binding.workspace && binding.workspace !== workspace) {
    return `${binding.file} 绑定的是工作区「${binding.workspace}」，当前 MCP 连的是「${workspace}」，没有写入。`;
  }
  if (binding.projects !== "*" && !binding.projects.includes(project.toUpperCase())) {
    return `这个仓库只绑定了 ${binding.projects.join("、") || "（空）"}，没有绑定 ${project}，没有写入。确实需要的话请用户同意后用 bind_repo 加上。`;
  }
  return undefined;
}

export function writeBinding(dir: string, workspace: string, projects: string[]): string {
  const f = join(dir, BINDING_FILE);
  let existing: string[] | "*" = [];
  if (existsSync(f)) {
    const j = JSON.parse(readFileSync(f, "utf8")) as { projects?: string[] | string };
    existing = j.projects === "*" ? "*" : Array.isArray(j.projects) ? j.projects : [];
  }
  const merged = existing === "*" || projects.includes("*") ? "*" : [...new Set([...existing, ...projects.map((p) => p.toUpperCase())])];
  writeFileSync(f, `${JSON.stringify({ workspace, projects: merged }, null, 2)}\n`);
  return f;
}
