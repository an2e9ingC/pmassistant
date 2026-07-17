# PMA (Project Management Assistant) — AI 开发指南

> 本文档供所有 AI 编码工具（Claude Code、Codex、Cursor 等）在使用本仓库时自动加载。
> 详细工作流已拆分为独立 skills，按需触发以降低基础 token 消耗。

---

## 0. Code Discovery Protocol（代码发现协议 — 最高优先级）

> **硬性规则：进行任何代码探索时，必须先输出 MCP 查询结果（search_graph / trace_path），再进入下一步。MCP 返回空或索引未覆盖时才允许 grep/Read。**

### 工具选择决策树

| 你想做什么 | 使用工具 | 说明 |
|-----------|---------|------|
| "这个功能在哪实现的" | `search_graph(query="...")` | BM25 全文搜索，camelCase 分词，结构重要性排序 |
| "这个函数被谁调用 / 调用了谁" | `trace_path(mode="calls")` | 上下游调用链，支持 `direction="both"` |
| "数据从 API 入口到数据库怎么流转" | `trace_path(mode="data_flow")` | 沿 CALLS + DATA_FLOWS 追踪参数/返回值传递 |
| "看这个函数的完整源码" | `get_code_snippet(qualified_name)` | 精确源码，支持 `include_neighbors=true` 获取上下文 |
| "项目怎么分层的 / 有哪些模块" | `get_architecture()` | 包结构、服务依赖、Leiden 社区检测（揭示实际架构边界） |
| "有哪些 API 路由" | `search_graph(label="Route")` | 列出所有路由节点，含 HTTP 方法 + 路径 |
| "搜索某个字符串出现在哪里" | `search_code(pattern="...")` | 图谱增强 grep：按函数去重、按重要性排序 |
| "复杂关联查询" | `query_graph(query="MATCH ...")` | Cypher 图查询，适合聚合分析、热点路径检测 |
| "跨服务调用链" | `trace_path(mode="cross_service")` | 通过 Route 节点追踪 HTTP/异步跨服务调用 |

### 典型工作流

```
0. Re-Index workspace codebase-memory -> 先基于工作区的代码重新构建最新的codebase-memory
1. search_graph(query="关键词")  → 定位相关函数/类/路由
2. trace_path(function_name, mode="calls")  → 理解调用链，评估修改影响范围
3. get_code_snippet(qualified_name)  → 获取精确源码
4. （仅当需要查看非代码文件时）→ Read
```

### 性能热点检测

排查性能问题时，用 Cypher 查询找出高复杂度热点：

```
query_graph("
  MATCH (f:Function)
  WHERE f.transitive_loop_depth >= 3 OR f.linear_scan_in_loop >= 1
  RETURN f.qualified_name, f.transitive_loop_depth, f.linear_scan_in_loop, f.cyclomatic
  ORDER BY f.transitive_loop_depth DESC
")
```

- `transitive_loop_depth`：传递嵌套循环深度（O(n^k) 代理指标）
- `linear_scan_in_loop`：循环内线性扫描次数（隐藏的 O(n²)）
- `alloc_in_loop`：循环内内存分配
- `cyclomatic`：圈复杂度

### 索引维护

项目已在 codebase-memory 中索引。**每次修改代码后必须重新索引**，确保 MCP 图谱反映最新代码结构：

| 时机 | 索引模式 | 原因 |
|------|---------|------|
| **修改代码后（commit 前）** | `moderate` | 让 `trace_path` / `search_graph` 看到最新调用链和字段，辅助后续修改和自检 |
| **commit 后** | `moderate` | 已在 pma-commit SKILL 中自动执行 |

```
index_repository(repo_path="/home/xuchuan/workspace/pma", mode="moderate")
```

> **为什么修改代码后就要索引？** MCP 工具（`trace_path`、`search_graph`、`query_graph` 等）基于已索引的图谱。刚修改的代码如果未索引，MCP 看不到新的函数调用、新字段、新数据流路径，导致：
> - `trace_path` 追踪不到新的调用链
> - `query_graph` 查不到新增的列和关系
> - 无法通过图谱发现"新函数被调用但返回值未被使用"等逻辑断点
>
> 修改代码 → 索引 → 用 MCP 追踪新代码的上下游 → 发现遗漏 → 修复，这个循环能显著减少调试往返。

