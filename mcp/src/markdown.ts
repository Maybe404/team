// Agent 读写都用 Markdown；Loom 存的是 HTML。在这里来回转换。
import { randomUUID } from "node:crypto";
import { marked } from "marked";
import { autoImageWidth, sizeTables, widthToPx } from "./layout.ts";
import TurndownService from "turndown";
// @ts-expect-error 该插件没有类型声明
import { gfm } from "@joplin/turndown-plugin-gfm";

marked.use({ gfm, breaks: false });

const escAttr = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

// 编辑器里的 HTML 嵌入块在 Markdown 里写成 ```html-embed name="x.html" height=420 width=100 的围栏代码块，
// 围栏内是完整 HTML。往返时靠它保住嵌入块，全文改写不会把它删掉。
// 只讲原型里的一块：加 focus="选择器"（引号和反斜杠按 JSON 转义），可选 mode=spot（整页压暗其余，默认 crop 只露出这块）、
// follow=false（不把附近弹出的下拉算进去）、lock=false（压暗区域仍可点）；
// ref="名称" 表示复用同一篇文档里同名的完整块，此时围栏内留空，原型只存一份。
// 围栏里可以什么都不写（局部块），所以「开围栏后立刻闭合」要单独识别；否则两个空局部块之间的正文会被吞进第一个块。
const EMBED_FENCE = /^(`{3,}|~{3,})html-embed([^\n]*)\n(?:\1[ \t]*$|([\s\S]*?)\n\1[ \t]*$)/gm;

const fenceStr = (info: string, key: string): string => {
  const m = new RegExp(`(?:^|\\s)${key}="((?:[^"\\\\]|\\\\.)*)"`).exec(info);
  if (!m) return "";
  try {
    return JSON.parse(`"${m[1]}"`) as string;
  } catch {
    return m[1];
  }
};

