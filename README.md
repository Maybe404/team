# Loom

团队一体化协作平台：任务、文档、经验库和定时回顾，人和 Agent 围绕同一个任务协作。

| 目录 | 内容 |
|---|---|
| `plane/` | Loom 的应用源码（基于开源项目 Plane 二次开发，git subtree，上游 `preview`），二开改动都标了 `[team 二开]` |
| `mcp/` | team-mcp：对接 Loom、规范闸门、经验库、回顾 |
| `dev/` | 本地开发：基础设施、源码启动脚本、种子数据 |
| `deploy/` | 部署配置 |

## 部署清单

用二开过的源码构建镜像，`docker compose` 常驻，容器随 Docker 自动重启，数据在 Docker volume 里。常用命令都走 `deploy/team.sh`：`build`、`up`、`down`、`logs <服务>`、`ps`。

### 首次部署

前提：Docker、Node.js 22 以上（构建时编译 MCP 用）、`git`。

- [ ] 克隆仓库，`cp deploy/plane/variables.example.env deploy/plane/.env`
- [ ] 改 `.env` 里的密钥，不要用模板默认值：`SECRET_KEY`、`LIVE_SERVER_SECRET_KEY`、`POSTGRES_PASSWORD`、`RABBITMQ_PASSWORD`、`AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY`（后两个是文件存储 MinIO 的账号，用默认值启动时会有安全警告）
- [ ] 对外访问地址：`APP_DOMAIN` 改成成员实际访问的域名或局域网 IP（带端口的话包含端口）。成员 MCP 命令、公开文档链接、邮件链接都由它生成，本机试用用默认的 `localhost:47080` 即可
- [ ] `ENABLE_SIGNUP=0`（模板默认就是 0）：关闭自助注册，只有被邀请的邮箱能注册
- [ ] AI 模型（可选）：`LLM_PROVIDER`、`LLM_BASE_URL`、`LLM_MODEL`、`LLM_API_KEY`，只在第一次启动时写入；之后在 `/god-mode/ai` 改，只有实例管理员能改，改完立即生效
- [ ] `deploy/team.sh build`（首次 10～20 分钟），再 `deploy/team.sh up`
- [ ] `deploy/team.sh ps` 确认 13 个容器都在运行
- [ ] 打开 `http://<地址>/god-mode/`，建实例管理员账号，回到首页建工作区（slug 用小写英文，例如 `team`，发给成员之前定下来，改了 MCP 命令也要跟着换）
- [ ] 定时回顾（可选）：用管理员建一个 API Token，填到 `.env` 的 `TEAM_REVIEW_WORKSPACE`、`TEAM_REVIEW_TOKEN`，再 `deploy/team.sh up`，每天 `TEAM_REVIEW_AT`（默认 09:00）生成团队回顾
- [ ] 验证：用管理员的 Token 添加 MCP（见使用清单），在任意目录让 Agent 调用 `whoami`，看到账号信息就说明 `/mcp/<工作区>` 通了

对外提供服务时（未在本机验证）：端口用 `LISTEN_HTTP_PORT`/`LISTEN_HTTPS_PORT`；要 HTTPS 就把 `SITE_ADDRESS` 改成域名并填 `CERT_EMAIL`，Caddy 会自动申请证书。Token 在请求头里传，生产环境一定要上 HTTPS，否则是明文。

### 升级（改了代码或同步了上游之后）

- [ ] `git pull`
- [ ] 只构建改动的服务，例如 `deploy/team.sh build web proxy team-mcp`；不确定就 `build` 全部
- [ ] `deploy/team.sh up`，数据库迁移由 `migrator` 容器自动执行
- [ ] 改了 MCP：只重建 `team-mcp`，成员不用动，下一次调用就是新版
- [ ] 改了 `Caddyfile.ce`：要重建 `proxy`

### 备份和恢复

数据在 volume 里：`team_pgdata`（数据库）和 `team_uploads`（上传的文件和图片）。

```bash
# 数据库备份
docker compose -p team exec -T plane-db sh -c 'PGPASSWORD=$POSTGRES_PASSWORD pg_dump -U $POSTGRES_USER $POSTGRES_DB' > team-$(date +%F).sql
```

