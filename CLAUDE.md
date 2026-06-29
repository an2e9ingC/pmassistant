# PMA (Project Management Assistant) — AI 开发指南

> 本文档供所有 AI 编码工具（Claude Code、Codex、Cursor 等）在使用本仓库时自动加载。
> 详细工作流已拆分为独立 skills，按需触发以降低基础 token 消耗。

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
| 排查 bug / 报错 / 异常 | `Skill("pma-bug-analysis")` | Bug 分析流程：查日志→定位→加日志→修复，扫描同类问题 |
| 前端 UI/CSS/JS 修改 | `Skill("pma-frontend-rules")` | 主题兼容（CSS变量）、TODO占位符、UI组件工厂函数 |

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
| 后端 .py 修改 | `./server.sh -p <PORT> restart` |

---

## 4. 重要规则（每轮对话必须遵守）

### 后端修改后自动重启

修改 `backend/**/*.py` 后必须重启服务器：

```bash
./server.sh -p <PORT> restart
```

- 主 session 用 `-p 8000`，worktree session 用各自的端口
- 纯前端修改无需重启（用户刷新即可）
- `server.sh` 命令：`{start|stop|restart|status|logs|tail}`
- 不加 `-p` 时：`status` 查看所有实例、`stop` 停止所有实例

### 交互调试验证阶段不自动提交

调试/验证阶段，完成修改后告知用户改了什么，**等待用户明确说 "commit" 才提交**。不擅自提交。

### 交付前自检

**修改完成交付用户验证前**，主动调用 `Skill("code-review")` 对本次修改进行一次 review，重点检查：
- 旧代码残留（旧实现未删除，新旧并存）
- 遗漏的引用更新（改了一处未改关联处）
- 重复代码块

### 北京时间显示

**所有展示给用户的时间必须为北京时间（UTC+8）**。SQLite `func.now()` 返回 UTC 时间，后端所有日期时间字段在返回给前端前必须使用 `to_local_str()` 转换（`backend/database.py` 已提供），**禁止直接使用 `.strftime()` 或原始 UTC 时间**。

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
2. 有堆栈 → 分析修复
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

**每次修改代码前**更新 `frontend/index.html#app-version`。文档版本号仅在 commit 时同步，不额外 +1，允许非连续。详见 `Skill("pma-version")`。

### 前端组件

**禁止复制粘贴后修改。** 搜索下拉、对话框、状态标签、进度条等统一使用 `components.js` 中的工厂函数。新增状态需同步 `STATUS_TXT` + CSS。详见 `Skill("pma-frontend-rules")`。
