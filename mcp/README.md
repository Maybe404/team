# team-mcp

团队协作 MCP。任务和文档存在 Plane，经验库存在 Plane 的「经验库」项目（私人经验在本机），所有写入都先过规范闸门：模板缺章节、AI 腔句式、对话助手残留、emoji、加粗过多、没有证据的结论，都会被退回给调用方 Agent 修改后重交。

规范和模板都在这个包里（`src/norms/`），团队成员装一个 MCP 就能拿到同一套规则。

## 工具

| 分类 | 工具 |
|---|---|
| 规范 | `get_writing_guide`、`check_text`、`analyze_tone`；资源 `team://guide/writing`、`team://templates/<type>`、`team://skills/less-ai-tone`；提示词 `team-write`、`less-ai-tone` |
| 项目 | `list_projects`、`setup_project` |
| 任务 | `list_tasks`、`search_tasks`、`get_task`、`create_task`、`update_task`、`comment_task` |
| 文档 | `list_docs`、`read_doc`、`write_doc` |
| 经验 | `search_lessons`、`propose_lesson` |
| 回顾 | `review_digest`（`publish: true` 写成当天的文档） |

## 去 AI 味

句式规则来自 [lieflat-less-ai-tone](https://github.com/larashero3-dotcom/lieflat-less-ai-tone)（去 AI 味 v2），原样放在 `skills/less-ai-tone/`，来源和改动见其中的 `NOTICE.md`。

- 写入时逐行检查（`skills/tone_bridge.py` 调用 skill 自带的 `detect.py` 规则）：翻案腔、提示语冒号、起手式直接拒绝；翻译腔、顿号罗列、破折号过密只提示。skill 实测不是 AI 味的写法（「首先/其次」「这意味着」、序数小标题、冒号引出列表等）不检查。
- `analyze_tone` 对整篇（500 汉字以上）跑 `detect.py`，给出完整报告。
- 需要本机有 `python3`（3.9+），找不到时只给警告、不阻止写入；可以用 `TEAM_PYTHON` 指定解释器。

许可：该 skill 是 CC BY-NC 4.0，仅限非商业使用。公司或团队内部用于商业工作需要先向作者取得商业授权。

## 定时回顾

`team-review` 扫出待决定、阻塞、待审查、超时没动的任务和待审核的经验，写成「每日回顾」项目（`REVIEW`）下的文档「回顾 YYYY-MM-DD」，同一天重复执行只更新这一篇。

```bash
npm run review -- --dry-run            # 只打印
npm run review                         # 生成并发布
npm run review -- --daemon --at 09:00  # 常驻，每天 09:00 执行；启动时今天已过点且没发布会先补一次
```

本地开发时 `dev/run.sh` 会以常驻方式启动它（`TEAM_REVIEW_AT` 改时间）。服务器上也可以用 cron 跑单次：`0 9 * * * cd /path/to/mcp && node dist/cli.js`。

## 系统规则

- 任务状态：待办 → 待开始 → 进行中 → 待审查 → 已完成，另有阻塞、待决定、已取消。
- 「已完成」「已取消」只能由人在网页上设置；Agent 做完改成「待审查」，并写一条带证据的「结论」评论。
- 团队经验由 Agent 提交到「待审核」，人在 Plane 上改成「已采纳」后才会被 `search_lessons` 检索到。

## 配置

| 环境变量 | 说明 |
|---|---|
| `PLANE_BASE_URL` | Plane API 地址，本地开发是 `http://localhost:47800` |
| `PLANE_WEB_URL` | Plane 网页地址，用来生成链接，本地开发是 `http://localhost:47300` |
| `PLANE_API_TOKEN` | 个人 API Token（Plane 个人设置里生成） |
| `PLANE_WORKSPACE` | 工作区 slug |
| `TEAM_LESSONS_PROJECT` | 经验库项目标识，默认 `LESSON`，不存在会自动创建 |
| `TEAM_PRIVATE_LESSONS_DIR` | 私人经验目录，默认 `~/.team/lessons` |
| `TEAM_REVIEW_PROJECT` | 回顾项目标识，默认 `REVIEW` |
| `TEAM_REVIEW_AT` | 常驻模式的执行时间，默认 `09:00` |
| `TEAM_REVIEW_STALE_DAYS` | 进行中多少天没动算超时，默认 3 |
| `TEAM_PYTHON` | 语气检查用的 Python 解释器，默认 `python3` |

依赖二开的 Pages 接口（`plane/apps/api/plane/api/views/team_page.py`），官方 Plane 上文档相关工具不可用。

## 开发

```bash
npm install
npm test          # 规范闸门单元测试
npm run e2e       # 对本地 Plane 跑端到端流程（需先 dev/run.sh、dev/seed.sh）
npm run build     # 编译到 dist/
```
