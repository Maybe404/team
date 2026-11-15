// Agent 读写都用 Markdown；Plane 存的是 HTML。在这里来回转换。
import { marked } from "marked";
import TurndownService from "turndown";
// @ts-expect-error 该插件没有类型声明
import { gfm } from "@joplin/turndown-plugin-gfm";

marked.use({ gfm, breaks: false });

export function mdToHtml(md: string): string {
  let html = marked.parse(md, { async: false }) as string;
  // Plane 编辑器的任务列表：<ul data-type="taskList"><li data-type="taskItem" data-checked="true">
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
td.addRule("planeMention", {
  filter: (node) => node.nodeName === "MENTION-COMPONENT",
  replacement: (_c, node) => `@${(node as HTMLElement).getAttribute("entity_identifier") ?? ""}`,
});

export function htmlToMd(html: string | null | undefined): string {
  if (!html) return "";
  return td
    .turndown(html)
    .replace(/^(\s*)(\d+\.|-)\s{2,}/gm, "$1$2 ") // turndown 列表项后面会多出空格
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
