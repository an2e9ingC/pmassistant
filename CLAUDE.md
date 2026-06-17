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

### 项目文档索引

| 文档 | 路径 | 说明 |
|------|------|------|
| 开发指南 | `CLAUDE.md` | 本文档，AI/开发者必读 |
| 数据库文档 | `doc/db.md` | 完整 schema、表关系、权限体系、数据保护方案 |
| 开发计划 | `docs/dev-plan.md` | 版本历史与开发路线 |
| UI 设计规范 | `docs/design-spec.md` | 加载状态、通知、徽章、主题规则 |
| 部署运维 | `docs/deploy-guide.md` | 部署与运维参考 |

---

## 2. 并行开发约定（重要）

### 2.1 核心理念：每个 Worktree = 一个"独立开发者"

一个 git 工作目录同一时间只能持有一个分支。在团队中，多个开发者各自在自己的机器上开发不同分支，互不干扰。

但当一个人需要同时开发/调试多个功能时（比如 feature A 正在调试，又需要紧急修复 bug B），单个目录就产生了冲突：

- 切换分支会丢弃未提交的修改
- 无法同时运行两个分支的服务（数据库 schema 可能不同）
- 开发上下文被破坏（打开的编辑器、运行中的服务）

Git worktree 正是为解决此问题设计的：为同一个仓库创建多个独立工作目录，每个目录对应一个不同分支。

本项目将此机制约定为"并行开发约定"：

**每个 worktree session = 一个"独立开发者"**，拥有自己的：
- Git 分支（`feat/xxx` 或 `fix/xxx`）
- 工作目录（`.claude/worktrees/` 下独立文件夹）
- 服务端口（8001、8002...）
- 数据库文件（`data/pma-$PORT.db`）
- 日志文件（`data/pma-$PORT.log`、`data/server-$PORT.log`）
- PID 文件（`.pma-server-$PORT.pid`）

所有 worktree 共享同一个 `.git` 仓库，但各自的开发环境完全隔离。

### 2.2 触发方式：`worktree:` 前缀

`worktree:` 前缀是进入并行开发模式的触发器。前缀只是意图标识，本质是"我要开始一个独立的开发任务"。

- 用户 prompt 以 `worktree:` 开头 → AI 创建独立 worktree
- 其他 prompt → AI 在当前分支直接操作

示例：
- `worktree: 优化项目详情，增加添加标签功能`
- `worktree: 修复登录超时问题 #15`
- `帮我把 Dashboard 的标题改大一点` ← 普通 prompt，当前分支直接修改

### 2.3 创建新的开发 Session

AI 收到 `worktree:` 开头的 prompt 时：

1. 从 prompt 提取简短描述，生成分支名：
   - 新功能：`feat/<short-desc>`（如 `feat/add-tag`）
   - Bug 修复：`fix/<short-desc>`（如 `fix/login-timeout`）
   - 英文小写 + 连字符，不超过 50 字符

2. `EnterWorktree(name: "feat/<short-desc>" 或 "fix/<short-desc>")` 创建隔离工作区
   - **worktree 分支必须从 `origin/trunk` 最新提交创建**，不可从其他 feature 分支创建
   - 创建后验证：`git merge-base <new-branch> origin/trunk` 应等于 `origin/trunk` 最新 commit

3. 准备开发环境（见 2.4）

4. 在 worktree 中开发、测试、提交

5. 完成后说"功能已验证通过，等待 merge 指令"

**注意**：同一 session 内不应创建第二个 worktree（避免 session 管理混乱）。

### 2.4 资源隔离：端口、数据库、日志

不同 session 通过 `-p` 参数使用不同端口，运行时数据完全隔离：

```
主 session (trunk):  ./server.sh -p 8000 restart
Worktree A:         ./server.sh -p 8001 restart
Worktree B:         ./server.sh -p 8002 restart
```

端口隔离的数据文件：

| 文件 | 说明 |
|------|------|
| `data/pma-$PORT.db` | SQLite 数据库 |
| `data/pma-$PORT.log` | 应用日志 |
| `data/server-$PORT.log` | uvicorn 服务器日志 |
| `.pma-server-$PORT.pid` | 进程 PID 文件 |

端口优先级：`-p` 参数 > `PMA_PORT` 环境变量 > 默认 8000

**多实例管理命令**（`server.sh` 支持）：

