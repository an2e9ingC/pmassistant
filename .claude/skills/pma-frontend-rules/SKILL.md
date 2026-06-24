---
name: pma-frontend-rules
description: 前端开发规范 — 主题兼容（CSS变量）、TODO占位符格式、UI组件工厂函数
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
| `renderProgressBar(percent, status)` | 进度条 |

### 开发检查点

1. 按钮是否使用了 `.btn-sm` / `.btn-xs` / `.btn-icon`？
2. section-hd 是否使用了 `sectionHeader()`？
3. 关联 chip 是否使用了 `linkChip()`？
4. 颜色变化是否可以用 factory 参数区分？
