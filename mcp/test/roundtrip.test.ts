import { test } from "node:test";
import assert from "node:assert/strict";
import { htmlToMd, mdToHtml } from "../src/markdown.ts";

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
