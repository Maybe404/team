// Loom REST 客户端（/api/v1，API Token 认证）。只封装 MCP 用得到的接口。

export type PlaneConfig = { baseUrl: string; token: string; workspace: string; webUrl?: string };

export type Project = {
  id: string;
  name: string;
  identifier: string;
  description?: string;
  is_member?: boolean;
  team_repos?: string[];
};

/** 项目存在但当前账号不是成员时，给出能照着做的提示。 */
export function assertMember(p: Project): Project {
  if (p.is_member === false) {
    throw new Error(`你还不是项目 ${p.identifier}（${p.name}）的成员。请项目管理员在网页上把你加进项目（项目设置 → 成员）。`);
  }
  return p;
}
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
  parent?: string | null;
  created_by?: string;
};
export type Module = {
  id: string;
  name: string;
  description?: string | null;
  status: string;
  start_date?: string | null;
  target_date?: string | null;
  lead?: string | null;
  total_issues?: number;
  completed_issues?: number;
};
export type Cycle = {
  id: string;
  name: string;
  description?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  total_issues?: number;
  completed_issues?: number;
};
export type View = {
  id: string;
  name: string;
  description: string;
  rich_filters: { and?: Record<string, string>[] } | Record<string, never>;
  display_filters: Record<string, unknown>;
  access: number;
  owned_by_id: string;
};
export type Member = { id: string; email?: string; display_name: string; first_name?: string; last_name?: string };
export type LinkedPage = { id: string; name: string; owned_by: string; access: number; archived: boolean };
export type LinkedIssue = { id: string; key: string; name: string; state: string };
export type Link = { id: string; url: string; title?: string | null };
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
    super(`Loom ${status} ${path}: ${body.slice(0, 300)}`);
    this.status = status;
    this.body = body;
    this.path = path;
  }
}

export class Loom {
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

  // 成员
  listProjectMembers(projectId: string) {
    return this.req<Member[]>("GET", this.ws(`projects/${projectId}/members/`));
  }

  // 项目
  listProjects() {
    return this.all<Project>(this.ws("projects/"));
  }
  createProject(name: string, identifier: string, description = "") {
    return this.req<Project>("POST", this.ws("projects/"), { name, identifier, description });
  }

  // 状态、标签
  listStates(projectId: string) {
    return this.all<State>(this.ws(`projects/${projectId}/states/`));
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
  listLinks(projectId: string, itemId: string) {
    return this.all<Link>(this.ws(`projects/${projectId}/work-items/${itemId}/links/`));
  }
  addLink(projectId: string, itemId: string, url: string, title: string) {
    return this.req("POST", this.ws(`projects/${projectId}/work-items/${itemId}/links/`), { url, title });
  }

  // 文档 ↔ 工作项关联（二开接口）
  listIssuePages(projectId: string, itemId: string) {
    return this.req<LinkedPage[]>("GET", this.ws(`projects/${projectId}/work-items/${itemId}/pages/`));
  }
  linkPage(projectId: string, itemId: string, pageId: string) {
    return this.req<LinkedPage[]>("POST", this.ws(`projects/${projectId}/work-items/${itemId}/pages/`), { page_id: pageId });
  }
  listPageIssues(projectId: string, pageId: string) {
    return this.req<LinkedIssue[]>("GET", this.ws(`projects/${projectId}/pages/${pageId}/work-items/`));
  }

  // 页面图片（二开接口）：返回附件 ID，在 Markdown 里写 ![](asset:<ID>)
  async uploadPageImage(projectId: string, name: string, contentType: string, dataBase64: string): Promise<string> {
    const r = await this.req<{ asset_id: string }>("POST", this.ws(`projects/${projectId}/page-images/`), {
      name,
      content_type: contentType,
      data_base64: dataBase64,
    });
    return r.asset_id;
  }

  /** 收集里待分诊（状态为待处理）的条目名称 */
  async listIntakePending(projectId: string): Promise<string[]> {
    const rows = await this.all<{ status?: number; issue_detail?: { name?: string }; name?: string }>(this.ws(`projects/${projectId}/intake-issues/`), 200);
    return rows.filter((r) => r.status === -2).map((r) => r.issue_detail?.name ?? r.name ?? "（无标题）");
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
  updatePage(projectId: string, pageId: string, body: { name?: string; description_html?: string; parent_id?: string }) {
    return this.req<Page>("PATCH", this.ws(`projects/${projectId}/pages/${pageId}/`), body);
  }

  // 模块
  listModules(projectId: string) {
    return this.all<Module>(this.ws(`projects/${projectId}/modules/`), 200);
  }
  createModule(projectId: string, body: Record<string, unknown>) {
    return this.req<Module>("POST", this.ws(`projects/${projectId}/modules/`), body);
  }
  updateModule(projectId: string, moduleId: string, body: Record<string, unknown>) {
    return this.req<Module>("PATCH", this.ws(`projects/${projectId}/modules/${moduleId}/`), body);
  }
  /** 模块里所有工作项的 ID */
  async listModuleIssueIds(projectId: string, moduleId: string): Promise<string[]> {
    const rows = await this.all<{ id?: string; issue?: string }>(this.ws(`projects/${projectId}/modules/${moduleId}/module-issues/`), 1000);
    return rows.map((r) => r.id ?? r.issue ?? "").filter(Boolean);
  }
  addModuleIssues(projectId: string, moduleId: string, issueIds: string[]) {
    return this.req("POST", this.ws(`projects/${projectId}/modules/${moduleId}/module-issues/`), { issues: issueIds });
  }
  removeModuleIssue(projectId: string, moduleId: string, issueId: string) {
    return this.req("DELETE", this.ws(`projects/${projectId}/modules/${moduleId}/module-issues/${issueId}/`));
  }

  // 周期（只读，在网页上维护）
  listCycles(projectId: string) {
    return this.all<Cycle>(this.ws(`projects/${projectId}/cycles/`), 200);
  }
  async listCycleIssueIds(projectId: string, cycleId: string): Promise<string[]> {
    const rows = await this.all<{ id?: string; issue?: string }>(this.ws(`projects/${projectId}/cycles/${cycleId}/cycle-issues/`), 1000);
    return rows.map((r) => r.id ?? r.issue ?? "").filter(Boolean);
  }

  // 视图（二开接口）
  listViews(projectId: string) {
    return this.req<View[]>("GET", this.ws(`projects/${projectId}/views/`));
  }
  createView(projectId: string, body: Record<string, unknown>) {
    return this.req<View>("POST", this.ws(`projects/${projectId}/views/`), body);
  }
  updateView(projectId: string, viewId: string, body: Record<string, unknown>) {
    return this.req<View>("PATCH", this.ws(`projects/${projectId}/views/${viewId}/`), body);
  }
}
