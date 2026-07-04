---
name: pma-web-design
description: PMA 网页设计指南 — 颜色/间距/字体/布局/动画/组件视觉规范，前端开发时自动参考
user-invocable: true
allowed-tools: Read, Write, Edit, Bash
---

# PMA 网页设计指南

> 网页设计决策参考手册。前端开发时自动加载，确保视觉一致性。

## 快速决策矩阵

| 需求 | 方案 | 参考 |
|------|------|------|
| 主色调/强调色 | `var(--accent)` 蓝色系 | tokens.css |
| 成功/完成 | `var(--success)` 绿色系 | tokens.css |
| 警告/超期 | `var(--warn)` 琥珀色系 | tokens.css |
| 错误/危险 | `var(--danger)` 红色系 | tokens.css |
| 中性/禁用 | `var(--muted)` 灰色系 | tokens.css |
| 页面背景 | `var(--bg)` → `var(--surface)` → `var(--surface2)` 三层 | tokens.css |
| 圆角 | 按钮/卡片 `8px`(r-lg)，标签 `4-6px`，头像 `50%` | detail.css |
| 阴影 | 浅 `0 1px 3px rgba`，中 `sh-md`，深 `0 8px 32px` | tokens.css |
| 按钮主操作 | `class="btn btn-primary"` 蓝色填充 | design-spec §22 |
| 按钮次要 | `class="btn"` 透明边框 | design-spec §22 |
| 按钮小号 | `class="btn btn-sm"` / `btn-xs` | tokens.css |
| 图标按钮 | `iconBtn(svg, title, onclick)` | components.js |
| 开关控件 | `toggleSwitch(isOn, onclick, opts)` 44×24px | design-spec §23 |
| 状态标签 | `renderPill(status)` 圆角药丸 | components.js |
| 进度指示 | `renderProgressCircle(pct, size)` 环形 | components.js |
| 对话框 | `openDialog(title, body, buttons, opts)` | components.js |
| 多选弹窗 | `multiSelectDialog(title, items, ids, opts, cb)` | design-spec §15.1 |
| Toast | `showToast(msg, type)` 顶部居中 | design-spec §4 |
| 加载态 | `<div class="loading-spinner">` | tokens.css |
| 空状态 | `<div class="empty-state">` | tokens.css |
| 错误态 | `<div class="error-state">` + 重试按钮 | tokens.css |

---

## 1. 颜色体系

### 1.1 语义色

| 变量 | 色值 | 浅色背景 | 用途 |
|------|------|---------|------|
| `--accent` | `#2563EB` | `--accent-lt` `#DBEAFE` | 主操作、链接、选中态 |
| `--success` | `#16A34A` | `--success-lt` `#DCFCE7` | 完成、正常、绿色标签 |
| `--warn` | `#D97706` | `--warn-lt` `#FEF3C7` | 警告、超期、黄色标签 |
| `--danger` | `#DC2626` | `--danger-lt` `#FEE2E2` | 错误、删除、红色标签 |
| `--muted` | `#6B7280` | — | 次要文本、禁用、占位 |
| `--border` | `#D1D5DB` | — | 边框线 |
| `--fg` | `#111827` (light) | — | 主文本色 |
| `--bg` | `#F3F4F6` (light) | — | 页面背景 |

### 1.2 表面层级（由浅到深）

```
--bg           → 页面底层背景
--surface      → 卡片、表格、面板
--surface2     → 表头、悬停行
```

### 1.3 昼夜主题

所有颜色使用 `var(--xxx)` token，`tokens.css` 同时定义 `:root`（light）和 `[data-theme="dark"]` 两套值。

### 1.4 实体专属色

| 实体 | 主色 | 浅色 | 用途 |
|------|------|------|------|
| 客户 | `--warn` | `--warn-lt` | 客户badge、按钮 |
| 项目（研发） | `--accent` | `--accent-lt` | 项目编号tag |
| 项目（生产） | `--success` | `--success-lt` | 生产项目tag |
| 产品 | `--success` | `--success-lt` | 产品tag |
| SVN | `#7C3AED` | `#EDE9FE` | SVN卡片左边框 |

---

## 2. 间距体系

| 场景 | 值 | 说明 |
|------|----|------|
| 卡片内边距 | `16px` / `var(--card-pad)` | 标准卡片 |
| 表单字段间距 | `6-8px` | 垂直间距 |
| 网格间距 | `12-16px` | card grid gap |
| 表格单元格 | `padding: 8-12px` | 上下/左右 |
| 按钮间距 | `gap: 8px` | 按钮组 flex gap |
| 区块间距 | `18-20px` | section 之间的 margin-bottom |
| 页面内边距 | `24px 28px` | content 区域 |

---

## 3. 字体与字号

| 用途 | 字号 | 字体 |
|------|------|------|
| 页面标题 | `15-17px, 600-640` | Inter |
| 区块标题 | `13px, 600` | Inter |
| 正文/表格 | `13px` | Inter |
| 次要信息 | `11-12px` | Inter |
| 代码/编号 | `11-12px` | JetBrains Mono (`--mono`) |
| 标签/徽章 | `10-11px` | Inter |
| Toast | `12-13px` | Inter |

---

## 4. 布局模式

### 4.1 主布局
```
Sidebar(228px fixed) | Topbar(sticky 50px) + Content(scroll)
```

### 4.2 卡片网格
```css
display: grid;
grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
gap: 16px;
```

### 4.3 双列网格
```css
display: grid;
grid-template-columns: 1fr 1fr;
gap: 20px;
```