- [ ] 定期备份数据库，并备份 `team_uploads`（可以用 `docker run --rm -v team_uploads:/d -v $PWD:/b alpine tar czf /b/uploads.tgz -C /d .`，恢复命令未验证）
- [ ] `deploy/team.sh down` 只停容器，不删数据；不要加 `-v`，那会删掉 volume

### 排障

| 现象 | 先看哪里 |
|---|---|
| 页面打不开、返回 429 | 静态资源限流，已放宽到每 IP 每分钟 6000；`deploy/team.sh logs web` 看是否还有 429 |
| 页面 502 | `deploy/team.sh ps` 看哪个容器没起来，再 `logs <服务>` |
| MCP 返回 401 | Token 没带或已失效，到 API Tokens 页重新建 |
| MCP 返回“未关联” | 管理员还没在项目设置里登记这个仓库地址，或 Agent 没带 `repo` 参数 |
| 写评论、改文档报协同服务不可用 | `live` 容器没起来，`logs live` |
| 经验或文档写入被退回 | 看退回信息里的规则，按提示改；规则代码在 `mcp/src/norms/` |

## 使用流程

只有两种角色：

| 角色 | 能做的 |
|---|---|
| 管理员 | 成员能做的全部；邀请成员、建项目、登记关联仓库、把人加进项目；验收任务（改成已完成/已取消）、采纳或驳回经验；删除 |
| 成员 | 在加入的项目里新建任务和文档、评论、提交经验、归档；只能修改自己的内容（见下）。不能删除 |

**谁能改什么**（网页和 Agent 一样，服务端强制）：

| 内容 | 能改的人 | 其他成员 |
|---|---|---|
| 工作项 | 创建人、指派人、管理员 | 只能评论 |
| 页面（文档） | 作者、管理员 | 只能阅读和评论 |
| 关联文档 ↔ 工作项 | 工作项的创建人或指派人、文档作者、管理员 | 不能建立 |

想改别人的内容，在评论里提建议，让对方自己改。任务指派给你之后，你就能改它的状态和内容。

Plane 自带的“访客”角色用不上，邀请时不要选。Agent 用的 API Token 不论谁的，都不能删除、管理成员或改项目设置，这些只能由人在网页上做。

### 管理员

1. 打开 `http://localhost:47080/god-mode`，建实例管理员账号，然后回到首页建工作区（slug 用小写英文，例如 `team`）。
2. 新建项目。项目默认就是团队工作流（待办、待开始、进行中、待审查、阻塞、待决定、已完成、已取消），已完成和已取消的任务 1 个月后自动归档。
3. 项目设置 → 关联代码仓库：填这个项目的仓库地址，一行一个。只有在这些仓库里工作的 Agent 能读写这个项目。
4. 工作区设置 → 成员 → 邀请，填对方邮箱，角色选“成员”或“管理员”。没配邮件服务时不会发信，直接把网页地址告诉对方。
5. 对方接受后，项目设置 → 成员，把他加进项目。经验库和每日回顾不用加，会自动加。
6. 日常：任务到了“待审查”时看结论和证据，改成“已完成”或打回；经验库里“待审核”的经验改成“已采纳”或“已驳回”。
7. 自己也要用 Agent 的话，按下面成员的第 2、3 步装 MCP。

### 成员

1. 打开管理员给的地址，用被邀请的邮箱注册，登录后接受工作区邀请。
2. 头像 → 个人设置 → API Tokens → 新建 Token。弹窗里会显示一条已经填好地址、工作区和 Token 的命令，复制到终端执行一次：

   ```bash
   claude mcp add --transport http team http://<地址>/mcp/<工作区> --header "Authorization: Bearer <Token>"
   ```

   本机什么都不用装，MCP 跑在服务器上。用 Cursor 等其他客户端的，复制弹窗里的 JSON 配置，或在客户端的 MCP 设置里添加一个 HTTP 类型的服务：网址同上，请求头 `Authorization: Bearer <Token>`。
