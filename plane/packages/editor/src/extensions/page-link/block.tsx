/**
 * [team 二开] 子页面块，样式参照 Notion：文件图标 + 带下划线的标题，没有边框，点击跳转。
 * 标题打开时取最新的；页面被删或没权限看就标灰。数据走同源的网页接口（带登录态）。
 */
import { navigateApp } from "@/helpers/navigate-app";
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { useEffect, useMemo, useState } from "react";
import type { TPageLinkAttributes } from "./extension-config";

/** 从地址里取工作区：/<workspace>/projects/<project>/pages/<page> */
const readSlug = () => window.location.pathname.match(/^\/([^/]+)\/projects\//)?.[1] ?? "";

const DocIcon = ({ muted }: { muted: boolean }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={muted ? "text-placeholder" : "text-tertiary"}>
    <path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
    <path d="M14 3v5h5" />
  </svg>
);

export function PageLinkBlock(props: NodeViewProps) {
  const { node, editor, deleteNode, selected } = props;
  const attrs = node.attrs as TPageLinkAttributes;
  const slug = useMemo(() => (typeof window === "undefined" ? "" : readSlug()), []);
  const [title, setTitle] = useState(attrs.title);
  const [state, setState] = useState<"ok" | "gone">("ok");

  useEffect(() => {
    if (!attrs.pageId || !slug || !attrs.projectId) return;
    let cancelled = false;
    void fetch(`/api/workspaces/${slug}/projects/${attrs.projectId}/pages/${attrs.pageId}/`, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    })
      .then(async (res) => (res.ok ? ((await res.json()) as { name?: string }) : null))
      .then((p) => {
        if (cancelled) return;
        if (p) {
          setState("ok");
          setTitle(p.name?.trim() || "无标题");
        } else setState("gone");
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [attrs.pageId, attrs.projectId, slug]);

  if (!attrs.pageId) {
    return (
      <NodeViewWrapper className="page-link my-1" contentEditable={false}>
        <span className="text-body-sm-regular text-tertiary">（没有指向任何页面的子页面块）</span>
        {editor.isEditable && (
          <button type="button" className="ml-2 text-caption-md-regular text-accent-primary" onClick={() => deleteNode()}>
            删除
          </button>
        )}
      </NodeViewWrapper>
    );
  }

  const href = slug && attrs.projectId ? `/${slug}/projects/${attrs.projectId}/pages/${attrs.pageId}` : undefined;
  return (
    <NodeViewWrapper className="page-link my-0.5" contentEditable={false}>
      <a
        href={state === "ok" ? href : undefined}
        onClick={(e) => {
          if (state !== "ok" || !href || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          e.preventDefault();
          navigateApp(href);
        }}
        title={state === "ok" ? "打开页面" : "页面已删除，或你没有权限查看"}
        className={`flex w-full items-center gap-2 rounded-md px-1 py-1 no-underline hover:bg-layer-transparent-hover ${selected ? "bg-layer-transparent-hover" : ""} ${state === "ok" ? "cursor-pointer" : "cursor-not-allowed"}`}
      >
        <DocIcon muted={state === "gone"} />
        <span
          className={`truncate border-b border-strong text-16 font-medium leading-6 ${state === "ok" ? "text-primary" : "text-tertiary"}`}
        >
          {title || "无标题"}
        </span>
        {state === "gone" && <span className="shrink-0 text-caption-md-regular text-tertiary">（无法打开）</span>}
      </a>
    </NodeViewWrapper>
  );
}
