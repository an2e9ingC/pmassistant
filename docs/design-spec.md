# PMA 设计规范

本文档汇总所有跨功能的 UI/UX 设计约定和共性需求，新增功能必须遵循。

---

## 1. 版本号规范

- 正式发布：`vYYYY.MM.DD`（如 `v2026.05.29`）
- 调试阶段：`vYYYY.MM.DD-betaN`（如 `v2026.05.29-beta20`）
- N 为当天递增序号，第二天重置为 1
- 版本号统一存放在 `frontend/index.html` 的 `<span id="app-version">` 和 `docs/dev-plan.md` 变更记录表中

---

## 2. 页面布局

### 2.1 整体结构

```
┌──────────┬──────────────────────────────────────────┐
│ Sidebar  │ Topbar (title | src-tags+sync | bell+user)│
│          ├──────────────────────────────────────────┤
│  nav     │                                          │
│  items   │              Content Area                │
│          │              (view active)               │
│          │                                          │
│  footer  │                                          │
└──────────┴──────────────────────────────────────────┘
```

- Sidebar（固定宽度 228px）：Logo、导航菜单、主题切换、版本号
- Topbar（sticky）：页面标题、数据源标签+同步按钮、通知铃铛、用户头像
- Content：视图切换（dashboard / detail / mapping / reports / logs）

### 2.2 侧边栏导航

- 分组结构：工作台 / 报表 / 管理
- 激活项高亮（蓝色背景）
- 数字 badge 仅在 > 0 时显示
- 底部：主题切换、版本号、退出登录

### 2.3 数据源状态标签

顶部栏右侧，3 个独立 pill 标签（禅道 / GitLab / NAS）：

| 状态 | 样式 | 显示内容 | 示例 |
|------|------|---------|------|
| ok | 绿色背景+绿点+绿边框 | 仅名称 | `禅道` |
| warn | 黄色背景+黄点+黄边框 | 名称 + 原因 | `GitLab 未配置` |
| err | 红色背景+红点+红边框 | 名称 + 原因 | `禅道 同步失败` |
| pending | 灰色背景+灰点+灰边框 | 名称 + 原因 | `NAS 未配置` |

- 间距 12px，`border: 2px`，`font-weight: 600`
- 所有颜色使用 `var(--xxx)` token
- 同步按钮紧邻标签右侧：图标 + 文字「数据源同步」

---

## 3. 异步操作加载状态

所有涉及数据查询、同步、提交的操作，**必须**显示执行状态。

### 3.1 按钮操作

- 点击后立即禁用（`disabled = true`），防止重复提交
- 显示执行中状态（文字变更 或 opacity 降低）
- 完成后恢复

### 3.2 首次数据加载

目标容器显示 `loading-spinner`，不能显示空白或过期占位数据。

### 3.3 数据刷新

对已有数据的刷新（甘特图缩放、日志自动刷新、KPI 更新），**保留旧内容**直到新数据就绪，不闪现空白。

### 3.4 三种状态必须覆盖

| 状态 | CSS class | 说明 |
|------|----------|------|
| Loading | `.loading-spinner` | 旋转动画 + 文字 |
| Empty | `.empty-state` | 居中灰色文字 |
| Error | `.error-state` | 红色文字 + 重试按钮 |

---

## 4. 通知系统

### 4.1 Toast 通知

- **位置**：页面顶部居中（`position: fixed; top: 16px; left: 50%; transform: translateX(-50%)`）
- **入场动画**：从上往下滑入（`translateY(-12px)` → `translateY(0)`）
- **自动关闭**：success / info / warn 类型 4 秒后自动消失
- **手动关闭**：error 类型**不自动关闭**，显示 × 按钮供用户手动关闭，防止严重问题被忽视

### 4.2 Toast 类型

| 类型 | 样式 |
|------|------|
| success | 绿色背景 + 绿色边框 |
| error | 红色背景 + 红色边框 |
| warn | 黄色背景 + 黄色边框 |
| info | 蓝色背景 + 蓝色边框 |

### 4.3 铃铛通知中心

- 所有 toast 通知自动存入队列（`_notifQueue`，最多 50 条）
- 铃铛图标显示未读数字 badge（红底白字，> 0 显示，= 0 隐藏）
- 点击铃铛展开下拉框：
  - 先显示 toast 消息列表（标记时间）
  - 再显示系统告警（从 `/api/dashboard/alerts` 获取）