### 4.4 表格容器
```css
max-height: calc(100vh - Npx);  /* N取决于页面头部高度 */
overflow-y: auto;
```

### 4.5 表单字段（2列）
```css
display: grid;
grid-template-columns: 1fr 1fr;
gap: 6px 20px;
```

### 4.6 表单字段（4列）
```css
display: grid;
grid-template-columns: 1fr 1fr 1fr 1fr;
gap: 6px 14px;
```

---

## 5. 常用 CSS class（tokens.css）

| class | 说明 |
|-------|------|
| `.btn-sm` | 小号按钮 `font-size:11px; padding:3px 10px` |
| `.btn-xs` | 极小按钮 `font-size:10px; padding:2px 8px` |
| `.btn-icon` | 图标按钮 `width:34px; height:34px` |
| `.btn-primary` | 主操作蓝色填充按钮 |
| `.card` | 标准卡片 `border + border-radius + bg` |
| `.card-pad` | 带内边距的卡片 |
| `.card-clip` | 溢出裁剪的卡片 |
| `.pill` | 状态药丸标签 `padding:1px 8px; border-radius:10px` |
| `.pill.completed` | 绿色已完成药丸 |
| `.pill.blocked` | 灰色未完成药丸 |
| `.loading-spinner` | 旋转加载动画 |
| `.empty-state` | 居中灰色空状态 |
| `.error-state` | 红色错误状态 |
| `.section-hd` | 区块标题 `flex + space-between` |
| `.section-title` | 区块标题文字 `font-size:13px; font-weight:600` |
| `.tabs` | 标签页容器 |
| `.tab` | 单个标签页 `padding:8px 18px` |
| `.tab.active` | 激活标签 `color:--accent; border-bottom` |
| `.search-wrap` | 搜索框容器 `position:relative` |
| `.search-inp` | 搜索/表单输入框统一样式 |
| `.table-scroll` | 表格滚动容器 `sticky thead + overflow-y` |

---

## 6. JS 组件工厂函数（components.js）

| 函数 | 用途 | 参数 |
|------|------|------|
| `openDialog(title, body, btns, opts)` | 标准对话框 | maxWidth, hideClose, overlayClass |
| `renderPill(status)` | 状态标签 | 'todo'/'in_progress'/'review'/'done'/'closed' |
| `renderProgressCircle(pct, size, opts)` | 环形进度 | size=26/30/32, opts.label |
| `renderTypeBadge(type)` | 文档类型徽章 | svn/gitlab/nas 等 |
| `toggleSwitch(isOn, onclick, opts)` | iOS开关 | opts.id, opts.disabled |
| `sectionHeader(title)` | 区块标题组件 | — |
| `iconBtn(icon, title, onclick, danger)` | 图标按钮 | SVG 字符串作为 icon |
| `iconEdit(onclick, title)` | 编辑图标 ✎ | — |
| `iconDelete(onclick, title)` | 删除图标 ✕ | — |
| `iconEye(onclick, title)` | 预览图标 👁 | — |
| `iconCopy(onclick, title)` | 复制图标 📋 | — |
| `iconUpload(onclick, title)` | 上传图标 📤 | — |
| `iconToggle(onclick, title)` | 禁用图标 ⊙\ | SVG矢量+红色 |
| `createProjectCombo(opts)` | 项目搜索下拉 | comboId, onSelect |
| `createUserCombo(opts)` | 用户搜索下拉 | comboId, onSelect |
| `multiSelectDialog(title, items, ids, opts, cb)` | 多选弹窗 | placeholder, maxWidth |

---

## 7. 动画与过渡

| 场景 | 时长 | 缓动 |
|------|------|------|
| 按钮hover | `0.12s` | ease |
| 开关切换 | `0.2s` | ease |
| 对话框入场 | `0.2s` | ease |
| Toast入场 | `0.3s` | ease, translateY(-12→0) |
| 高亮闪烁 | `0.5s × 3次` | ease-in-out |
| 加载旋转 | `0.8s` | linear infinite |

---

## 8. 对话与通知

### Toast 通知 (`showToast`)
```js
// type: 'success' | 'error' | 'warn' | 'info'
// success/info/warn 4秒自动消失；error 不自动消失（需手动关闭）
showToast('操作成功', 'success');
```

### 对话框 (`openDialog`)
```js
openDialog('标题', bodyHtml, [
  {text: '取消', onclick: 'closeDialog()'},
  {text: '确定', cls: 'btn-primary', onclick: 'submit()'}
], {maxWidth: 500, hideClose: false});
```

### 密码验证 (`verifyPassword`)
```js
// 用于危险操作确认，自动检查 pma_settings 开关
var ok = await verifyPassword('操作名称', 'pw_verify_key');
if (!ok) return;
```

---

## 9. 新增页面 Checklist

1. [ ] 所有颜色使用 `var(--xxx)`，无硬编码 `#xxxxxx`
2. [ ] 按钮使用 `.btn` / `.btn-primary` + 内联字号（`font-size:11px/12px`）
3. [ ] 表格使用 `.proj-table` 或 `.stage-table` + `.table-scroll`
4. [ ] 加载/空/错误三态覆盖
5. [ ] 对话框使用 `openDialog()`，禁止手写 overlay
6. [ ] 状态标签使用 `renderPill()`
7. [ ] 进度使用 `renderProgressCircle()`
8. [ ] iOS 开关使用 `toggleSwitch()`，禁止原生 checkbox
9. [ ] 操作按钮优先图标（`iconEdit`/`iconDelete`）
10. [ ] 检查亮色/暗色主题
