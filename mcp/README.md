# team-mcp

团队协作 MCP。任务和文档存在 Plane，经验库存在 Plane 的「经验库」项目（私人经验在本机），所有写入都先过规范闸门：模板缺章节、套话、emoji、加粗过多、没有证据的结论，都会被退回给调用方 Agent 修改后重交。

规范和模板都在这个包里（`src/norms/`），团队成员装一个 MCP 就能拿到同一套规则。

## 工具

| 分类 | 工具 |
|---|---|
| 规范 | `get_writing_guide`、`check_text`；资源 `team://guide/writing`、`team://templates/<type>`；提示词 `team-write` |
| 项目 | `list_projects`、`setup_project` |
| 任务 | `list_tasks`、`search_tasks`、`get_task`、`create_task`、`update_task`、`comment_task` |
| 文档 | `list_docs`、`read_doc`、`write_doc` |
| 经验 | `search_lessons`、`propose_lesson` |
| 回顾 | `review_digest` |

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

依赖二开的 Pages 接口（`plane/apps/api/plane/api/views/team_page.py`），官方 Plane 上文档相关工具不可用。

## 开发

```bash
npm install
npm test          # 规范闸门单元测试
npm run e2e       # 对本地 Plane 跑端到端流程（需先 dev/run.sh、dev/seed.sh）
npm run build     # 编译到 dist/
```
