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

## 提交流程（严格按顺序执行）

### 1. 更新版本信息（commit 前完成，确保一并提交）

1. **更新 `frontend/index.html` + `frontend/login.html`** 的 `<meta name="app-version">`（如本轮尚未更新）
2. **更新 `docs/dev-plan.md`**：
   - 页头版本号同步为 `#app-version` 当前值
   - 变更记录表**插入新条目到表头下方第一条**（最新在最前面，按日期+版本倒序）：

   ```bash
   # 更新页头版本号 + 最后更新日期（显式指定 TZ=Asia/Shanghai 确保北京时间）
   sed -i 's/当前版本：v[^ ]*/当前版本：v新版本号/' docs/dev-plan.md
   sed -i 's/最后更新：[0-9-]*/最后更新：'$(TZ=Asia/Shanghai date +%Y-%m-%d)'/' docs/dev-plan.md

   # 在变更记录表头分隔行之后插入新条目（确保最新记录在第一位）
   LINE=$(awk '/^## 变更记录/{found=1} found && /^\|------\|------\|------\|$/{print NR; exit}' docs/dev-plan.md)
   sed -i "${LINE}a | $(TZ=Asia/Shanghai date +%Y-%m-%d) | v新版本号 | type: 简短描述 |" docs/dev-plan.md
   ```
3. **数据层变更**同步更新 `docs/db.md`

### 2. Code Review

1. `Skill("code-review")` 对本次修改进行 review
2. 修复发现的问题，确认无遗留后进入下一步

### 3. 停服 → Commit → 重启

1. `./server.sh -p <PORT> stop`
2. `git add ...`（**只添加本次会话修改的文件**，不含会话前工作区已有改动；**必须包含步骤 1 中更新的版本信息文件**：`frontend/index.html`、`frontend/login.html`、`docs/dev-plan.md`；add 后 `git diff --cached --stat` 确认暂存范围无误）
3. `git commit -m "..."`（AI 生成 commit 必须加 `Co-Authored-By:`）
4. `./server.sh -p <PORT> restart`
5. `index_repository(repo_path="/home/xuchuan/workspace/pma", mode="moderate")`

## 重要规则

- **fix 类型 commit 必须在 body 首行简述根因**：`根因: <一句话描述bug根源>`
- **feat/fix 必须有 body**（bullet 变更点）
- **一个 commit 只含本次会话的相关改动**（不包含会话前工作区已有的未暂存修改）
- **数据库文件不再纳入版本控制**（`data/pma-*.db` 已加入 `.gitignore`），`init_db()` 自动建表
