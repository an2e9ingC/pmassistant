---
name: pma-code-review
description: |
  PMA 项目专用代码审查技能。支持两种模式：
  1. 局部检查（默认）：基于 git diff 自动识别改动范围，结合 codebase-memory MCP 追踪影响面，对改动文件及其关联代码进行审查。
  2. 全量检查（需明确要求）：对整个代码库进行系统性审查。
  触发条件：用户说 "review"、"检查代码"、"code review"、"审查"、"/review" 时触发。
  注意：本技能是项目本地 skill，优先级高于插件市场的通用 code-review 插件。
---

# PMA 代码审查技能

## 模式选择

| 模式 | 触发条件 | 范围 |
|------|---------|------|
| **局部检查**（默认） | 用户未明确说"全量"/"全面"/"整个项目" | git diff 改动文件 + MCP 追踪的关联代码 |
| **全量检查** | 用户明确说"全量检查"/"全面审查"/"检查整个项目" | 整个代码库 |

> **重要**：除非用户明确要求，否则一律使用局部检查。全量检查耗时长、token 消耗大。

---

## 局部检查流程

### Step 1：确定检查范围

```bash
git diff HEAD                    # 未提交的改动
git diff HEAD~1..HEAD            # 最近一次提交（如工作区干净）
```

根据 diff 输出，提取改动文件列表，按类型分类：
- **前端**：`*.html`, `*.css`, `*.js`（`frontend/` 目录下）
- **后端**：`*.py`（`backend/` 目录下）
- **配置/文档**：`*.md`, `*.json`, `*.yml`, `Dockerfile` 等

### Step 2：更新 MCP 索引

```python
index_repository(repo_path="/home/xuchuan/workspace/pma", mode="moderate")
```

确保 MCP 工具能看到最新的调用链和数据结构。

### Step 3：对每个改动文件执行检查

根据文件类型选择对应的检查维度（见下方"检查维度"表格）。不需要对所有文件跑所有维度，按类型匹配：

| 文件类型 | 需检查的维度 |
|---------|------------|
| `frontend/js/*.js` | 语法、前端规范、设计一致性、代码规范、注释、残留引用 |
| `frontend/css/*.css` | 语法、前端规范、设计一致性 |
| `frontend/*.html` | 前端规范、设计一致性 |
| `backend/**/*.py` | 语法、后端规范、代码规范、注释、数据库、残留引用 |
| `docs/*.md` | 注释 |

### Step 4：MCP 追踪影响面

对改动涉及的函数/类/路由，使用 MCP 工具追踪上下游：

```
search_graph(query="改动的函数名")     # 定位函数
trace_path(function_name, mode="calls", direction="both", depth=2)  # 追踪调用链
```

检查调用方是否会受到改动影响（参数变化、返回值变化、异常变化）。

### Step 5：输出检查结果

以表格形式简要输出：

```
| 文件 | 行号 | 类别 | 问题 | 建议 |
|------|------|------|------|------|
| frontend/js/app.js | 1529 | 残留引用 | _renderUcStats() 已清空但仍被调用 | 删除调用或恢复函数体 |
| backend/routers/bugs.py | 96 | 后端规范 | 写入操作未调用 log_audit | 添加 audit log 记录 |
```

如无问题，输出：`✅ 未发现问题。`

---

## 全量检查流程

> 仅在用户明确要求时执行。执行前先确认：
> "全量检查将审查整个代码库，预计耗时较长。确认继续？"

### Step 1：全量索引

```python
index_repository(repo_path="/home/xuchuan/workspace/pma", mode="full")
```

### Step 2：分模块检查

按以下顺序逐模块审查：

1. **后端路由层** (`backend/routers/`)：所有 `.py` 文件
2. **后端服务层** (`backend/services/`)：所有 `.py` 文件
3. **后端模型层** (`backend/models/`)：所有 `.py` 文件
4. **前端 JS** (`frontend/js/`)：所有 `.js` 文件
5. **前端 CSS** (`frontend/css/`)：所有 `.css` 文件
6. **前端 HTML** (`frontend/*.html`)：入口文件
7. **文档** (`docs/`)：所有 `.md` 文件

每个文件按对应的检查维度执行检查（同局部检查维度匹配表）。

### Step 3：MCP 全局分析

```
get_architecture()                    # 整体架构概览
query_graph("MATCH (f:Function) WHERE f.transitive_loop_depth >= 3 ...")  # 性能热点
query_graph("MATCH (f:Function) WHERE f.cyclomatic > 15 ...")  # 高复杂度函数
```

### Step 4：输出详细报告

以表格形式输出，含严重度和修改建议：

```
| 文件 | 行号 | 类别 | 严重度 | 问题描述 | 修改建议 |
|------|------|------|--------|---------|---------|
| backend/routers/admin_users.py | 266 | 后端规范 | 高 | update_user 未记录 audit log | 在 return 前添加 log_audit(db, user, "update_user", ...) |
| frontend/js/app.js | 1545 | 代码规范 | 低 | var projs 重复声明 | 删除重复行 |
```

