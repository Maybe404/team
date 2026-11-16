#!/usr/bin/env node
// team-review：定时回顾。
//   team-review                     生成并发布今天的回顾，打印到标准输出
//   team-review --dry-run           只打印，不写 Loom
//   team-review --daemon --at 09:00 常驻，每天 09:00（本机时区）执行一次；启动时如果今天还没发布会先补一次
// 配置和 team-mcp 相同：PLANE_BASE_URL、PLANE_WEB_URL、PLANE_API_TOKEN、PLANE_WORKSPACE，
// 另有 TEAM_REVIEW_AT（默认 09:00）、TEAM_REVIEW_STALE_DAYS（默认 3）、TEAM_REVIEW_PROJECT（默认 REVIEW）。
import { parseArgs } from "node:util";
import { Loom } from "./plane.ts";
import { buildDigest, digestTitle, getReviewProject, publishDigest } from "./review.ts";

const { values } = parseArgs({
  options: {
    "dry-run": { type: "boolean" },
    daemon: { type: "boolean" },
    at: { type: "string" },
    "stale-days": { type: "string" },
    "only-mine": { type: "boolean" },
  },
});

function env(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`缺少环境变量 ${name}`);
    process.exit(2);
  }
  return v;
}

const plane = new Loom({
  baseUrl: process.env.PLANE_BASE_URL || "http://localhost:47800",
  webUrl: process.env.PLANE_WEB_URL || "http://localhost:47300",
  token: env("PLANE_API_TOKEN"),
  workspace: env("PLANE_WORKSPACE"),
});
const opts = {
  staleDays: Number(values["stale-days"] ?? process.env.TEAM_REVIEW_STALE_DAYS ?? 3),
  onlyMine: Boolean(values["only-mine"]),
  team: !values["only-mine"],
  webUrl: (p: string) => plane.webUrl(p),
};
const at = values.at ?? process.env.TEAM_REVIEW_AT ?? "09:00";

const log = (msg: string) => console.log(`[${new Date().toLocaleString("sv-SE")}] ${msg}`);

async function once() {
  const r = await publishDigest(plane, opts);
  log(`${r.updated ? "已更新" : "已发布"}「${r.title}」，${r.total} 项需要关注：${r.url}`);
  return r;
}

async function publishedToday(): Promise<boolean> {
  const project = await getReviewProject(plane);
  const title = digestTitle();
  return (await plane.listPages(project.id)).some((p) => p.name === title);
}

function msUntil(hhmm: string): number {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) throw new Error(`--at 的格式是 HH:MM，收到「${hhmm}」`);
  const now = new Date();
  const next = new Date(now);
  next.setHours(Number(m[1]), Number(m[2]), 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

async function daemon() {
  log(`定时回顾已启动，每天 ${at} 执行`);
  const [h, mm] = at.split(":").map(Number);
  const now = new Date();
  const pastToday = now.getHours() > h || (now.getHours() === h && now.getMinutes() >= mm);
  if (pastToday && !(await publishedToday().catch(() => true))) {
    await once().catch((e) => log(`执行失败：${e instanceof Error ? e.message : e}`));
  }
  for (;;) {
    const wait = msUntil(at);
    log(`下次执行：${new Date(Date.now() + wait).toLocaleString("sv-SE")}`);
    await new Promise((r) => setTimeout(r, wait));
    await once().catch((e) => log(`执行失败：${e instanceof Error ? e.message : e}`));
  }
}

if (values.daemon) {
  await daemon();
} else if (values["dry-run"]) {
  console.log((await buildDigest(plane, opts)).md);
} else {
  const r = await once();
  console.log(`\n${r.md}`);
}
