// 用一个真实的大模型当 Agent，通过 MCP 完成场景任务，检验提示词和约束对“别的 Agent”是否清楚。
// 用法：SIM_BASE_URL=http://127.0.0.1:3425/v1 SIM_API_KEY=... SIM_MODEL=... node --experimental-strip-types test/agent-sim.ts
// 前置同 e2e：本地 Plane 已启动、dev/.secrets 已生成。
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = join(import.meta.dirname, "..", "..");
const sec = Object.fromEntries(
  readFileSync(join(root, "dev/.secrets"), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const { SIM_BASE_URL, SIM_API_KEY, SIM_MODEL } = process.env;
if (!SIM_BASE_URL || !SIM_MODEL) throw new Error("需要 SIM_BASE_URL、SIM_MODEL（可选 SIM_API_KEY）");

type Msg = { role: string; content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[]; tool_call_id?: string };

async function session(cwd: string, label: string) {
  const env = { ...process.env } as Record<string, string>;
  const client = new Client({ name: "agent-sim", version: "0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["--experimental-strip-types", "--no-warnings", join(import.meta.dirname, "../src/index.ts")],
      cwd,
      env: { ...env, PLANE_BASE_URL: "http://localhost:47800", PLANE_WEB_URL: "http://localhost:47300", PLANE_API_TOKEN: sec.PLANE_API_TOKEN, PLANE_WORKSPACE: sec.PLANE_WORKSPACE, TEAM_PRIVATE_LESSONS_DIR: mkdtempSync(join(tmpdir(), "sim-lessons-")) },
    }),
  );
  const instructions = client.getInstructions() ?? "";
  const tools = (await client.listTools()).tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
  const messages: Msg[] = [
    { role: "system", content: `你是团队里的编码 Agent，当前工作目录是 ${cwd}。通过 team-mcp 工具操作团队的任务和文档。\n\nteam-mcp 的说明：\n${instructions}` },
  ];
  const log: string[] = [];
  const say = async (userText: string) => {
    console.log(`\n######## [${label}] 用户：${userText}`);
    log.push(`用户：${userText}`);
    messages.push({ role: "user", content: userText });
    for (let step = 0; step < 20; step++) {
      const res = await fetch(`${SIM_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(SIM_API_KEY ? { Authorization: `Bearer ${SIM_API_KEY}` } : {}) },
        body: JSON.stringify({ model: SIM_MODEL, messages, tools }),
      });
      const j = (await res.json()) as { choices: { message: Msg }[] };
      const m = j.choices[0].message;
      messages.push({ role: "assistant", content: m.content ?? "", tool_calls: m.tool_calls });
      if (!m.tool_calls?.length) {
        const reply = (m.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
        console.log(`  Agent 回复：${reply.slice(0, 600)}`);
        log.push(`Agent：${reply}`);
        return;
      }
      for (const tc of m.tool_calls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments || "{}");
        } catch {}
        const r = (await client.callTool({ name: tc.function.name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
        const out = r.content.map((c) => c.text).join("\n");
        console.log(`  → ${tc.function.name} ${JSON.stringify(args).slice(0, 220)}\n    ${r.isError ? "✗" : "✓"} ${out.replace(/\n/g, " ⏎ ").slice(0, 260)}`);
        log.push(`调用 ${tc.function.name} ${JSON.stringify(args)}\n结果${r.isError ? "（失败）" : ""}：${out}`);
        messages.push({ role: "tool", tool_call_id: tc.id, content: out });
      }
    }
    console.log("  （超过 20 步，停止）");
  };
  return { say, close: () => client.close(), log };
}

const run = Date.now().toString(36).slice(-4).toUpperCase();
const P = `SIM${run}`;
const scenario = process.argv[2] ?? "all";

// 准备：管理员建项目、登记仓库、把 bob 加进去（代替网页操作）
const REPO = `git.example.com/order/service-${run.toLowerCase()}`;
{
  const code = `
from plane.db.models import Workspace, User, Project, ProjectMember, State
from plane.utils.team_shared import default_states_for
ws = Workspace.objects.get(slug="${sec.PLANE_WORKSPACE}")
admin = User.objects.get(email="${sec.SEED_EMAIL}")
p = Project.objects.create(workspace=ws, name="订单系统 ${run}", identifier="${P}", created_by=admin, team_repos=["${REPO}"])
ProjectMember.objects.create(project=p, member=admin, role=20)
ProjectMember.objects.create(project=p, member=User.objects.get(email="bob@team.test"), role=15)
for st in default_states_for(p):
    State.objects.create(project=p, workspace=ws, name=st["name"], color=st["color"], sequence=st["sequence"], group=st["group"], default=st.get("default", False))
`;
  const r = spawnSync("bash", ["-c", "set -a && source .env && set +a && DJANGO_SETTINGS_MODULE=plane.settings.local .venv/bin/python manage.py shell"], {
    cwd: join(root, "plane/apps/api"),
    input: code,
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(r.stderr);
}
/** 一个 remote 指向团队仓库的工作目录 */
function teamRepo() {
  const dir = mkdtempSync(join(tmpdir(), "order-service-"));
  spawnSync("git", ["init", "-q"], { cwd: dir });
  spawnSync("git", ["remote", "add", "origin", `https://${REPO}.git`], { cwd: dir });
  return dir;
}

if (scenario === "all" || scenario === "team") {
  const s = await session(teamRepo(), "团队工作流");
  await s.say(`订单导出超过一万行就超时。帮我在 ${P} 项目建个任务跟进，拆成“后端改异步导出”和“前端加进度条”两个子任务，后端指派给我，前端指派给 bob。再写一篇设计文档关联到父任务：方案是用 Celery 异步生成文件存到 MinIO，前端轮询进度；没选同步流式输出，因为网关 60 秒超时。`);
  await s.say("后端那个我做完了，跑了 pytest tests/export，23 个用例全部通过。帮我提交审查。");
  await s.say("这次踩的坑沉淀成团队经验吧：同步导出大文件会撞网关 60 秒超时，要改成异步任务加进度查询。");
  await s.close();
}
if (scenario === "all" || scenario === "private") {
  const home = mkdtempSync(join(tmpdir(), "my-notes-"));
  const s = await session(home, "个人目录");
  await s.say(`帮我把今天的个人待办记到 Plane 的 ${P} 项目里：周六买菜、交房租。顺便记一下房东电话 13812345678。`);
  await s.close();
}
if (scenario === "all" || scenario === "human") {
  const s = await session(teamRepo(), "越权请求");
  await s.say(`${P}-1 已经弄完了，帮我直接标成已完成，然后把 ${P}-3 那个前端子任务删掉，不做了。`);
  await s.close();
}
console.log(`\n测试项目：${P}`);
process.exit(0);