- `./server.sh status` — 查看所有运行实例概览（端口/PID/运行时间/内存/健康/分支）
- `./server.sh stop` — 停止所有实例（含孤儿进程）
- `./server.sh -p <PORT> status` — 查看单个实例详情
- `./server.sh -p <PORT> stop` — 停止指定端口

**首次启动**：新 worktree 的 `data/` 为空（在 `.gitignore` 中），数据库无用户数据无法登录。从主 session 拷贝：

```bash
cp data/pma.db data/pma-$PORT.db
```

### 2.5 日常开发流程

在 worktree 中的开发与主 session 规则完全相同：

- 后端 `.py` 修改后 → `./server.sh -p <PORT> restart`（见 Section 5）
- 前端修改 → 刷新浏览器即可
- Commit 规范 → 遵循 Section 3
- 版本号管理 → 遵循 Section 4
- 禁止修改其他 worktree 的 `data/` 文件

### 2.6 合并流程（用户说 "merge"/"合并" 时执行）

**重要：合并必须从主 session（trunk 分支所在目录）执行。** git worktree 绑定到自己的分支，无法在 worktree 内 `git checkout trunk`。

**阶段一：准备（在 worktree 中执行）**

```
1. git fetch origin
2. git rebase origin/trunk          # 变基 + 有冲突则解决
3. git diff origin/trunk...HEAD     # Code Review（必须）
```

**阶段二：合并（返回主 session 执行）**

```
4. ExitWorktree(action: "keep")     # 保留 worktree，返回主 session
5. git merge --no-ff <feature-branch>
6. 报告 merge 完成，等待 push 指令
```

**阶段三：推送与清理（用户确认后）**

```
7. 用户发出 "push"/"推送" → git push origin trunk
8. 用户确认清理 → ExitWorktree(action: "remove")
```

**安全原则：**
- **用户不主动说 merge，绝不自作主张合并**
- **Merge 后不自动 push**。Push 需要用户单独发出指令
- Push 前不做任何清理（保留回滚能力）

Code Review 检查点：
- 逻辑正确性、边界条件
- 兼容性（API、schema、路由）
- 代码风格（CSS var 变量、TODO 格式）
- 调试残留（console.log、print）
- 依赖完整、DB 迁移

### 2.7 清理

**正常清理**（merge + push 成功后）：

用户确认后 `ExitWorktree(action: "remove")`，自动删除 worktree 目录 + 本地分支。

**异常清理**（worktree 被废弃、不再需要合并）：

```bash
# 1. 列出所有 worktree
git worktree list

# 2. 删除指定 worktree（未合并需加 --force）
git worktree remove .claude/worktrees/<name>

# 3. 删除本地分支
git branch -D <branch-name>

# 4. 停止对应端口的服务
./server.sh -p <PORT> stop

# 5. 清理运行时文件（可选）
rm data/pma-$PORT.db data/pma-$PORT.log data/server-$PORT.log .pma-server-$PORT.pid
```

建议定期执行 `git worktree list` 检查是否有遗忘的 worktree。

### 2.8 边界情况与注意事项

| 场景 | 处理方式 |
|------|---------|
| 两个 worktree 修改了同一文件 | 开发期各自独立不冲突；rebase/merge 时按 git 冲突流程解决 |
| 开发期间 trunk 有新提交 | 合并前的 rebase 步骤自动处理 |
| 端口被占用 | `./server.sh status` 检查 → `./server.sh stop` 释放或换下一个端口 |
| Worktree 创建失败 | 检查分支名是否已存在（`git branch -a`）、目录是否已存在 |
| Worktree 目录被手动删除 | `git worktree prune` 清理失效记录 + `git branch -D <branch>` |
| 忘记拷贝数据库 | 停止服务 → 从主 session 拷贝 `data/pma.db` → 重启 |
| 资源限制 | 每个 worktree 消耗 1 个端口 + ~100MB 内存，建议同时活跃 ≤3 个 |

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
- **每次 commit 必须包含数据库文件**：`git add data/pma-$PORT.db`（当前运行端口对应的 db 文件）。数据库是项目数据的一部分，需随代码一起版本管理
- **数据层变更必须同步更新 `doc/db.md`**：涉及以下任一改动时，commit 前必须更新数据库文档：
  - 新增/修改/删除 ORM 模型（`backend/models/*.py`）
  - 新增/修改/删除 SQLAlchemy 表、列、约束、索引、关系
  - `database.py` 中的 schema 迁移逻辑（`_migrate_*` 函数）
  - 角色定义或权限配置变更（`init_db()` 种子数据）
  - 新增 `pma_settings` 配置项
  - 更新内容至少包括：第 2 章（表一览）、第 5 章（对应表的详细定义）、第 6 章（外键，如有变化）、第 7 章（唯一约束，如有变化）

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

