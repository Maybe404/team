// Plane REST 客户端（/api/v1，API Token 认证）。只封装 MCP 用得到的接口。

export type PlaneConfig = { baseUrl: string; token: string; workspace: string; webUrl?: string };

export type Project = { id: string; name: string; identifier: string; description?: string };
export type State = { id: string; name: string; group: string; color: string; sequence?: number };
export type Label = { id: string; name: string; color?: string };
export type WorkItem = {
  id: string;
  name: string;
  sequence_id: number;
  description_html: string;
  state: string;
  priority: string;
  assignees: string[];
  labels: string[];
  project: string;
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
};
export type Comment = { id: string; comment_html: string; actor: string; created_at: string };
export type Page = {
  id: string;
  name: string;
  description_html?: string;
  updated_at: string;
  owned_by_id: string;
  parent_id: string | null;
  live_editing?: boolean;
};
export type Me = { id: string; email: string; display_name: string };

type Paginated<T> = { results: T[]; next_cursor?: string; next_page_results?: boolean };

export class PlaneError extends Error {
  status: number;
  body: string;
  path: string;
  constructor(status: number, body: string, path: string) {
    super(`Plane ${status} ${path}: ${body.slice(0, 300)}`);
    this.status = status;
    this.body = body;
    this.path = path;
  }
}

export class Plane {
  private cfg: PlaneConfig;
  constructor(cfg: PlaneConfig) {
    this.cfg = cfg;
  }

  get workspace() {
    return this.cfg.workspace;
  }

  webUrl(path: string) {
    const base = (this.cfg.webUrl || this.cfg.baseUrl).replace(/\/$/, "");
    return `${base}/${this.cfg.workspace}/${path.replace(/^\//, "")}`;
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.cfg.baseUrl.replace(/\/$/, "")}/api/v1/${path.replace(/^\//, "")}`;
    const res = await fetch(url, {
      method,
      headers: { "X-API-Key": this.cfg.token, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new PlaneError(res.status, text, `${method} ${path}`);
    return (text ? JSON.parse(text) : undefined) as T;
  }

  private ws(path: string) {
    return `workspaces/${this.cfg.workspace}/${path.replace(/^\//, "")}`;
  }

  private async all<T>(path: string, limit = 500): Promise<T[]> {
    const out: T[] = [];
    let cursor: string | undefined;
    const sep = path.includes("?") ? "&" : "?";
    while (out.length < limit) {
      const page = await this.req<Paginated<T> | T[]>(
        "GET",
        `${path}${sep}per_page=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      if (Array.isArray(page)) return page;
      out.push(...page.results);
      if (!page.next_page_results || !page.next_cursor) break;
      cursor = page.next_cursor;
    }
    return out;
  }

  me() {
    return this.req<Me>("GET", "users/me/");
  }

  // 项目
  listProjects() {
    return this.all<Project>(this.ws("projects/"));
  }
  createProject(name: string, identifier: string, description = "") {
    return this.req<Project>("POST", this.ws("projects/"), { name, identifier, description });
  }
  async resolveProject(ref: string): Promise<Project> {
    const projects = await this.listProjects();
    const key = ref.trim().toLowerCase();
    const hit = projects.find((p) => p.id === ref || p.identifier.toLowerCase() === key || p.name.toLowerCase() === key);
    if (!hit) {
      throw new Error(`找不到项目「${ref}」。现有项目：${projects.map((p) => `${p.identifier}（${p.name}）`).join("、") || "无"}`);
    }
    return hit;
  }

  // 状态、标签
  listStates(projectId: string) {
    return this.all<State>(this.ws(`projects/${projectId}/states/`));
  }
  createState(projectId: string, s: { name: string; group: string; color: string }) {
    return this.req<State>("POST", this.ws(`projects/${projectId}/states/`), s);
  }
  updateState(projectId: string, stateId: string, s: Partial<{ name: string; color: string; default: boolean }>) {
    return this.req<State>("PATCH", this.ws(`projects/${projectId}/states/${stateId}/`), s);
  }
  listLabels(projectId: string) {
    return this.all<Label>(this.ws(`projects/${projectId}/labels/`));
  }
  createLabel(projectId: string, name: string) {
    return this.req<Label>("POST", this.ws(`projects/${projectId}/labels/`), { name });
  }

  // 工作项
  listWorkItems(projectId: string) {
    return this.all<WorkItem>(this.ws(`projects/${projectId}/work-items/`), 1000);
  }
  getWorkItem(projectId: string, id: string) {
    return this.req<WorkItem>("GET", this.ws(`projects/${projectId}/work-items/${id}/`));
  }
  getWorkItemByKey(key: string) {
    return this.req<WorkItem>("GET", this.ws(`work-items/${key}/`));
  }
  createWorkItem(projectId: string, body: Record<string, unknown>) {
    return this.req<WorkItem>("POST", this.ws(`projects/${projectId}/work-items/`), body);
  }
  updateWorkItem(projectId: string, id: string, body: Record<string, unknown>) {
    return this.req<WorkItem>("PATCH", this.ws(`projects/${projectId}/work-items/${id}/`), body);
  }
  searchWorkItems(q: string) {
    return this.req<{ issues: { id: string; name: string; sequence_id: number; project__identifier: string; project_id: string }[] }>(
      "GET",
      this.ws(`work-items/search/?search=${encodeURIComponent(q)}`),
    );
  }
  listComments(projectId: string, itemId: string) {
    return this.all<Comment>(this.ws(`projects/${projectId}/work-items/${itemId}/comments/`));
  }
  createComment(projectId: string, itemId: string, html: string) {
    return this.req<Comment>("POST", this.ws(`projects/${projectId}/work-items/${itemId}/comments/`), { comment_html: html });
  }
  addLink(projectId: string, itemId: string, url: string, title: string) {
    return this.req("POST", this.ws(`projects/${projectId}/work-items/${itemId}/links/`), { url, title });
  }

  // Page（二开接口）
  listPages(projectId: string, search?: string) {
    return this.all<Page>(this.ws(`projects/${projectId}/pages/${search ? `?search=${encodeURIComponent(search)}` : ""}`), 300);
  }
  getPage(projectId: string, pageId: string) {
    return this.req<Page>("GET", this.ws(`projects/${projectId}/pages/${pageId}/`));
  }
  createPage(projectId: string, name: string, html: string, parent?: string) {
    return this.req<Page>("POST", this.ws(`projects/${projectId}/pages/`), { name, description_html: html, parent });
  }
  updatePage(projectId: string, pageId: string, body: { name?: string; description_html?: string }) {
    return this.req<Page>("PATCH", this.ws(`projects/${projectId}/pages/${pageId}/`), body);
  }
}
