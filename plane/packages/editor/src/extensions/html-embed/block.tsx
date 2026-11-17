/**
 * [team 二开] HTML 嵌入块的编辑器视图：沙箱渲染、拖拽缩放、整页放大、下载。
 * 安全：iframe 不给 allow-same-origin，页面里的脚本拿不到我们站点的 cookie 和接口。
 */
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HTML_EMBED_MAX_BYTES } from "./extension-config";
import type { THtmlEmbedAttributes } from "./extension-config";

const SANDBOX = "allow-scripts allow-popups allow-forms allow-modals";

const Icon = ({ children }: { children: ReactNode }) => (
  <svg
    viewBox="0 0 24 24"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children}
  </svg>
);

// srcDoc 页面里的 <a href="#/xx"> 会按父页面地址解析，点了会让 iframe 跳去加载 Loom 本身而被拒绝（refused to connect）。
// 注入一段脚本，把页内锚点改成只改自己的 location.hash，单页应用的 tab、路由就能正常切换。
const HASH_FIX =
  "<script>document.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a[href]');if(!a)return;var h=a.getAttribute('href');if(h&&h.charAt(0)==='#'&&!e.defaultPrevented){e.preventDefault();if(h.length>1){location.hash=h.slice(1);var t=document.getElementById(decodeURIComponent(h.slice(1)));if(t&&t.scrollIntoView)t.scrollIntoView();}else{location.hash='';}}},true);</script>";
const withHashFix = (html: string) => {
  const m = /<head[^>]*>/i.exec(html) ?? /<html[^>]*>/i.exec(html) ?? /<!doctype[^>]*>/i.exec(html);
  if (!m) return HASH_FIX + html;
  const i = m.index + m[0].length;
  return html.slice(0, i) + HASH_FIX + html.slice(i);
};

const downloadHtml = (html: string, name: string) => {
  const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = /\.html?$/i.test(name) ? name : `${name || "page"}.html`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const barBtn =
  "flex size-7 items-center justify-center rounded text-secondary hover:bg-layer-transparent-hover hover:text-primary";

// 整页放大只盖住右侧内容区（不遮挡左侧导航），左侧导航收起后自然变宽；找不到内容区时才铺满整个窗口
const getMainArea = () => document.getElementById("app-main-content");

function Fullscreen(props: { html: string; name: string; onClose: () => void }) {
  const { html, name, onClose } = props;
  const main = getMainArea();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className={`${main ? "absolute" : "fixed"} inset-0 z-[1000] flex flex-col bg-surface-1`}>
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-subtle px-4">
        <span className="flex-1 truncate text-body-sm-medium text-primary">{name || "HTML 页面"}</span>
        <button type="button" className={barBtn} title="下载 HTML" onClick={() => downloadHtml(html, name)}>
          <Icon>
            <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" />
          </Icon>
        </button>
        <button type="button" className={barBtn} title="关闭（Esc）" onClick={onClose}>
          <Icon>
            <path d="M6 6l12 12M18 6 6 18" />
          </Icon>
        </button>
      </div>
      <iframe title={name || "html"} sandbox={SANDBOX} srcDoc={withHashFix(html)} referrerPolicy="no-referrer" className="w-full flex-1 border-0 bg-white" />
    </div>,
    main ?? document.body
  );
}

