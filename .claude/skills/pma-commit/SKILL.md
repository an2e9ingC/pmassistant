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
（model-name 使用当前运行模型的精确 ID，如 deepseek-v4-pro；tool-name 使用当前工具名，如 Claude Code）
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
- **数据库文件不再纳入版本控制**（`data/pma-*.db` 已加入 `.gitignore`），`init_db()` 自动建表
- **提交前必须先停止服务**（避免 git 操作干扰服务进程的文件描述符）：
  1. `./server.sh -p <PORT> stop`
  2. `git add ... && git commit -m "..."`
  3. `./server.sh -p <PORT> restart`
- **数据层变更必须同步更新 `docs/db.md`**
- **每次 commit 必须同步更新 `docs/dev-plan.md`**：页头版本号同步为 `#app-version` 当前值，并在变更记录表追加新条目

  ```bash
  # 追加条目到变更记录表（定位到 "## 变更记录" 后的第二个表头分隔行）
  LINE=$(awk '/^## 变更记录/{found=1} found && /^\|------\|------\|------\|$/{print NR; exit}' docs/dev-plan.md)
  sed -i "${LINE}a | $(date +%Y-%m-%d) | v2026.0X.0X-betaN | type: 简短描述 |" docs/dev-plan.md
  ```
- **AI 生成 commit 必须加 `Co-Authored-By:`**
- **commit 重启后必须更新 codebase-memory 索引**：
  1. `./server.sh -p <PORT> restart`（见上）
  2. `index_repository(repo_path="/home/xuchuan/workspace/pma", mode="moderate")`
