/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// [team 二开] 文档 ↔ 工作项关联：工作项侧边栏里「关联文档」，文档菜单里「关联工作项」，两边看到的是同一份数据。
// 谁能建立关联由服务端判断（工作项的创建人、指派人、文档作者或管理员），没有权限时提示原因。
import { useCallback, useEffect, useState } from "react";
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
type PageOption = { id: string; name: string };
type IssueOption = { id: string; name: string; sequence_id: number; project__identifier: string; state__name?: string };

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
  linkIssue(ws: string, project: string, page: string, issue: string): Promise<LinkedIssue[]> {
    return this.post(`${this.base(ws, project)}/pages/${page}/team-issues/`, { issue_id: issue }).then((r) => r.data);
  }
  unlinkIssue(ws: string, project: string, page: string, issue: string): Promise<LinkedIssue[]> {
    return this.delete(`${this.base(ws, project)}/pages/${page}/team-issues/?issue_id=${issue}`).then((r) => r.data);
  }
  projectPages(ws: string, project: string): Promise<PageOption[]> {
    return this.get(`${this.base(ws, project)}/pages/`).then((r) => r.data);
  }
  searchIssues(ws: string, project: string, q: string): Promise<IssueOption[]> {
    return this.get(`${this.base(ws, project)}/search-issues/`, { params: { search: q } }).then((r) => r.data);
  }
}
const service = new TeamPageIssueService();

const errorMessage = (e: unknown) => (e as { error?: string })?.error ?? "请稍后再试";
const fail = (e: unknown) => setToast({ type: "error", title: "操作失败", message: errorMessage(e) });

function Row({ href, title, hint, onRemove }: { href: string; title: string; hint?: string; onRemove?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border-[0.5px] border-subtle px-2 py-1.5">
      <a href={href} className="min-w-0 flex-1 truncate text-caption-md-regular text-primary hover:underline">
        {title}
        {hint && <span className="ml-2 text-caption-sm-regular text-tertiary">{hint}</span>}
      </a>
      {onRemove && (
        <button type="button" onClick={onRemove} className="text-caption-sm-regular text-tertiary hover:text-primary">
          取消关联
        </button>
      )}
    </div>
  );
}

