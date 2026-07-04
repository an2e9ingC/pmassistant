---
name: pma-frontend-rules
description: 前端开发流程指引 — 引用设计规范文档，不在此重复规范内容
user-invocable: true
allowed-tools: Read, Write, Edit, Bash
---

# 前端开发流程指引

> 本文档定义前端开发的**流程和原则**。具体的 UI 规范（CSS 类名、按钮尺寸、颜色变量、组件 API）参见对应设计文档，不在此重复。

## 规范文档索引

| 文档 | 内容 |
|------|------|
| `docs/design-spec.md` | UI/UX 设计规范：主题颜色、CSS 变量、按钮规范（§22 区块操作按钮）、实体颜色（§19）、通知系统、加载/空/错误状态、对话框规范 |
| `CLAUDE.md` | 开发总则：日期时间规范、版本号管理、模块化组件规范、Bug 分析流程 |
| `frontend/css/tokens.css` | CSS 变量定义（`--accent`, `--danger`, `--warn` 等）和通用 class（`.btn-sm`, `.btn-xs`, `.btn-icon`, `.card-pad` 等） |
| `frontend/js/components.js` | JS 工厂函数：`openDialog()`, `renderPill()`, `renderProgressCircle()`, `sectionHeader()`, `createProjectCombo()` 等 |

## 开发流程

### 1. 修改前

- 阅读 `docs/design-spec.md` 对应章节，确认规范要求
- 检查 `components.js` 是否已有可复用的工厂函数或 UI 模式
- 更新版本号（`<meta name="app-version">`，参见 `CLAUDE.md`）

### 2. 实现中

- **主题兼容**：禁止硬编码颜色值，必须使用 CSS 变量（`var(--xxx)`），在 light/dark 两主题下验证
- **组件复用**：优先复用 `components.js` 中的工厂函数，禁止复制粘贴后修改
- **TODO 占位符**：前端 `<span style="font-style:italic;color:var(--muted)">TODO：说明</span>`，后端 `# TODO: 说明`
- **新增 UI 模式**：先提取为 `components.js` 公共组件，而非内联实现

### 3. 交付前

- `node --check` 语法检查
- 亮/暗主题各验证一遍
- `/code-review` 检查：旧代码残留、遗漏的引用更新、重复代码块
- 纯前端修改无需重启服务器

## 组件复用原则

1. **搜索下拉** → `createProjectCombo()` / `createProductCombo()` / `createUserCombo()` / `initSearchCombo()`（详见 `pma-web-design` §6.1）
2. **对话框** → `openDialog()`，禁止手写 overlay HTML
3. **状态标签** → `renderPill()`，新增状态需同步 `STATUS_TXT` + CSS
4. **进度** → `renderProgressCircle()`（唯一进度组件，`renderProgressBar` 已废弃）
5. **区块标题+按钮** → `sectionHeader()` 或参照 `docs/design-spec.md` §22
6. **颜色** → 必须 CSS 变量，参照 `docs/design-spec.md` §19 实体颜色一致性

## 开发教训（踩坑记录）

1. **API 字段名以实际返回为准**：`/api/dashboard/projects` 返回 `data.items` 而非 `data.projects`。需查看后端实际 `return` 语句确认 key 名。
2. **JS 函数名不能含连字符**：`task-proj-comboOpen()` 被解析为 `task - proj - comboOpen()`。通过 `onclick` 属性调用的函数名必须转驼峰。
3. **提取组件时同步更新 HTML 中的 onclick**：`onfocus="oldFunc()"` 和 JS 里 `window.newFunc = ...` 要一起改。
4. **日期时间**：详见 `CLAUDE.md` §"日期时间规范（前后端统一）"。
5. **删变量定义时检查所有引用**：简化函数时删了变量定义但漏删使用处 → `ReferenceError`。
