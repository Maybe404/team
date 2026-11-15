# team

团队一体化协作平台：任务、文档、经验库和定时回顾，人和 Agent 围绕同一个任务协作。

| 目录 | 内容 |
|---|---|
| `plane/` | Plane 源码（git subtree，基于上游 `preview`），二开改动都标了 `[team 二开]` |
| `mcp/` | team-mcp：Plane 对接、规范闸门、经验库、回顾 |
| `dev/` | 本地开发：基础设施、源码启动脚本、种子数据 |
| `deploy/` | 部署配置 |

## 长期运行（Docker）

用二开过的源码构建镜像，`docker compose` 常驻，容器随 Docker 自动重启，数据在 volume 里。

```bash
cp deploy/plane/variables.example.env deploy/plane/.env   # 首次，改端口和密钥
deploy/team.sh build   # 构建镜像（首次 10～20 分钟）
deploy/team.sh up      # 启动，网页 http://localhost:47080
```

首次打开 `/god-mode` 建管理员和工作区。定时回顾：在 `.env` 填 `TEAM_REVIEW_WORKSPACE`、`TEAM_REVIEW_TOKEN`（管理员 API Token）后再 `deploy/team.sh up`。AI 模型在 `/god-mode/ai` 配，或在 `.env` 里填 `LLM_*`（首次启动时写入）。

## 使用流程

只有两种角色：

| 角色 | 能做的 |
|---|---|
| 管理员 | 成员能做的全部；邀请成员、建项目、登记关联仓库、把人加进项目；验收任务（改成已完成/已取消）、采纳或驳回经验；删除 |
| 成员 | 在加入的项目里读写任务、文档、评论；提交经验；归档。不能删除 |

Plane 自带的“访客”角色用不上，邀请时不要选。Agent 用的 API Token 不论谁的，都不能删除、管理成员或改项目设置，这些只能由人在网页上做。

### 管理员

1. 打开 `http://localhost:47080/god-mode`，建实例管理员账号，然后回到首页建工作区（slug 用小写英文，例如 `team`）。
2. 新建项目。项目默认就是团队工作流（待办、待开始、进行中、待审查、阻塞、待决定、已完成、已取消），已完成和已取消的任务 1 个月后自动归档。
3. 项目设置 → 关联代码仓库：填这个项目的仓库地址，一行一个。只有在这些仓库里工作的 Agent 能读写这个项目。
4. 工作区设置 → 成员 → 邀请，填对方邮箱，角色选“成员”或“管理员”。没配邮件服务时不会发信，直接把网页地址告诉对方。
5. 对方接受后，项目设置 → 成员，把他加进项目。经验库和每日回顾不用加，会自动加。
6. 日常：任务到了“待审查”时看结论和证据，改成“已完成”或打回；经验库里“待审核”的经验改成“已采纳”或“已驳回”。
7. 自己也要用 Agent 的话，按下面成员的第 2～4 步装 MCP。

### 成员

1. 打开管理员给的地址，用被邀请的邮箱注册，登录后接受工作区邀请。
2. 头像 → 个人设置 → API Tokens，新建一个 Token。
3. 装 MCP：

   ```bash
   git clone https://github.com/Maybe404/team.git ~/team && ~/team/mcp/install.sh
   ```

   按提示填 Plane 地址、工作区 slug 和 Token。装好后重启 Claude Code。
4. 进入团队项目的仓库打开 Claude Code，让它调用 `whoami`：显示“已关联 某项目”就可以用了；显示“未关联”说明管理员还没登记这个仓库，显示“还不是成员”说明还没被加进项目。

## 本地开发

基础设施（Postgres、Redis、RabbitMQ、MinIO）用 Docker 跑，Plane 应用从源码启动。端口统一用 47xxx 段，见 `dev/ports.env`。

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
- 全员共享项目：经验库（审核状态）和每日回顾自动收录工作区管理员和成员，`plane/apps/api/plane/utils/team_shared.py`

同步上游：`git subtree pull --prefix=plane <上游地址> preview --squash`
