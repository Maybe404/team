/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// [team 二开] 文档 ↔ 工作项关联：工作项侧边栏里「关联文档」，文档菜单里「关联工作项」，两边看到的是同一份数据。
// 谁能建立关联由服务端判断（工作项的创建人、指派人、文档作者或管理员），没有权限时提示原因。
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { Button } from "@makeplane/propel/components/button";
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogHeading,
  DialogMain,
  DialogTitle,
} from "@makeplane/propel/components/dialog";
import { setToast } from "@plane/blocks/toast";
import { API_BASE_URL } from "@plane/constants";
import { APIService } from "@/services/api.service";

type LinkedPage = { id: string; name: string; owned_by: string; archived: boolean };
type LinkedIssue = { id: string; key: string; name: string; state: string };
type Candidate = { id: string; name: string; key?: string; meta: string; updated_at: string };

class TeamPageIssueService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }
  private base(ws: string, project: string) {
    return `/api/workspaces/${ws}/projects/${project}`;
  }
  pagesOfIssue(ws: string, project: string, issue: string): Promise<LinkedPage[]> {
    return this.get(`${this.base(ws, project)}/issues/${issue}/team-pages/`).then((r) => r.data);
  }
  linkPage(ws: string, project: string, issue: string, page: string): Promise<LinkedPage[]> {
    return this.post(`${this.base(ws, project)}/issues/${issue}/team-pages/`, { page_id: page }).then((r) => r.data);
  }
  unlinkPage(ws: string, project: string, issue: string, page: string): Promise<LinkedPage[]> {
    return this.delete(`${this.base(ws, project)}/issues/${issue}/team-pages/?page_id=${page}`).then((r) => r.data);
  }
  issuesOfPage(ws: string, project: string, page: string): Promise<LinkedIssue[]> {
    return this.get(`${this.base(ws, project)}/pages/${page}/team-issues/`).then((r) => r.data);
  }
  linkIssue(ws: string, project: string, page: string, issue: string, children = false): Promise<LinkedIssue[]> {
    return this.post(`${this.base(ws, project)}/pages/${page}/team-issues/`, { issue_id: issue, include_children: children }).then((r) => r.data);
  }
  unlinkIssue(ws: string, project: string, page: string, issue: string, children = false): Promise<LinkedIssue[]> {
    return this.delete(`${this.base(ws, project)}/pages/${page}/team-issues/?issue_id=${issue}${children ? "&include_children=1" : ""}`).then((r) => r.data);
  }
  candidates(ws: string, project: string, kind: "pages" | "issues", q: string): Promise<Candidate[]> {
    return this.get(`${this.base(ws, project)}/team-link-candidates/`, { params: { kind, q } }).then((r) => r.data);
  }
}
const service = new TeamPageIssueService();

const errorMessage = (e: unknown) => (e as { error?: string })?.error ?? "请稍后再试";
const fail = (e: unknown) => setToast({ type: "error", title: "操作失败", message: errorMessage(e) });

const ago = (iso: string) => {
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" });
  for (const [unit, sec] of [["day", 86400], ["hour", 3600], ["minute", 60]] as const) {
    if (Math.abs(diff) >= sec) return rtf.format(Math.round(diff / sec), unit);
  }
  return "刚刚";
};

function LinkedRow({ href, title, hint, onRemove }: { href: string; title: string; hint?: string; onRemove?: () => void }) {
  return (
    <div className="group/row flex items-center justify-between gap-2 rounded-md border-[0.5px] border-subtle px-2 py-1.5 hover:bg-layer-transparent-hover">
      <Link to={href} className="min-w-0 flex-1 truncate text-body-xs-regular text-primary hover:underline">
        {title}
        {hint && <span className="ml-2 text-caption-sm-regular text-tertiary">{hint}</span>}
      </Link>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 text-caption-sm-regular text-tertiary opacity-0 transition-opacity group-hover/row:opacity-100 hover:text-primary"
        >
          取消关联
        </button>
      )}
    </div>
  );
}

