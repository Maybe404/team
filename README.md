# team

团队一体化协作平台：任务、文档、经验库和定时回顾，人和 Agent 围绕同一个任务协作。

| 目录 | 内容 |
|---|---|
| `plane/` | Plane 源码（git subtree，基于上游 `preview`），二开改动都标了 `[team 二开]` |
| `mcp/` | team-mcp：Plane 对接、规范闸门、经验库、回顾 |
| `dev/` | 本地开发：基础设施、源码启动脚本、种子数据 |
| `deploy/` | 部署配置 |

## 本地开发

基础设施（Postgres、Redis、RabbitMQ、MinIO）用 Docker 跑，Plane 应用从源码启动。端口统一用 47xxx 段，见 `dev/ports.env`。

```bash
dev/setup-env.sh   # 生成各应用 .env（首次）
dev/run.sh         # 启动全部服务（含定时回顾），日志在 dev/logs/
dev/seed.sh        # 建测试管理员、工作区和 API Token，写进 dev/.secrets
```

网页 http://localhost:47300 ，API http://localhost:47800/api/v1/ 。

首次还需要安装依赖：`plane/apps/api` 下 `uv sync`，`plane/` 下 `pnpm install` 后执行 `pnpm turbo run build --filter="./packages/*"`。

## 二开清单

- Pages 公开 API：`plane/apps/api/plane/api/views/team_page.py`、`urls/team_page.py`
- 增量写入协同文档：`plane/apps/live/src/controllers/team-page.controller.ts`、`plane/packages/editor/src/helpers/document-codecs.ts`
- 去掉付费升级弹窗和外链：升级徽章与弹窗、Billing 设置、侧边栏 Community 徽章、顶栏 GitHub Star、帮助菜单里的文档/论坛/联系销售、命令面板的文档/论坛/报 bug、设置页和登录页的官网链接。改动文件可以用 `grep -rl "team 二开" plane/apps/web plane/packages/constants` 找到。

同步上游：`git subtree pull --prefix=plane <上游地址> preview --squash`