3. 重启 Claude Code，进入团队项目的仓库，让它调用 `whoami`：显示“已关联 某项目”就可以用了；“未关联”说明管理员还没登记这个仓库；“还不是成员”说明还没被加进项目。

MCP 随服务器升级，成员这边不用动。Agent 每次调用工具会带上当前仓库的 git remote 地址，服务器据此判断它在哪个团队项目里。

### 使用清单

管理员第一次把团队跑起来：

- [ ] 工作区建好，项目建好
- [ ] 每个项目的「项目设置 → 关联代码仓库」登记了仓库地址（没登记的仓库里 Agent 读写不了）
- [ ] 邀请成员，邮箱注册后在项目设置 → 成员里加进项目
- [ ] 自己和每个成员都按成员步骤装好 MCP，在仓库里让 Agent 调用 `whoami`，显示“已关联”
- [ ] 提醒成员：Token 等于账号，不要发给别人

日常（管理员）：

- [ ] 任务到“待审查”时看结论和证据，改成“已完成”或打回
- [ ] 经验库里“待审核”的经验，改成“已采纳”或“已驳回”；重复的驳回，不属于具体项目的会标成“通用”
- [ ] 每天看“每日回顾”项目里的团队回顾：等你决定、阻塞、长期没动的任务
- [ ] 人员变动：移出项目，需要时在工作区设置里停用成员；该成员的 Token 随账号失效，建议同时让对方在 API Tokens 页删掉
- [ ] 要给团队外的人看某篇文档：文档右上角“…” → 公开链接，用完关掉

日常（成员和 Agent）：

- [ ] 在团队项目的仓库里用 Agent；Agent 动手前会先查经验库
- [ ] 任务做完让 Agent 改成“待审查”并写带证据的结论，不要自己标“已完成”
- [ ] 有价值的经验让 Agent 提交（要可复用、不明显、有代价、已验证，并写明来源），你同意后才提交
- [ ] 不熟悉怎么用某个功能时，直接问 Agent，它会读使用指南；周期、模块、视图目前要在网页上操作
- [ ] 写入被退回很正常，Agent 会按提示改；改不过就把退回信息发给管理员

### 47080 上的几个入口

| 地址 | 是什么 |
|---|---|
| `/god-mode/` | 实例后台，只有实例管理员能进：首次初始化、登录方式、邮件、AI 模型。左下角的按钮回到工作区 |
| `/<工作区>/` | 日常使用的地方：项目、任务、文档、成员都在这里，例如 `http://localhost:47080/team/` |
| `/settings/profile/api-tokens` | 个人 API Token 和 MCP 安装命令 |
| `/spaces/team-pages/<链接>` | 公开文档，不用登录 |

### 公开文档

文档右上角“…” → 公开链接。只有工作区管理员能打开或关闭；打开后拿到链接的人不用登录就能阅读这一篇（只读，看不到评论和项目里的其他内容），关闭后旧链接立即失效。私有文档、已归档的文档不能公开，Agent 也开不了。

## 本地开发

基础设施（Postgres、Redis、RabbitMQ、MinIO）用 Docker 跑，Loom 应用从源码启动。端口统一用 47xxx 段，见 `dev/ports.env`。

```bash
dev/setup-env.sh   # 生成各应用 .env（首次）
dev/run.sh         # 启动全部服务（含定时回顾），日志在 dev/logs/
dev/seed.sh        # 建测试管理员、工作区和 API Token，写进 dev/.secrets
```

网页 http://localhost:47300 ，API http://localhost:47800/api/v1/ 。仓库根目录的 `.mcp.json` 注册了连开发环境的 `team-dev`（`TEAM_MCP_AS=member` 切成成员账号），和正式安装的 `team` 不冲突。

首次还需要安装依赖：`plane/apps/api` 下 `uv sync`，`plane/` 下 `pnpm install` 后执行 `pnpm turbo run build --filter="./packages/*"`。

## 二开清单

