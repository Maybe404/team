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

test("翻案腔、提示语冒号、起手式被拒绝（less-ai-tone）", () => {
  const md = `${goodTask}\n说白了，真正的瓶颈不是数据库，而是缓存失效。一句话总结：先修缓存。`;
  const r = gate(md, "task");
  const rules = r.errors.map((e) => e.rule);
  assert.ok(rules.includes("翻案腔"), JSON.stringify(rules));
  assert.ok(rules.includes("提示语冒号"), JSON.stringify(rules));
  assert.ok(rules.includes("起手式"), JSON.stringify(rules));
});

test("翻译腔和顿号罗列只提示不拒绝", () => {
  const r = gate(`${goodTask}\n对于早期团队来说，招人最难。\n\n然而，当负载升高时，延迟、错误率、超时数都会上升。`, "task");
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const rules = r.warnings.map((w) => w.rule);
  assert.ok(rules.includes("前置话题壳") && rules.includes("句首连接词") && rules.includes("当…时从句"), JSON.stringify(rules));
});

test("实测不是 AI 味的写法不拦（X 级）", () => {
  const r = gate(`${goodTask}\n## 一、背景\n\n首先，这意味着赋能闭环。其次，改动有两处。\n\n- 一\n- 二\n`, "task");
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test("对话助手残留和模型自述被拒绝", () => {
  const r = gate(`${goodTask}\n希望对你有帮助。作为 AI，我为你整理了方案。`, "task");
  const rules = r.errors.map((e) => e.rule);
  assert.ok(rules.includes("套话") && rules.includes("模型自述"), JSON.stringify(rules));
});

test("列表和标题里的冒号、引文不检查", () => {
  const r = gate(`${goodTask}\n## 原因：缓存\n\n- 核心是：缓存\n\n> 说白了，不是 A 而是 B\n`, "task");
  assert.ok(!r.errors.some((e) => e.rule === "提示语冒号" || e.rule === "翻案腔"), JSON.stringify(r.errors));
});

test("emoji 被拒绝", () => {
  const r = gate(`${goodTask}\n完成 ✅ 🚀`, "task");
  assert.ok(r.errors.some((e) => e.rule === "emoji"));
});

test("代码块和行内代码不检查", () => {
  const r = gate(`${goodTask}\n\`\`\`js\n// 说白了，不是 A 而是 B 🚀\n\`\`\`\n用 \`不是x而是y\` 匹配。\n`, "task");
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
