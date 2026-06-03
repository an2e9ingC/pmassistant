# PMA 开发计划与进度

> 当前版本：v2026.06.03-beta4 | 最后更新：2026-06-03

---

## 总体进度

| 模块 | 状态 | 说明 |
|------|------|------|
| 项目脚手架 | ✅ 完成 | FastAPI + SQLite + Docker Compose |
| 数据库层 | ✅ 完成 | 15 张缓存表 + 3 张本地表 |
| 禅道同步 | ✅ 完成 | 全量/增量同步 + 并发优化 + 暂停/取消 |
| 认证系统 | ✅ 完成 | JWT + bcrypt + 角色管理 |
| Dashboard | ✅ 完成 | KPI 卡片 + 4 分类筛选 + 项目列表 + 告警 |
| 项目详情 | ✅ 完成 | 甘特图 + 阶段详情 + 文档齐套 + 交付 + 资料 + 笔记 |
| 产品管理 | ✅ 完成 | 产品总览 + 产品详情 + 产品线 KPI |
| 产品拓扑 | ✅ 完成 | 三维度 AND 搜索（项目/产品/客户） |
| 交付管理 | ✅ 完成 | DeliveryRecord CRUD |
| Bug 统计 | ✅ 完成 | Zentao bug 同步 + 统计 API |
| 项目报表 | ✅ 完成 | 周报/月报 API |
| 用户管理 | ✅ 完成 | admin_users CRUD + 角色管理 |
| 数据源配置 | ✅ 完成 | 禅道/GitLab/NAS 三卡片 + .env 持久化 |
| 系统日志 | ✅ 完成 | DB + 文件双写 + 前端实时查看 |
| 自动同步 | ✅ 完成 | 后台 asyncio 定时任务 + 前端进度显示 |
| 主题切换 | ✅ 完成 | 浅色/深色 + CSS var(--xxx) 令牌体系 |
| 部署 | ⚠️ 待验证 | Docker Compose 就绪，生产环境未部署 |
| GitLab 集成 | ❌ Phase 2 | commit 统计、发布验证 |
| NAS 监控 | ❌ Phase 2 | 售前项目检测 |

---

## Phase 1: 项目进度视图 (2026-05-28 ~ 进行中)

> 目标：对接禅道 REST API，实现 Dashboard + 项目列表 + 项目详情

### 1.1 项目脚手架
- [x] 目录结构、requirements.txt、Dockerfile、docker-compose.yml
- [x] FastAPI 入口 + CORS + 静态文件挂载
- [x] 配置管理（`.env` 自动加载 + `Settings.reload()` 热重载）
- [x] `server.sh` 运维脚本（start/stop/restart/logs）

### 1.2 数据库层
- [x] SQLAlchemy 引擎 + Session + Base
- [x] 本地模型：`LocalUser`、`SyncLog`、`DeliveryRecord`、`ProjectNote`、`LogEntry`
- [x] 禅道缓存模型：`CachedProject`、`CachedExecution`、`CachedTask`、`CachedUser`、`CachedProduct`、`CachedCustomer`、`CachedBug`、`ProductProjectLink`、`CustomerProjectLink`
- [x] 启动时自动建表 + seed 默认 admin 用户

### 1.3 禅道 Client + 同步服务
- [x] `ZentaoClient`：MD5 认证、分页、重试、token 过期自动刷新、GBK 编码容错
- [x] `SyncService`：全量同步 users → products → projects → executions(tasks) → bugs
- [x] 并发优化：asyncio.gather + Semaphore(20)，耗时 7.5min → 1min
- [x] 增量跳过：raw_json 对比未变更执行跳过任务拉取（无任务缓存时重新拉取）
- [x] Upsert 逻辑：PMA 扩展字段不被同步覆盖
- [x] 手动触发同步（`POST /api/sync/trigger`）+ 暂停/恢复/取消
- [x] 同步进度实时反馈（projects/execs/tasks 统计 + 进度条 + 当前项）
- [x] 后台自动同步（可配置间隔）+ 完成后气泡通知
- [x] 容错处理：日期字段非标准值、权限不足跳过
- [x] 过期数据清理：同步后清理禅道中已删除的项目/执行/任务/产品
- [x] 项目筛选（config.project_filter 按 code 前缀过滤）

### 1.4 认证
- [x] JWT 签发/验证（`/api/auth/login`、`/api/auth/me`）
- [x] bcrypt 密码哈希 + 修改密码
- [x] 登录页面（`login.html`）
- [x] 前端 API client（fetch 封装，JWT header，401 跳转登录页）
- [x] 角色管理：admin / manager / viewer