- Pages 公开 API：`plane/apps/api/plane/api/views/team_page.py`、`urls/team_page.py`
- 增量写入协同文档：`plane/apps/live/src/controllers/team-page.controller.ts`、`plane/packages/editor/src/helpers/document-codecs.ts`
- 去掉付费升级弹窗和外链：升级徽章与弹窗、Billing 设置、侧边栏 Community 徽章、顶栏 GitHub Star、帮助菜单里的文档/论坛/联系销售、命令面板的文档/论坛/报 bug、设置页和登录页的官网链接。改动文件可以用 `grep -rl "team 二开" plane/apps/web plane/packages/constants` 找到。

- 删除权限：只有工作区管理员能删除共享内容，其他人只能归档。服务端 `plane/apps/api/plane/utils/team_delete_guard.py`（挂在三套视图基类的 `initial()` 上），网页端 `apps/web/hooks/use-can-delete-content.ts` 隐藏删除入口
- AI 接自建模型：`LLM_PROVIDER=openai-compatible` + `LLM_BASE_URL`，模型名不做白名单；`/god-mode/ai` 可配
- 长期运行镜像：`deploy/plane/docker-compose.team.yml`、`deploy/team.sh`
- 项目关联仓库：`Project.team_repos`（迁移 `0126`），网页 `apps/web/components/project/settings/team-repos.tsx`；建项目默认用团队工作流状态、自动归档 1 个月
- Agent Token 限权：API Token 请求不能 DELETE、不能管理成员和邀请、不能改项目设置（`team_delete_guard.py`）
- 编辑权限（自己的自己改）：`plane/apps/api/plane/utils/team_edit_policy.py`，挂在 `team_delete_guard.enforce_delete_policy` 里；网页端 `apps/web/hooks/use-can-edit-issue.ts`、`store/pages/project-page.ts` 同步隐藏编辑
- 文档里的流程图：语言为 `mermaid` 的代码块，下方实时渲染（`packages/editor/src/extensions/code/code-block-node-view.tsx`，mermaid 按需加载）
- 文档里的 HTML 页面块：`packages/editor/src/extensions/html-embed/`（斜杠命令「HTML 页面」）。内容存在节点属性里，沙箱 iframe（无 same-origin）渲染，可拖拽缩放、整页放大、下载，上限 2MB；API 白名单 `utils/content_validator.py`，公开分享页 `space/views/team_page.py`，MCP 里写成 ```html-embed 围栏（`mcp/src/markdown.ts`，图片也用 `![](asset:…)` 往返，全文改写不会丢）
- 文档 ↔ 工作项关联：`TeamPageIssue`（迁移 `0128`），业务 `utils/team_page_issue.py`，网页接口 `app/views/page/team_page_issue.py`，Agent 接口 `api/views/team_page.py`，界面 `apps/web/components/team/page-issue-links.tsx`（工作项侧栏「关联文档」、文档菜单「关联工作项」）
- 全员共享项目：经验库（审核状态）和每日回顾自动收录工作区管理员和成员，`plane/apps/api/plane/utils/team_shared.py`
- 使用指南 `mcp/src/usage.ts`（工具 get_guide topic=usage、资源 team://guide/usage）：改了工具能力要同步它
- 团队 MCP 是服务器上的 HTTP 服务（`mcp/src/http.ts`，compose 里的 `team-mcp`），Caddy 把 `/mcp/*` 转给它（`Caddyfile.ce`）；API Tokens 页显示添加命令（`apps/web/components/api-token/team-mcp-install.tsx`）
- 文档公开链接：`TeamPageShare`（迁移 `0127`），管理接口 `app/views/page/team_share.py`，公开接口 `space/views/team_page.py`（服务端白名单清洗 HTML），公开页 `apps/space/app/team-pages/`。没有复用 Plane 的 DeployBoard，因为公开接口按 anchor 查它时不分类型，会连带暴露整个项目

同步上游：`git subtree pull --prefix=plane <上游地址> preview --squash`

## 许可与来源

Loom 基于开源项目 [Plane](https://github.com/makeplane/plane)（AGPL-3.0）二次开发，源码文件头里的原作者版权声明保持不变。按 AGPL 的要求，对外提供服务时需要向使用者提供对应版本的源码（本仓库即是）。去 AI 味规则来自第三方 skill「去 AI 味 v2」（CC BY-NC 4.0）。
