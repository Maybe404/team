// 仓库绑定：Loom 项目设置里登记了“关联代码仓库”，Agent 当前所在仓库的 git remote 能对上，才能读写这个项目。
// 没对上（个人项目、私人目录、没有 git 的地方）时只能调用 whoami 和规范类工具，防止把无关内容写进团队空间，
// 也防止在别的仓库里读到团队数据。登记由项目管理员在网页上完成，Agent 改不了。
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Project } from "./plane.ts";

/** 与 Loom 二开里的 normalize_repo_url 保持一致：git@github.com:Org/Repo.git → github.com/org/repo */
export function normalizeRepoUrl(url: string): string {
  let u = (url || "").trim();
  u = u.replace(/^[a-z+]+:\/\//i, "");
  u = u.replace(/^[^@/]+@/, "");
  u = u.replace(/^([^/:]+):(?!\d+\/)/, "$1/");
  u = u.replace(/^([^/:]+):\d+\//, "$1/");
  u = u.replace(/\/+$/, "").replace(/\.git$/, "");
  return u.toLowerCase();
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

/** 目录所在 git 仓库的所有 remote 地址（规范化后去重）。不是 git 仓库时返回空。 */
export function repoRemotes(dir: string): string[] {
  const r = spawnSync("git", ["remote", "-v"], { cwd: dir, encoding: "utf8", timeout: 5000 });
  if (r.status !== 0) return [];
  const urls = r.stdout
    .split("\n")
    .map((l) => l.split(/\s+/)[1])
    .filter(Boolean)
    .map(normalizeRepoUrl);
  return [...new Set(urls)];
}

export type RepoScope = { dirs: string[]; remotes: string[]; projects: Project[] };

/** 当前工作目录对应的团队项目：项目的 team_repos 和 git remote 有交集即算。 */
export function matchProjects(projects: Project[], remotes: string[]): Project[] {
  if (!remotes.length) return [];
  return projects.filter((p) => (p.team_repos ?? []).some((r) => remotes.includes(normalizeRepoUrl(r))));
}

export function notBoundMessage(scope: RepoScope, webUrl: string, local = true): string {
  if (!scope.remotes.length) {
    const how = local
      ? `当前目录（${scope.dirs.join("、")}）不是 git 仓库或没有 remote`
      : "没有收到 repo 参数。在 git 仓库里运行 `git remote get-url origin`，把输出填到工具的 repo 参数再调一次（每次调用都要带）；如果当前目录不是 git 仓库或没有 remote";
    return `${how}，就不属于任何团队项目。为了避免把个人内容写进团队空间，也避免在团队外读到团队数据，这里只能用 whoami、get_guide、check_text。`;
  }
  return `当前仓库（${scope.remotes.join("、")}）没有登记到任何团队项目，这里只能用 whoami、get_guide、check_text。
如果这确实是团队项目，请项目管理员在 ${webUrl} 的「项目设置 → 关联代码仓库」里填上这个仓库地址，不需要改本地任何文件。`;
}
