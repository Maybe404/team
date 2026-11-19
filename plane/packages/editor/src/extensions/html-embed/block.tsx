/**
 * [team 二开] HTML 嵌入块的编辑器视图：沙箱渲染、拖拽缩放、整页放大、下载，
 * 以及「只讲一块」：把原型里的某个元素单独露出来（crop），或整页保留、其余压暗（spot）。
 * 安全：iframe 不给 allow-same-origin，页面里的脚本拿不到我们站点的 cookie 和接口；
 * 量元素位置靠注入脚本（inject.ts）在 iframe 里完成，用 postMessage 回传。
 */
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HTML_EMBED_MAX_BYTES } from "./extension-config";
import type { THtmlEmbedAttributes } from "./extension-config";
import { withInject } from "./inject";

const SANDBOX = "allow-scripts allow-popups allow-forms allow-modals";
const PAD = 6;
const MIN_CROP_W = 320;
// 局部显示区域的最小尺寸：选中小按钮时也带上周围一圈，不会只剩一个小点
const MIN_REGION_W = 360;
const MIN_REGION_H = 160;

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

const downloadHtml = (html: string, name: string) => {
  const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = /\.html?$/i.test(name) ? name : `${name || "page"}.html`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// 工具栏按钮的统一样式，和产品里的标签页一致：默认没有底色和边框，只有选中、鼠标指向时才出现
const barBtn =
  "flex size-6 shrink-0 items-center justify-center rounded-md text-tertiary hover:bg-layer-transparent-hover hover:text-primary";
const ctlBase = "flex h-6 shrink-0 items-center gap-1.5 rounded-md border px-2 text-caption-md-regular";
const ctlOff = `${ctlBase} border-transparent text-tertiary hover:border-subtle hover:bg-layer-transparent-hover hover:text-primary`;
const ctlOn = `${ctlBase} border-subtle bg-layer-transparent-hover text-primary`;
const segWrap = "flex shrink-0 items-center gap-0.5";
const segItem = (on: boolean) =>
  `h-6 rounded-md border px-2 text-caption-md-regular ${on ? "border-subtle bg-layer-transparent-hover text-primary" : "border-transparent text-tertiary hover:border-subtle hover:bg-layer-transparent-hover hover:text-primary"}`;

/** 开关按钮：开着时前面有个小圆点，不靠颜色也能看出状态 */
function Toggle(props: { on: boolean; title: string; onClick: () => void; children: ReactNode }) {
  const { on, title, onClick, children } = props;
  return (
    <button type="button" aria-pressed={on} title={title} className={on ? ctlOn : ctlOff} onClick={onClick}>
      <span className={`size-1.5 rounded-full ${on ? "bg-accent-primary" : "border border-strong"}`} />
      {children}
    </button>
  );
}

// 整页放大只盖住右侧内容区（不遮挡左侧导航），左侧导航收起后自然变宽；找不到内容区时才铺满整个窗口
const getMainArea = () => document.getElementById("app-main-content");

function Fullscreen(props: { html: string; name: string; onClose: () => void }) {
  const { html, name, onClose } = props;
  const main = getMainArea();
  const srcDoc = useMemo(() => withInject(html), [html]);
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
      <iframe title={name || "html"} sandbox={SANDBOX} srcDoc={srcDoc} referrerPolicy="no-referrer" className="w-full flex-1 border-0 bg-white" />
    </div>,
    main ?? document.body
  );
}

type TRect = { x: number; y: number; w: number; h: number; fb: number };
type TPick = "insert" | "replace" | null;

