// Agent 读写都用 Markdown；Loom 存的是 HTML。在这里来回转换。
import { marked } from "marked";
import TurndownService from "turndown";
// @ts-expect-error 该插件没有类型声明
import { gfm } from "@joplin/turndown-plugin-gfm";

marked.use({ gfm, breaks: false });

const escAttr = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

// 编辑器里的 HTML 嵌入块在 Markdown 里写成 ```html-embed name="x.html" height=420 width=100 的围栏代码块，
// 围栏内是完整 HTML。往返时靠它保住嵌入块，全文改写不会把它删掉。
const EMBED_FENCE = /^(`{3,}|~{3,})html-embed([^\n]*)\n([\s\S]*?)\n\1[ \t]*$/gm;

export function mdToHtml(md: string): string {
  const embeds: string[] = [];
  md = md.replace(EMBED_FENCE, (_m, _f, info: string, body: string) => {
    const name = /name="([^"]*)"/.exec(info)?.[1] ?? "";
    const height = /height=(\d+)/.exec(info)?.[1] ?? "420";
    const width = /width=(\d+)/.exec(info)?.[1] ?? "100";
    embeds.push(
      `<html-embed-component data-html="${escAttr(body)}" data-name="${escAttr(name)}" data-height="${height}" data-width="${width}"></html-embed-component>`,
    );
    return `\n\nHTMLEMBEDSLOT${embeds.length - 1}END\n\n`;
  });
  let html = marked.parse(md, { async: false }) as string;
  html = html.replace(/<p>HTMLEMBEDSLOT(\d+)END<\/p>/g, (_m, i: string) => embeds[Number(i)] ?? "");
  // 文档里的图片：![](asset:<附件ID> "宽度|宽高比|对齐") 还原成编辑器的图片节点
  html = html.replace(/(<p>\s*)?<img src="asset:([^"]+)"([^>]*)>(\s*<\/p>)?/g, (_m, _p, id: string, rest: string) => {
    const title = /title="([^"]*)"/.exec(rest)?.[1] ?? "";
    const [width = "35%", ratio = "", align = "left"] = title.split("|");
    const r = ratio ? ` aspectRatio="${ratio}"` : "";
    return `<image-component src="${id}" width="${width || "35%"}" height="auto"${r} alignment="${align || "left"}" status="uploaded"></image-component>`;
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
  return html.trim() || "<p></p>";
}

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
    return `\n\n${fence}html-embed name="${name}" height=${h} width=${w}\n${html}\n${fence}\n\n`;
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
  replacement: (_c, node) => `@${(node as HTMLElement).getAttribute("entity_identifier") ?? ""}`,
});

export function htmlToMd(html: string | null | undefined): string {
  if (!html) return "";
  // turndown 会把没有文字内容的元素当空白丢掉，给自定义块补一个占位字符，规则里不会用到它
  html = html.replace(/<(html-embed-component|image-component)\b((?:[^>"]|"[^"]*")*)>\s*<\/\1>/gi, "<$1$2>.</$1>");
  html = html.replace(/\s+(<(?:html-embed|image)-component\b)/gi, "$1").replace(/(<\/(?:html-embed|image)-component>)\s+/gi, "$1");
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
    const width = /width=(\d+%?)/.exec(info)?.[1] ?? "80%";
    const caption = /caption="([^"]*)"/.exec(info)?.[1] ?? "";
    jobs.push({ name, type: "image/svg+xml", b64: Buffer.from(body, "utf8").toString("base64"), width: /%$/.test(width) ? width : `${width}%`, caption });
    return `\u0000IMG${jobs.length - 1}\u0000`;
  });
  out = out.replace(DATA_IMG, (_m, alt: string, type: string, b64: string) => {
    jobs.push({ name: `${alt.trim().replace(/[^\w一-鿿-]+/g, "_") || "image"}.${EXT[type]}`, type, b64: b64.replace(/\s+/g, ""), width: "60%", caption: alt.trim() });
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