export function HtmlEmbedBlock(props: NodeViewProps) {
  const { node, editor, updateAttributes, selected, deleteNode } = props;
  const attrs = node.attrs as THtmlEmbedAttributes;
  const editable = editor.isEditable;
  const wrapRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [full, setFull] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [paste, setPaste] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const dragging = size !== null;
  const width = size?.width ?? attrs.width;
  const height = size?.height ?? attrs.height;
  // 宽度是正文栏宽的百分比，可以超过 100%：超出的部分向两侧居中延伸，但不会超出右侧内容区
  const [geo, setGeo] = useState<{ parentW: number; left: number; right: number } | null>(null);
  const measure = useCallback(() => {
    const parent = wrapRef.current?.parentElement;
    if (!parent) return;
    const area = getMainArea();
    const pr = parent.getBoundingClientRect();
    const ar = area ? area.getBoundingClientRect() : { left: 0, right: window.innerWidth };
    const margin = 24;
    // 正文栏左右两侧还能延伸多少
    setGeo({
      parentW: pr.width,
      left: Math.max(0, pr.left - ar.left - margin),
      right: Math.max(0, ar.right - margin - pr.right),
    });
  }, []);
  useLayoutEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    const area = getMainArea();
    const ro = typeof ResizeObserver !== "undefined" && area ? new ResizeObserver(measure) : null;
    if (ro && area) ro.observe(area);
    return () => {
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, [measure]);
  const maxPx = geo ? geo.parentW + geo.left + geo.right : 0;
  const widthPx = geo ? Math.min((width / 100) * geo.parentW, maxPx) : undefined;
  const extra = geo && widthPx ? Math.max(0, widthPx - geo.parentW) : 0;
  const marginLeft = geo ? -Math.max(extra - geo.right, Math.min(extra / 2, geo.left)) : 0;
  const wrapStyle =
    widthPx !== undefined ? { width: widthPx, marginLeft } : { width: `${Math.min(width, 100)}%` };

  const load = useCallback(
    (html: string, name: string) => {
      if (new Blob([html]).size > HTML_EMBED_MAX_BYTES) {
        alert("HTML 超过 2MB，请精简后再试（图片建议用外链）。");
        return;
      }
      updateAttributes({ html, name });
    },
    [updateAttributes]
  );

  const onFile = async (file?: File) => {
    if (!file) return;
    load(await file.text(), file.name);
  };

  // 拖拽缩放：mode 决定能动哪个方向
  const startResize = (mode: "x" | "y" | "xy") => (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const box = wrapRef.current;
    const parentW = box?.parentElement?.clientWidth ?? 0;
    if (!box || !parentW) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = box.clientWidth;
    const startH = attrs.height;
    let latest = { width: attrs.width, height: attrs.height };
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const P = parentW;
    const edgeOf = (w: number) => (w <= P ? w : P + (w - P) / 2);
    const startEdge = edgeOf(startW);
    const maxW = geo ? geo.parentW + geo.left + geo.right : P;
    const move = (ev: PointerEvent) => {
      let w = attrs.width;
      if (mode !== "y") {
        const edge = startEdge + ev.clientX - startX;
        const px = edge <= P ? edge : P + 2 * (edge - P);
        w = Math.min(maxW, Math.max(0.2 * P, px)) / P * 100;
      }
      const h = mode === "x" ? attrs.height : Math.min(2000, Math.max(120, startH + ev.clientY - startY));
      latest = { width: Math.round(w), height: Math.round(h) };
      setSize(latest);
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      setSize(null);
      updateAttributes(latest);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
  };

  const empty = !attrs.html;

  return (
    <NodeViewWrapper className="html-embed my-3" contentEditable={false}>
      <div
        ref={wrapRef}
        className={`group/html relative overflow-visible rounded-lg border bg-surface-1 ${selected ? "border-accent-strong" : "border-subtle"}`}
        style={wrapStyle}
      >
        <div className="flex h-9 items-center gap-2 border-b border-subtle px-3">
          <Icon>
            <path d="m8 8-4 4 4 4m8-8 4 4-4 4M14 5l-4 14" />
          </Icon>
          <span className="flex-1 truncate text-body-xs-medium text-secondary">{attrs.name || "HTML 页面"}</span>
          {!empty && (
            <>
              <button type="button" className={barBtn} title="下载 HTML" onClick={() => downloadHtml(attrs.html, attrs.name)}>
                <Icon>
                  <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" />
                </Icon>
              </button>
              <button type="button" className={barBtn} title="整页放大" onClick={() => setFull(true)}>
                <Icon>
                  <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                </Icon>
              </button>
            </>
          )}
          {!empty && (
            <button type="button" className={barBtn} title="刷新（重新加载页面）" onClick={() => setReloadKey((k) => k + 1)}>
              <Icon>
                <path d="M4 12a8 8 0 0 1 14-5l2 2M20 12a8 8 0 0 1-14 5l-2-2M20 4v5h-5M4 20v-5h5" />
              </Icon>
            </button>
          )}
          {editable && !empty && (
            <button type="button" className={barBtn} title="替换为另一个 HTML 文件" onClick={() => fileRef.current?.click()}>
              <Icon>
                <path d="M12 16V4m0 0-4 4m4-4 4 4M5 20h14" />
              </Icon>
            </button>
          )}
          {editable && (
            <button type="button" className={barBtn} title="删除此块" onClick={() => deleteNode()}>
              <Icon>
                <path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3" />
              </Icon>
            </button>
          )}
        </div>

        {empty ? (
          <div className="flex flex-col items-center gap-3 p-8 text-center text-body-sm-regular text-secondary">
            {editable ? (
              <>
                <div>选择一个 .html 文件，会在文档里独立渲染（上限 2MB）</div>
                <div className="flex gap-2">
                  <button type="button" className="rounded border border-subtle px-3 py-1.5 hover:bg-layer-transparent-hover" onClick={() => fileRef.current?.click()}>
                    选择 HTML 文件
                  </button>
                  <button type="button" className="rounded border border-subtle px-3 py-1.5 hover:bg-layer-transparent-hover" onClick={() => setShowPaste((v) => !v)}>
                    粘贴 HTML 代码
                  </button>
                </div>
                {showPaste && (
                  <div className="flex w-full flex-col gap-2">
                    <textarea
                      value={paste}
                      onChange={(e) => setPaste(e.target.value)}
                      rows={6}
                      className="w-full rounded border border-subtle bg-layer-1 p-2 font-mono text-caption-md-regular text-primary"
                      placeholder="<!doctype html>…"
                    />
                    <button
                      type="button"
                      className="self-end rounded bg-accent-primary px-3 py-1.5 text-on-color"
                      onClick={() => paste.trim() && load(paste, "")}
                    >
                      插入
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div>（空的 HTML 块）</div>
            )}
          </div>
        ) : (
          <div className="relative" style={{ height }}>
            <iframe
              title={attrs.name || "html"}
              sandbox={SANDBOX}
              srcDoc={withHashFix(attrs.html)}
              key={reloadKey}
              referrerPolicy="no-referrer"
              loading="lazy"
              className="size-full border-0 bg-white"
              style={{ pointerEvents: dragging ? "none" : "auto" }}
            />
            {editable && (
              <>
                {/* 右边、下边、右下角三个拉伸手柄 */}
                <div onPointerDown={startResize("x")} className="absolute top-0 -right-1.5 h-full w-3 cursor-ew-resize" />
                <div onPointerDown={startResize("y")} className="absolute -bottom-1.5 left-0 h-3 w-full cursor-ns-resize" />
                <div
                  onPointerDown={startResize("xy")}
                  title="拖动调整大小"
                  className="absolute -right-1.5 -bottom-1.5 size-4 cursor-nwse-resize rounded-sm border-2 border-accent-strong bg-surface-1 opacity-0 group-hover/html:opacity-100"
                />
              </>
            )}
          </div>
        )}
      </div>
      <input ref={fileRef} type="file" accept=".html,.htm,text/html" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
      {full && <Fullscreen html={attrs.html} name={attrs.name} onClose={() => setFull(false)} />}
    </NodeViewWrapper>
  );
}