/** 工作项侧边栏：这个工作项关联的文档，可以一键关联 / 取消。 */
export function TeamIssuePages(props: { workspaceSlug: string; projectId: string; issueId: string }) {
  const { workspaceSlug, projectId, issueId } = props;
  const [pages, setPages] = useState<LinkedPage[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [options, setOptions] = useState<PageOption[]>([]);
  const [query, setQuery] = useState("");

  const load = useCallback(() => {
    service
      .pagesOfIssue(workspaceSlug, projectId, issueId)
      .then(setPages)
      .catch(() => setPages([]));
  }, [workspaceSlug, projectId, issueId]);
  useEffect(load, [load]);

  const openPicker = () => {
    setPicking(true);
    setQuery("");
    service
      .projectPages(workspaceSlug, projectId)
      .then(setOptions)
      .catch(() => setOptions([]));
  };
  const linkedIds = new Set((pages ?? []).map((p) => p.id));
  const shown = options.filter((p) => !linkedIds.has(p.id) && p.name.toLowerCase().includes(query.toLowerCase())).slice(0, 30);

  return (
    <div className="flex flex-col gap-2">
      {(pages ?? []).map((p) => (
        <Row
          key={p.id}
          href={`/${workspaceSlug}/projects/${projectId}/pages/${p.id}`}
          title={p.name || "未命名文档"}
          hint={p.owned_by}
          onRemove={() =>
            void service
              .unlinkPage(workspaceSlug, projectId, issueId, p.id)
              .then(setPages)
              .catch(fail)
          }
        />
      ))}
      {pages && pages.length === 0 && <div className="text-caption-sm-regular text-tertiary">还没有关联文档</div>}
      <div>
        <Button variant="secondary" size="sm" stretch="auto" label="关联文档" onClick={openPicker} />
      </div>
      <Dialog open={picking} onOpenChange={(open) => !open && setPicking(false)}>
        <DialogContent size="md">
          <DialogMain>
            <DialogHeader>
              <DialogHeading>
                <DialogTitle>关联文档</DialogTitle>
                <DialogDescription>选一篇本项目的文档，关联后两边都能看到。</DialogDescription>
              </DialogHeading>
            </DialogHeader>
            <DialogBody>
              <div className="flex flex-col gap-2">
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索文档标题"
                  className="w-full rounded-md border-[0.5px] border-subtle bg-transparent px-3 py-2 text-body-sm-regular outline-none"
                />
                {shown.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="truncate rounded-md border-[0.5px] border-subtle px-3 py-2 text-left text-body-sm-regular hover:bg-layer-1"
                    onClick={() =>
                      void service
                        .linkPage(workspaceSlug, projectId, issueId, p.id)
                        .then((r) => {
                          setPages(r);
                          setPicking(false);
                        })
                        .catch(fail)
                    }
                  >
                    {p.name || "未命名文档"}
                  </button>
                ))}
                {shown.length === 0 && <div className="text-caption-sm-regular text-tertiary">没有可关联的文档</div>}
              </div>
            </DialogBody>
          </DialogMain>
          <DialogActions>
            <Button variant="secondary" size="sm" stretch="auto" label="关闭" onClick={() => setPicking(false)} />
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
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<IssueOption[]>([]);

  useEffect(() => {
    if (!isOpen || !projectId || !pageId) return;
    setQuery("");
    setResults([]);
    service
      .issuesOfPage(workspaceSlug, projectId, pageId)
      .then(setIssues)
      .catch(() => setIssues([]));
  }, [isOpen, workspaceSlug, projectId, pageId]);

  useEffect(() => {
    if (!isOpen || !query.trim()) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      service
        .searchIssues(workspaceSlug, projectId, query.trim())
        .then(setResults)
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [isOpen, query, workspaceSlug, projectId]);

  const linkedIds = new Set((issues ?? []).map((i) => i.id));
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md">
        <DialogMain>
          <DialogHeader>
            <DialogHeading>
              <DialogTitle>关联工作项</DialogTitle>
              <DialogDescription>这篇文档关联的工作项。关联后，工作项页里也能看到这篇文档。</DialogDescription>
            </DialogHeading>
          </DialogHeader>
          <DialogBody>
            <div className="flex flex-col gap-2">
              {(issues ?? []).map((i) => (
                <Row
                  key={i.id}
                  href={`/${workspaceSlug}/browse/${i.key}`}
                  title={`${i.key} ${i.name}`}
                  hint={i.state}
                  onRemove={() =>
                    void service
                      .unlinkIssue(workspaceSlug, projectId, pageId, i.id)
                      .then(setIssues)
                      .catch(fail)
                  }
                />
              ))}
              {issues && issues.length === 0 && <div className="text-caption-sm-regular text-tertiary">还没有关联工作项</div>}
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索工作项标题或编号，点一下就关联"
                className="mt-2 w-full rounded-md border-[0.5px] border-subtle bg-transparent px-3 py-2 text-body-sm-regular outline-none"
              />
              {results
                .filter((r) => !linkedIds.has(r.id))
                .slice(0, 20)
                .map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className="truncate rounded-md border-[0.5px] border-subtle px-3 py-2 text-left text-body-sm-regular hover:bg-layer-1"
                    onClick={() =>
                      void service
                        .linkIssue(workspaceSlug, projectId, pageId, r.id)
                        .then((list) => {
                          setIssues(list);
                          setQuery("");
                        })
                        .catch(fail)
                    }
                  >
                    {r.project__identifier}-{r.sequence_id} {r.name}
                  </button>
                ))}
            </div>
          </DialogBody>
        </DialogMain>
        <DialogActions>
          <Button variant="secondary" size="sm" stretch="auto" label="关闭" onClick={onClose} />
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}