### 1.5 Dashboard 前后端
- [x] KPI 接口（进行中项目、告警数、交付数、整体进度、total_projects）
- [x] 项目列表接口（搜索 `?search=`、类型 `?type=RD|SC`、分类 `?category=`、排序 `?sort_by=code|end`、分页）
- [x] 告警列表接口（超期、输出件缺失、审核关键字缺失）+ 按项目过滤
- [x] 前端 KPI 卡片渲染 + 4 分类筛选（进行中/已完成/高风险/资料不全）+ 颜色联动
- [x] 前端项目表格（搜索框 300ms 防抖 + 全部/研发/生产 Tab + 排序切换 ⇅▲▼）
- [x] 前端告警列表渲染（项目编号 chip、高风险页过滤）
- [x] Loading / Empty / Error 状态处理

### 1.6 项目详情前后端
- [x] 项目详情接口（`/api/projects/{id}`）+ 进度圆环 SVG
- [x] **甘特图**：
  - 多层时间轴（年/月/周/日）+ 12 月季节配色
  - Ctrl+滚轮缩放（×6/×16/×24 三档）+ 滚轮默认滚动
  - 拖拽平移 + 列宽拖拽
  - 双层进度条：浅色 track（完整周期）+ 实色 fill（完成 %）+ color-mix 边框
  - 项目起止竖线：开始绿色虚线 + 结束红色虚线 + 今日蓝色实线
  - 图例 8 项：已完成/进行中/已阻塞/规划中/未开始/今日/项目开始/项目结束
  - 阶段按钮（统一 .gs-btn 风格）→ 点击跳转阶段详情 + 呼吸高亮动画
  - 进度圆环列（SVG）+ 风险列（getStageRisk 7 级判断）
  - 悬浮提示：精简日期（7/16→9/30）+ 任务计数（任务:n/m，即时显示）
- [x] 阶段详情表格（斑马纹 + 行悬停 + 7 级风险评估）
- [x] 文档齐套接口 + 表格
- [x] 交付状态接口 + 概要 KPI + 记录 CRUD
- [x] 资料链接接口 + 快捷跳转
- [x] 项目笔记（CRUD + 弹窗 + 阶段关联下拉）
- [x] 项目下拉选择器（可搜索 combobox）
- [x] 责任人显示：从任务指派人聚合去重
- [x] 6 个 Tab 切换（甘特图/阶段详情/文档齐套/交付状态/软硬件资料 + 项目笔记固定区域）

### 1.7 产品管理
- [x] 产品总览：产品线 KPI 卡片 + 表格（编号/品名/产品线/状态/项目数/标签）
- [x] 产品详情：扩展字段（category/nas_path/git_url/alias_name）+ 关联项目列表
- [x] 产品-项目关联 CRUD（link/unlink）

### 1.8 产品拓扑
- [x] 快速检索页：三维度 AND 搜索（项目编号/产品名称/客户名称）
- [x] 5 列结果表：项目编号 + 项目名 + 客户 + 关联产品 + 状态
- [x] 300ms 防抖 + Empty/Loading/Error 状态

### 1.9 用户管理
- [x] admin_users CRUD API（list/create/update/password/delete/toggle-active）
- [x] 前端表格 + 弹窗表单（添加/编辑/修改密码）
- [x] 角色管理（admin/manager/viewer），管理菜单仅 admin 可见

### 1.10 数据源配置
- [x] GET/PUT `/api/admin/config` + JSON + .env 双写
- [x] 禅道/GitLab/NAS 三卡片（蓝/琥珀/绿）+ 密码显隐切换 + CapsLock 提醒
- [x] 同步间隔配置 + 清除数据库缓存（双确认）
- [x] `Settings.reload()` 热重载 + `SyncService` 重建 client

### 1.11 系统日志
- [x] RotatingFileHandler + DatabaseLogHandler 双写
- [x] 日志 API（level 过滤 + 搜索）+ 前端实时刷新（2s）
- [x] 清除日志（DB + 文件）+ sticky 工具栏 + 智能滚动

### 1.12 前端模块化
- [x] CSS 拆分：tokens / reset / layout / components / gantt / detail
- [x] JS 拆分：utils / api / auth / components / dashboard / detail / product / reports / logs / topology / admin / app
- [x] 主题切换（浅色/深色）+ CSS var(--xxx) 令牌体系
- [x] 侧边栏：项目 / 产品 / 工具（快速检索 + 统计报告）/ 管理（用户管理 + 数据源配置 + 系统日志）
- [x] 数据源状态标签（右上角禅道/GitLab/NAS）+ 点击显式详情
- [x] Toast 通知队列 + 铃铛下拉框（未读 badge）
- [x] Logo 系统（logo-mark-light/dark 深浅主题自适应）

