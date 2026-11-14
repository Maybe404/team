import assert from "node:assert/strict";
import { test } from "node:test";
import { gate } from "../src/norms/index.ts";
import { htmlToMd, mdToHtml } from "../src/markdown.ts";

const goodTask = "## 目标\n\n修复订单列表分页在第二页重复数据的问题。\n\n## 验收标准\n\n- [ ] 翻页不再重复\n- [ ] 新增回归测试\n";

test("合规的任务描述通过", () => {
  const r = gate(goodTask, "task", { title: "修复订单分页重复" });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test("缺少必填章节被拒绝", () => {
  const r = gate("## 目标\n\n做点事情。", "task");
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.rule === "缺少章节" && e.message.includes("验收标准")));
});

test("章节别名也算数", () => {
  const r = gate("## 背景\n\n原因说明。\n\n## 完成标准\n\n- [ ] 条目", "task");
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test("套话和模型自述被拒绝", () => {
  const md = `${goodTask}\n值得注意的是，这个问题至关重要。总而言之，希望对你有帮助。作为 AI，我为你整理了方案。`;
  const r = gate(md, "task");
  const rules = r.errors.map((e) => e.rule);
  assert.ok(rules.includes("套话"));
  assert.ok(rules.includes("模型自述"));
  assert.ok(r.errors.some((e) => e.excerpt === "值得注意的是，"));
});

test("emoji 被拒绝", () => {
  const r = gate(`${goodTask}\n完成 ✅ 🚀`, "task");
  assert.ok(r.errors.some((e) => e.rule === "emoji"));
});

test("代码块里的内容不检查", () => {
  const r = gate(`${goodTask}\n\`\`\`js\n// 值得注意的是 🚀\n\`\`\`\n`, "task");
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test("加粗过多被拒绝", () => {
  const r = gate(`${goodTask}\n**一** **二** **三** **四** **五**`, "task");
  assert.ok(r.errors.some((e) => e.rule === "加粗过多"));
});

test("结论评论必须带证据", () => {
  assert.equal(gate("分页问题已修复，测试都没问题。", "comment", { commentKind: "结论" }).ok, false);
  assert.equal(gate("分页问题已修复。\n\n跑了 `pnpm test`，42 个用例通过。", "comment", { commentKind: "结论" }).ok, true);
});

test("评论第一行不能是标题", () => {
  assert.equal(gate("## 进展\n\n今天改完了接口层。", "comment", { commentKind: "进展" }).ok, false);
});

test("经验必须有场景和做法", () => {
  assert.equal(gate("## 场景\n\nDjango 写数据迁移时。", "lesson").ok, false);
  assert.equal(
    gate("## 场景\n\nDjango 写数据迁移时需要读写模型。\n\n## 做法\n\n用 `apps.get_model()` 取历史模型，不要直接 import。", "lesson").ok,
    true,
  );
});

test("警告不阻止写入", () => {
  const r = gate(`${goodTask}\n## 总结\n\n这个改动很好！`, "task");
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some((w) => w.rule === "结尾总结"));
  assert.ok(r.warnings.some((w) => w.rule === "感叹号"));
});

test("Markdown 和 Plane HTML 互转保留任务列表", () => {
  const html = mdToHtml("## 验收\n\n- [ ] 未完成\n- [x] 已完成\n");
  assert.match(html, /data-type="taskList"/);
  assert.match(html, /data-checked="true"/);
  const back = htmlToMd(html);
  assert.match(back, /- \[ \] 未完成/);
  assert.match(back, /- \[x\] 已完成/);
});
