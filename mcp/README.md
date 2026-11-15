# team-mcp

团队协作 MCP。任务和文档存在 Plane，经验库存在 Plane 的「经验库」项目（私人经验在本机），所有写入都先过规范闸门：模板缺章节、AI 腔句式、对话助手残留、emoji、加粗过多、没有证据的结论，都会被退回给调用方 Agent 修改后重交。

规范和模板都在这个包里（`src/norms/`），团队成员装一个 MCP 就能拿到同一套规则。

## 工具

| 分类 | 工具 |
|---|---|
| 规范 | `get_writing_guide`、`check_text`、`analyze_tone`；资源 `team://guide/writing`、`team://templates/<type>`、`team://skills/less-ai-tone`；提示词 `team-write`、`less-ai-tone` |
| 账号与成员 | `whoami`、`bind_repo`、`list_members`、`invite_member`、`add_project_member` |
| 项目 | `list_projects`、`setup_project` |
| 任务 | `list_tasks`、`search_tasks`、`get_task`、`create_task`、`update_task`、`comment_task`（支持指派 `assignees` 和子任务 `parent`） |
| 文档 | `list_docs`、`read_doc`、`write_doc`、`link_doc` |
| 经验 | `search_lessons`、`propose_lesson` |
| 回顾 | `review_digest`（`publish: true` 写成你当天的个人回顾） |

## 去 AI 味

句式规则来自 [lieflat-less-ai-tone](https://github.com/larashero3-dotcom/lieflat-less-ai-tone)（去 AI 味 v2），原样放在 `skills/less-ai-tone/`，来源和改动见其中的 `NOTICE.md`。

- 写入时逐行检查（`skills/tone_bridge.py` 调用 skill 自带的 `detect.py` 规则）：翻案腔、提示语冒号、起手式直接拒绝；翻译腔、顿号罗列、破折号过密只提示。skill 实测不是 AI 味的写法（「首先/其次」「这意味着」、序数小标题、冒号引出列表等）不检查。
- `analyze_tone` 对整篇（500 汉字以上）跑 `detect.py`，给出完整报告。
- 需要本机有 `python3`（3.9+），找不到时只给警告、不阻止写入；可以用 `TEAM_PYTHON` 指定解释器。

许可：该 skill 是 CC BY-NC 4.0，仅限非商业使用。公司或团队内部用于商业工作需要先向作者取得商业授权。

## 定时回顾

`team-review` 扫出待决定、阻塞、待审查、超时没动的任务和待审核的经验，按人列出各自手上的任务，写成「每日回顾」项目（`REVIEW`）下的文档「回顾 YYYY-MM-DD」，同一天重复执行只更新这一篇。用管理员的 Token 跑，才能看到全部项目。成员在 MCP 里 `review_digest publish` 写的是自己的「回顾 YYYY-MM-DD · 名字」，不会覆盖团队那篇。

```bash
npm run review -- --dry-run            # 只打印
npm run review                         # 生成并发布
npm run review -- --daemon --at 09:00  # 常驻，每天 09:00 执行；启动时今天已过点且没发布会先补一次
```

本地开发时 `dev/run.sh` 会以常驻方式启动它（`TEAM_REVIEW_AT` 改时间）。服务器上也可以用 cron 跑单次：`0 9 * * * cd /path/to/mcp && node dist/cli.js`。

## 成员和首次使用

每个人用自己的 Plane 账号和自己的 API Token，Plane 上的操作记在本人名下。

1. 管理员调用 `invite_member` 邀请邮箱（需要工作区所有者的 Token；本地没配邮件服务，链接要自己发给对方）。
2. 对方用这个邮箱在网页注册，在首页接受邀请，然后在「个人设置 → API Tokens」生成 Token，配进自己的 MCP。
3. 管理员调用 `add_project_member` 把他加进项目，会顺带加进经验库（`LESSON`）和每日回顾（`REVIEW`）。
4. 对方调用 `whoami` 确认。

没配 Token 或 Token 失效时，MCP 照常启动，所有工具都返回上面这段配置说明。

## 写入范围和隐私

- 只有绑定了团队项目的仓库里才能写。仓库根目录的 `.team.json` 声明这个仓库属于哪些项目：`{"workspace": "team", "projects": ["ORDER"]}`（`"*"` 表示工作区所有项目），建议提交到仓库。没绑定时所有写入工具都拒绝，只能读。Agent 不能自行调用 `bind_repo`，要先问用户。
- 没有工作目录的客户端（桌面聊天等）用环境变量 `TEAM_ALLOWED_PROJECTS=ORDER,PAY` 显式放行。
- 写入内容会查密钥（API Key、Token、私钥、明文密码）、个人信息（手机号、身份证号）、指向本机的图片和文件，命中就拒绝；本机绝对路径和疑似银行卡号只提示。
- 私人经验 `scope=private` 只存本机（`~/.team/lessons`），团队经验也要求仓库已绑定。

## 系统规则

- 任务状态：待办 → 待开始 → 进行中 → 待审查 → 已完成，另有阻塞、待决定、已取消。
- 「已完成」「已取消」只能由人在网页上设置；Agent 做完用 `update_task` 改成「待审查」，同时在 `comment` 里写带证据的结论（改成「阻塞」「待决定」时同样必须写说明）。
- 没有删除工具。Plane 上只有工作区管理员能删除，其他人只能归档；已完成、已取消的任务 1 个月后自动归档。
- 交付文档用 `write_doc` 的 `task` 参数或 `link_doc` 关联到任务，任务页的链接区能看到。
- 评论署名自动填为「角色 · 账号 的 客户端」，Agent 只能传角色。
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
npm run sim       # 用真实模型当 Agent 跑三个场景（需 SIM_BASE_URL、SIM_MODEL、SIM_API_KEY，任何 OpenAI 兼容接口）
```
