---
name: pma-frontend-rules
description: 前端开发规范 — 主题兼容（CSS变量）、TODO占位符格式、UI组件工厂函数、组件复用原则、开发教训
user-invocable: true
allowed-tools: Read, Write, Edit, Bash
---

# 前端开发规范

## 主题兼容

- **禁止硬编码颜色值**（如 `#15803D`、`#DCFCE7`）
- **必须使用 CSS 变量**（`var(--xxx)`），定义在 `frontend/css/tokens.css`
- 新增颜色语义时，在 `:root`（light）和 `[data-theme="dark"]` 两处添加
- 提交前在亮/暗主题下各验证一遍

## TODO 占位符

- 前端：`<span style="font-style:italic;color:var(--muted)">TODO：说明</span>`
- 后端：`# TODO: 说明`

## 模块化 UI 组件

**重复的内联样式必须收敛到 CSS class + JS 工厂函数。**

### CSS Class（tokens.css）

| Class | 用途 |
|-------|------|
| `.btn-sm` | section-hd 操作按钮 |
| `.btn-xs` | 表格行内按钮 |
| `.btn-icon` | 纯图标按钮 |
| `.card-pad` | 标准 padding 卡片 |
| `.card-clip` | 溢出裁剪卡片 |

### JS 工厂函数（components.js）

| 函数 | 用途 |
|------|------|
| `sectionHeader(title, count, btnLabel, onclick)` | 区块标题 + 计数 + 按钮 |
| `iconBtn(icon, title, onclick, danger)` | 图标按钮 |
| `linkChip(name, onclick, title, bgColor, fgColor)` | 关联 chip |
| `chipTag(name, colorClass, ...)` | 标签 chip |
| `openDialog(title, bodyHtml, buttons, opts)` | 对话框 |
| `multiSelectDialog(...)` | 多选搜索对话框 |
| `renderPill(status)` | 状态圆点 |
| `renderTypeBadge(type)` | 类型 badge |
| `renderProgressCircle(percent, size, opts)` | 环形进度（唯一进度组件，renderProgressBar已废弃） |
| `renderProgressRing(percent, size, opts)` | 环形进度 |
| `createProjectCombo(opts)` | 项目搜索下拉（新建HTML+注册函数） |
| `initProjectCombo(opts)` | 项目搜索下拉（已有HTML，仅注册函数） |
| `initSearchCombo(opts)` | 通用搜索下拉（自定义数据源） |

### 开发检查点

1. 按钮是否使用了 `.btn-sm` / `.btn-xs` / `.btn-icon`？
2. section-hd 是否使用了 `sectionHeader()`？
3. 关联 chip 是否使用了 `linkChip()`？
4. 颜色变化是否可以用 factory 参数区分？

## 组件复用原则

**优先复用已有组件，禁止复制粘贴后修改。**

1. **搜索下拉**：统一使用 `createProjectCombo()` / `initProjectCombo()` / `initSearchCombo()`。新页面需要项目/产品搜索时，勿手写下拉逻辑。
2. **对话框**：使用 `openDialog()`，禁止手写 overlay HTML。
3. **状态标签**：使用 `renderPill()`，需先在 `utils.js` 的 `STATUS_TXT` 和 `components.css` 中注册新状态的 CSS 类。
4. **进度条**：使用 `renderProgressBar()` / `renderProgressRing()`。
5. **颜色**：必须使用 CSS 变量（`var(--xxx)`），禁止硬编码 hex 值。
6. **新增 UI 模式**：先检查 `components.js` 是否已有可复用函数；如无，提取为公共组件而非内联实现。

### 正确工作流

```
1. 在现有页面找到类似功能 → 复制粘贴 → 修改定制 → 验证可行
2. 提取公共组件到 components.js
3. 逐页迁移 → 逐页验证（不要边迁移边重构边改 API）
4. 删除旧代码
```

## 开发教训（本项目的踩坑记录）

1. **API 字段名以实际返回为准**：`/api/dashboard/projects` 返回 `data.items` 而非 `data.projects`。需查看后端实际 `return` 语句确认 key 名。
2. **JS 函数名不能含连字符**：`task-proj-comboOpen()` 被解析为 `task - proj - comboOpen()`。通过 `onclick` 属性调用的函数名必须转驼峰。
3. **提取组件时同步更新 HTML 中的 onclick**：`onfocus="oldFunc()"` 和 JS 里 `window.newFunc = ...` 要一起改。
4. **日期时间**：详见 `CLAUDE.md` §"日期时间规范（前后端统一）"。
5. **删变量定义时检查所有引用**：简化函数时删了变量定义但漏删使用处 → `ReferenceError`。
5. **交付前 code-review**：修改完成交付用户验证前，主动 `/code-review` 检查旧代码残留（新旧实现并存）、遗漏的引用更新、重复代码块。