模式说明：
- `full`：全部文件 + 语义边（最全，最慢）
- `moderate`：过滤后文件 + 语义边（推荐日常使用）
- `fast`：过滤后文件，无语义边（最快）

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

### 项目文档索引

| 文档 | 路径 | 说明 |
|------|------|------|
| 开发指南 | `CLAUDE.md` | 本文档，AI/开发者必读 |
| 数据库文档 | `docs/db.md` | 完整 schema、表关系、权限体系、数据保护方案 |
| 日志系统说明 | `docs/audit-log.md` | 操作日志 + 系统日志架构、category 定义、开发规范 |
| 试用发布说明 | `docs/release-notes.md` | Beta 版本功能清单、已知限制、快速开始 |
| 开发计划 | `docs/dev-plan.md` | 版本历史与开发路线 |
| UI 设计规范 | `docs/design-spec.md` | 加载状态、通知、徽章、主题规则 |
| 部署运维 | `docs/deploy-guide.md` | 部署与运维参考 |

---

## 2. Skills（强制执行 — MUST 调用 Skill 工具）

> **规则：匹配以下触发条件时，必须先调用 `Skill("skill-name")`，再执行任何其他操作。不得跳过。**

| 触发条件 | 必须调用 | 说明 |
|---------|---------|------|
| 用户消息包含 `worktree:` 前缀 | `Skill("pma-worktree")` | 并行开发：git worktree 隔离、分支管理、合并流程 |
| 用户说 "commit" / "提交" | `Skill("pma-version")` + `Skill("pma-commit")` | 版本号管理 + Git 提交规范 |
| 用户消息包含 `issue#N` | `Skill("pma-issue-workflow")` | GitLab Issue 解决：获取详情→定位→诊断→设计→实现→迭代→commit |
| 用户说 "merge" / "合并" | `Skill("pma-worktree")` | rebase+review → 回主session → merge --no-ff |
| 排查/分析 bug / 报错 / 异常 | `Skill("pma-bug-analysis")` | Bug 分析流程：查日志→定位→加日志→修复，扫描同类问题 |
| 前端 UI/CSS/JS 修改 | `Skill("pma-frontend-rules")` + `Skill("pma-web-design")` | 开发流程 + 配色/间距/布局/组件/动画视觉决策 |

---

## 3. 工作流速查

| 用户指令 | AI 必须执行 |
|---------|-----------|
| `worktree: <描述>` | `Skill("pma-worktree")` → EnterWorktree → 开发 → 等 merge |
| `issue#N: <描述>` | `Skill("pma-issue-workflow")` → 理解→定位→诊断→设计→实现→迭代→等 commit |
| "commit" / "提交" | `Skill("pma-version")` + `Skill("pma-commit")` → 更新版本号 → commit |
| "merge" / "合并" | `Skill("pma-worktree")` → rebase+review → 回主session → merge --no-ff → 等 push |
| `./server.sh status` | 查看所有运行实例概览 |
| `./server.sh stop` | 停止所有实例 |
| 后端 .py 修改 | `Skill("code-review")` → 修复 → `./server.sh -p <PORT> restart` |

---

## 4. 重要规则（每轮对话必须遵守）

### 后端修改后自动重启

修改 `backend/**/*.py` 后，先进行 code-review，再重启服务器验证：

1. `Skill("code-review")` — 检查旧代码残留、遗漏引用、重复代码块等
2. 修复 review 发现的问题
3. 重启服务器验证：

```bash
./server.sh -p <PORT> restart
```

- 主 session 用 `-p 8000`，worktree session 用各自的端口
- 纯前端修改无需重启（用户刷新即可），但仍需 code-review
- `server.sh` 命令：`{start|stop|restart|status|logs|tail}`
- 不加 `-p` 时：`status` 查看所有实例、`stop` 停止所有实例

### 交互调试验证阶段不自动提交

调试/验证阶段，完成修改后告知用户改了什么，**等待用户明确说 "commit" 才提交**。不擅自提交。

### 操作日志规范

> 详见 [docs/audit-log.md](docs/audit-log.md)

**所有后端增删改操作必须调用 `log_audit`**（`backend/routers/logs.py`），写入 `audit_logs` 表（同时备份到 `pma-8000.log`）：

| 操作类型 | level | 示例 |
|---------|-------|------|
| 删除、权限变更、数据清除 | `"high"` | 删除用户、清除SVN数据 |
| 编辑、新增 | `"medium"` | 创建Bug、编辑模板 |
| 配置、查看 | `"low"` | 修改设置 |