- 展开后自动清零未读计数
- 点击下拉框外部自动关闭

---

## 5. 数字标记规则

所有界面中的数字 badge，**只在数字 > 0 时显示**，= 0 时 `display: none`。

| 位置 | 元素 | 数据来源 |
|------|------|---------|
| 侧边栏告警数 | `#alert-badge` | KPI API `pending_alerts` |
| 铃铛未读数 | `#bell-badge` | `_notifUnread` 计数器 |
| KPI 卡片数值 | KPI cards | KPI API |

---

## 6. 深浅主题兼容

- **所有 CSS 颜色必须使用 `var(--xxx)` token**，禁止硬编码 `#xxxxxx`
- Token 定义在 `frontend/css/tokens.css`
- 新增颜色语义需同时在 `:root`（light）和 `[data-theme="dark"]` 块中定义
- 修改 CSS 后必须在两种主题下验证效果

---

## 7. 日志系统

### 7.1 后端

- 双写：`data/pma.log`（RotatingFileHandler，5MB/3 备份）+ `log_entries` 数据库表
- DatabaseLogHandler 在 `lifespan` 中延迟加载（确保表已创建）
- 日志 API 仅管理员可访问

### 7.2 前端日志查看器

- 默认进入页面立即开始自动刷新（INFO 级别 15 秒间隔）
- 单个「暂停/恢复」按钮控制自动刷新
- 级别和行数使用 `<select>` 下拉选择
- 智能滚动：
  - 默认定位到最新日志（底部）
  - 新日志到来时自动跟随到底部
  - 用户手动上滚查看历史 → 暂停跟随
  - 用户滚回底部 → 恢复跟随
  - 切换级别/行数 → 重置到最新
- 暂停后点「恢复」→ 重新拉取并定位底部

---

## 8. API 响应格式

所有 API 响应统一为：

```json
{"code": 0, "data": {...}, "message": "ok"}
```

- `code: 0` 表示成功，非 0 表示失败
- 前端 `API.get/post/put/del` 自动检查 `code !== 0` 并抛出 Error
- **不要把纯文本作为 API 响应**（必须包裹在 `data` 字段中）

---

## 9. 前端 JS 模块加载

JS 文件按依赖顺序加载（index.html 中 script 顺序）：

```
utils.js → api.js → auth.js → components.js → dashboard.js → detail.js → mapping.js → reports.js → logs.js → app.js
```

- 模块间通过全局变量/函数通信（Vanilla JS 模式）
- 私有变量加 `_` 前缀约定
- DOM 操作统一在对应的 view render 函数中

---

## 10. CSS 文件组织

| 文件 | 内容 |
|------|------|
| `tokens.css` | CSS 变量（颜色、尺寸、阴影） |
| `reset.css` | 基础重置 |
| `layout.css` | Sidebar、Topbar、数据源标签 |
| `components.css` | Card、Button、Badge、Pill、Toast、Spinner |
| `gantt.css` | 甘特图专用 |
| `detail.css` | 项目详情、映射视图、日志查看器、通知下拉框 |

---

## 11. TODO 占位符规范

所有暂未实现的功能必须使用统一格式标记：

### 11.1 前端（HTML/JS）
```html
<span style="font-style:italic;color:var(--muted)">TODO：具体待实现的内容说明</span>
```

### 11.2 后端（Python）
```python
# TODO: 具体待实现的内容说明
```

### 11.3 规则
- 占位文本、未实现的逻辑分支、临时硬编码值，一律用 TODO 标记
- 每个 TODO 应包含简短说明，指明后续需要做什么
- 每次实现 TODO 后及时移除标记
- `grep -rn "TODO"` 可快速定位所有未完成项

### 11.4 当前 TODO 清单

| 位置 | 说明 |
|------|------|
| `sync_service.py:full_sync()` | GitLab commit统计、release验证同步（Phase 3） |
| `sync_service.py:full_sync()` | NAS 售前项目检测、交付文档扫描（Phase 3） |
| `sync/sources` | GitLab/NAS 数据源未配置时的待集成提示 |
| `dashboard_service.py:get_kpi()` | 本月交付数量从 DeliveryRecord 统计（Phase 2） |
| `dashboard_service.py:_detect_alerts_internal()` | GitLab发布未同步告警、按阶段文档清单检查 |
| `delivery_service.py:get_delivery_summary()` | 交付进度计算公式（对比应交付 vs 实际交付） |
| `project_service.py:get_project_stages()` | 阶段→固定文档清单映射（非禅道任务名） |
| `mapping.js` 思维导图 | SVG 节点布局渲染引擎 |
| `detail.js` 文档位置/链接列 | 根据阶段提示不同的文档存放位置 |