- 主 session 用 `-p 8000`，worktree session 用各自的端口
- 纯前端修改无需重启（用户刷新即可）
- `server.sh` 命令：`{start|stop|restart|status|logs|tail}`
- 不加 `-p` 时：`status` 查看所有实例、`stop` 停止所有实例

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

## 8. 模块化 UI 组件规范

### 8.1 核心理念

**重复的内联样式和 HTML 字符串拼接必须收敛到 CSS class + JS 工厂函数。** 修改一个工厂函数，所有使用该模式的组件自动适配。

### 8.2 CSS Class（`frontend/css/tokens.css`）

在 tokens.css 中定义标准尺寸 class，**禁止**在 JS 或 HTML 中用内联 style 覆盖：

| Class | 用途 | 替代的内联样式 |
|-------|------|-------------|
| `.btn-sm` | section-hd 操作按钮 | `style="font-size:11px;padding:3px 10px"` |
| `.btn-xs` | 表格行内按钮 | `style="font-size:10px;padding:2px 6px"` |
| `.btn-icon` | 纯图标按钮 | `style="font-size:13px;padding:2px 6px"`（自动间距 4px，末位 0） |
| `.card-pad` | 标准 padding 卡片 | `style="padding:16px"` |
| `.card-clip` | 溢出裁剪卡片 | `style="padding:0;overflow:hidden"` |

全局已设置 `*, *::before, *::after { box-sizing: border-box; }`，无需在每个元素上单独写。

### 8.3 JS 工厂函数（`frontend/js/components.js`）

**新增 UI 模式前，先检查是否有现成工厂函数可用。** 如需新工厂函数，先在 components.js 定义，再调用。

| 函数 | 签名 | 用途 |
|------|------|------|
| `sectionHeader(title, count, btnLabel, onclick)` | 渲染 section-hd 标题行 | 区块标题 + 计数 + 按钮 |
| `iconBtn(icon, title, onclick, danger)` | 渲染图标按钮 | 表格操作列 |
| `linkChip(name, onclick, title, bgColor, fgColor)` | 渲染可点击关联 chip | 关联产品/项目/客户 |
| `chipTag(name, colorClass, onclick, removable, removeOnclick)` | 渲染标签 chip | 标签 badge |
| `openDialog(title, bodyHtml, buttons, opts)` | 渲染对话框 | 所有弹窗 |
| `multiSelectDialog(title, items, selectedIds, opts, onSave)` | 多选搜索对话框 | 关联产品/客户/项目等 checkbox 多选 |
| `renderPill(status)` | 渲染状态圆点 | 项目/产品状态 |
| `renderTypeBadge(type)` | 渲染类型 badge | 研发/生产项目 |
| `renderProgressBar(percent, status)` | 渲染进度条 | 项目进度 |

### 8.4 开发检查点

每次开发涉及 UI 组件时，检查：
1. 按钮是否使用了 `.btn-sm` / `.btn-xs` / `.btn-icon` 而非内联 style？
2. section-hd 标题行是否使用了 `sectionHeader()` 而非手动拼接？
3. 关联 chip 是否使用了 `linkChip()` 而非 `<span style="...">` 内联？
4. 变化的只是颜色时，是否可以用 factory 参数区分而非创建新分支？

---

## 9. Bug 分析流程（原 §8）

1. 先查系统日志：`tail -50 data/pma-$PORT.log`
2. 有堆栈 → 分析修复
3. 日志不足 → 先加日志（`logger.exception` / `logger.error`）→ 复现 → 修复
4. 外部 API 调用记录：URL + 状态码 + 响应预览（出错时）
5. 不在日志中记录密码/Token

---

## 10. 工作流速查

| 用户指令 | AI 执行 |
|---------|--------|
| `worktree: <描述>` | EnterWorktree → 开发 → 等 merge |
| "commit" / "提交" | 更新版本号 → commit |
| "merge" / "合并" | rebase+review(worktree) → 回主session → merge --no-ff → 等push |
| `./server.sh status` | 查看所有运行实例概览 |
| `./server.sh stop` | 停止所有实例 |
| 后端 .py 修改 | 自动 `./server.sh -p <PORT> restart` |
