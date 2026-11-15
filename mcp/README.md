# team-mcp

团队协作 MCP。任务和文档存在 Plane，经验库存在 Plane 的「经验库」项目（私人经验在本机），所有写入都先过规范闸门：模板缺章节、AI 腔句式、对话助手残留、emoji、加粗过多、没有证据的结论，都会被退回给调用方 Agent 修改后重交。

规范和模板都在这个包里（`src/norms/`），团队成员装一个 MCP 就能拿到同一套规则。

## 工具

| 分类 | 工具 |
|---|---|
| 规范 | `get_writing_guide`、`check_text`、`analyze_tone`；资源 `team://guide/writing`、`team://templates/<type>`、`team://skills/less-ai-tone`；提示词 `team-write`、`less-ai-tone` |
| 账号与项目 | `whoami`、`list_projects`、`list_members` |
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

## 安装

每个人用自己的 Plane 账号和自己的 API Token，Plane 上的操作记在本人名下。

团队 MCP 是服务器上长期运行的 HTTP 服务（`src/http.ts`，部署里的 `team-mcp` 容器），Caddy 把 `<地址>/mcp/*` 转给它。成员本机不用装任何东西。在网页「个人设置 → API Tokens」新建 Token 后，弹窗里有填好的命令：

```bash
claude mcp add --transport http team http://<地址>/mcp/<工作区> --header "Authorization: Bearer <Token>"
```

其他客户端添加一个 HTTP 类型的 MCP 服务：网址 `http://<地址>/mcp/<工作区>`，请求头 `Authorization: Bearer <Token>`。

服务是无状态的：每个请求用请求头里的 Token 转发给 Plane，Token 不落盘，权限由 Plane 判断。Token 失效时，所有工具都返回配置说明。

`src/index.ts` 是同一套工具的本机 stdio 入口，开发和测试用（`.mcp.json`、`npm run e2e`）。

没配置或 Token 失效时，MCP 照常启动，所有工具都返回配置说明。

## 仓库绑定和隐私

- 项目管理员在 Plane「项目设置 → 关联代码仓库」登记仓库地址（https、git@ 写法都行，会统一成 `github.com/org/repo`）。Agent 每次调用工具都带上 `repo` 参数（`git remote get-url origin` 的输出，指令里已写明），和项目登记的地址对上才能读写这个项目；这是防止误写的闸门，不是安全边界，权限始终以 Plane 里的项目成员为准。一个仓库可以关联多个项目，此时调用要带 `project`。
- 没对上的目录（个人项目、私人文件夹、不是 git 仓库的地方）里只能用 `whoami`、`get_writing_guide`、`check_text`、`analyze_tone`（直接传正文时），读写 Plane 的工具都拒绝。这样个人内容写不进来，团队数据也不会在别的仓库里被读出去。
- 登记只能由人在网页上做：Agent 的 API Token 不能改项目设置、不能管理成员、不能删除任何东西（服务端拦截，管理员的 Token 也一样）。
- 经验库（`LESSON`）和每日回顾（`REVIEW`）是全员共享项目，工作区的管理员和成员会被自动加入。在任一团队仓库里都能检索经验、提交经验。
- 写入内容会查密钥（API Key、Token、私钥、明文密码）、个人信息（手机号、身份证号）、指向本机的图片和文件，命中就拒绝；本机绝对路径和疑似银行卡号只提示。
- 私人经验 `scope=private` 只在本机 stdio 入口可用（存 `~/.team/lessons`）；远程服务没有“本机”，会拒绝。

## 系统规则

- 任务状态：待办 → 待开始 → 进行中 → 待审查 → 已完成，另有阻塞、待决定、已取消。
- 「已完成」「已取消」只能由人在网页上设置；Agent 做完用 `update_task` 改成「待审查」，同时在 `comment` 里写带证据的结论（改成「阻塞」「待决定」时同样必须写说明）。
- 没有删除、成员管理和项目设置类工具。Plane 网页上只有工作区管理员能删除，其他人只能归档；已完成、已取消的任务 1 个月后自动归档。
- 交付文档用 `write_doc` 的 `task` 参数或 `link_doc` 关联到任务，任务页的链接区能看到。
- 评论署名自动填为「角色 · 账号 的 客户端」，Agent 只能传角色。
- 团队经验由 Agent 提交到「待审核」，人在 Plane 上改成「已采纳」后才会被 `search_lessons` 检索到。

## 配置

下面是 stdio 入口的配置，环境变量优先于配置文件。HTTP 服务只用 `PORT`、`PLANE_BASE_URL`（服务器访问 Plane API 的内部地址）、`PLANE_WEB_URL`（生成链接用的对外地址）；Token 和工作区来自请求。

| 环境变量 | 说明 |
|---|---|
| `PLANE_URL` | Plane 地址（网页和 API 同一个），例如 `http://localhost:47080` |
| `PLANE_BASE_URL` | 单独指定 API 地址，源码开发时是 `http://localhost:47800` |
| `PLANE_WEB_URL` | Plane 网页地址，用来生成链接，默认同上；源码开发时是 `http://localhost:47300` |
| `PLANE_API_TOKEN` | 个人 API Token，默认取配置文件 |
| `PLANE_WORKSPACE` | 工作区 slug，默认取配置文件 |
| `TEAM_MCP_CONFIG` | 可选的配置文件（`{"url","workspace","token"}`），默认 `~/.config/team-mcp/config.json`，环境变量优先 |
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