---

## 12. UI 元素渲染一致性

### 12.1 核心原则

**同一类数据元素在全局范围内必须使用统一的渲染函数和样式风格。** 禁止在不同页面/组件中对相同语义的数据使用不同的渲染方式。这确保了：

- **视觉一致性**：用户在任何页面看到同类型信息时，样式风格完全一致
- **可维护性**：样式修改只需改一个函数，全局自动同步
- **代码复用**：避免散落各处的重复渲染逻辑

### 12.2 共享渲染函数（Single Source of Truth）

所有渲染函数定义在 `frontend/js/utils.js`，全局可用：

| 数据元素 | 共享函数 | 输出格式 | 示例 |
|---------|---------|---------|------|
| 项目编号 | `extractProjectCode(name)` | 纯文本，name 第一段 `-` 前 | `PE0406` |
| 项目名称 | `extractCoreName(name)` | 纯文本，剥离编号和客户前缀 | `全国产存储板卡` |
| 完整项目身份 | `renderProjectIdBlock(name, customerName)` | `[PE0406] 核心名 CDLY` | `[PE0406] 全国产存储板卡 CDLY` |
| 项目编号图标 | `renderProjIcon(type, code)` | 34px 彩色圆角方块 | 蓝色 `PE0406` / 绿色 `YF2506` |
| 客户名 | `renderCustomerBadge(name)` | 琥珀色 mono 字体 badge | `CDLY` |
| 产品标签 | `<span class="tag-badge tag-N">#标签</span>` | tag-badge CSS class + 循环色 | `#全国产` `#双V7` |
| HTML 剥离 | `stripHtml(html)` | 浏览器 DOM 解析后纯文本 | — |

### 12.3 禁止的渲染方式

以下做法**违反本规范**，code review 必须拦截：

- ❌ 直接使用 `p.name` 作为显示文本（应使用 `extractCoreName()`）
- ❌ 客户名用普通 `escHtml()` 或自定义 `<span>` 渲染（应使用 `renderCustomerBadge()`）
- ❌ 项目编号用 `p.code` 或 `'#' + p.id` 显示（应使用 `extractProjectCode()`）
- ❌ 手动正则 `.replace(/<[^>]+>/g, '')` 剥离 HTML（应使用 `stripHtml()`）
- ❌ 同一元素在不同页面使用不同的 CSS class 或 inline style

### 12.4 新增数据元素规范

当需要渲染一种新的数据类型时：

1. 在 `utils.js` 中创建对应的 `renderXxx()` 函数
2. 确保函数返回值（HTML 字符串）在所有上下文（表格、卡片、弹窗、下拉框）中视觉效果一致
3. 所有 CSS 颜色使用 `var(--xxx)` token，兼容浅色/深色主题
4. 空值兜底：空数据统一显示灰色 `—`（`<span style="color:var(--muted)">—</span>`）

### 12.5 检查清单

- [ ] 全局搜索 `escHtml.*\.name` 确认无直接使用原始名称
- [ ] 全局搜索 `\.customer_name` 确认无绕过 `renderCustomerBadge` 的渲染
- [ ] 全局搜索 `.replace(/<[^>]+>/g` 确认无手动 HTML 剥离
- [ ] 全局搜索 `font-size.*px` 确认无硬编码字号（应使用现有 CSS class）

### 12.6 可点击跳转规范

**所有涉及项目、产品、客户的 UI 元素必须支持点击跳转到对应详情页。** 禁止展示实体信息但不提供导航入口。

| 实体 | 跳转目标 | 实现方式 |
|------|---------|---------|
| 项目 | `openProject(id)` → 项目详情页 | 表格行、卡片、芯片均可点击 |
| 产品 | `openProductDetail(id)` → 产品详情页 | 产品名、卡片、芯片均可点击 |
| 客户 | `gotoCustomerProjects(name)` → 客户关联项目页（自动选中） | 客户 badge、列表项均可点击 |

**规则**：
- 表格行：点击整行跳转主实体，行内子元素（产品芯片、客户badge）用 `event.stopPropagation()` 阻止冒泡后跳转各自目标
- 卡片/芯片：直接绑定 onclick 跳转
- 搜索结果：每条结果必须可点击跳转