export function HtmlEmbedBlock(props: NodeViewProps) {
  const { node, editor, updateAttributes, selected, deleteNode, getPos } = props;
  const attrs = node.attrs as THtmlEmbedAttributes;
  const editable = editor.isEditable;
  const wrapRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [cwLive, setCwLive] = useState<number | null>(null);
  const [full, setFull] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [paste, setPaste] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const dragging = size !== null;
  const width = size?.width ?? attrs.width;
  const height = size?.height ?? attrs.height;

  // ---- 内容：自己的，或引用同一篇文档里另一个完整块的（先按 uid，没有再按名称） ----
  const [refSrc, setRefSrc] = useState<{ html: string; name: string }>({ html: "", name: "" });
  useEffect(() => {
    if (!attrs.ref) {
      setRefSrc((v) => (v.html || v.name ? { html: "", name: "" } : v));
      return;
    }
    const find = () => {
      let byUid: { html: string; name: string } | null = null;
      let byName: { html: string; name: string } | null = null;
      editor.state.doc.descendants((n) => {
        if (n.type === node.type && n !== node && n.attrs.html) {
          const hit = { html: n.attrs.html as string, name: (n.attrs.name as string) ?? "" };
          if (!byUid && n.attrs.uid && n.attrs.uid === attrs.ref) byUid = hit;
          if (!byName && n.attrs.name === attrs.ref) byName = hit;
        }
        return true;
      });
      const hit = byUid ?? byName ?? { html: "", name: "" };
      setRefSrc((v) => (v.html === hit.html && v.name === hit.name ? v : hit));
    };
    find();
    editor.on("update", find);
    return () => {
      editor.off("update", find);
    };
  }, [editor, attrs.ref, node]);
  const refHtml = refSrc.html;
  const html = attrs.html || refHtml;
  const srcDoc = useMemo(() => withInject(html), [html]);

  // ---- 版面：宽度是正文栏宽的百分比，可以超过 100%，超出的部分向两侧居中延伸，但不会超出右侧内容区 ----
  const [geo, setGeo] = useState<{ parentW: number; left: number; right: number } | null>(null);
  const measure = useCallback(() => {
    const parent = wrapRef.current?.parentElement;
    if (!parent) return;
    const area = getMainArea();
    const pr = parent.getBoundingClientRect();
    const ar = area ? area.getBoundingClientRect() : { left: 0, right: window.innerWidth };
    const margin = 24;
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
  const stageW = geo ? Math.min((width / 100) * geo.parentW, maxPx) : 0;

  // ---- 只讲一块 ----
  const [ready, setReady] = useState(0);
  const [rect, setRect] = useState<TRect | null>(null);
  const [found, setFound] = useState<boolean | null>(null);
  // 选中的元素比预览视口还高（长表单）：不锁文档滚动，读者可以在局部里滚到下面的内容
  const tall = !!rect && rect.h > height + 2;
  const [gaveUp, setGaveUp] = useState(false);
  const [whole, setWhole] = useState(false); // 读者点了「看整页」：同一个 iframe，只换呈现方式，页面里的操作状态不丢
  const [pick, setPick] = useState<TPick>(null);
  const [pickHint, setPickHint] = useState("");
  const [editSel, setEditSel] = useState(false);
  const hasFocus = !!attrs.focus && !!html;
  const showWhole = whole || pick !== null; // 点选元素时必须看到整页
  const cropping = hasFocus && !showWhole && attrs.mode === "crop" && !gaveUp;
  const spotting = hasFocus && !showWhole && attrs.mode === "spot" && !gaveUp;

  const send = useCallback((m: Record<string, unknown>) => {
    frameRef.current?.contentWindow?.postMessage({ loom: 1, ...m }, "*");
  }, []);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const win = frameRef.current?.contentWindow;
      const d = e.data as { loom?: number; t?: string } & Record<string, unknown>;
      if (!win || e.source !== win || !d || d.loom !== 1) return;
      // 以页面里的脚本发出的 ready 为准：懒加载的 iframe 挂载时会先触发一次空白页的 load，那时发消息会丢
      if (d.t === "ready") setReady((n) => n + 1);
      else if (d.t === "rect") {
        if (d.found) {
          setFound(true);
          setGaveUp(false);
          setRect({ x: Number(d.x), y: Number(d.y), w: Number(d.w), h: Number(d.h), fb: Number(d.fb) || 0 });
        } else {
          setFound(false);
        }
      } else if (d.t === "picked") setPicked(String(d.sel ?? ""), String(d.text ?? ""));
      else if (d.t === "pick-cancel") setPick(null);
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pick, node, attrs.name, attrs.ref, attrs.width, attrs.height]);

  // 换了元素或页面重新加载：清掉上一次的定位结果
  useEffect(() => {
    setRect(null);
    setFound(null);
    setGaveUp(false);
  }, [ready, attrs.focus]);

  // 把「盯哪个元素」告诉 iframe；整页状态下仍然盯着（画出轮廓），只是不锁滚动；
  // 找不到时也继续盯（元素之后出现还能恢复），只是放开滚动锁，让长页面能滚动看完
  useEffect(() => {
    if (!ready) return;
    if (attrs.focus) send({ t: "focus", sel: attrs.focus, follow: attrs.follow, hold: !showWhole && !gaveUp && !tall });
    else send({ t: "unfocus" });
  }, [ready, attrs.focus, attrs.follow, showWhole, gaveUp, tall, send]);

  // 迟迟找不到元素（选择器写错了、页面里没有）：退回显示整页，并提示
  useEffect(() => {
    // 从页面加载完才开始计时（iframe 是懒加载的，没滚到时不算找不到）
    if (!hasFocus || found === true || !ready) return;
    const t = setTimeout(() => setGaveUp(true), 5000);
    return () => clearTimeout(t);
  }, [hasFocus, found, attrs.focus, ready]);

  useEffect(() => {
    if (!ready) return;
    send({ t: "pick", on: pick !== null });
    if (pick === null) return;
    // 键盘焦点在编辑器里时，iframe 收不到按键，转发过去
    const onKey = (e: KeyboardEvent) => {
      if (!["ArrowUp", "ArrowDown", "Escape"].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") setPick(null);
      else send({ t: "pickkey", key: e.key });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [pick, ready, send]);

  const setPicked = (sel: string, text: string) => {
    if (!sel) return;
    if (pick === "replace") {
      updateAttributes({ focus: sel });
    } else if (pick === "insert") {
      // 局部块用固定编号引用这个原型：文件名重复或以后换了文件，引用都不会断
      const uid = attrs.uid || Math.random().toString(36).slice(2, 10);
      if (!attrs.uid) updateAttributes({ uid, ...(attrs.name ? {} : { name: "原型" }) });
      const pos = getPos();
      if (typeof pos === "number") {
        const { doc } = editor.state;
        // 新块放在这个原型后面已有的局部块之后，前后各留一个空行，方便写说明文字
        let at = pos + node.nodeSize;
        for (;;) {
          const next = doc.resolve(at).nodeAfter;
          if (next && next.type === node.type && next.attrs.ref === uid) at += next.nodeSize;
          else if (next && next.type.name === "paragraph" && next.content.size === 0 && doc.resolve(at + next.nodeSize).nodeAfter?.type === node.type && doc.resolve(at + next.nodeSize).nodeAfter?.attrs.ref === uid) at += next.nodeSize;
          else break;
        }
        const before = doc.resolve(at).nodeBefore;
        const after = doc.resolve(at).nodeAfter;
        const needBefore = !(before && before.type.name === "paragraph" && before.content.size === 0);
        const needAfter = !after || after.type.name !== "paragraph";
        const content = [
          ...(needBefore ? [{ type: "paragraph" }] : []),
          {
            type: node.type.name,
            attrs: { ref: uid, focus: sel, mode: "crop", follow: true, lock: true, width: attrs.width, height: attrs.height, name: text },
          },
          ...(needAfter ? [{ type: "paragraph" }] : []),
        ];
        const caret = needBefore ? at + 1 : at - 1;
        editor.chain().insertContentAt(at, content).setTextSelection(Math.max(1, caret)).focus().run();
      }
    }
    setPick(null);
  };

  const startPick = (mode: Exclude<TPick, null>) => {
    setPickHint(mode === "insert" ? "点一下原型里要单独讲的那一块，下方会新建只显示它的局部块" : "点一下原型里要显示的新元素");
    setPick(mode);
  };

  // 下拉等弹层可能伸到原型视口下面：只显示一块（或聚光灯）时把页面视口撑高到刚好装下。
  // 只为弹层溢出撑高（按弹层自己的最低边算，不含被聚焦元素和取景留白），否则吸底栏、整屏容器会每次多撑一截、越撑越高。
  const stageH = hasFocus && !showWhole && rect && stageW ? Math.min(3000, Math.max(height, Math.ceil(rect.fb))) : height;
  // 聚焦区域：加内边距；局部（crop）再保证最小尺寸，围着元素居中向外扩，限制在页面视口内
  const R = useMemo(() => {
    if (!rect || !stageW) return null;
    let x = rect.x - PAD;
    let y = rect.y - PAD;
    let w = rect.w + 2 * PAD;
    let h = rect.h + 2 * PAD;
    if (attrs.mode !== "spot") {
      if (w < MIN_REGION_W) {
        x -= (MIN_REGION_W - w) / 2;
        w = MIN_REGION_W;
      }
      if (h < MIN_REGION_H) {
        y -= (MIN_REGION_H - h) / 2;
        h = MIN_REGION_H;
      }
    }
    w = Math.min(w, stageW);
    x = Math.min(Math.max(0, x), stageW - w);
    h = Math.min(h, stageH);
    y = Math.min(Math.max(0, y), Math.max(0, stageH - h));
    return { x, y, w: Math.max(8, w), h: Math.max(8, h) };
  }, [rect, stageW, stageH, attrs.mode]);

  const waiting = cropping && !R; // 还没量出位置：先别露出整页
  // 显示框宽度：自动时不超过正文宽度；手动拖过后按保存的 cw，内容按比例缩放
  const maxBoxW = geo ? maxPx : stageW;
  const cwNow = cwLive ?? attrs.cw;
  const scale =
    cropping && R && stageW
      ? Math.max(0.2, Math.min(cwNow > 0 ? cwNow / R.w : Math.min(1, stageW / R.w), Math.max(0.2, maxBoxW / R.w)))
      : 1;
  const cropW = cropping && R ? R.w * scale : 0;
  const cropH = cropping && R ? R.h * scale : 0;
  const outerW = cropping ? Math.min(Math.max(cropW, MIN_CROP_W), maxBoxW || MIN_CROP_W) : stageW;

  const marginLeft = (() => {
    if (!geo) return 0;
    if (cropping && outerW <= geo.parentW) return (geo.parentW - outerW) / 2;
    const extra = Math.max(0, outerW - geo.parentW);
    return -Math.max(extra - geo.right, Math.min(extra / 2, geo.left));
  })();
  const wrapStyle = geo ? { width: outerW, marginLeft } : { width: `${Math.min(width, 100)}%` };

  const load = useCallback(
    (nextHtml: string, name: string) => {
      if (new Blob([nextHtml]).size > HTML_EMBED_MAX_BYTES) {
        alert("HTML 超过 2MB，请精简后再试（图片建议用外链）。");
        return;
      }
      updateAttributes({ html: nextHtml, name });
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
        w = (Math.min(maxW, Math.max(0.2 * P, px)) / P) * 100;
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

  // 局部块的缩放：拖右边或右下角，改的是显示框宽度，高度按比例跟着变，里面的内容等比放大缩小（双击恢复自动）
  const startCropResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = cropW;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    let latest = Math.round(startW);
    const move = (ev: PointerEvent) => {
      // 显示框在正文里居中，边缘跟着指针走要动两倍
      latest = Math.round(Math.min(maxBoxW || 4000, Math.max(120, startW + 2 * (ev.clientX - startX))));
      setCwLive(latest);
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      setCwLive(null);
      updateAttributes({ cw: latest });
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
  };

  const empty = !html;
  const refMissing = empty && !!attrs.ref;
  const title = attrs.name || (attrs.ref ? `${refSrc.name || "原型"} · 局部` : "HTML 页面");
  const dim = "rgba(15,23,42,0.55)";
  const blockPointer = attrs.lock !== false;
  const dimStyle = (s: { left: number; top: number; width: number; height: number }) => ({
    position: "absolute" as const,
    ...s,
    background: dim,
    pointerEvents: blockPointer ? ("auto" as const) : ("none" as const),
  });

  // iframe 的外层：crop 时是一个只露出聚焦区域的窗口，其余情况就是整页
  const viewportStyle = cropping && R
    ? { width: cropW, height: cropH, margin: "0 auto",  }
    : waiting
      ? { width: "100%", height: 160,  }
      : { width: "100%", height: stageH };
  const stageStyle =
    cropping && R
      ? {
          position: "absolute" as const,
          left: 0,
          top: 0,
          width: stageW,
          height: stageH,
          transformOrigin: "0 0",
          transform: `scale(${scale}) translate(${-R.x}px, ${-R.y}px)`,
        }
      : waiting
        ? { position: "absolute" as const, left: 0, top: 0, width: stageW || "100%", height, opacity: 0 }
        : { position: "absolute" as const, left: 0, top: 0, width: "100%", height: "100%", opacity: 1 };

  return (
    <NodeViewWrapper className="html-embed my-3" contentEditable={false}>
      <div
        ref={wrapRef}
        className={`group/html relative overflow-visible rounded-lg border bg-surface-1 ${selected ? "border-accent-strong" : "border-subtle"}`}
        style={wrapStyle}
      >
        <div className="flex min-h-9 flex-wrap items-center gap-1.5 border-b border-subtle px-3 py-1">
          <Icon>
            <path d="m8 8-4 4 4 4m8-8 4 4-4 4M14 5l-4 14" />
          </Icon>
          <span className="min-w-[4rem] flex-1 truncate text-body-xs-medium text-secondary">{title}</span>
          {hasFocus && !gaveUp && (
            <span className={segWrap}>
              <button type="button" className={segItem(!whole)} title="只看这一块" onClick={() => setWhole(false)}>
                局部
              </button>
              <button type="button" className={segItem(whole)} title="看完整页面，页面里的操作状态不会丢" onClick={() => setWhole(true)}>
                整页
              </button>
            </span>
          )}
          {editable && hasFocus && (
            <>
              <Toggle on={attrs.mode === "spot"} title="整页保留，只把其余部分压暗" onClick={() => updateAttributes({ mode: attrs.mode === "spot" ? "crop" : "spot" })}>
                聚光灯
              </Toggle>
              <Toggle on={!!attrs.follow} title="点开的下拉、弹出的浮层一起显示" onClick={() => updateAttributes({ follow: !attrs.follow })}>
                含弹层
              </Toggle>
              {attrs.mode === "spot" && (
                <Toggle on={attrs.lock !== false} title="变暗的区域不能点击" onClick={() => updateAttributes({ lock: attrs.lock === false })}>
                  暗区禁点
                </Toggle>
              )}
              <button type="button" className={ctlOff} title="在原型里重新点选要显示的元素" onClick={() => startPick("replace")}>
                重选
              </button>
              <button type="button" className={editSel ? ctlOn : ctlOff} title="手动修改选择器" onClick={() => setEditSel((v) => !v)}>
                选择器
              </button>
            </>
          )}
          {editable && !empty && !attrs.focus && (
            <button type="button" className={ctlOff} title="点选原型里的一块，在下方新建只显示它的局部块" onClick={() => startPick("insert")}>
              拆出局部
            </button>
          )}
          {!empty && (
            <>
              <button type="button" className={barBtn} title="下载 HTML" onClick={() => downloadHtml(html, attrs.name || refSrc.name)}>
                <Icon>
                  <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" />
                </Icon>
              </button>
              <button type="button" className={barBtn} title="整页放大" onClick={() => setFull(true)}>
                <Icon>
                  <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                </Icon>
              </button>
              <button type="button" className={barBtn} title="刷新（重新加载页面）" onClick={() => setReloadKey((k) => k + 1)}>
                <Icon>
                  <path d="M4 12a8 8 0 0 1 14-5l2 2M20 12a8 8 0 0 1-14 5l-2-2M20 4v5h-5M4 20v-5h5" />
                </Icon>
              </button>
            </>
          )}
          {editable && !empty && !attrs.ref && (
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

        {editable && editSel && hasFocus && (
          <div className="flex items-center gap-2 border-b border-subtle px-3 py-1.5">
            <span className="shrink-0 text-caption-md-regular text-tertiary">CSS 选择器</span>
            <input
              defaultValue={attrs.focus}
              className="min-w-0 flex-1 rounded border border-subtle bg-layer-1 px-2 py-1 font-mono text-caption-md-regular text-primary"
              onKeyDown={(e) => {
                if (e.key === "Enter") updateAttributes({ focus: (e.target as HTMLInputElement).value.trim() });
              }}
              onBlur={(e) => updateAttributes({ focus: e.target.value.trim() })}
            />
          </div>
        )}

        {pick && (
          <div className="flex items-center gap-2 border-b border-subtle bg-layer-1 px-3 py-1.5 text-caption-md-regular text-secondary">
            <span className="flex-1">{pickHint}（↑ 选上一层，Esc 取消）</span>
            <button type="button" className={ctlOff} onClick={() => setPick(null)}>
              取消
            </button>
          </div>
        )}

        {hasFocus && gaveUp && (
          <div className="border-b border-subtle bg-layer-1 px-3 py-1.5 text-caption-md-regular text-secondary">
            原型里找不到这个元素（{attrs.focus}），先显示整页。{editable ? "可以点「重选」。" : ""}
          </div>
        )}

        {empty ? (
          <div className="flex flex-col items-center gap-3 p-8 text-center text-body-sm-regular text-secondary">
            {refMissing ? (
              <div>找不到这个局部引用的完整原型。它可能被删除了，或不在这篇文档里。</div>
            ) : editable ? (
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
          <div className="relative" style={viewportStyle}>
            <div className="absolute inset-0 overflow-hidden rounded-b-lg">
            <div style={stageStyle}>
              <iframe
                ref={frameRef}
                title={title}
                sandbox={SANDBOX}
                srcDoc={srcDoc}
                key={reloadKey}
                referrerPolicy="no-referrer"
                loading="lazy"
                className="size-full border-0 bg-white"
                style={{ pointerEvents: dragging ? "none" : "auto" }}
              />
              {spotting && R && (
                <>
                  <div style={dimStyle({ left: 0, top: 0, width: stageW, height: R.y })} />
                  <div style={dimStyle({ left: 0, top: R.y + R.h, width: stageW, height: Math.max(0, stageH - R.y - R.h) })} />
                  <div style={dimStyle({ left: 0, top: R.y, width: R.x, height: R.h })} />
                  <div style={dimStyle({ left: R.x + R.w, top: R.y, width: Math.max(0, stageW - R.x - R.w), height: R.h })} />
                  <div
                    className="pointer-events-none absolute rounded-md border-2 border-accent-strong"
                    style={{ left: R.x, top: R.y, width: R.w, height: R.h }}
                  />
                </>
              )}
              {hasFocus && showWhole && R && pick === null && (
                <div
                  className="pointer-events-none absolute rounded-md border-2 border-dashed border-accent-strong"
                  style={{ left: R.x, top: R.y, width: R.w, height: R.h }}
                />
              )}
            </div>
            </div>
            {waiting && <div className="absolute inset-0 flex items-center justify-center text-caption-md-regular text-tertiary">正在定位要展示的区域…</div>}
            {editable && cropping && R && (
              <>
                <div onPointerDown={startCropResize} onDoubleClick={() => updateAttributes({ cw: 0 })} title="拖动调整大小，双击恢复自动" className="absolute top-0 -right-1.5 h-full w-3 cursor-ew-resize" />
                <div
                  onPointerDown={startCropResize}
                  onDoubleClick={() => updateAttributes({ cw: 0 })}
                  title="拖动调整大小，双击恢复自动"
                  className="absolute -right-1.5 -bottom-1.5 size-4 cursor-nwse-resize rounded-sm border-2 border-accent-strong bg-surface-1 opacity-0 group-hover/html:opacity-100"
                />
              </>
            )}
            {editable && !cropping && (
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
      {full && <Fullscreen html={html} name={title} onClose={() => setFull(false)} />}
    </NodeViewWrapper>
  );
}
