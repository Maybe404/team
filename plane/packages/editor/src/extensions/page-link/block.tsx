/**
 * [team 二开] 页面链接卡片的视图。
 * 没选页面时是选择面板：搜索已有页面，或者直接在当前页面下新建一个子页面；选好后是一张可点击的卡片。
 * 数据直接走同源的网页接口（带登录态），不依赖外部传入的回调。
 */
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { useEffect, useMemo, useState } from "react";
import type { TPageLinkAttributes } from "./extension-config";

type PageRow = { id: string; name: string; parent?: string | null };

/** 从地址里取工作区、项目、当前页面：/<workspace>/projects/<project>/pages/<page> */
const readLocation = () => {
  const m = window.location.pathname.match(/^\/([^/]+)\/projects\/([^/]+)\/pages\/([^/?#]+)/);
  return m ? { slug: m[1], projectId: m[2], pageId: m[3] } : null;
};

const api = (slug: string, projectId: string, path = "") => `/api/workspaces/${slug}/projects/${projectId}/pages/${path}`;

const getJson = async <T,>(url: string): Promise<T | null> => {
  const res = await fetch(url, { credentials: "same-origin", headers: { Accept: "application/json" } });
  return res.ok ? ((await res.json()) as T) : null;
};

const barBtn =
  "flex size-6 items-center justify-center rounded text-tertiary hover:bg-layer-transparent-hover hover:text-primary";

export function PageLinkBlock(props: NodeViewProps) {
  const { node, editor, updateAttributes, deleteNode, selected } = props;
  const attrs = node.attrs as TPageLinkAttributes;
  const editable = editor.isEditable;
  const loc = useMemo(() => (typeof window === "undefined" ? null : readLocation()), []);
  const projectId = attrs.projectId || loc?.projectId || "";
  const slug = loc?.slug ?? "";
  const [title, setTitle] = useState(attrs.title);
  const [state, setState] = useState<"ok" | "gone">("ok");
  const [pages, setPages] = useState<PageRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  // 取最新标题；打不开（被删除或没权限）就显示兜底标题并标灰
  useEffect(() => {
    if (!attrs.pageId || !slug || !projectId) return;
    let cancelled = false;
    void getJson<{ name?: string }>(api(slug, projectId, `${attrs.pageId}/`)).then((p) => {
      if (cancelled) return;
      if (p) {
        setState("ok");
        setTitle(p.name?.trim() || "无标题");
      } else setState("gone");
    });
    return () => {
      cancelled = true;
    };
  }, [attrs.pageId, slug, projectId]);

  // 选择面板：加载项目里的页面
  useEffect(() => {
    if (attrs.pageId || !editable || !slug || !projectId) return;
    void getJson<PageRow[] | { results?: PageRow[] }>(api(slug, projectId)).then((r) =>
      setPages(Array.isArray(r) ? r : (r?.results ?? []))
    );
  }, [attrs.pageId, editable, slug, projectId]);

  const choose = (p: PageRow) => updateAttributes({ pageId: p.id, projectId, title: p.name?.trim() || "无标题" });

  const createChild = async () => {
    if (!loc || busy) return;
    setBusy(true);
    try {
      const res = await fetch(api(loc.slug, loc.projectId), {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ name: "", parent: loc.pageId }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const p = (await res.json()) as PageRow;
      updateAttributes({ pageId: p.id, projectId: loc.projectId, title: "无标题" });
    } catch {
      alert("没能新建子页面，请稍后再试。");
    } finally {
      setBusy(false);
    }
  };

  const shown = (pages ?? []).filter((p) => p.id !== loc?.pageId && (p.name || "无标题").toLowerCase().includes(query.trim().toLowerCase()));

  if (!attrs.pageId) {
    return (
      <NodeViewWrapper className="page-link my-2" contentEditable={false}>
        <div className={`rounded-lg border bg-surface-1 p-3 ${selected ? "border-accent-strong" : "border-subtle"}`}>
          {!editable ? (
            <div className="text-body-sm-regular text-tertiary">（未选择页面）</div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索要链接的页面，或在当前页面下新建子页面"
                  className="min-w-0 flex-1 rounded border border-subtle bg-layer-1 px-2 py-1.5 text-body-sm-regular text-primary outline-none"
                />
                <button
                  type="button"
                  disabled={busy || !loc}
                  onClick={() => void createChild()}
                  className="shrink-0 rounded bg-accent-primary px-3 py-1.5 text-body-sm-medium text-on-color disabled:opacity-50"
                >
                  新建子页面
                </button>
                <button type="button" title="删除此块" className={barBtn} onClick={() => deleteNode()}>
                  ✕
                </button>
              </div>
              <div className="max-h-52 overflow-y-auto">
                {pages === null ? (
                  <div className="px-2 py-2 text-caption-md-regular text-tertiary">加载中…</div>
                ) : shown.length === 0 ? (
                  <div className="px-2 py-2 text-caption-md-regular text-tertiary">没有找到页面</div>
                ) : (
                  shown.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => choose(p)}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-body-sm-regular text-secondary hover:bg-layer-transparent-hover"
                    >
                      <span>📄</span>
                      <span className="truncate">{p.name?.trim() || "无标题"}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </NodeViewWrapper>
    );
  }

  const href = slug && projectId ? `/${slug}/projects/${projectId}/pages/${attrs.pageId}` : undefined;
  return (
    <NodeViewWrapper className="page-link my-2" contentEditable={false}>
      <div
        className={`group/pl flex items-center gap-2 rounded-lg border bg-surface-1 px-3 py-2 ${selected ? "border-accent-strong" : "border-subtle"}`}
      >
        <a
          href={state === "ok" ? href : undefined}
          className={`flex min-w-0 flex-1 items-center gap-2 text-body-sm-medium no-underline ${state === "ok" ? "text-primary hover:underline" : "cursor-not-allowed text-tertiary"}`}
          title={state === "ok" ? "打开页面" : "页面已删除，或你没有权限查看"}
        >
          <span>📄</span>
          <span className="truncate">{title || "无标题"}</span>
          {state === "gone" && <span className="shrink-0 text-caption-md-regular">（无法打开）</span>}
        </a>
        {editable && (
          <button type="button" title="移除这个链接（不会删除页面）" className={`${barBtn} opacity-0 group-hover/pl:opacity-100`} onClick={() => deleteNode()}>
            ✕
          </button>
        )}
      </div>
    </NodeViewWrapper>
  );
}
