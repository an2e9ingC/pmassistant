---
name: pma-commit
description: PMA Git 提交规范 — type(scope): subject 格式、scope 表格、Co-Authored-By、提交前停服务
user-invocable: true
allowed-tools: Read, Write, Edit, Bash
---

# PMA Git 提交规范

## 格式

```
<type>(<scope>): <中文subject ≤50字>

- 变更点 1
- 变更点 2

Closes #X          （修复 issue 时必须）
Co-Authored-By: <model-name> / <tool-name>
```

## type（必填）

`feat` / `fix` / `docs` / `style` / `refactor` / `test` / `chore` / `perf` / `ci`

## scope（必填，选择主模块）

| Scope | 模块 | 文件范围 |
|-------|------|---------|
| `sync` | 数据同步 | `sync_service.py`, `zentao_client.py` |
| `api` | API 路由 | `routers/*.py`, `services/*_service.py` |
| `db` | 数据库 | `models/*.py`, `database.py` |
| `auth` | 认证 | `middleware/auth.py`, `auth_service.py`, `routers/auth.py` |
| `ui` | 前端 UI | `frontend/**` |
| `log` | 日志 | `log_entry.py`, `log_handler.py`, `routers/logs.py` |
| `deploy` | 部署配置 | `Dockerfile`, `docker-compose.yml`, `config.py`, `.env`, `server.sh` |
| `docs` | 文档 | `docs/*.md` |

## 重要规则

- **fix 类型 commit 必须在 body 首行简述根因**：`根因: <一句话描述bug根源>`
- **feat/fix 必须有 body**（bullet 变更点）
- **一个 commit 只含相关改动**
- **每次 commit 必须包含数据库文件**：`git add data/pma-$PORT.db`
- **提交前必须先停止服务**：
  1. `./server.sh -p <PORT> stop`
  2. `git add ... && git commit -m "..."`
  3. `./server.sh -p <PORT> restart`
- **数据层变更必须同步更新 `docs/db.md`**
- **AI 生成 commit 必须加 `Co-Authored-By:`**
- **commit 重启后必须更新 codebase-memory 索引**：
  1. `./server.sh -p <PORT> restart`（见上）
  2. `index_repository(repo_path="/home/xuchuan/workspace/pma", mode="moderate")`