/**
 * 关联弹窗里的选择器：不输入时列出最近更新的（推荐），输入后模糊搜索；列表可滚动，
 * 点一下关联，再点一下取消，可连续选多个。
 */
function LinkPicker(props: {
  items: Candidate[] | null;
  linkedIds: Set<string>;
  query: string;
  onQuery: (q: string) => void;
  placeholder: string;
  emptyText: string;
  onToggle: (item: Candidate, linked: boolean) => void;
}) {
  const { items, linkedIds, query, onQuery, placeholder, emptyText, onToggle } = props;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 rounded-md border-[0.5px] border-subtle bg-surface-1 px-2.5 py-1.5 focus-within:border-accent-strong">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 text-tertiary">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          autoFocus
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-transparent text-body-xs-regular text-primary outline-none placeholder:text-placeholder"
        />
      </div>
      <div className="px-1 text-caption-sm-medium text-tertiary">{query.trim() ? "搜索结果" : "最近更新"}</div>
      <div className="vertical-scrollbar scrollbar-sm -mx-1 max-h-72 min-h-24 overflow-y-auto px-1">
        {items === null && <div className="py-6 text-center text-caption-md-regular text-tertiary">加载中…</div>}
        {items?.length === 0 && <div className="py-6 text-center text-caption-md-regular text-tertiary">{emptyText}</div>}
        {items?.map((it) => {
          const linked = linkedIds.has(it.id);
          return (
            <button
              key={it.id}
              type="button"
              onClick={() => onToggle(it, linked)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-layer-transparent-hover"
            >
              {it.key && <span className="shrink-0 text-caption-sm-regular text-tertiary">{it.key}</span>}
              <span className="min-w-0 flex-1 truncate text-body-xs-regular text-primary">{it.name || "未命名"}</span>
              <span className="shrink-0 text-caption-sm-regular text-tertiary">
                {[it.meta, ago(it.updated_at)].filter(Boolean).join(" · ")}
              </span>
              {linked ? (
                <span className="shrink-0 rounded bg-accent-subtle px-1.5 py-0.5 text-caption-sm-medium text-accent-primary">已关联</span>
              ) : (
                <span className="w-[42px] shrink-0" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** 防抖地取候选：query 为空时取最近更新的。 */
function useCandidates(enabled: boolean, ws: string, project: string, kind: "pages" | "issues") {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Candidate[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let stale = false;
    const timer = setTimeout(
      () => {
        service
          .candidates(ws, project, kind, query.trim())
          .then((r) => !stale && setItems(r))
          .catch(() => !stale && setItems([]));
      },
      query ? 250 : 0
    );
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [enabled, ws, project, kind, query]);
  const reset = () => {
    setQuery("");
    setItems(null);
  };
  return { query, setQuery, items, reset };
}

/** 工作项侧边栏：这个工作项关联的文档，可以一键关联 / 取消。 */
export function TeamIssuePages(props: { workspaceSlug: string; projectId: string; issueId: string }) {
  const { workspaceSlug, projectId, issueId } = props;
  const [pages, setPages] = useState<LinkedPage[] | null>(null);
  const [picking, setPicking] = useState(false);
  const picker = useCandidates(picking, workspaceSlug, projectId, "pages");

  const load = useCallback(() => {
    service
      .pagesOfIssue(workspaceSlug, projectId, issueId)
      .then(setPages)
      .catch(() => setPages([]));
  }, [workspaceSlug, projectId, issueId]);
  useEffect(load, [load]);

  return (
    <div className="flex flex-col gap-2">
      {(pages ?? []).map((p) => (
        <LinkedRow
          key={p.id}
          href={`/${workspaceSlug}/projects/${projectId}/pages/${p.id}`}
          title={p.name || "未命名文档"}
          hint={p.owned_by}
          onRemove={() => void service.unlinkPage(workspaceSlug, projectId, issueId, p.id).then(setPages).catch(fail)}
        />
      ))}
      {pages && pages.length === 0 && <div className="text-caption-sm-regular text-tertiary">还没有关联文档</div>}
      <div>
        <Button
          variant="secondary"
          size="sm"
          stretch="auto"
          label="关联文档"
          onClick={() => {
            picker.reset();
            setPicking(true);
          }}
        />
      </div>
      <Dialog open={picking} onOpenChange={(open) => !open && setPicking(false)}>
        <DialogContent size="md">
          <DialogMain>
            <DialogHeader>
              <DialogHeading>
                <DialogTitle>关联文档</DialogTitle>
                <DialogDescription>可以选多篇。点一下关联，再点一下取消。</DialogDescription>
              </DialogHeading>
            </DialogHeader>
            <DialogBody>
              <LinkPicker
                items={picker.items}
                linkedIds={new Set((pages ?? []).map((p) => p.id))}
                query={picker.query}
                onQuery={picker.setQuery}
                placeholder="搜索文档标题"
                emptyText="没有找到文档"
                onToggle={(it, linked) =>
                  void (linked
                    ? service.unlinkPage(workspaceSlug, projectId, issueId, it.id)
                    : service.linkPage(workspaceSlug, projectId, issueId, it.id)
                  )
                    .then(setPages)
                    .catch(fail)
                }
              />
            </DialogBody>
          </DialogMain>
          <DialogActions>
            <Button variant="primary" size="sm" stretch="auto" label="完成" onClick={() => setPicking(false)} />
          </DialogActions>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** 文档菜单里的「关联工作项」弹窗：看这篇文档关联了哪些工作项，搜索并一键关联。 */
export function TeamPageIssuesModal(props: {
  isOpen: boolean;
  onClose: () => void;
  workspaceSlug: string;
  projectId: string;
  pageId: string;
}) {
  const { isOpen, onClose, workspaceSlug, projectId, pageId } = props;
  const [issues, setIssues] = useState<LinkedIssue[] | null>(null);
  // [team 二开] 关联、取消关联时要不要连子页面一起处理
  const [withChildren, setWithChildren] = useState(false);
  const picker = useCandidates(isOpen, workspaceSlug, projectId, "issues");
  const { reset } = picker;

  useEffect(() => {
    if (!isOpen || !projectId || !pageId) return;
    reset();
    service
      .issuesOfPage(workspaceSlug, projectId, pageId)
      .then(setIssues)
      .catch(() => setIssues([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, workspaceSlug, projectId, pageId]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md">
        <DialogMain>
          <DialogHeader>
            <DialogHeading>
              <DialogTitle>关联工作项</DialogTitle>
              <DialogDescription>可以选多个。点一下关联，再点一下取消；工作项页里也会看到这篇文档。</DialogDescription>
            </DialogHeading>
          </DialogHeader>
          <DialogBody>
            <label className="mb-2 flex items-center gap-2 text-caption-sm-regular text-secondary">
              <input type="checkbox" checked={withChildren} onChange={(e) => setWithChildren(e.target.checked)} />
              同时对子页面生效（关联、取消关联都会带上它的所有子页面）
            </label>
            <LinkPicker
              items={picker.items}
              linkedIds={new Set((issues ?? []).map((i) => i.id))}
              query={picker.query}
              onQuery={picker.setQuery}
              placeholder="搜索工作项标题或编号"
              emptyText="没有找到工作项"
              onToggle={(it, linked) =>
                void (linked
                  ? service.unlinkIssue(workspaceSlug, projectId, pageId, it.id, withChildren)
                  : service.linkIssue(workspaceSlug, projectId, pageId, it.id, withChildren)
                )
                  .then(setIssues)
                  .catch(fail)
              }
            />
          </DialogBody>
        </DialogMain>
        <DialogActions>
          <Button variant="primary" size="sm" stretch="auto" label="完成" onClick={onClose} />
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}