/** 只能检查简单选择器（#id、.class、[属性="值"]、标签），复杂的返回 null 表示没法判断。属性值带不带引号都认 */
function selectorInHtml(sel: string, html: string): boolean | null {
  const s = sel.trim();
  const esc = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const end = `(?=["'\\s>/])`;
  let m: RegExpExecArray | null;
  if ((m = /^#([\w-]+)$/.exec(s))) return new RegExp(`\\bid=["']?${esc(m[1])}${end}`).test(html);
  if ((m = /^\.([\w-]+)$/.exec(s))) return new RegExp(`\\bclass=["']?(?:[^"'>]*\\s)?${esc(m[1])}${end}`).test(html);
  if ((m = /^\[([\w-]+)=["']?([^"'\]]*)["']?\]$/.exec(s))) return new RegExp(`\\b${esc(m[1])}=["']?${esc(m[2])}${end}`).test(html);
  if ((m = /^\[([\w-]+)\]$/.exec(s))) return new RegExp(`\\b${esc(m[1])}\\b`).test(html);
  if ((m = /^([a-z][a-z0-9-]*)$/i.exec(s))) return new RegExp(`<${esc(m[1])}[\\s>/]`, "i").test(html);
  return null;
}

/** 写文档前检查 html-embed 局部块的引用：找不到原型、选择器在原型里不存在，都在写入前退回，免得页面上显示一片空白 */
export function embedProblems(md: string): string[] {
  const blocks = [...md.matchAll(EMBED_FENCE)].map((m) => {
    const info = m[2] ?? "";
    return { name: /name="([^"]*)"/.exec(info)?.[1] ?? "", id: fenceStr(info, "id"), ref: fenceStr(info, "ref"), focus: fenceStr(info, "focus"), body: m[3] ?? "" };
  });
  const out: string[] = [];
  const sources = blocks.filter((b) => b.body.trim() && !b.ref);
  for (const b of blocks.filter((x) => x.ref)) {
    const src = sources.find((s) => s.id === b.ref) ?? sources.find((s) => s.name === b.ref);
    if (!src) {
      out.push(`局部块 ref="${b.ref}" 找不到原型：同一篇文档里要有一个完整的 html-embed 块，name 写成 "${b.ref}"（围栏里是完整 HTML）。`);
      continue;
    }
    if (!b.focus) out.push(`局部块 ref="${b.ref}" 没写 focus：不写选择器就是把整个原型再显示一遍。`);
    else if (selectorInHtml(b.focus, src.body) === false && !/<script[\s>]/i.test(src.body)) out.push(`局部块 focus=${JSON.stringify(b.focus)} 在原型「${src.name || src.id}」里找不到对应元素。给要单独讲的块加 data-focus="名字"，focus 写 [data-focus="名字"]。`);
  }
  const names = sources.map((s) => s.name).filter(Boolean);
  const dup = names.find((n, i) => names.indexOf(n) !== i && blocks.some((b) => b.ref === n));
  if (dup) out.push(`有两个完整原型都叫「${dup}」，局部块分不清引用哪个：改成不同的 name。`);
  return out;
}

export type Person = { id: string; name: string };

/** 把正文里的 @姓名 换成提及标签；代码、链接里的不动。返回新 HTML 和提到的人。 */
export function mentionPeople(html: string, members: Person[]): { html: string; mentioned: Person[] } {
  const named = members.filter((m) => m.name).sort((a, b) => b.name.length - a.name.length);
  if (!named.length) return { html, mentioned: [] };
  const re = new RegExp(`@(${named.map((m) => m.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
  const found = new Map<string, Person>();
  let skip = 0;
  const out = html
    .split(/(<[^>]+>)/)
    .map((part) => {
      if (part.startsWith("<")) {
        if (/^<(code|pre|a)[\s>]/i.test(part)) skip++;
        else if (/^<\/(code|pre|a)>/i.test(part)) skip = Math.max(0, skip - 1);
        return part;
      }
      if (skip) return part;
      return part.replace(re, (_m, name: string) => {
        const m = named.find((x) => x.name === name)!;
        found.set(m.id, m);
        return `<mention-component id="${randomUUID()}" entity_identifier="${m.id}" entity_name="user_mention"></mention-component>`;
      });
    })
    .join("");
  return { html: out, mentioned: [...found.values()] };
}


// 提示块（callout）：Markdown 里写 GitHub 提示块语法，写入时变成编辑器的提示块（带图标和底色）：
//   > [!NOTE] 可选标题      > [!TIP]      > [!IMPORTANT]      > [!WARNING]      > [!CAUTION]
const CALLOUTS: Record<string, { emoji: string; file: string; bg: string }> = {
  NOTE: { emoji: "1f4dd", file: "1f4dd", bg: "light-blue" },
  TIP: { emoji: "1f4a1", file: "1f4a1", bg: "green" },
  IMPORTANT: { emoji: "2757", file: "2757", bg: "purple" },
  WARNING: { emoji: "26a0", file: "26a0-fe0f", bg: "orange" },
  CAUTION: { emoji: "26d4", file: "26d4", bg: "pink" },
};

function calloutsToHtml(html: string): string {
  return html.replace(/<blockquote>\s*<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*([\s\S]*?)<\/p>([\s\S]*?)<\/blockquote>/g, (_m, kind: string, first: string, rest: string) => {
    const c = CALLOUTS[kind];
    const firstP = first.trim() ? `<p>${first.trim()}</p>` : "";
    const body = `${firstP}${rest}`.trim() || "<p></p>";
    return `<div data-block-type="callout-component" data-logo-in-use="emoji" data-emoji-unicode="${c.emoji}" data-emoji-url="https://cdn.jsdelivr.net/npm/emoji-datasource-apple/img/apple/64/${c.file}.png" data-background="${c.bg}">${body}</div>`;
  });
}

export function mdToHtml(md: string, opts: { projectId?: string; members?: Person[] } = {}): string {
  return mdToHtmlWith(md, opts).html;
}

export function mdToHtmlWith(md: string, opts: { projectId?: string; members?: Person[] } = {}): { html: string; mentioned: Person[] } {
  const embeds: string[] = [];
  // 给每个完整原型块一个固定编号，局部块的 ref（写的是名称）解析成这个编号：
  // 以后在网页上替换原型文件、改了文件名，局部块也不会断
  const srcUids: string[] = [];
  const nameToUid = new Map<string, string>();
  const knownUids = new Set<string>();
  for (const m of md.matchAll(EMBED_FENCE)) {
    const info = m[2] ?? "";
    const isSource = !!(m[3] ?? "").trim() && !fenceStr(info, "ref");
    const uid = isSource ? fenceStr(info, "id") || randomUUID().slice(0, 8) : "";
    srcUids.push(uid);
    if (uid) {
      knownUids.add(uid);
      const nm = /name="([^"]*)"/.exec(info)?.[1] ?? "";
      if (nm && !nameToUid.has(nm)) nameToUid.set(nm, uid);
    }
  }
  let fenceNo = 0;
  md = md.replace(EMBED_FENCE, (_m, _f, info: string, bodyRaw: string | undefined) => {
    const body = bodyRaw ?? "";
    const srcUid = srcUids[fenceNo++] ?? "";
    const name = /name="([^"]*)"/.exec(info)?.[1] ?? "";
    const height = /height=(\d+)/.exec(info)?.[1] ?? "420";
    const width = /width=(\d+)/.exec(info)?.[1] ?? "100";
    const focus = fenceStr(info, "focus");
    const refRaw = fenceStr(info, "ref");
    const ref = refRaw && !knownUids.has(refRaw) ? (nameToUid.get(refRaw) ?? refRaw) : refRaw;
    const uid = srcUid;
    const cw = /(?:^|\s)cw=(\d+)/.exec(info)?.[1];
    const extra = [
      uid ? ` data-uid="${escAttr(uid)}"` : "",
      focus && cw ? ` data-cw="${cw}"` : "",
      focus ? ` data-focus="${escAttr(focus)}"` : "",
      focus && /(?:^|\s)mode=spot\b/.test(info) ? ' data-mode="spot"' : "",
      focus && /(?:^|\s)follow=false\b/.test(info) ? ' data-follow="false"' : "",
      focus && /(?:^|\s)lock=false\b/.test(info) ? ' data-lock="false"' : "",
      ref ? ` data-ref="${escAttr(ref)}"` : "",
    ].join("");
    embeds.push(
      `<html-embed-component data-html="${escAttr(body)}" data-name="${escAttr(name)}" data-height="${height}" data-width="${width}"${extra}></html-embed-component>`,
    );
    return `\n\nHTMLEMBEDSLOT${embeds.length - 1}END\n\n`;
  });
  let html = calloutsToHtml(sizeTables(marked.parse(md, { async: false }) as string));
  // 页面链接卡片：单独一行的 [📄 标题](page:<页面ID>)，对应编辑器里的子页面/链接块
  html = html.replace(/<p>\s*<a href="page:([0-9a-fA-F-]{32,36})"[^>]*>([\s\S]*?)<\/a>\s*<\/p>/g, (_m, id: string, label: string) => {
    const title = label.replace(/<[^>]*>/g, "").replace(/^📄\s*/, "").trim().replace(/"/g, "&quot;");
    return `<page-link-component data-page-id="${id}" data-project-id="${opts.projectId ?? ""}" data-title="${title}"></page-link-component>`;
  });
  // 行内的 [📄 标题](page:ID)：还原成 @ 页面标签（需要知道项目）
  if (opts.projectId) {
    html = html.replace(/<a href="page:([0-9a-fA-F-]{32,36})"[^>]*>[\s\S]*?<\/a>/g, (_m, id: string) =>
      `<mention-component id="${randomUUID()}" entity_identifier="${opts.projectId}/${id}" entity_name="page"></mention-component>`);
  }
  html = html.replace(/<p>HTMLEMBEDSLOT(\d+)END<\/p>/g, (_m, i: string) => embeds[Number(i)] ?? "");
  // 文档里的图片：![](asset:<附件ID> "宽度|宽高比|对齐") 还原成编辑器的图片节点
  html = html.replace(/(<p>\s*)?<img src="asset:([^"]+)"([^>]*)>(\s*<\/p>)?/g, (_m, _p, id: string, rest: string) => {
    const title = /title="([^"]*)"/.exec(rest)?.[1] ?? "";
    const [rawWidth = "", ratio = "", align = "center"] = title.split("|");
    const width = widthToPx(rawWidth || "70%"); // 编辑器按像素算宽度，百分比不生效，这里统一折成像素
    const r = ratio ? ` aspectRatio="${ratio}"` : "";
    return `<image-component src="${id}" width="${width}" height="auto"${r} alignment="${align || "center"}" status="uploaded"></image-component>`;
  });
  // Loom 编辑器的任务列表：<ul data-type="taskList"><li data-type="taskItem" data-checked="true">
  html = html.replace(/<ul>\s*(<li><input[^>]*type="checkbox"[\s\S]*?)<\/ul>/g, (_m, items: string) => {
    const lis = items.replace(
      /<li><input([^>]*)type="checkbox"([^>]*)>\s*([\s\S]*?)<\/li>/g,
      (_x, a: string, b: string, body: string) =>
        `<li data-type="taskItem" data-checked="${/checked/.test(a + b)}"><p>${body.trim()}</p></li>`,
    );
    return `<ul data-type="taskList">${lis}</ul>`;
  });
  const r = mentionPeople(html, opts.members ?? []);
  return { html: r.html.trim() || "<p></p>", mentioned: r.mentioned };
}

let mentionNames = new Map<string, string>();
const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-", emDelimiter: "*" });
td.use(gfm);
td.addRule("planeTaskItem", {
  filter: (node) => node.nodeName === "LI" && (node as HTMLElement).getAttribute("data-type") === "taskItem",
  replacement: (content, node) => {
    const checked = (node as HTMLElement).getAttribute("data-checked") === "true";
    return `- [${checked ? "x" : " "}] ${content.trim().replace(/\n+/g, " ")}\n`;
  },
});
td.addRule("planeHtmlEmbed", {
  filter: (node) => node.nodeName === "HTML-EMBED-COMPONENT",
  replacement: (_c, node) => {
    const el = node as HTMLElement;
    const html = el.getAttribute("data-html") ?? "";
    const name = (el.getAttribute("data-name") ?? "").replace(/"/g, "'");
    const fence = "`".repeat(Math.max(3, ...(html.match(/`+/g) ?? []).map((m) => m.length + 1)));
    const h = el.getAttribute("data-height") ?? "420";
    const w = el.getAttribute("data-width") ?? "100";
    const q = (v: string) => JSON.stringify(v);
    const focus = el.getAttribute("data-focus") ?? "";
    const ref = el.getAttribute("data-ref") ?? "";
    const uid = el.getAttribute("data-uid") ?? "";
    const extra = [
      uid ? ` id=${q(uid)}` : "",
      focus && el.getAttribute("data-cw") ? ` cw=${el.getAttribute("data-cw")}` : "",
      focus ? ` focus=${q(focus)}` : "",
      focus && el.getAttribute("data-mode") === "spot" ? " mode=spot" : "",
      focus && el.getAttribute("data-follow") === "false" ? " follow=false" : "",
      focus && el.getAttribute("data-lock") === "false" ? " lock=false" : "",
      ref ? ` ref=${q(ref)}` : "",
    ].join("");
    return `\n\n${fence}html-embed name="${name}" height=${h} width=${w}${extra}\n${html ? `${html}\n` : ""}${fence}\n\n`;
  },
});
td.addRule("planeCallout", {
  filter: (node) => node.nodeName === "DIV" && (node as HTMLElement).getAttribute("data-block-type") === "callout-component",
  replacement: (content, node) => {
    const code = (node as HTMLElement).getAttribute("data-emoji-unicode") ?? "";
    const kind = Object.entries(CALLOUTS).find(([, v]) => v.emoji === code)?.[0] ?? "NOTE";
    const body = content.trim().split("\n").map((l) => `> ${l}`.trimEnd()).join("\n");
    return `\n\n> [!${kind}]\n${body}\n\n`;
  },
});
td.addRule("pageLink", {
  filter: (node) => node.nodeName === "PAGE-LINK-COMPONENT",
  replacement: (_c, node) => {
    const el = node as HTMLElement;
    const title = (el.getAttribute("data-title") ?? "").replace(/[[\]]/g, "") || "页面";
    return `\n\n[📄 ${title}](page:${el.getAttribute("data-page-id") ?? ""})\n\n`;
  },
});
td.addRule("planeImage", {
  filter: (node) => node.nodeName === "IMAGE-COMPONENT",
  replacement: (_c, node) => {
    const el = node as HTMLElement;
    const src = el.getAttribute("src");
    if (!src) return "";
    const meta = [el.getAttribute("width") ?? "", el.getAttribute("aspectratio") ?? "", el.getAttribute("alignment") ?? ""].join("|");
    return `\n\n![](asset:${src} "${meta}")\n\n`;
  },
});
td.addRule("planeMention", {
  filter: (node) => node.nodeName === "MENTION-COMPONENT",
  replacement: (_c, node) => {
    const el = node as HTMLElement;
    const ident = el.getAttribute("entity_identifier") ?? "";
    // @ 出来的页面写成 [📄 页面](page:ID)，往返时还原成 @ 标签；其他沿用 @标识
    if (el.getAttribute("entity_name") === "page") return `[📄 页面](page:${ident.split("/").pop()})`;
    return `@${mentionNames.get(ident) ?? ident}`;
  },
});

