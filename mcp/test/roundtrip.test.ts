import { test } from "node:test";
import assert from "node:assert/strict";
import { htmlToMd, importInlineImages, mdToHtml } from "../src/markdown.ts";

const page = '<ul><li>a</li></ul><html-embed-component data-html="<h1 a=&quot;1&quot;>你好&lt;/h1&gt;&lt;script&gt;x&gt;1&lt;/script&gt;" data-name="demo.html" data-height="500" data-width="80"></html-embed-component><image-component src="abc-1" width="50%" height="auto" alignment="center" status="uploaded"></image-component><p>尾</p>';

test("HTML 嵌入块和图片经 Markdown 往返不丢失", () => {
  const md = htmlToMd(page);
  assert.match(md, /```html-embed name="demo.html" height=500 width=80/);
  assert.match(md, /!\[\]\(asset:abc-1 "50%\|\|center"\)/);
  const back = mdToHtml(md);
  assert.match(back, /<html-embed-component data-html="<h1 a=&quot;1&quot;>你好/);
  assert.match(back, /data-height="500" data-width="80"/);
  assert.match(back, /<image-component src="abc-1" width="50%" height="auto" alignment="center" status="uploaded">/);
  assert.equal(htmlToMd(back), md);
});

test("mermaid 代码块正常往返", () => {
  const md = "```mermaid\ngraph TD\n  A-->B\n```";
  assert.match(htmlToMd(mdToHtml(md)), /```mermaid\ngraph TD\n {2}A-->B\n```/);
});

import { checkStyle } from "../src/norms/style.ts";
test("html-embed 围栏里的内容不参与文风检查，也能含三个反引号", () => {
  const md = "结论：已上线。\n\n````html-embed name=\"a.html\" height=420 width=100\n<p>说白了，核心是：```x```</p>\n````\n\n后续：无。";
  assert.equal(checkStyle(md).filter((i) => i.excerpt.includes("说白了")).length, 0);
});


test("SVG 围栏和 data URI 图片上传后变成 asset 图片", async () => {
  const calls: { name: string; type: string; b64: string }[] = [];
  const md = [
    "## 图",
    "",
    '```svg name="架构.svg" width=70% caption="图 1：整体架构"',
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
    "```",
    "",
    "![截图](data:image/png;base64,iVBORw0KGgo=)",
  ].join("\n");
  const r = await importInlineImages(md, async (name, type, b64) => {
    calls.push({ name, type, b64 });
    return `id${calls.length}`;
  });
  assert.equal(r.count, 2);
  assert.equal(calls[0].type, "image/svg+xml");
  assert.equal(calls[0].name, "架构.svg");
  assert.match(Buffer.from(calls[0].b64, "base64").toString(), /<svg/);
  assert.equal(calls[1].type, "image/png");
  assert.match(r.md, /!\[\]\(asset:id1 "70%\|\|center"\)\n\n\*图 1：整体架构\*/);
  assert.match(r.md, /!\[\]\(asset:id2 "70%\|\|center"\)\n\n\*截图\*/);
  assert.ok(!r.md.includes("```svg"));
  const none = await importInlineImages("普通文字", async () => "x");
  assert.equal(none.count, 0);
});


test("页面链接卡片经 Markdown 往返不丢失", () => {
  const id = "11111111-2222-3333-4444-555555555555";
  const html = `<p>前文</p><page-link-component data-page-id="${id}" data-project-id="p1" data-title="部署手册"></page-link-component><p>后文</p>`;
  const md = htmlToMd(html);
  assert.match(md, new RegExp(`\\[📄 部署手册\\]\\(page:${id}\\)`));
  const back = mdToHtml(md, { projectId: "p1" });
  assert.match(back, new RegExp(`<page-link-component data-page-id="${id}" data-project-id="p1" data-title="部署手册"></page-link-component>`));
  assert.doesNotMatch(back, /<a href="page:/);
});