### 1.13 部署
- [x] Docker Compose 配置
- [x] 部署文档（`docs/deploy-guide.md`）
- [ ] 生产环境部署验证

### 1.14 设计规范
- [x] 设计规范文档（`docs/design-spec.md`）
- [x] 需求规格文档（`docs/requirements-spec.md`）：FR-001~FR-031

---

## 待完成

### Phase 2
- [ ] GitLab 集成（commit 统计、发布验证）
- [ ] 交付状态 PMA 本地配置
- [ ] NAS 售前项目检测（需 NAS 路径配置）
- [ ] 外协进度跟踪
- [ ] 关系图谱可视化（思维导图 SVG）

### 技术债务
- [ ] 生产环境部署验证
- [ ] 自动化测试覆盖

---

## 变更记录

| 日期 | 版本 | 说明 |
|------|------|------|
| 2026-05-28 | v2026.05.28-beta1 | Phase 1 主体完成：后端全功能 + 前端 Dashboard + 项目详情 |
| 2026-05-29 | v2026.05.29-beta1 | 甘特图优化：线性缩放、拖拽平移、固定宽度、双列布局、滚动防抖 |
| 2026-05-29 | v2026.05.29-beta8 | Bug修复：ProductProjectLink导入、sync双次fetch、N+1查询、硬编码URL、权限跳过、空集合清理、canceled样式 |
| 2026-05-29 | v2026.05.29-beta9 | Phase 2+3 完成：产品-项目映射、交付管理 CRUD、Bug 统计、项目报表、同步进度历史 |
| 2026-05-29 | v2026.05.29-beta11 | 系统日志查看器：RotatingFileHandler+DB双写、日志 API、前端实时刷新 |
| 2026-05-29 | v2026.05.29-beta13 | 数据库日志存储：LogEntry+DatabaseLogHandler、deploy-guide 更新 |
| 2026-05-29 | v2026.05.29-beta14 | DB路径绝对化+权限修复、数据源标签重构移到右上角、server.sh脚本 |
| 2026-05-29 | v2026.05.29-beta17 | 数据源标签 UI 迭代、规则完善（no-auto-commit/docs-sync/auto-restart/theme-compat） |
| 2026-05-29 | v2026.05.29-beta20 | Toast 通知 + 铃铛队列 + 日志智能滚动 + 同步按钮 + design-spec.md |
| 2026-05-29 | v2026.05.29-beta24 | 动态数据源检测、项目状态映射、产品线同步、客户提取、映射页重构 |
| 2026-05-30 | v2026.05.30-beta1 | Dashboard 分类卡片、产品管理、客户名提取、项目列表 9 列拆分、侧边栏重组 |
| 2026-05-31 | v2026.05.31-beta1 | 甘特图修复：工具栏移出滚动区、displayWidth 确保拖拽、滚轮缩放、日期起点 |
| 2026-05-31 | v2026.05.31-beta2 | 甘特图多层时间轴(年/月/周/日)、12 月季节配色、z-index 体系重构 |
| 2026-05-31 | v2026.05.31-beta3 | 甘特图：进度圆环列、Grid 对齐、列宽拖拽、阶段名换行、风险列 |
| 2026-06-01 | v2026.06.01-beta1 | 阶段详情风险判断、进度圆环、告警增强（项目编号 chip、高风险页） |
| 2026-06-01 | v2026.06.01-beta2 | 缩放预设 ×6/×16/×24、方向感知滚轮吸附、日视图去重 |
| 2026-06-01 | v2026.06.01-beta3 | 数据源配置页（三卡片+密码显隐+JSON+.env 双写）+ favicon |
| 2026-06-01 | v2026.06.01-beta4 | 客户模块删除 + 产品拓扑页（三维度 AND 搜索），净减 1525 行 |
| 2026-06-01 | v2026.06.01-beta5 | 产品列表→产品总览：KPI 卡片 + 表格布局 |
| 2026-06-01 | v2026.06.01-beta6 | 产品拓扑→快速检索、移至工具组；报表→工具 |
| 2026-06-01 | v2026.06.01-beta7 | Logo 系统：logo-mark-light/dark 深浅主题自适应 |
| 2026-06-01 | v2026.06.01-beta8 | 项目笔记：project_notes 表 + CRUD API + 弹窗 |
| 2026-06-01 | v2026.06.01-beta9 | 用户管理：admin_users CRUD + 角色管理 |
| 2026-06-01 | v2026.06.01-beta10 | 禅道 MD5 认证 + 权限容错 + 密码明文显隐 + Settings.reload + 日志实时刷新 |
| 2026-06-01 | v2026.06.01-beta11 | 同步进度条 + 两阶段执行 + 详细统计 + 每 50 条日志进度 |
| 2026-06-01 | v2026.06.01-beta12 | 项目筛选(config) + 暂停/取消同步 + 执行过滤修复 |
| 2026-06-01 | v2026.06.01-beta13 | 产品同步增加过期清理 |
| 2026-06-01 | v2026.06.01-beta14 | 项目编号列排序(⇅▲▼) + 后端 sort_by 支持 code |
| 2026-06-01 | v2026.06.01-beta15 | KPI 增加 total_projects + 类型筛选 tab 移到列表右侧 |
| 2026-06-01 | v2026.06.01-beta16 | 同步性能：asyncio.gather+Semaphore(20) 并发，耗时 7.5min→1min |
| 2026-06-02 | v2026.06.02-beta1 | Bug 同步修复 + 增量跳过 + Bug 并发 + 清除缓存 + 项目筛选优化 |
| 2026-06-02 | v2026.06.02-beta2 | 后台自动同步 + 完成气泡通知 |
| 2026-06-02 | v2026.06.02-beta3 | 项目列表 10 行 + 告警列表 5 行固定高度局部滚动 |
| 2026-06-02 | v2026.06.02-beta4 | 自动同步前端进度显示 + 完成通知 + sync_interval 持久化 |
| 2026-06-02 | v2026.06.02-beta5 | 同步进度提示框紧凑化：单行布局对齐顶栏 |
| 2026-06-02 | v2026.06.02-beta6 | 修复 auto_sync_loop 缩进 bug + 完成后日志打印下次同步时间 |
| 2026-06-02 | v2026.06.02-beta7 | 甘特图项目起止时间线（半透明条+日期文本+工具提示） |
| 2026-06-02 | v2026.06.02-beta8 | 甘特图竖线标记：start 绿色虚线 + end 红色虚线 + 今日蓝色实线 + 图例 |
| 2026-06-02 | v2026.06.02-beta9 | 甘特图双层进度条：浅色 track + 实色 fill + color-mix 边框 |
| 2026-06-02 | v2026.06.02-beta10 | 甘特图阶段按钮跳转高亮 + 任务数 tooltip + 禅道链接修复 + 增量同步修复 |
| 2026-06-02 | v2026.06.02-beta11 | 修复多余 </div> 导致 view-detail 内容泄漏 + 甘特图提示精简 |
| 2026-06-02 | v2026.06.02-beta12 | 甘特图 Ctrl+滚轮缩放，未按 Ctrl 时滚轮默认滚动 |
| 2026-06-02 | v2026.06.02-beta13 | 甘特图竖线去顶部圆点 |
| 2026-06-02 | v2026.06.02-beta14 | 添加笔记按钮移至标题右侧 + 阶段高亮修复 + 呼吸动画 + 行悬停 |
| 2026-06-02 | v2026.06.02-beta15 | 表格统一scroll+sticky表头+6行默认+阶段名按钮跳转禅道执行页+列宽优化+表头字体加大 |
| 2026-06-02 | v2026.06.02-beta16 | 项目列表各列nowrap单行显示，溢出省略号，项目名列除外（双行布局） |
| 2026-06-02 | v2026.06.02-beta17 | Dashboard四分类统一点击行为：行点击过滤告警，编号按钮跳转详情 |
| 2026-06-03 | v2026.06.03-beta1 | 责任人获取优化：任务指派人→openedBy→项目PM三层兜底+PMUserID解析+未指派红色标注+甘特图定位今日按钮 |
| 2026-06-03 | v2026.06.03-beta2 | 项目集分类过滤：program_id/name字段+同步解析+/programs API+前端chips+与状态AND逻辑+状态卡片点击取消过滤 |
| 2026-06-03 | v2026.06.03-beta3 | 全部KPI卡片+5列同行4:3比例+选中高亮+产品总览状态过滤chips对齐项目总览设计 |
| 2026-06-03 | v2026.06.03-beta4 | 所有搜索框增加×清除按钮+clearSearch通用函数+设计规范§15 |