export function htmlToMd(html: string | null | undefined, members: Person[] = []): string {
  if (!html) return "";
  mentionNames = new Map(members.map((m) => [m.id, m.name]));
  // turndown 会把没有文字内容的元素当空白丢掉，给自定义块补一个占位字符，规则里不会用到它
  html = html.replace(/<(html-embed-component|image-component|page-link-component|mention-component)\b((?:[^>"]|"[^"]*")*)>\s*<\/\1>/gi, "<$1$2>.</$1>");
  html = html.replace(/\s+(<(?:html-embed|image|page-link)-component\b)/gi, "$1").replace(/(<\/(?:html-embed|image|page-link)-component>)\s+/gi, "$1");
  return td
    .turndown(html)
    .replace(/\n[ \t]+\n/g, "\n\n")
    .replace(/^(\s*)(\d+\.|-)\s{2,}/gm, "$1$2 ") // turndown 列表项后面会多出空格
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}


// ---------- 图片导入：SVG 源码围栏和 data URI 图片 ----------
// ```svg name="流程.svg" width=80% caption="图 1：下单流程"   围栏里直接写 SVG 源码
// ![说明](data:image/png;base64,....)       PNG、JPEG、GIF、WebP、SVG 的 data URI
// 写入前上传成文档附件，改写成居中的 ![](asset:<ID> "宽度||center")，说明文字变成图下面一行斜体图注；网页上就是普通图片，点图可放大预览。
const SVG_FENCE = /^(`{3,}|~{3,})svg([^\n]*)\n([\s\S]*?)\n\1[ \t]*$/gm;
const DATA_IMG = /!\[([^\]]*)\]\(data:(image\/(?:png|jpeg|gif|webp|svg\+xml));base64,([A-Za-z0-9+/=\s]+)\)/g;
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg" };

export type ImageUploader = (name: string, contentType: string, dataBase64: string) => Promise<string>;

export async function importInlineImages(md: string, upload: ImageUploader): Promise<{ md: string; count: number }> {
  type Job = { name: string; type: string; b64: string; width: string; caption: string };
  const jobs: Job[] = [];
  let out = md.replace(SVG_FENCE, (_m, _f, info: string, body: string) => {
    const name = /name="([^"]*)"/.exec(info)?.[1] || `diagram-${jobs.length + 1}.svg`;
    const width = /width=(\d+%?)/.exec(info)?.[1] ?? "auto";
    const caption = /caption="([^"]*)"/.exec(info)?.[1] ?? "";
    const buf = Buffer.from(body, "utf8");
    jobs.push({ name, type: "image/svg+xml", b64: buf.toString("base64"), width: width === "auto" ? autoImageWidth("image/svg+xml", buf) : widthToPx(/%$/.test(width) ? width : `${width}%`), caption });
    return `\u0000IMG${jobs.length - 1}\u0000`;
  });
  out = out.replace(DATA_IMG, (_m, alt: string, type: string, b64: string) => {
    jobs.push({ name: `${alt.trim().replace(/[^\w一-鿿-]+/g, "_") || "image"}.${EXT[type]}`, type, b64: b64.replace(/\s+/g, ""), width: autoImageWidth(type, Buffer.from(b64.replace(/\s+/g, ""), "base64")), caption: alt.trim() });
    return `\u0000IMG${jobs.length - 1}\u0000`;
  });
  if (!jobs.length) return { md, count: 0 };
  const ids = await Promise.all(jobs.map((j) => upload(j.name, j.type, j.b64)));
  out = out.replace(/\u0000IMG(\d+)\u0000/g, (_m, i: string) => {
    const j = jobs[Number(i)];
    // 居中显示；有说明文字就在图下面加一行斜体图注
    return `![](asset:${ids[Number(i)]} "${j.width}||center")${j.caption ? `\n\n*${j.caption}*` : ""}`;
  });
  return { md: out, count: jobs.length };
}