严重度定义：
- **高**：可能导致数据错误、安全漏洞、运行时崩溃
- **中**：影响可维护性、可能在某些条件下出错
- **低**：代码异味、风格问题、优化建议

---

## 检查维度详解

### 1. 语法检查

- **JS**：`node --check <file>`
- **Python**：`python3 -m py_compile <file>`
- **CSS**：检查是否有未闭合的括号、无效属性名
- **HTML**：检查标签闭合、属性引号匹配
- **前端 Div 配对**（`frontend/**` 下所有文件）：改动涉及 `<div>` 等 HTML 标签时，必须检查 Open/Close 数量是否匹配。用以下命令核对：
  ```bash
  # 对比每个文件中 <div 和 </div> 的数量
  grep -c '<div ' <file>   # 开放标签数
  grep -c '</div>' <file>  # 闭合标签数
  # 两者必须相等；如果不等则存在漏闭合或多余的 </div>
  ```

### 2. 前端规范

对照 [CLAUDE.md](../../../CLAUDE.md) 和 [design-spec.md](../../../docs/design-spec.md)：

- CSS 变量使用：禁止硬编码颜色值（如 `#fff`、`rgb()`），必须用 `var(--xxx)`
- 组件复用：禁止从已有组件复制粘贴后修改，必须使用 `components.js` 中的工厂函数
- 内联样式：重复的内联样式应收敛到 CSS class
- 日期处理：前端取当天日期必须用 `fmtLocalDate()`，禁止 `new Date().toISOString().slice(0,10)`
- 版本号：JS/CSS 引用必须带 `?v=` 版本参数
- 主题兼容：所有颜色必须支持 light/dark 双主题

### 3. 后端规范

对照 [CLAUDE.md](../../../CLAUDE.md) 和 [audit-log.md](../../../docs/audit-log.md)：

- **audit log**：所有增删改操作必须调用 `log_audit()`，category 必须使用 `backend/audit_categories.py` 中的常量
- **日期时间**：DateTime 字段返回前端前必须通过 `to_iso_str()` 序列化
- **异常处理**：外部 API 调用必须记录 URL + 状态码 + 响应预览；用 `logger.exception` 记录堆栈
- **密码/Token**：不得在日志中记录密码或 Token
- **只读原则**：生产禅道 (192.168.0.124:8800) 仅允许 GET 请求

### 4. 设计一致性

对照 [design-spec.md](../../../docs/design-spec.md)：

- 颜色：使用 CSS 变量，不硬编码
- 间距：使用 `var(--r)`, `var(--r-lg)` 等标准间距
- 字体：使用 `var(--mono)`（代码）、系统字体栈（正文）
- 动画：过渡使用 `0.12s`-`0.2s` 范围
- 组件：使用 `components.js` 工厂函数，保持视觉统一
- 加载/空/错误状态：使用标准 class（`.empty-state`, `.error-state`, `.loading`）

### 5. 代码规范

- **命名**：JS 函数 camelCase，Python 函数 snake_case，CSS class kebab-case
- **文件组织**：JS 模块按功能拆分（`app.js`, `components.js`, `utils.js`, `auth.js`, `api.js`）
- **函数长度**：单函数不超过 100 行（特殊情况除外）
- **重复代码**：检查是否有可抽取的公共逻辑
- **死代码**：已清空的函数是否还在被调用、已删除元素是否还有引用

### 6. 注释质量

- **函数注释**：关键函数应有 JSDoc（JS）或 docstring（Python）说明用途、参数、返回值
- **复杂逻辑**：非直观的算法或业务逻辑应有行内注释解释 why
- **过时注释**：注释内容是否与代码实际行为一致
- **TODO/FIXME**：是否有未处理的 TODO 标记

### 7. 数据库完整性

对照 [db.md](../../../docs/db.md)：

- **Schema 变更**：新增/修改字段是否同步更新了 `docs/db.md`
- **迁移安全**：SQLite 不支持 ALTER COLUMN，需确认变更方式
- **索引**：新字段是否需要索引、新查询是否命中已有索引
- **数据保护**：`data/` 目录下的 SQLite 文件是否正确排除在备份之外

### 8. 残留引用

利用 MCP 工具检查：

- 删除的元素 id/class 是否在其他文件中仍有引用
- 重命名的函数/变量是否在所有调用处都已更新
- 删除的 CSS class 是否还有 HTML/JS 在使用

```
search_code(pattern="删除的id或函数名")   # 全库搜索残留引用
```

> **技巧**：结果过多时用 `path_filter` 缩小范围（如 `path_filter: "wecom"`），`mode: "compact"` 减少输出量。`search_graph` 的 `name_pattern` 只匹配标识符，搜字段/变量用 `query` 全文搜索。

---

## 与 CLAUDE.md 的关系

本 skill 是 CLAUDE.md 中"交付前自检"规则的具体实现。执行逻辑：
- 后端 `.py` 修改 → 按 CLAUDE.md 要求，交付前触发本 skill 的局部检查
- 纯前端修改 → CLAUDE.md 不要求 code-review，但用户主动要求时可调用本 skill
- 用户说 "commit" → pma-commit skill 接管，不触发本 skill