**Category 必须使用常量**（`backend/audit_categories.py`），禁止硬编码字符串：
```python
from backend.audit_categories import AUDIT_CAT_USER
log_audit(db, user, "delete_user", f"username={uname!r}", AUDIT_CAT_USER, "high")
```

### 交付前自检

**修改完成交付用户验证前**，主动调用 `Skill("code-review")` 对本次修改进行一次 review，重点检查：
- 旧代码残留（旧实现未删除，新旧并存）
- 遗漏的引用更新（改了一处未改关联处）
- 重复代码块

### 日期时间规范（前后端统一）

**所有展示给用户的时间必须为北京时间（UTC+8）。**

| 端 | 规则 | 工具 |
|----|------|------|
| 后端 Python | 时间字段返回前端前必须转换 | `to_local_str()`（`backend/database.py`） |
| 后端 Python | 禁止直接使用 `.strftime()` 或原始 UTC 时间 | — |
| 前端 JS | 禁止 `new Date().toISOString().slice(0,10)` 取当天日期 | 使用 `fmtLocalDate(d)`（`utils.js`） |
| 前端 JS | `toISOString()` 转 UTC，UTC+8 时区下会偏移一天 | — |

### 服务器与环境

| 环境 | 地址 | 用途 |
|------|------|------|
| 生产禅道 | `192.168.0.124:8800` | **只读访问，禁止修改任何内容** |
| 测试禅道 | `192.168.3.22` | 开发测试（API: `/zentao/api.php/v1`） |
| PMA 测试账号 | `PM_Assistant` / `123456` | 只读 role: pm |

- **严禁用生产服务器测试**
- **PM_Assistant 是只读账户**，所有 ZenTao API 调用仅用 GET

---

## 5. Bug 分析流程（快速参考）

1. 先查系统日志：`tail -50 data/pma-$PORT.log`
2. 有堆栈 → 定位出错函数 → 用 MCP 追踪上下游：
   - `trace_path(function_name, mode="data_flow")` — 追踪数据流转，定位数据在哪一层出错
   - `trace_path(function_name, mode="calls", direction="inbound")` — 查看调用者，评估修复影响范围
   - `search_code(pattern="同类模式")` — 扫描同类问题
3. 日志不足 → 先加日志（`logger.exception` / `logger.error`）→ 复现 → 修复
4. 外部 API 调用记录：URL + 状态码 + 响应预览（出错时）
5. 不在日志中记录密码/Token
6. 修复时扫描代码库中同类问题，询问是否一并修复

---

## 6. 模块化 UI 组件规范（快速参考）

**重复的内联样式和 HTML 字符串拼接必须收敛到 CSS class + JS 工厂函数。**

CSS class（`tokens.css`）：`.btn-sm` / `.btn-xs` / `.btn-icon` / `.card-pad` / `.card-clip`

JS 工厂函数（`components.js`）：`sectionHeader()` / `iconBtn()` / `linkChip()` / `chipTag()` / `openDialog()` / `multiSelectDialog()` / `renderPill()` / `renderTypeBadge()` / `renderProgressBar()`

详见 `.claude/skills/pma-frontend-rules/SKILL.md`。

---

## 7. 开发调试规则

### 版本号

版本号统一由 `<meta name="app-version" content="v2026.07.01-beta2">` 定义，`window.APP_VERSION` 读取后所有 JS/CSS 引用动态拼接，**只需改 meta 一处**：

- `frontend/index.html`：`<meta name="app-version" content="...">` → CSS/JS 通过 `document.write` 自动带 `?v=`
- `frontend/login.html`：同上
- `frontend/js/app.js`：VIEW_REGISTRY 中 `js: '/js/tasks.js?v=' + APP_VERSION`（自动跟随）

可一键替换：`sed -i 's/<meta name="app-version" content="[^"]*"/<meta name="app-version" content="新版本号"/' frontend/index.html frontend/login.html`

**每次修改代码前**更新两个 meta 标签。文档版本号仅在 commit 时同步，不额外 +1，允许非连续。详见 `Skill("pma-version")`。

### 前端组件

**禁止复制粘贴后修改。** 搜索下拉、对话框、状态标签、进度条等统一使用 `components.js` 中的工厂函数。新增状态需同步 `STATUS_TXT` + CSS。详见 `Skill("pma-frontend-rules")`。
