# PMA (Project Management Assistant) — AI 开发指南

> 本文档供所有 AI 编码工具（Claude Code、Codex、Cursor 等）在使用本仓库时自动加载。

---

## 1. 项目概述

### 架构

PMA 是一个**只读聚合仪表盘**，从外部系统拉取数据并展示，绝不回写。

```
Zentao API (REST) ──┐
GitLab API ──────────┼── 同步 ──► SQLite (缓存) ──► FastAPI API ──► Vanilla JS 前端
NAS 文件 ───────────┘
```

- 只读访问所有数据源（绝不写入 Zentao/GitLab/NAS）
- 本地 SQLite 缓存，支持 50 并发用户
- 数据同步为全量刷新
- 单 Docker 容器，同时提供 API 和静态文件
- 本地 JWT 认证（未集成 Zentao SSO）

### 技术栈

| 层 | 技术 |
|----|------|
| 后端 | Python FastAPI + SQLAlchemy ORM + SQLite |
| 前端 | Vanilla HTML/CSS/JS（无框架） |
| 部署 | Docker Compose |
| 认证 | 本地 JWT |

**禁止引入 React/Vue/Node.js/PostgreSQL**，除非用户明确要求。

### Phase 1 范围

- Dashboard、Project List、Project Detail（甘特图、阶段详情、文档齐套）
- 本地 JWT 认证
- 暂不包含：产品-项目映射图、交付文档管理、统计报告、外包进度

---

## 2. 多 Session 并行开发（重要）

### 核心原则

**`worktree:` 前缀触发隔离开发：一个 worktree = 一个分支 = 一个需求**

用户输入以 `worktree:` 开头时，AI 创建独立 worktree；普通 prompt 直接在当前分支操作。

### 启动新功能

用户打开新 Claude Code 窗口，输入以 `worktree:` 开头的提示词即可触发隔离开发工作流。AI 应：

1. `EnterWorktree(name: "feat/<short-desc>" 或 "fix/<short-desc>")` 创建隔离工作区
2. 在 worktree 中开发、测试、提交
3. 完成后说"功能已验证通过，等待 merge 指令"

示例：
- `worktree: 优化项目详情，增加添加标签功能`
- `worktree: 修复登录超时问题 #15`

**只有以 `worktree:` 开头才进入 worktree 流程**，普通 prompt 直接在当前分支操作。

### 端口分配

不同 session 通过 `-p` 参数使用不同端口，运行时数据完全隔离：

```
主 session (trunk):  ./server.sh -p 8800 restart
Worktree A:         ./server.sh -p 8801 restart
Worktree B:         ./server.sh -p 8802 restart
```

端口隔离的数据：`data/pma-$PORT.db`、`data/pma-$PORT.log`、`data/server-$PORT.log`、`.pma-server-$PORT.pid`

优先级：`-p` 参数 > `PMA_PORT` 环境变量 > 默认 8800

### 首次启动

新 worktree 的 `data/` 为空（在 `.gitignore` 中），数据库无用户数据无法登录。从主 session 拷贝：

```bash
cp data/pma.db data/pma-$PORT.db
```

### Merge 流程（用户说 "merge"/"合并" 时执行）

```
1. git fetch origin
2. git rebase origin/trunk          # 变基 + 有冲突则解决
3. git diff origin/trunk...HEAD     # Code Review（必须）
4. git checkout trunk && git merge --no-ff <feature-branch>
5. 报告 merge 完成，等待 push 指令
6. 清理 worktree（用户确认后 ExitWorktree）
```

**用户不主动说 merge，绝不自作主张合并。**
**Merge 后不自动 push。** Push 需要用户单独发出 "push"/"推送" 指令，或用户自行 push。

Code Review 检查点：
- 逻辑正确性、边界条件
- 兼容性（API、schema、路由）
- 代码风格（CSS var 变量、TODO 格式）
- 调试残留（console.log、print）
- 依赖完整、DB 迁移

---

## 3. Git Commit 规范

### 格式

```
<type>(<scope>): <中文subject ≤50字>

- 变更点 1
- 变更点 2

Closes #X          （修复 issue 时必须）
Co-Authored-By: <model-name> / <tool-name>
```

### type（必填）

`feat` / `fix` / `docs` / `style` / `refactor` / `test` / `chore` / `perf` / `ci`

### scope（必填，选择主模块）

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

新增 scope 时先在本文档更新上表。

### 其他规则

- **feat/fix 必须有 body**（bullet 变更点）
- **一个 commit 只含相关改动**，不相关的拆分为独立 commit
- 多 scope 时优先按功能拆分，而非按 scope 拆分
- 修复 GitLab issue 时 body 加 `Closes #X`
- **不要每改一行就 commit**，等用户确认后再提交

### Co-Authored-By（AI 生成 commit 必须）

格式：`Co-Authored-By: <实际模型名> / <实际工具名>`

示例：`Co-Authored-By: deepseek-v4-pro / Claude Code`

---

## 4. 版本管理

### 版本号格式

`vYYYY.MM.DD-betaN`（开发） / `vYYYY.MM.DD`（发布）

- 日期部分用**当天实际日期**
- 同一天内 beta 递增（beta1, beta2, ...）
- 跨天重置 beta 为 1

### Commit 前必须更新

1. `docs/dev-plan.md`：版本历史表追加新条目 + 页头版本号
2. `frontend/index.html`：`#app-version` 改为相同版本号

**先更新版本，再 commit，不可事后补。**

---

## 5. 后端修改后自动重启

修改 `backend/**/*.py` 后必须重启服务器：

```bash
./server.sh -p <PORT> restart
```

- 主 session 用 `-p 8800`，worktree session 用各自的端口
- 纯前端修改无需重启（用户刷新即可）
- `server.sh` 命令：`{start|stop|restart|status|logs|tail}`

---

## 6. 前端规则

### 主题兼容

- **禁止硬编码颜色值**（如 `#15803D`、`#DCFCE7`）
- **必须使用 CSS 变量**（`var(--xxx)`），变量定义在 `frontend/css/tokens.css`
- 新增颜色语义时，需在 `:root`（light）和 `[data-theme="dark"]` 两处添加
- 提交前在亮/暗主题下各验证一遍

### TODO 占位符

未实现功能统一标记：

- 前端：`<span style="font-style:italic;color:var(--muted)">TODO：说明</span>`
- 后端：`# TODO: 说明`

---

## 7. 服务器与环境

| 环境 | 地址 | 用途 |
|------|------|------|
| 生产禅道 | `192.168.0.124:8800` | **只读访问，禁止修改任何内容** |
| 测试禅道 | `192.168.3.22` | 开发测试（API: `/zentao/api.php/v1`） |
| PMA 测试账号 | `PM_Assistant` / `123456` | 只读 role: pm |

- **严禁用生产服务器测试**
- **PM_Assistant 是只读账户**，所有 ZenTao API 调用仅用 GET

---

## 8. Bug 分析流程

1. 先查系统日志：`tail -50 data/pma-$PORT.log`
2. 有堆栈 → 分析修复
3. 日志不足 → 先加日志（`logger.exception` / `logger.error`）→ 复现 → 修复
4. 外部 API 调用记录：URL + 状态码 + 响应预览（出错时）
5. 不在日志中记录密码/Token

---

## 9. 工作流速查

| 用户指令 | AI 执行 |
|---------|--------|
| `worktree: <描述>` | EnterWorktree → 开发 → 等 merge |
| "commit" / "提交" | 更新版本号 → commit |
| "merge" / "合并" | rebase → code review → merge → push |
| 后端 .py 修改 | 自动 `./server.sh -p <PORT> restart` |