**检查命令**：
- [ ] `grep -rn "renderProjIcon\|proj-name\|proj-code" frontend/js/` 确认所有项目渲染都有跳转入口
- [ ] `grep -rn "renderCustomerBadge" frontend/js/` 确认客户 badge 可点击（项目关联客户/产品关联客户视图）

### 12.7 可点击组件视觉规范

**所有可点击的小组件（badge、chip、tag、行内链接等）统一采用 `.cust-badge` 的设计模式**，方便用户通过视觉线索识别可交互内容。

**参考实现** (`.cust-badge`)：
- `border: 1px solid var(--border)` — 可见边框，明确组件边界
- `cursor: pointer` — 鼠标悬停时显示手型
- `border-radius: 5px` — 圆角，与纯文本区分
- `transition: border-color 0.12s, background 0.12s` — 平滑过渡
- hover 时 `border-color` 变为组件主题色 — 提供即时交互反馈

**适用场景**：
- 表格行内的可点击实体（阶段名、产品芯片、客户badge）
- 卡片内的跳转入口
- 甘特图、列表等密集信息区域的可点击元素

**反模式**：
- 禁止仅依赖 `color` 或 `text-decoration` 区分可点击元素
- 禁止无边框、无 hover 反馈的裸文本链接

---

## 13. 服务器管理

`server.sh` 脚本提供：

| 命令 | 功能 |
|------|------|
| `./server.sh start` | 后台启动 + 健康检查等待 |
| `./server.sh stop` | 优雅关闭（20s 超时后强制） |
| `./server.sh restart` | stop + start |
| `./server.sh status` | PID、内存、运行时间、健康检查、DB 大小 |
| `./server.sh logs` | 最近 50 行系统日志 |
| `./server.sh tail` | 实时跟踪日志 |

---

## 14. 品牌资源

**Favicon**：`frontend/favicon.svg` — 蓝色圆角方块+白色P字母

- `index.html` 和 `login.html` 的 `<head>` 中通过 `<link rel="icon">` 引用
- `backend/main.py` 中通过 `/favicon.svg` 路由提供静态服务
- 后续可替换为正式 logo 图片（替换 `frontend/favicon.svg` 并更新 SVG 内容即可）

---

## 15. 搜索框设计规范

**所有搜索框必须包含快捷清除按钮。**

- 搜索框容器 `.search-wrap`，输入框 `.search-inp`
- 清除按钮 `.search-clear`：绝对定位在输入框右侧，`&times;` 图标
- 按钮在输入框有内容时显示（`:placeholder-shown ~ .search-clear { display: none }`）
- 点击清除按钮 → 清空输入框 + 触发搜索/过滤回调
- 使用通用函数 `clearSearch(inputId, callback)` 处理清除逻辑
- 输入框 `padding` 右侧预留 34px 清除按钮空间

**示例：**
```html
<div class="search-wrap">
  <svg class="search-ico">...</svg>
  <input class="search-inp" id="xxx-search" placeholder="搜索..." oninput="onSearch(this.value)">
  <button class="search-clear" onclick="clearSearch('xxx-search', onSearch)" title="清除">&times;</button>
</div>
```

---

## 16. 单表格页面高度规范

**所有仅包含单表格的页面，表格容器必须使用 `max-height: calc(100vh - Npx)` 自适应屏幕高度。**

- 不含搜索栏/工具栏：`calc(100vh - 200px)`（如用户管理、权限管理）
- 含搜索栏或少量操作：`calc(100vh - 260px)`（如快速检索）
- 含 KPI 卡片等较大头部：`calc(100vh - 380px)`（如产品总览）
- 所有表格容器必须使用 `.table-scroll` 类（sticky 表头 + overflow-y auto）
- 禁止使用固定 `max-height` 值（如 `252px`、`440px`）

**适用页面清单：**
- 用户管理、权限管理
- 快速检索（产品拓扑）
- 产品总览（产品列表）

---

## 17. 开发流程规则

**每次代码修改后必须检查：**
1. `docs/dev-plan.md` — 版本历史表格是否需要追加新版本条目
2. `docs/design-spec.md` — 设计规范是否需要新增/更新章节
3. `docs/deploy-guide.md` — 部署运维是否需要更新（新增路由/文件/配置项等）
4. `.claude/memory/` — 项目记忆是否需要新增/修改（新规则、新发现等）
