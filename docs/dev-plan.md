# PMA 开发计划与进度

当前版本：v2026.08.24-beta4 | 最后更新：2026-08-24

---

## 总体进度

| 模块 | 状态 | 说明 |
|------|------|------|
| 项目脚手架 | ✅ 完成 | FastAPI + SQLite + Docker Compose |
| 数据库层 | ✅ 完成 | 46 张表（含 ZenTao 缓存 + PMA 本地业务表） |
| 禅道同步 | ✅ 完成 | 全量同步 + 暂停/取消 + 实时进度 |
| 认证系统 | ✅ 完成 | JWT + bcrypt + GitLab OAuth + RBAC 角色权限 |
| Dashboard | ✅ 完成 | KPI 卡片 + 分类筛选 + 项目集过滤 + 告警联动 + Bug 环形图 |
| 项目详情 | ✅ 完成 | 甘特图 + 阶段详情 + 文档模板 + 交付状态 + SVN 同步 + 笔记 |
| 产品管理 | ✅ 完成 | 产品总览 + 详情 + 三级节点 + 框图 + 文档分类进度圆环 |
| 产品拓扑 | ✅ 完成 | 三维度 AND 搜索 |
| 任务管理 | ✅ 完成 | PMA 本地任务 CRUD + 工时 + 批量导入 + 工时延长 |
| Bug 管理 | ✅ 完成 | PMA 本地 Bug CRUD + 禅道导入 + GitLab Issue 联动 |
| 客户管理 | ✅ 完成 | 客户 CRUD + 项目/产品关联 |
| 项目报表 | ✅ 完成 | 周报/月报/季报/年报 |
| 用户管理 | ✅ 完成 | CRUD + 角色组多选 + 在线状态检测 |
| 权限管理 | ✅ 完成 | Role/UserRole 多对多 + 9 种细粒度权限 |
| 数据源配置 | ✅ 完成 | 禅道/GitLab/NAS 在线配置 + .env 持久化 |
| 系统日志 | ✅ 完成 | 文件日志实时查看 + 操作审计日志（8 分类 67+ action） |
| 自动同步 | ✅ 完成 | 后台 asyncio + 前端进度 + 气泡通知 + 三源独立 |
| 主题切换 | ✅ 完成 | 浅色/深色 + CSS var(--xxx) |
| 部署 | ⚠️ 待验证 | Docker Compose 就绪（生产部署未验证） |
| GitLab 集成 | ✅ 完成 | Release 同步 + URL 校验 + OAuth + Issue/MR |
| 文档模板 | ✅ 完成 | 项目/产品双模板体系 + 阶段持久化 + SVN 自动匹配 |
| SVN 集成 | ✅ 完成 | 文档元数据 PROPFIND + 变更记录 + 自动匹配 |
| NAS 监控 | ❌ Phase 2 | 售前项目检测 |
| Release Notes | 📄 新增 | 详见 [docs/release-notes.md](release-notes.md) |

---

## Phase 1: 项目进度视图 (2026-05-28 ~ 进行中)

> 目标：对接禅道 REST API，实现 Dashboard + 项目列表 + 项目详情

### 1.1 项目脚手架
- [x] 目录结构、requirements.txt、Dockerfile、docker-compose.yml
- [x] FastAPI 入口 + CORS + 静态文件挂载 + 全局异常处理
- [x] 配置管理（`.env` 自动加载 + `Settings.reload()` 热重载）
- [x] `server.sh` 运维脚本（start/stop/restart/logs）

### 1.2 数据库层
- [x] SQLAlchemy 引擎 + Session + Base + 自动列迁移
- [x] 本地模型：`LocalUser`、`Role`、`UserRole`、`SyncLog`、`DeliveryRecord`、`ProjectNote`、`AuditLog`、`ProjectActivity`、`ProductActivity`
- [x] 禅道缓存模型：`CachedProject`、`CachedExecution`、`CachedTask`、`CachedUser`、`CachedProduct`、`CachedCustomer`、`CachedBug`、`ProductProjectLink`、`CustomerProjectLink`
- [x] 启动时自动建表 + 迁移 + seed 默认角色（14 个）+ admin 用户

### 1.3 禅道 Client + 同步服务
- [x] `ZentaoClient`：MD5 认证、分页、重试、token 过期自动刷新、GBK 编码容错
- [x] `SyncService`：全量同步 users → products → projects → executions(tasks) → bugs
- [x] 并发优化：asyncio.gather + Semaphore(20)，耗时 7.5min → 1min
- [x] 增量跳过：raw_json 对比未变更执行跳过任务拉取（无任务缓存时重新拉取）
- [x] Upsert 逻辑：PMA 扩展字段不被同步覆盖
- [x] 手动触发同步 + 暂停/恢复/取消 + 进度实时反馈
- [x] 后台自动同步（可配置间隔）+ 完成后气泡通知 + 下次同步时间日志
- [x] 容错处理：日期字段非标准值、权限不足跳过、GBK 编码
- [x] 过期数据清理：同步后清理禅道中已删除的项目/执行/任务/产品
- [x] 项目筛选（config.project_filter）+ 项目集（program）解析

### 1.4 认证与权限
- [x] JWT 签发/验证（`/api/auth/login`、`/api/auth/me`）+ bcrypt 密码哈希
- [x] 登录页面 + 前端 API client（401 自动跳转）
- [x] **角色组权限系统**：
  - `Role` 表（14 个角色）+ `UserRole` 多对多关联
  - 权限聚合：用户权限 = 所属所有角色权限并集
  - 4 种权限：admin（系统管理）、sync（数据同步）、project_edit（项目维护）、product_link（产品维护）、customer_link（客户维护）
  - `has_perm(user, perm)` 检查 + `require_perm(perm)` 依赖工厂
  - 权限管理页：角色组 → 权限 checkbox + 成员管理 + 快捷搜索
- [x] 批量添加用户：5 行默认 + 用户名/密码/角色多选下拉 + 标签删除 + 失败回滚

### 1.5 Dashboard 前后端
- [x] KPI 接口（进行中项目、告警数、交付数、整体进度、total_projects）+ "全部"卡片
- [x] 项目列表接口（搜索、类型、分类、项目集 program_id、排序 sort_by=code|end、分页）
- [x] 告警列表接口（超期、输出件缺失、审核关键字缺失）+ 按项目过滤
- [x] KPI 卡片 5 列同行（4:3:3:3:3 比例）+ 点击切换/取消过滤
- [x] 项目集分类 chips + 与状态 AND 逻辑组合过滤
- [x] 项目表格（搜索框 300ms 防抖 + 清除按钮 + 全部/研发/生产 Tab + 排序切换）
- [x] 四分类统一点击行为：行点击过滤告警，编号按钮跳转详情
- [x] Loading / Empty / Error 状态处理

### 1.6 项目详情前后端
- [x] 项目详情接口（`/api/projects/{id}`）+ 进度圆环 SVG
- [x] **甘特图**：
  - 多层时间轴（年/月/周/日）+ 12 月季节配色
  - Ctrl+滚轮缩放（×6/×16/×24 三档）+ 滚轮默认滚动 + 定位今日按钮
  - 拖拽平移 + 列宽拖拽
  - 双层进度条：浅色 track + 实色 fill + color-mix 边框
  - 项目起止竖线：开始绿色虚线 + 结束红色虚线 + 今日蓝色实线（无 pip）
  - 图例 8 项
  - 阶段按钮（.gs-btn）→ 跳转阶段详情 + 呼吸高亮动画（1.4s × 6 次）
  - 进度圆环 + 风险列（7 级判断，去圆点简化文字）
  - 悬浮提示：精简日期（7/16→9/30）+ 任务计数（任务:n/m，即时自定义 tooltip）
- [x] 阶段详情表格（斑马纹 CSS + 行悬停 + 表头 sticky + 阶段名按钮跳转禅道执行页）
- [x] 文档齐套表格（表头 sticky + 按阶段分组）
- [x] 交付状态接口 + 概要 KPI + 记录 CRUD
- [x] 资料链接接口 + 快捷跳转 + 禅道项目链接（index.php?m=project 格式）
- [x] 项目笔记（CRUD + 弹窗 + 添加按钮在标题右侧）
- [x] 项目下拉选择器（可搜索 combobox）
- [x] 责任人获取：任务指派人 → execution.openedBy → 项目 PM（PMUserID 解析）→ "未指派"（红色标注）
- [x] 6 个 Tab + 项目笔记固定区域

### 1.7 产品管理
- [x] 产品总览：产品线 KPI 卡片 + 状态过滤 chips（全部/正常/已关闭）+ 表格
- [x] 产品详情：4 卡片点击跳转禅道（需求/Bug/发布/关联项目）+ 基本信息 + 交付资料 + 关联项目表格
- [x] 产品-项目关联 CRUD（link/unlink）

### 1.8 产品拓扑
- [x] 快速检索页：三维度 AND 搜索（项目编号/产品名称/客户名称）
- [x] 5 列结果表 + 300ms 防抖 + Empty/Loading/Error 状态 + 清除按钮

### 1.9 用户管理
- [x] admin_users CRUD API（list/create/update/password/delete/toggle-active）
- [x] 前端表格 + 弹窗表单（角色组多选 checkbox 替代单选下拉）
- [x] 批量添加用户对话框：5 行默认 + 用户名/密码/角色多选下拉 + 标签删除
- [x] 角色分配失败自动回滚删除已创建用户
- [x] 用户列表显示角色组标签 + 角色组列

### 1.10 权限管理
- [x] Role/UserRole 多对多模型 + 14 个默认角色 + 5 种权限
- [x] 权限管理页面：角色组 → 权限 checkbox + 成员展示 + 管理成员对话框（快捷搜索）+ 操作列
- [x] `has_perm()` / `require_perm()` 权限检查
- [x] 用户权限 = 所属所有角色组权限并集

### 1.11 数据源配置
- [x] GET/PUT `/api/admin/config` + JSON + .env 双写
- [x] 禅道/GitLab/NAS 三卡片 + 密码显隐切换 + CapsLock 提醒
- [x] 同步间隔配置 + 清除数据库缓存（双确认）
- [x] `Settings.reload()` 热重载 + `SyncService` 重建 client

### 1.12 系统日志
- [x] RotatingFileHandler + DatabaseLogHandler 双写
- [x] 日志 API（level 过滤 + 搜索）+ 前端实时刷新（2s）+ 清除功能
- [x] 全局 `exception_handler` 捕获所有未处理异常并写入日志

### 1.13 前端模块化
- [x] CSS 拆分：tokens / reset / layout / components / gantt / detail
- [x] JS 拆分：utils / api / auth / components / dashboard / detail / product / reports / logs / topology / admin / app
- [x] 主题切换（浅色/深色）+ CSS var(--xxx) 令牌体系
- [x] 侧边栏：项目 / 产品 / 工具 / 管理（用户管理 + 权限管理 + 数据源配置 + 系统日志）
- [x] 数据源状态标签 + Toast 通知队列 + 铃铛下拉框
- [x] Logo 系统 + favicon
- [x] 所有搜索框统一清除按钮 + `clearSearch()` 通用函数

### 1.14 设计规范
- [x] 搜索框清除按钮规范（§15）
- [x] 单表格页面高度自适应 `calc(100vh-Npx)`（§16）
- [x] 所有表格统一 `.table-scroll` + sticky 表头
- [x] 需求规格、部署指南、设计规范文档

### 1.15 文档与模板
- [x] README.md（特性/技术栈/快速开始/项目结构）
- [x] `.gitlab/issue_templates`（Bug 报告 + 功能请求）
- [x] `.gitlab/merge_request_templates`（MR Checklist）
- [x] `.env.example` 清理硬编码 + `docker-compose.yml` 生产化

---

## 待完成

> 详见 [release-notes.md](release-notes.md) §3 待完善功能

### Phase 2
- [x] 交付状态 PMA 本地配置（应交付总数、交付备注、计划 vs 实际对比）
- [x] 文档齐套性（模板配置 + 项目文档初始化 + 状态跟踪 + 告警集成）
- [x] **GitLab 集成** — 详见下方 Phase 2.1 详细计划
- [ ] NAS 售前项目检测（需 NAS 路径配置）
- [ ] 外协进度跟踪
- [ ] 关系图谱可视化（思维导图 SVG）

### Phase 2.1: GitLab 集成（详细计划）

> **核心逻辑**: 禅道产品发布/版本中记录 GitLab 发布链接 → PMA 同步禅道 Release → 提取 GitLab URL → 调用 GitLab API 校验链接有效性 → 告警
> **参考文档**: `docs/gitlab-api.md`、`docs/requirements-spec.md` §3.3/§4.2/§7.2
> **关联需求**: FR-004 (GitLab未发布告警), FR-007/008 (交付资料 GitLab 路径), FR-009 (快捷跳转), FR-024 (数据源状态)

#### 阶段 A：同步禅道 Release 记录（基础数据）

- [x] A1. 新增 `zenta_releases` 缓存表（id, product_id, name, marker, status, date, desc, gitlab_url, gitlab_url_valid, gitlab_url_checked_at, raw_json, synced_at）
- [x] A2. SyncService 集成 `_sync_releases()`：在 Bug 同步之后调用 `get_product_releases()` 逐产品同步
- [x] A3. GitLab URL 提取：从 release 描述/字段中解析 GitLab 项目路径 + tag 名称

#### 阶段 B：GitLab Client（轻量版）

- [x] B1. `backend/services/gitlab_client.py`：异步 httpx + PRIVATE-TOKEN 认证 + 分页 + 重试 + 429 限速
- [x] B2. 核心方法：`get_release()` + `get_tag()` + `get_version()` + `get_tree()` + `get_raw_file()`
- [x] B3. `backend/config.py` settings 已有 `GITLAB_BASE_URL` / `GITLAB_TOKEN`，无需改动

#### 阶段 C：URL 校验 + 告警集成

- [x] C1. GitLab URL 解析器：`parse_gitlab_release_url()` 支持 releases/tags 多格式
- [x] C2. 批量校验：`validate_all_releases()` 异步校验，结果写入 `gitlab_url_valid` / `gitlab_url_checked_at`
- [x] C3. 告警集成：`_detect_alerts_internal()` 增加 GitLab 发布链接无效/缺失 + GitLab/NAS 未配置 告警

#### 阶段 D：前端展示

- [x] D1. 产品详情页「发布版本」表格，展示 Release 列表 + GitLab 链接有效性状态（✓/✗/待校验）
- [x] D2. Dashboard 告警列表新增「GitLab 链接无效」「未填写GitLab链接」「数据源未配置」类型
- [x] D3. 数据源状态标签增强：release 同步状态 + 链接无效计数

#### 阶段 E：交付资料 GitLab 链接

- [x] E1. 资料链接 Tab：增加关联产品的 GitLab release 链接（含有效性标记）
- [x] E2. 快捷跳转（FR-009）：产品详情和项目资料中 GitLab 链接可直接点击跳转

#### 阶段 F：同步拆分与通知

- [x] F1. 同步拆分为禅道/GitLab/NAS 3 个独立部分，各自 try/except 互不影响
- [x] F2. 同步完成通知展示 3 部分独立结果（✓/✗/⊘）
- [x] F3. 每步增加 `[禅道]`、`[GitLab]` 前缀日志

#### 阶段 G：阶段类型独立持久化

- [x] G1. `get_stage_types()` 改为预定义 + PmaSetting 持久化，与模板数量解耦
- [x] G2. `POST /doc-templates/stage-types` 持久化自定义阶段类型
- [x] G3. `addStageType()` 不再创建占位模板，空阶段可正常添加文档

### 技术债务
- [ ] 生产环境部署验证
- [ ] 自动化测试覆盖
- [ ] 项目研发/生产分类：`project_type` 字段默认为 RD，同步时未写入，需确定分类来源

---

## 变更记录

| 日期 | 版本 | 说明 |
|------|------|------|
| 2026-08-24 | v2026.08.24-beta4 | fix: 任务批量删除误走Bug路径(函数名冲突) — 任务版_doBatchDelete(components.js)与Bug版_doBatchDelete(bugs.js)同名全局函数,先进Bug列表加载bugs.js后其Bug版覆盖任务版,导致任务批量删除确认调Bug版→verifyPassword"批量删除0个Bug"+DELETE/bugs/batch;将任务版改名_doTaskBatchDelete消除冲突,复现路径(先Bug后任务)恢复正常 |
| 2026-08-24 | v2026.08.24-beta3 | fix: 项目详情批量删除串用(Bug路径) — 先进Bug列表tab再切任务tab后,任务批量删除误走/bugs/batch并提示"0个Bug"(任务id被Bug表过滤为0);根因是任务/Bug批量选择集合(_selectedTasks/_selectedBugs)与两个底部浮层工具栏(batch-toolbar/bug-batch-toolbar)跨视图/跨tab残留不清理;新增_clearAllBatchState()并在gotoView(主视图切换)与switchDTab(项目详情tab切换)时清空集合+隐藏工具栏 |
| 2026-08-24 | v2026.08.24-beta2 | fix: 工时日历红点误判 — 红点用未圆整浮点比较(wlH>=h),显示却用toFixed(1)/toFixed(0)圆整,导致"打卡/记录均8.2h、记录比100%"仍显示红点(实际差0.01h);改为Math.round(wlH*10)>=Math.round(h*10)对齐显示口径,真实未达标(记录6h/打卡8h)仍判红 |
| 2026-08-24 | v2026.08.24-beta1 | chore: 增加服务器停止原因诊断日志 — 服务器曾于08-23 04:58被优雅关闭(仅记录"Shutting down"，无触发者信息)；新增:_install_signal_logger捕获SIGTERM/SIGINT信号+时间,_log_shutdown_diag在shutdown记录pid/运行时长/请求数/最近请求与空闲/父进程命令行/残留任务/shutdown-notice,中间件统计请求;server.sh在start/stop写data/ops-8000.log(time+pid+reason+caller)留痕 |
| 2026-08-21 | v2026.08.21-beta1 | chore: 版本号日期校正 — 修正此前误用 08-19 的版本日期，按当天实际日期(08-21)+跨天重置 beta 规范使用 v2026.08.21-beta1 |
| 2026-08-19 | v2026.08.19-beta8 | fix: LibreOffice docx→pdf 转换失败(rc=77) — 根因是常驻 GUI soffice 进程锁定用户 profile(~/.config/libreoffice/4/.lock),headless 转换报"Failed to update lastsynchronized";已杀掉残留进程,并在 _convert_with_libreoffice 改用独立 user profile(-env:UserInstallation=临时目录)彻底隔离用户 LibreOffice 锁,失败日志补充 stderr |
| 2026-08-19 | v2026.08.19-beta7 | feat: Bug分析记录正文改为可选 — 标题保持必填,正文去掉必填校验(添加/编辑对话框),空正文不显示"查看正文"折叠块改为显示"(无正文)";后端 AnalysisCreate.content 默认空字符串 |
| 2026-08-19 | v2026.08.19-beta6 | feat: 评论/分析记录富文本+编辑/软删除+分析排序 — 分析记录添加/编辑对话框改富文本编辑器(80vw,支持图片粘贴)+任务编辑表单评论框改富文本+评论/分析记录支持作者本人编辑(后端归属校验403+audit log)+删除改软删除(is_deleted列,内容保留,时间线/分析列表显示删除线+已删除标记,本人或admin可删)+分析记录支持与历史记录一致的排序切换(默认从新到旧) |
| 2026-08-19 | v2026.08.19-beta1 | feat: 任务/Bug历史记录折叠+分析记录上移 — 历史记录卡片头部新增▾/▸折叠按钮(整块时间线可收起/展开,默认展开,排序/添加评论按钮保留)+Bug详情页分析记录卡片移到工时日志上方(描述→分析记录→工时日志→历史记录) |
| 2026-08-18 | v2026.08.18-beta1 | feat: 任务/Bug产品维度+项目↔产品双向过滤 — Bug修改支持改产品(product_id)+任务修改支持改项目(project_id)+任务新增product_id维度(单产品项目自动带出,多产品显式选择)+任务/Bug创建表单项目↔产品双向过滤(先选任一,另一个下拉只显示关联项)+问题反馈GitLab链接动态化 |
| 2026-08-16 | v2026.08.16-beta3 | fix: 任务/Bug详情页项目编号点击跳转 — 详情页项目编号projCodeTag第二参数由null(任务)/project_id(Bug)改为openProject(code)回调,与列表页一致,鼠标悬停显示小手+点击跳转项目详情 |
| 2026-08-16 | v2026.08.16-beta2 | feat: 任务/Bug表格列统一+工时日志中文名+日历红边框仅限过去 — 任务管理/Bug管理/用户中心任务/Bug四列表统一为复选列→收藏列→编号列序(收藏列固定24px居中,Bug管理及用户中心Bug补齐复选/收藏列)+责任人/负责人列宽统一60px+任务工时日志用户列显示企微中文名(display_name优先)+工时日历未打卡红边框仅限过去日期 |
| 2026-08-16 | v2026.08.16-beta1 | feat: 任务/Bug详情页宽度80%+左右分栏布局 — 详情页(task-detail-page/bug-detail-page)宽度由max-width:1200px改为width:80%+基本信息/状态进度卡片移到右侧上下摆放+描述/工时日志/历史记录等其他卡片移到左侧+详情页TOC跳转改为递归扫描info-glass-card适配分栏嵌套+scroll-margin-top选择器同步调整 |
| 2026-08-15 | v2026.08.15-beta1 | fix: 团队弹窗暗色主题适配+任务详情KPI布局/工时表列宽调整 — 团队成员popover改用--surface/--fg变量(修复暗色白底)+任务详情delivery-kpi移除grid-auto-rows(卡片行高不强制拉伸)+工时表格日期/用户/占比/工时列改固定宽度 |
| 2026-08-14 | v2026.08.14-beta10 | fix: 多人任务记录工时误写任务总进度 — 批量工时后端移除task.progress直接赋值+死代码_handle_100_percent_task+前端团队任务按个人进度比较走my-progress+工时对话框默认进度显示个人进度(非任务总进度) |
| 2026-08-14 | v2026.08.14-beta9 | feat: 事件总线统一事件常量(events.js)+跨视图原位刷新 — 新增events.js集中管理事件名常量+isViewActive()守卫仅刷新可见视图+用户/角色/产品线/文档模板等保存删除后原位刷新+任务变更联动甘特图 |
| 2026-08-14 | v2026.08.14-beta8 | feat: 移除Zentao执行/任务缓存层 — 删除zenta_executions/zenta_tasks缓存表+CachedExecution/CachedTask模型+pma_tasks/project_documents的execution_id列(DB迁移重建表)+服务层/路由移除execution关联+前端清理execution残留 |
| 2026-08-14 | v2026.08.14-beta7 | feat: 人力报表访问权限优化+用户中心跳转链接调整 — 人力报表放开访问(所有用户可进入,普通用户self-scope仅本人)+普通用户隐藏按项目维度+后端3端点require_perm改get_current_user+打卡补充循环尊重user_id+用户中心删除月度报表链接(打卡xxh·记录xxh可点击跳转人力页) |
| 2026-08-14 | v2026.08.14-beta6 | feat: 工时日历显示优化+项目工时占比饼图（issue#266）— 工作日无打卡红边框+圆点标记(有打卡即显示,记录≥打卡绿否则红)+用户中心&人力页项目工时占比饼图(分母打卡工时+未记录斜纹段)+饼图中心显示打卡工时+悬停扇区放大突出+提示框边缘自适应+修复人力报表打卡工时口径(每日max打卡/审批)与用户中心一致 |
| 2026-08-14 | v2026.08.14-beta5 | fix: 任务创建阶段校验+用户中心我创建的任务+移除events.js残留 — 全页新建任务补齐stage_name(修复无execution项目报"请选择阶段")+用户中心"我创建的"改用reporter_id过滤+删除index.html悬空events.js引用 |
| 2026-08-14 | v2026.08.14-beta4 | feat: 项目详情信息卡片优化+Bug列表子页过滤（issue#265）— 关联项目移到关联商机同行+新增项目任务/项目Bug卡片(n/m)+Bug列表状态统计过滤卡片+严重程度/优先级/责任人过滤条+逐框清除 |
| 2026-08-14 | v2026.08.14-beta3 | feat: 人力工时报表纳入仅打卡人员 — 打卡工时查询扩展至所有wecom用户+by_user补充无PMA记录人员+person_count同步+饼图空数据灰色底环 |
| 2026-08-14 | v2026.08.14-beta2 | feat: 统计报告人力报表增加企微打卡总工时卡片 — 顶部KPI新增打卡总工时(by_user checkin_hours求和)+KPI网格4列改5列 |
| 2026-08-14 | v2026.08.14-beta1 | fix: 项目/产品详情顶部选择栏显示优化 — 查看项目/查看产品标签单行不换行 + 搜索选择框宽度收敛为320px |
| 2026-08-13 | v2026.08.13-beta25 | feat: 统计报告人力报表优化 — 打卡工时/记录占比列+按人员-项目占比Excel+项目饼图+独立URL+全列排序 |
| 2026-08-13 | v2026.08.13-beta15 | feat: 个人中心企微工时优化 — 午休可配置+圆点标记填满状态+无打卡显示修复+删除冗余打卡工时面板 |
| 2026-08-13 | v2026.08.13-beta14 | fix: 修复Bug工时批量记录与展示链路 — openDialog支持函数onclick(修复SyntaxError)、工时确认弹窗取消/叠层关闭修复、新增bug_service.create_worklog_batch(占比预校验+批量创建+进度只增不减)、get_worklogs补返占比/工时字段、日历工时详情Bug条目进度取自bug.progress |
| 2026-08-13 | v2026.08.13-beta13 | feat: Bug管理页全面优化 + 模糊搜索支持Bug/任务（issue#264）— 快速检索支持项目/Bug/任务分区展示（标题/编号匹配）、项目详情Bug列表子页、Bug管理三视图(列表/看板/报表)、KPI卡点击过滤(状态/近30天)、高级筛选(产品/项目/严重度/优先级/类型/负责人/创建人/日期)、批量操作(改状态/指派/转移/删除)、行内快捷指派、报表饼图分布+月度趋势+按项目统计、从禅道导入、CSV导出、创建人/负责人编辑权限限制、修复Reports页Bug统计显示0 |
| 2026-08-13 | v2026.08.13-beta11 | fix: 富文本化后 legacy markdown 图片尺寸后缀( =WxH)无法解析 — 新增 mdImgSizeToHtml/markdownToHtml 兼容层，renderMarkdown/initRichEditor/.md文档预览统一接入，编辑保存后自动迁移为 HTML |
| 2026-08-13 | v2026.08.13-beta10 | feat: Bug独立URL页面+详情页导航/布局/交互优化 — 描述编辑按钮、收藏星标前置、状态进度自动联动、右侧快捷跳转导航、分析记录时间线（含标题） |
| 2026-08-13 | v2026.08.13-beta9 | fix: 模板路径变更后项目文档未重新匹配 — doc_path变更时同步清空location+重置status |
| 2026-08-13 | v2026.08.13-beta8 | fix: 文档模板glob与regex混用导致GitLab release匹配失败 + 正则生成器UI + 存量glob迁移脚本 |
| 2026-08-13 | v2026.08.13-beta7 | fix: 表格操作列宽度按按钮数量控制 + 修复btn-icon CSS级联bug + 可选/必选图标化 |
| 2026-08-13 | v2026.08.13-beta6 | fix: 富文本编辑器深色主题适配 — 默认字色跟随主题+皮肤/内容随data-theme切换+主题切换实时换肤 |
| 2026-08-13 | v2026.08.13-beta5 | fix: 问题反馈详细描述回退为 markdown+图片（移除富文本编辑器） |
| 2026-08-13 | v2026.08.13-beta4 | feat: 用户中心过滤卡片纵向堆叠 + 筛选栏并排 + 底部通知栏单行显示 |
| 2026-08-13 | v2026.08.13-beta3 | feat: 任务/Bug操作记录结构化 + 详情整页视图与操作时间线 |
| 2026-08-13 | v2026.08.13-beta2 | fix: 工时系统修复 — 迁移分母按标准工时折算+编辑校验不超过100%+占比粒度1%+滑块数值预览 |
| 2026-08-13 | v2026.08.13-beta1 | feat: 工时系统全面优化 — 百分比填报+批量多日+工时日历合并+人力报表+Excel导出+企微打卡校准 |
| 2026-08-11 | v2026.08.11-beta14 | chore: pma-issue-workflow上线流程补充释放used_server_ports端口步骤 |
| 2026-08-11 | v2026.08.11-beta13 | fix: 已解决Bug过滤卡片包含已关闭状态的Bug |
| 2026-08-11 | v2026.08.11-beta12 | style: 用户中心过滤卡片优化 — 删除kpi-meta改为tooltip，增大label字号+卡片高度 |
| 2026-08-11 | v2026.08.11-beta11 | fix: Bug工时日历缺失项目/阶段/组件信息 + 前端日历新增类型列 + 修复编辑删除URL 404 |
| 2026-08-12 | v2026.08.12-beta1 | feat: HugeRTE 富文本编辑器替换 Markdown textarea |
| 2026-08-11 | v2026.08.11-beta10 | chore: 优化skills分支命名，简化分支名和worktree名用连字符替代斜杠 |
| 2026-08-11 | v2026.08.11-beta9 | fix: 产品发货模块模板导入遗漏同步 + 阶段无需文档标志不一致 |
| 2026-08-11 | v2026.08.11-beta8 | feat: 个人中心Bug卡片布局优化，KPI卡片字体放大+grid布局，任务/Bug过滤卡片重组，profile-bar彩色tab |
| 2026-08-11 | v2026.08.11-beta7 | skill: worktree端口管理 — used_server_ports文件防止多worktree端口冲突 |
| 2026-08-11 | v2026.08.11-beta6 | feat: 任务批量删除 — 多选任务批量工具栏新增删除按钮，后端新增 DELETE /tasks/batch 端点 |
| 2026-08-11 | v2026.08.11-beta5 | feat: 任务多负责人支持 |
| 2026-08-11 | v2026.08.11-beta4 | feat: 组织架构用户列表新增ID列 |
| 2026-08-11 | v2026.08.11-beta3 | feat: 模板任务创建人配置化（系统用户+LEADER可选），system用户替代admin |
| 2026-08-11 | v2026.08.11-beta2 | fix: Bug进度无法修改 — 修复bug:before-save事件处理器中两条规则冲突导致进度被重置为0 |
| 2026-08-11 | v2026.08.11-beta1 | feat: draw.io VSDX→PDF高还原度转换引擎 — 双引擎(draw.io+LibreOffice) + SHA256内容哈希缓存 + LRU淘汰 + OLE嵌入提取 + 转换状态提示 |
| 2026-08-10 | v2026.08.10-beta2 | feat: 个人中心新增我创建的任务过滤卡片，模板任务创建人修正 |
| 2026-08-09 | v2026.08.09-beta2 | feat: 任务模板增加优先级配置和显示 |
| 2026-08-10 | v2026.08.10-beta1 | feat: 开放组织架构页面给所有用户，优化用户/角色列表 |
| 2026-08-09 | v2026.08.09-beta1 | fix: 启动自检优雅降级 — 外部服务不可达不再阻止启动
| 2026-08-07 | v2026.08.07-beta10 | feat: 版本号点击生成每日更新汇总 — API端点 + 前端联动 + 自适应时间窗口 |
| 2026-08-07 | v2026.08.07-beta9 | fix: DataTable列宽拖拽修复 — 棘轮效应修复、操作列按钮标准化、全量minWidth设置 |
| 2026-08-07 | v2026.08.07-beta7 | fix: DataTable列宽拖拽修复 — 棘轮效应修复、操作列按钮标准化、全量minWidth设置 |
| 2026-08-07 | v2026.08.07-beta6 | feat: 偏好设置支持各页面默认筛选类型 + 标签重命名 + 产品卡片风格统一 |
| 2026-08-07 | v2026.08.07-beta5 | feat: 个人中心任务/Bug页面优化 — 关注收藏、抄送可见、过滤卡片统一、UI密度偏好 |
| 2026-08-07 | v2026.08.07-beta4 | feat: DataTable 全局列宽拖拽 + 行高密度偏好设置 |
| 2026-08-07 | v2026.08.07-beta3 | feat: 模板任务导入预览对话框，支持选择性导入和已删除任务恢复；修复 is_deleted 过滤遗漏 |
| 2026-08-07 | v2026.08.07-beta5 | feat: 优化项目状态使用场景 — 新增已废止状态、待启动延迟模板同步、已完成校验、状态机梳理 |
| 2026-08-06 | v2026.08.06-beta1 | fix: 模板-项目联动机制重建，解决阶段变更后任务悬空问题 |
| 2026-08-05 | v2026.08.05-beta1 | fix: 全面修复数据刷新不及时，新增EventBus同步机制 |
| 2026-08-05 | v2026.08.05-beta1 | fix: 系统启动日志、个人中心Bug列表合并/计数/详情修复、附件兼容性 |
| 2026-08-04 | v2026.08.04-beta2 | feat: 新增系统管理页面，整合数据库管理、数据源管理、系统设置、上传管理 |
| 2026-08-04 | v2026.08.04-beta1 | feat(deploy): Docker 离线部署方案 — 三种部署方式文档 + docker build 脚本优化 + .dockerignore |
| 2026-08-03 | v2026.08.03-beta4 | fix: 数据库管理页面多项优化 |
| 2026-08-03 | v2026.08.03-beta2 | refactor: 上线流程优化（worktree防重复创建、GitLab评论路径、openDialog规范） |
| 2026-08-03 | v2026.08.03-beta1 | fix: 编辑项目切换类型时编号被覆盖 + 孤立数据清理 |
| 2026-08-02 | v2026.08.02-beta3 | feat: 角色Leader — 角色组Leader设置 + 任务/文档默认责任人 + 角色组管理UI优化 |
| 2026-08-02 | v2026.08.02-beta2 | fix: OAuth token 过期 — 存储 refresh_token + 自动刷新 + PAT fallback |
| 2026-08-02 | v2026.08.02-beta1 | fix: 备份历史列表为空 — DataTable 缺少 data 参数 |
| 2026-07-31 | v2026.07.31-beta13 | feat: 交付模块全面优化 — 圆环进度、物料编码表、审计日志双写、企微中文名 |
| 2026-07-31 | v2026.07.31-beta12 | fix: 产品日志tab加载失败 — innerHTML覆盖导致容器丢失 |
| 2026-07-31 | v2026.07.31-beta11 | feat: 项目日志增强 — 工时动态+任务名可点击+detail精简+左对齐 |
| 2026-07-31 | v2026.07.31-beta10 | feat: 个人中心新增高优先级+即将到期卡片；批量编辑支持优先级 |
| 2026-07-31 | v2026.07.31-beta9 | feat: 底部通知栏动态按用户收藏项目过滤 + 自适应滚动速率 |
| 2026-07-31 | v2026.07.31-beta8 | chores: issue-workflow skill 新增 worktree 硬性要求 |
| 2026-07-31 | v2026.07.31-beta7 | style: 文档预览最小高度800px |
| 2026-07-31 | v2026.07.31-beta6 | feat: 优化详情页预览文档布局 + 项目动态卡片 |
| 2026-07-31 | v2026.07.31-beta5 | audit: 前端代码审计 — 修复CSS断点+JS函数名冲突+死代码清理+login版本化 |
| 2026-07-31 | v2026.07.31-beta4 | fix: 新增文档默认可删除，移除可选项复选框 |
| 2026-07-31 | v2026.07.31-beta3 | fix: 修复客戶刪除/编辑失败 + 补audit log |
| 2026-07-31 | v2026.07.31-beta2 | fix: 修复 audit category + 错误状态回归 |
| 2026-07-31 | v2026.07.31-beta1 | feat: 项目/产品自定义文档支持（非模板文档的增删改查） |
| 2026-07-30 | v2026.07.30-beta4 | feat: 模板重命名和顺序调整同步到已有项目/产品，阶段级联更新 |
| 2026-07-30 | v2026.07.30-beta3 | fix: 项目文档阶段过滤优化 — 全部文档均为可选且已删除时隐藏该阶段 |
| 2026-07-30 | v2026.07.30-beta2 | style: 页面缩放90% + 侧边栏导航优化 |
| 2026-07-30 | v2026.07.30-beta1 | fix: 工时记录后任务进度/状态实时刷新 + 100%进度确认弹窗 |
| 2026-07-29 | v2026.07.29-beta8 | fix: 审批流程关闭时进度100%仍进入评审中 |
| 2026-07-29 | v2026.07.29-beta7 | feat: 数据源可见性控制+同步日志完善 |
| 2026-07-29 | v2026.07.29-beta5 | feat: PDM文件夹级模板支持，路径下文件数角标 |
| 2026-07-29 | v2026.07.29-beta4 | fix: SQLAlchemy共享会话对象导致is_removed审计日志漏报 |
| 2026-07-29 | v2026.07.29-beta3 | fix: 文档is_removed审计日志修复+模板同步跳过已移除文档+日志补齐 |
| 2026-07-29 | v2026.07.29-beta2 | fix: 登录后页面先闪烁再跳转根因修复 + docs: issue-workflow 强化根因分析 |
| 2026-07-29 | v2026.07.29-beta1 | feat: 任务动态滚动栏优化 + fix: 工时弹框仅关顶层 |
| 2026-07-28 | v2026.07.28-beta10 | feat: 数据库恢复后自动重启 + 文本确认 + DB变更检测 |
| 2026-07-28 | v2026.07.28-beta5 | fix: 底部栏独立区域 + 批量编辑工具栏置顶 |
| 2026-07-28 | v2026.07.28-beta4 | feat: 任务审批开关配置 |
| 2026-07-28 | v2026.07.28-beta3 | refactor: 移除extractCoreName直用name, 关联项目显示编号 |
| 2026-07-28 | v2026.07.28-beta2 | feat: 商机转化+双向同步关联项目+code/name直用 |
| 2026-07-28 | v2026.07.28-beta1 | feat: 关联商机-详情页卡片+编辑+搜索表格列 |
| 2026-07-27 | v2026.07.27-beta10 | feat: 详情页毛玻璃卡片统一样式 |
| 2026-07-27 | v2026.07.27-beta9 | feat: 产品管理表格自适应窗口高度 |
| 2026-07-27 | v2026.07.27-beta8 | feat(ui): 项目/产品详情页技术协议和规格书增加全屏查看按钮 |
| 2026-07-27 | v2026.07.27-beta7 | feat: 文档预览默认全屏+全屏切换 |
| 2026-07-27 | v2026.07.27-beta6 | feat: 项目文档导入模板/新增文档+删除二次确认+日志优化 |
| 2026-07-27 | v2026.07.27-beta5 | fix: 全选任务仅选中当前可见行,排除隐藏表格 |
| 2026-07-27 | v2026.07.27-beta4 | fix: 模板任务同步不再覆盖已导入任务的任何字段 |
| 2026-07-27 | v2026.07.27-beta3 | feat: 项目详情页技术协议预览(对外销售优先,研发内部fallback) |
| 2026-07-27 | v2026.07.27-beta2 | style: 项目/产品详情页基本信息与笔记黄金分割左右分栏布局 |
| 2026-07-27 | v2026.07.27-beta1 | feat: 用户管理页面支持点击用户名查看该用户个人中心 |
| 2026-07-25 | v2026.07.25-beta5 | feat: 新手引导触发机制重构(DB need_guide列) |
| 2026-07-25 | v2026.07.25-beta4 | fix: Dashboard点击卡片/分类Tab自动清除搜索框 |
| 2026-07-25 | v2026.07.25-beta3 | fix: 底部告警滚动栏修复动画+空间隔离 |
| 2026-07-25 | v2026.07.25-beta2 | feat: 产品详情页产品框图改为产品规格书下拉切换 |
| 2026-07-25 | v2026.07.25-beta2 | feat: 项目关联产品支持数量配置 |
| 2026-07-25 | v2026.07.25-beta1 | feat: 配置页卡片优化+Logo导航+用户下拉菜单+引导 |
| 2026-07-24 | v2026.07.24-beta5 | feat: SOLIDWORKS PDM SSH扫描+文档源支持 |
| 2026-07-24 | v2026.07.24-beta4 | fix: GitLab OAuth 登录后从企微回填中文 display_name |
| 2026-07-24 | v2026.07.24-beta3 | feat: GitLab Issue 评论 API + commit 自动评论工作流 |
| 2026-07-24 | v2026.07.24-beta2 | fix: 产品模板可选+任务同步去重(is_diverged) (close #162,#163) |
| 2026-07-24 | v2026.07.24-beta2 | fix: 告警跑马灯空状态显示"一切安好"而非隐藏 |
| 2026-07-24 | v2026.07.24-beta2 | feat: 审批人权限控制+批量编辑审批人+搜索式下拉 |
| 2026-07-24 | v2026.07.24-beta2 | docs: worktree skill 代码修改后验证+上线schema检查 |
| 2026-07-24 | v2026.07.24-beta1 | fix: 模板名重复检查+GitLab卡片对齐+仪表盘告警用PMA模型 (close #159,#160,#161) |
| 2026-07-24 | v2026.07.23-beta9 | fix: 阶段编辑权限控制 + 项目表单新增客户入口+中文搜索 (close #151,#153) |
| 2026-07-23 | v2026.07.23-beta8 | docs: worktree skill 上线后自动删除远程临时分支 |
| 2026-07-23 | v2026.07.23-beta7 | feat: 任务审批工作流—reviewer/审批人/我的审批/自审批 (close #148,#154) |
| 2026-07-23 | v2026.07.23-beta6 | fix: 日志中文描述 + 甘特图团队显示 + 复制模板字段修复 (close #155,#156,#158) |
| 2026-07-23 | v2026.07.23-beta5 | fix: 项目类型变更自动重同步 stages/docs/tasks |
| 2026-07-23 | v2026.07.23-beta4 | fix: 模板可选属性同步 + 文档序号动态更新 |
| 2026-07-23 | v2026.07.23-beta3 | fix: 普通用户用户列表403 — 改用公开 /users/options 接口 |
| 2026-07-23 | v2026.07.23-beta2 | docs: 修正 CLAUDE.md worktree 触发词，消除与 SKILL.md 的歧义 |
| 2026-07-23 | v2026.07.23-beta1 | feat(ui,api): 任务批量编辑—复选框多选+指派+操作日志ID转中文名 (close #152) |
| 2026-07-20 | v2026.07.20-beta4 | fix(auth): 移除worklog_edit权限—工时编辑开放为所有角色基础功能 |
| 2026-07-23 | v2026.07.23-beta1 | fix: 主题闪屏+tab回退+偏好持久化修复 |
| 2026-07-22 | v2026.07.22-beta7 | feat: 产品/项目文档表格动态高度自适应 |
| 2026-07-22 | v2026.07.22-beta6 | style: 优化深色主题下项目文档和产品文档的表格颜色风格 |
| 2026-07-22 | v2026.07.22-beta5 | fix: 文档路径模板{YYYY}/{MM}/{DD}和d{N}双格式匹配 |
| 2026-07-22 | v2026.07.22-beta4 | fix: _link_task_to_stage 阶段名变更时重新关联 stage_id |
| 2026-07-22 | v2026.07.22-beta3 | feat: Issue#147 — 模板/文档可选项配置+审计日志补全 |
| 2026-07-22 | v2026.07.22-beta2 | fix: 项目总览搜索框不受过滤卡片影响，全局搜索 |
| 2026-07-22 | v2026.07.22-beta1 | feat: Issue#146 — 所有创建记录创建者信息 |
| 2026-07-21 | v2026.07.21-beta19 | fix: 客户信息同步customer_project_links关联表 |
| 2026-07-21 | v2026.07.21-beta18 | fix: 删除重复 _bug_dict 定义，修复 /bugs/my 500 |
| 2026-07-21 | v2026.07.21-beta16 | fix: 项目表单修复 — 客户选择异步竞争+必填项hint+_resolve_customer回退 |
| 2026-07-21 | v2026.07.21-beta9 | feat: Issue#121 — 项目背景 markdown渲染+编辑预览 |
| 2026-07-21 | v2026.07.21-beta8 | feat: Issue#122 — 项目启动任务完成自动切换项目状态 |
| 2026-07-21 | v2026.07.21-beta7 | feat: Issue#123 — 产品文档卡片显示资料完整度圆环 |
| 2026-07-21 | v2026.07.21-beta6 | feat: Issue#125 — 任务进度100%时提示自动设置为已完成 |
| 2026-07-21 | v2026.07.21-beta5 | feat: Issue#128 — 前端用户信息统一使用企微中文名 |
| 2026-07-21 | v2026.07.21-beta4 | feat: Issue#129 — 项目编号前缀按类型自动匹配+模板管理可配置 |
| 2026-07-21 | v2026.07.21-beta3 | docs: worktree skill 完善 — 停服拷贝DB+配置文件流程 |
| 2026-07-21 | v2026.07.21-beta2 | docs: 新增 pma-frontend-verify 自验证 skill + MCP 环境部署文档 |
| 2026-07-21 | v2026.07.21-beta1 | feat: 产品创建页优化 — 版本号自动生成+name可编辑+校验 |
| 2026-07-20 | v2026.07.20-beta3 | fix(auth): GitLab Issue创建强制OAuth用户token—非GitLab登录用户拒绝创建 |
| 2026-07-20 | v2026.07.20-beta2 | fix(api): GitLab issue创建一并设置assignee+所有GitLab交互点异常处理完善 |
| 2026-07-20 | v2026.07.20-beta11 | style: 工时日历统一低饱和度色彩系统 |
| 2026-07-20 | v2026.07.20-beta10 | fix: 打卡详情对话框+异常打卡过滤 |
| 2026-07-20 | v2026.07.20-beta8 | fix: 打卡工时计算+时间格式+synced_at时区修复 |
| 2026-07-20 | v2026.07.20-beta7 | fix: 企业微信同步错误处理+数据源卡片同步按钮 |
| 2026-07-20 | v2026.07.20-beta6 | feat(ui): 记录工时表单必填项统一内联红色提示+工作描述placeholder |
| 2026-07-20 | v2026.07.20-beta5 | fix(api,ui): resolve_project兼容id/code双模式+任务表单自动填入项目修复 |
| 2026-07-20 | v2026.07.20-beta4 | fix(ui): 项目code索引兼容—任务表单自动填入项目信息+阶段加载使用code |
| 2026-07-20 | v2026.07.20-beta3 | feat: 企业微信用户持久化+管理页面+关联对话框 |
| 2026-07-19 | v2026.07.19-beta4 | feat(ui): 任务表单必填项增强—阶段/负责人/截止日期必填+内联红色提示+开始日期默认当天 |
| 2026-07-20 | v2026.07.20-beta2 | refactor: profile bar回退为非悬浮卡片+tab按钮自适应 |
| 2026-07-20 | v2026.07.20-beta1 | feat(ui,api): 任务列表优化—最新动态分列+个人中心阶段列+工时统一编辑+记录时间(close #119) |
| 2026-07-19 | v2026.07.19-beta6 | feat(ui,api): 个人中心工时日历查看表格化+编辑/删除/复制操作+80vw宽 |
| 2026-07-19 | v2026.07.19-beta5 | feat(ui,api): 工时添加入口+项目/任务标准搜索组件+模板编辑填充路径(close #114,#117) |
| 2026-07-19 | v2026.07.19-beta4 | perf(api,ui): GitLab同步性能优化—全局批量扫描+统计重命名+日志可读+SVN隔离 |
| 2026-07-19 | v2026.07.19-beta3 | fix(api): 扫描前同步模板清理孤儿文档+doc_type继承+占位符日志降级 |
| 2026-07-19 | v2026.07.19-beta2 | feat(api,ui): GitLab同步改造—产品文档GitLab扫描+右上角按钮+tooltip+日志汇总 |
| 2026-07-19 | v2026.07.19-beta1 | feat(api): GitLab Release扫描支持—check_product_docs增加gitlab分支+批量扫描+日志 |
| 2026-07-19 | v2026.07.19-beta8 | fix: 产品框图段头去掉多余 undefined 按钮 |
| 2026-07-19 | v2026.07.19-beta7 | feat: 企业微信计划补齐(get_work_schedule+profile卡片关联) |
| 2026-07-19 | v2026.07.19-beta6 | feat: 企业微信用户搜索选择+wecom_userid字段 |
| 2026-07-19 | v2026.07.19-beta5 | feat: 企业微信打卡工时集成(自建应用) |
| 2026-07-19 | v2026.07.19-beta4 | feat: 个人中心Bug计数+工时双统计+法定工时强度色 |
| 2026-07-19 | v2026.07.19-beta3 | fix(ui): 删除多余</div>修复.content过早关闭导致详情页view溢出 |
| 2026-07-19 | v2026.07.19-beta2 | feat(ui): 项目总览重构—6列KPI卡片+多维过滤栏+dashFilter统一状态管理 |
| 2026-07-19 | v2026.07.19-beta1 | feat: 个人中心三区域独立布局重构 |
| 2026-07-18 | v2026.07.18-beta8 | docs: 项目专用 pma-code-review skill |
| 2026-07-18 | v2026.07.18-beta7 | refactor(api): 统一后端时间保存形式为ISO 8601 UTC+前端fmtISODateTime本地时间转换 |
| 2026-07-18 | v2026.07.18-beta6 | refactor(api): 迁移—API返回ISO 8601 UTC+前端fmtISODateTime本地时间转换 |
| 2026-07-18 | v2026.07.18-beta5 | fix(api): 项目文档列表最后修改时间显示UTC→北京时间—str()改为to_local_str() |
| 2026-07-18 | v2026.07.18-beta4 | docs: pma-commit SKILL重构为三段式提交流程—版本更新→review→停服commit重启 |
| 2026-07-18 | v2026.07.18-beta3 | feat: 个人中心悬浮卡片组件 + 三区域独立布局 |
| 2026-07-17 | v2026.07.17-beta13 | docs: 提交前code-review规则嵌入—修改后+commit前双节点检查 |
| 2026-07-17 | v2026.07.17-beta12 | fix(ui): 产品命名规范添加/编辑按钮onclick引号冲突导致无法保存，表格按编号排序 |
| 2026-07-17 | v2026.07.17-beta11 | fix: 未来新产品选择后显示+onclick字符串带引号+取消products必填 |
| 2026-07-17 | v2026.07.17-beta10 | style: 项目总览收藏卡片高亮+filterByFav+CSS |
| 2026-07-17 | v2026.07.17-beta9 | fix: renderTypeBadge移除多余项目后缀+TYPE_TXT默认值含项目 |
| 2026-07-17 | v2026.07.17-beta8 | style: 产品/项目选择框选中后只显示编号+产品标题proj-code-tag |
| 2026-07-17 | v2026.07.17-beta7 | fix: Gantt图任务数与任务详情不一致 |
| 2026-07-17 | v2026.07.17-beta6 | style: 任务表格移除阶段列聚合进度圆环(与进度列冗余) |
| 2026-07-17 | v2026.07.17-beta5 | fix: tasks/batch接受项目编号+execution_id类型安全+无标题过滤 |
| 2026-07-17 | v2026.07.17-beta4 | style: 项目/产品文档列表UI优化—背景色循环+计数角标+列宽调整+移除红色系 |
| 2026-07-17 | v2026.07.17-beta3 | fix: _sync_from_templates+get_project_documents读取stage_docs_unnecessary过滤无需文档阶段 |
| 2026-07-17 | v2026.07.17-beta2 | fix: location已解析路径误判mismatch回退pending+百分号编码location兼容 |
| 2026-07-17 | v2026.07.17-beta1 | feat: 统一新建/编辑项目对话框，搜索下拉组件+标签维护同款设计 |
| 2026-07-16 | v2026.07.16-beta66 | fix: 编辑项目/产品时项目编号/产品编号改为只读不可修改 |
| 2026-07-16 | v2026.07.16-beta65 | style: 文档列表路径列自动换行+文档名称列固定150px超长换行(项目+产品) |
| 2026-07-16 | v2026.07.16-beta64 | fix: location已解析路径误判mismatch导致回退pending+百分号编码location兼容 |
| 2026-07-16 | v2026.07.16-beta63 | feat: 项目文档SVN扫描—分步递归解析通配符+location写实际URL+updated_by用SVN作者 |
| 2026-07-16 | v2026.07.16-beta62 | fix: is_unnecessary=NULL模板导入只导入1条+ProductDocTemplate缺列500 |
| 2026-07-16 | v2026.07.16-beta61 | fix: hash路由手动输入不跳转+project tab无法定位具体stage |
| 2026-07-16 | v2026.07.16-beta60 | feat: 模板管理支持阶段级无需文档/任务开关+iOS风格toggle+empty状态持久化 |
| 2026-07-16 | v2026.07.16-beta58 | feat: 项目文档表格重构+文档模板路径分离+文档状态编辑对话框+操作列图标 |
| 2026-07-15 | v2026.07.15-beta56 | feat: 初始化阶段/导入模板任务/清空任务按钮仅project_edit权限可见 |
| 2026-07-15 | v2026.07.15-beta55 | style: 产品选择框统一code+name+拓扑搜索项目编号修复+个人中心改用createProductCombo |
| 2026-07-15 | v2026.07.15-beta54 | fix: 个人中心任务+Bug统计根据过滤条件动态更新 |
| 2026-07-15 | v2026.07.15-beta53 | style: projCodeTag新增projectName tooltip+产品关联项目改为编号标签 |
| 2026-07-15 | v2026.07.15-beta52 | style: 个人中心任务+Bug列表列对齐+标准控件+pill去点+sticky表头 |
| 2026-07-15 | v2026.07.15-beta51 | fix: Bug详情页面优化+resolve_product支持ID fallback |
| 2026-07-15 | v2026.07.15-beta50 | feat: 产品详情新增Bug子页面—列表显示+项目编号标签+点击跳转 |
| 2026-07-15 | v2026.07.15-beta48 | feat: 任务+Bug创建/编辑窗口支持图片粘贴+拖拽缩放+延迟上传 |
| 2026-07-15 | v2026.07.15-beta47 | feat: 笔记支持图片粘贴—拖拽缩放+查看对话框+延迟上传+删除清理 |
| 2026-07-15 | v2026.07.15-beta44 | fix: 任务表格优化—新增任务编号列+筛选器移至顶行+删除部分列 |
| 2026-07-15 | v2026.07.15-beta42 | refactor: 清理所有禅道遗留阶段匹配逻辑 |
| 2026-07-15 | v2026.07.15-beta41 | fix: 项目总进度改为实时计算并同步CachedProject.progress+工时操作触发进度更新 |
| 2026-07-15 | v2026.07.15-beta40 | feat: 维护页阶段信息增加添加阶段功能 |
| 2026-07-15 | v2026.07.15-beta39 | feat: 笔记支持编辑/回复+权限控制+AuditLog/Activity双记录+必选阶段/领域 |
| 2026-07-15 | v2026.07.15-beta36 | fix: 项目笔记阶段下拉只有"项目整体"——API返回对象取.stages数组 |
| 2026-07-15 | v2026.07.15-beta35 | style: 统一卡片hover动画—kpi-card/map-card/expand-card/product-card |
| 2026-07-15 | v2026.07.15-beta34 | fix: 产品文档tab产品卡片改为标准card风格+可点击跳转产品文档子页 |
| 2026-07-15 | v2026.07.15-beta33 | fix: 项目/产品总览点击筛选卡片时自动清空搜索框 |
| 2026-07-15 | v2026.07.15-beta32 | feat: 任务列表阶段列增加总进度圆环 |
| 2026-07-15 | v2026.07.15-beta31 | feat: 甘特图任务数为0的阶段显示虚线框 |
| 2026-07-15 | v2026.07.15-beta30 | fix: 产品标签按钮统一显示编号+name为tooltip+修复跳转用code |
| 2026-07-15 | v2026.07.15-beta29 | feat: ProjectStage实体化—阶段独立数据表+维护页阶段管理+任务关联 |
| 2026-07-14 | v2026.07.14-beta24 | fix: 浏览器回退键SPA路由不响应—初始history.state缺失 |
| 2026-07-14 | v2026.07.14-beta23 | fix: project_id→project_code统一修复openProject跳转失败 |
| 2026-07-14 | v2026.07.14-beta22 | feat: 任务表格阶段列hover全组高亮+任务行hover单行高亮 |
| 2026-07-14 | v2026.07.14-beta21 | feat: 任务详情新增最新动态列+删除预估/实际工时列+操作列自适应 |
| 2026-07-14 | v2026.07.14-beta19 | feat: 登录后默认进入个人中心 |
| 2026-07-14 | v2026.07.14-beta18 | fix: URL迁移遗漏resolver修复 + onclick引号修复 |
| 2026-07-14 | v2026.07.14-beta17 | feat: 任务详情完成日期+关闭缓存 |
| 2026-07-14 | v2026.07.14-beta15 | fix: 产品管理编辑/删除code修复 |
| 2026-07-14 | v2026.07.14-beta14 | fix: 任务详情责任人显示修复 |
| 2026-07-14 | v2026.07.14-beta13 | fix: 确认机制修复+责任人CTO回退+对话框优化 |
| 2026-07-14 | v2026.07.14-beta12 | fix: 任务详情显示所有模板阶段(含空) |
| 2026-07-14 | v2026.07.14-beta11 | feat: PMA任务→任务详情+甘特图跳转+表格统一 |
| 2026-07-14 | v2026.07.14-beta10 | fix: code迁移resolver遗漏+破损模型字段修复 |
| 2026-07-14 | v2026.07.14-beta9 | fix: 产品节点重命名ReferenceError |
| 2026-07-14 | v2026.07.14-beta8 | feat: 去除禅道依赖，阶段/甘特图/任务基于模板 |
| 2026-07-14 | v2026.07.14-beta7 | feat: 实体URL标识切换为code(项目/产品/客户) |
| 2026-07-14 | v2026.07.14-beta6 | feat: SPA hash深度链接+ETag缓存修复 |
| 2026-07-14 | v2026.07.14-beta5 | fix: 修复文档模板doc_type/doc_path保存丢失+拖拽排序+编辑入口 |
| 2026-07-14 | v2026.07.14-beta4 | feat: 项目类型支持重命名/删除+文档模板页面双区块显示 |
| 2026-07-14 | v2026.07.14-beta3 | fix: 清除禅道数据保留本地项目/产品+禅道区域增加清除按钮 |
| 2026-07-14 | v2026.07.14-beta2 | fix: 全局禁用浏览器缓存—API/HTML no-store+静态文件max-age=3600 |
| 2026-07-14 | v2026.07.14-beta1 | fix: DB文件退出版本控制—gitignore排除data/pma-*.db防止git操作污染运行中进程FD |
| 2026-07-13 | v2026.07.13-beta15 | feat: 项目文档模板支持添加任务模板—自动创建任务+角色映射+前端切换 |
| 2026-07-13 | v2026.07.13-beta14 | fix: 阶段拖拽重排保存全部阶段顺序—预定义可重排+已保存顺序优先 |
| 2026-07-13 | v2026.07.13-beta13 | fix: 阶段重命名同步更新custom_stage_types持久化—修复生产项目阶段改名失效 |
| 2026-07-13 | v2026.07.13-beta12 | fix: 删除项目/清空数据自动清理用户收藏—消除孤儿收藏数据 |
| 2026-07-13 | v2026.07.13-beta11 | fix: 新建项目权限project_edit+工时填报全员开放+移除worklog_edit权限 |
| 2026-07-13 | v2026.07.13-beta10 | feat: 新建项目编号自动生成—PE前缀(RD/SC)+LSJ前缀(SJ商机)+类型切换自动编号 |
| 2026-07-13 | v2026.07.13-beta9 | feat: 快速检索增强—模糊搜索(OR)+三维搜索(AND)分区+topbar快捷入口 |
| 2026-07-13 | v2026.07.13-beta8 | feat: 客户详情表格增强—项目/产品编号重命名+产品/项目信息交叉列+仅编号可点击 |
| 2026-07-13 | v2026.07.13-beta7 | fix: 项目/产品总览搜索忽略类型筛选—直接搜索全部数据 |
| 2026-07-13 | v2026.07.13-beta6 | feat: 用户管理增加上次登录列+changelog增量修复—seen_version未找到时限制3条 |
| 2026-07-13 | v2026.07.13-beta5 | style: 进度圆环统一增大30%—甘特图36→48+用户中心22→48 |
| 2026-07-13 | v2026.07.13-beta4 | feat: topbar新建任务+新建Bug快捷按钮+项目/产品上下文自动填入+个人中心样式统一 |
| 2026-07-13 | v2026.07.13-beta3 | fix: 预定义阶段删除失败+跨类型误删—排除列表持久化+可删除可恢复 |
| 2026-07-13 | v2026.07.13-beta2 | fix: 客户详情关联产品统计为0—间接路径customer→project→product+表格序号列+表头颜色变体 |
| 2026-07-13 | v2026.07.13-beta1 | fix: #86 客户管理项目/产品数点击跳转客户详情+客户管理跳转+skill脚本密码修复 |
| 2026-07-10 | v2026.07.10-beta1 | fix: #97 GitLab项目路径可配置+启动自检—硬编码替换+数据源配置页+连接失败自动stop |
| 2026-07-08 | v2026.07.08-beta16 | feat: Bug弹窗布局重构—90%宽+80vh黄金比例+描述左50%+工时分析右50%堆叠+编辑字段全带入 |
| 2026-07-08 | v2026.07.08-beta12 | feat: 个人中心统计增强—Bug统计卡片+任务/Bug饼图联动tab+状态下拉+空白卡0值保留 |
| 2026-07-08 | v2026.07.08-beta9 | feat: 个人中心布局重构—任务/Bug并排等高+产品列+产品项目双过滤AND逻辑 |
| 2026-07-08 | v2026.07.08-beta6 | feat: 个人中心Bug增强—task-tabs待处理/我创建分类+11列表格对齐bug管理页+数量徽章 |
| 2026-07-08 | v2026.07.08-beta5 | feat: #92,#93,#94 Bug工时编辑+用户名显示+对话框修复+日历合并bug/task工时 |
| 2026-07-08 | v2026.07.08-beta3 | fix: #96 产品删除后收藏数量未同步—_remove_product_from_favorites双路径兜底+历史孤儿数据清理 |
| 2026-07-08 | v2026.07.08-beta2 | feat: #95 用户列表登录状态—内存实时追踪60s窗口+IP/UA记录+bootstrap升级美化 |
| 2026-07-08 | v2026.07.08-beta1 | refactor: 日志系统重构—DB只存操作审计+category标准化常量+补全用户操作审计+server.log轮转 |
| 2026-07-07 | v2026.07.07-beta18 | feat: 关联项目气泡动画—右→左滑动+动态间隔+去底色+animation-fill-mode防初始全显 |
| 2026-07-07 | v2026.07.07-beta16 | fix: 深色模式失效—tokens.css :root块缺少闭合}导致[data-theme="dark"]被丢弃 |
| 2026-07-07 | v2026.07.07-beta12 | feat: 产品详情圆环交互增强—悬停放大+间距16px+点击定位滚动+文档分类高亮脉冲动画 |
| 2026-07-07 | v2026.07.07-beta5 | feat: 产品详情页头部分类进度圆环—每个stage_type独立计算完成率 |
| 2026-07-07 | v2026.07.07-beta5 | fix: 产品详情跳转自动定位修复—所属分类→产品管理+文档模板→doc-templates双路径L3→L2 |
| 2026-07-06 | v2026.07.07-beta5 | feat: vsdx预览支持+产品框图直接内嵌渲染设计框图vsdx |
| 2026-07-06 | v2026.07.06-beta14 | feat: 产品框图改为下拉展开预览产品规格书+MCP发现协议硬性门槛化 |
| 2026-07-06 | v2026.07.06-beta13 | fix: 收藏操作失败—toggleFav乐观更新不回滚+旧格式favorites兼容+失败toast提示 |
| 2026-07-06 | v2026.07.06-beta12 | fix: 个人中心工时日历颜色柱状图缺失—日期范围本周→整月+月份导航数据同步 |
| 2026-07-06 | v2026.07.06-beta9 | feat: #84+#88+seen_version数据库化+changelog弹窗简化+导航按钮固定位置 |
| 2026-07-06 | v2026.07.06-beta8 | feat: #84产品笔记框图位置交换+#88更新日志导航优化+seen_version数据库化+changelog逻辑简化 |
| 2026-07-06 | v2026.07.06-beta7 | feat: docx→PDF LibreOffice转换+预览流程优化+SVN文档获取BasicAuth修复 |
| 2026-07-06 | v2026.07.06-beta5 | feat: SVN元数据优化—北京时间格式化+Rev追踪+变更自动记入产品活动 |
| 2026-07-06 | v2026.07.06-beta4 | feat: SVN文档元数据—PROPFIND获取提交人+修改时间+产品详情文档列表展示 |
| 2026-07-06 | v2026.07.06-beta3 | feat: 清除SVN功能移至src-menu+单源同步统一预清除+全部location清除+log_audit等级+删除无用pma.db |
| 2026-07-06 | v2026.07.06-beta2 | feat: SVN同步日志区分类型+预清除location+清除调试按钮+发布同步启用 |
| 2026-07-06 | v2026.07.06-beta1 | feat: 禅道发布同步开关+区分发布同步与URL校验+附件免鉴权+图片粘贴HTML标签 |
| 2026-07-05 | v2026.07.05-beta5 | feat: Bug模板管理+默认模板+GitLab提交/同步+关联同步+Markdown预览+布局4列 |
| 2026-07-05 | v2026.07.05-beta4 | fix: Bug组件加载修复+备份含uploads+docs/db.md更新10张新表 |
| 2026-07-05 | v2026.07.05-beta3 | feat: Bug系统Markdown渲染+附件上传+图片粘贴+看板拖拽+备份含uploads |
| 2026-07-05 | v2026.07.05-beta2 | refactor: 搜索下拉标准化—createSearchCombo通用组件+Enter回车选中+SKILL文档 |
| 2026-07-05 | v2026.07.05-beta1 | feat: PMA本地Bug系统—5表模型+17API+前端列表/看板/详情/个人中心 |
| 2026-07-04 | v2026.07.04-beta6 | feat: #81 命名规范字段自动添加为产品标签+seed标签模板+创建时自动勾选 |
| 2026-07-04 | v2026.07.04-beta5 | feat: 命名规范编号改为下拉选择(0-9/A-Z)+去重+后端校验 |
| 2026-07-04 | v2026.07.04-beta4 | feat: #18 产品命名规范可配置+S KILL文档统一MCP优先探索协议 |
| 2026-07-04 | v2026.07.04-beta3 | feat: #80 产品命名规范+自动生成产品型号+#79图标+pma-web-design SKILL |
| 2026-07-04 | v2026.07.04-beta2 | docs: pma-commit SKILL增加codebase-memory索引步骤+CLAUDE.md同步 |
| 2026-07-04 | v2026.07.04-beta1 | fix: #79 用户禁用图标改为SVG矢量禁止图标 |
| 2026-07-03 | v2026.07.03-beta7 | feat: 个人中心铺满宽度+任务操作列+新建任务按钮 |
| 2026-07-03 | v2026.07.03-beta6 | feat: 工时超预算填预计还需要+超时显示原计划+编辑页预填修复 |
| 2026-07-03 | v2026.07.03-beta5 | feat: 任务超预算改为review+延长预估API+原计划耗时+工时用户信息+编辑页重构 |
| 2026-07-03 | v2026.07.03-beta4 | feat: #78 新手引导+版本更新日志+系统changelog API |
| 2026-07-03 | v2026.07.03-beta3 | feat: 顶部标签点击菜单+单源同步+总匹配/新匹配统计+遗留代码清理 |
| 2026-07-03 | v2026.07.03-beta2 | feat: 文档模板路径拆分为base_path+file_pattern+{code}占位符+路径预览+操作日志增强 |
| 2026-07-03 | v2026.07.03-beta1 | fix: SVN文档扫描6项修复—认证/HEAD状态码/通配符全路径匹配/全量回退/模板校验/Depth深度 |
| 2026-07-02 | v2026.07.02-beta12 | feat: SVN文档扫描纳入同步+顶部标签改为悬停tooltip+sync_sources返回同步结果 |
| 2026-07-02 | v2026.07.02-beta11 | feat: 数据源配置卡片折叠为摘要+对话框编辑+操作安全设置改用iOS开关+双列网格 |
| 2026-07-02 | v2026.07.02-beta10 | feat: SVN数据源配置—卡片+topbar标签+启用开关+测试连接+入口移至顶部栏下拉菜单 |
| 2026-07-02 | v2026.07.02-beta9 | feat: OAuth启用开关改为iOS toggleSwitch控件+design-spec§23合规 |
| 2026-07-02 | v2026.07.02-beta8 | fix: SVN配置saveConfig缺少svn:{}导致保存报错 |
| 2026-07-02 | v2026.07.02-beta4 | fix: #76 问题反馈—组件和标题改为必填项，提交时校验 |
| 2026-07-02 | v2026.07.02-beta3 | feat: #75 偏好设置独立卡片+响应式网格布局(auto-fill+minmax) |
| 2026-07-02 | v2026.07.02-beta2 | feat: #74 iOS风格功能开关标准控件+toggleSwitch组件+偏好面板替换+design-spec§23 |
| 2026-07-02 | v2026.07.02-beta1 | feat: #72任务列表+个人中心增加项目名称列 + #71底部滚动告警条+偏好面板(速率/主题) |
| 2026-07-01 | v2026.07.01-beta10 | style: 区块操作按钮统一对齐design-spec §22—btn btn-primary+内联样式替换btn-sm |
| 2026-07-01 | v2026.07.01-beta9 | feat: #70任务对话框分区卡片布局+--red→--danger+按钮规范对齐+pma-frontend-rules SKILL重写 |
| 2026-07-01 | v2026.07.01-beta5 | feat: #68头像→个人中心+#69登录默认个人中心+refactor:版本号meta统一管理 |
| 2026-07-01 | v2026.07.01-beta2 | refactor: JS/CSS缓存版本格式改为与app-version一致的vYYYY.MM.DD-betaN，更新CLAUDE.md+pma-version SKILL.md |
| 2026-07-01 | v2026.07.01-beta1 | fix: 4 issues—#67产品节点重命名#65完整度红绿#63深色对比度#62自动主题时间切换 |
| 2026-06-30 | v2026.06.30-beta13 | feat: 用户中心任务列表对齐PMA任务页 |
| 2026-06-30 | v2026.06.30-beta12 | refactor: zenta_表重命名—pma_customers+pma_products |
| 2026-06-30 | v2026.06.30-beta11 | fix: 客户名显示去冗余—4处拼接移除customer_name旧文本，仅用FK关联 |
| 2026-06-30 | v2026.06.30-beta10 | feat: 三类标签统一风格+淡紫产品/琥珀客户+全部支持点击跳转 |
| 2026-06-30 | v2026.06.30-beta9 | feat: 收藏星移至名字前+金黄色+星光增强+关联产品标签统一prod-link-chip |
| 2026-06-30 | v2026.06.30-beta8 | feat: KPI卡片分两行—收藏单独卡片+过滤互斥+布局1:1:1 |
| 2026-06-30 | v2026.06.30-beta7 | feat: favStar统一收藏组件—矢量SVG+星光动画+项目收藏+详情页收藏+JS缓存规范 |
| 2026-06-30 | v2026.06.30-beta6 | feat: 产品收藏持久化—localStorage→DB+GET/PUT /api/auth/favorites |
| 2026-06-30 | v2026.06.30-beta5 | style: 嵌入式任务工具栏—删除列表按钮+新建/批量按钮放大为规范风格 |
| 2026-06-30 | v2026.06.30-beta4 | feat: 项目编号统一使用DB code字段+按钮风格+projCodeTag全站可点击跳转 |
| 2026-06-30 | v2026.06.30-beta3 | feat: 饼图conic-gradient+看板拆分为双卡片+项目Top3编号+日期规范统一 |
| 2026-06-30 | v2026.06.30-beta1 | feat: 个人中心日历—月视图+工时强度+柱状填充+日期点击详情+toISOString全量修复 |
| 2026-06-29 | v2026.06.29-beta11 | feat: 用户中心页面重构—Profile栏+任务表格+工时日历+Bug预留+GitLab/安全面板 |
| 2026-06-29 | v2026.06.29-beta10 | feat: 任务进度手动管理—新增progress字段+工时时同步更新进度 |
| 2026-06-29 | v2026.06.29-beta9 | fix: 任务详情加载失败—_worklog_dict/_comment_dict未导入 |
| 2026-06-29 | v2026.06.29-beta8 | refactor: 全局对话框关闭按钮统一—6处原始.remove()改为对应close函数 |
| 2026-06-29 | v2026.06.29-beta7 | feat: 任务列表重构—项目列+进度独立+看板双饼图+删除分组行+stage保存修复 |
| 2026-06-29 | v2026.06.29-beta6 | style: 全局表格td内容默认居中对齐—proj-table+stage-table统一center |
| 2026-06-29 | v2026.06.29-beta5 | fix: 任务管理完善—stage_name保存+负责人搜索下拉+查看视图+进度环形组件+closeSharedDialog迁移 |
| 2026-06-29 | v2026.06.29-beta3 | fix: 自定义项目类型阶段支持—get_stage_types_for_project查db+对话框切换项目刷新阶段 |
| 2026-06-29 | v2026.06.29-beta2 | feat: 批量创建任务优化—项目搜索+全要素对齐+同上按钮+对话框自适应宽度 |
| 2026-06-29 | v2026.06.29-beta1 | feat: PMA原生任务管理系统—Task/WorkLog/Comment模型+CRUD+三视图+工时日历 |
| 2026-06-29 | v2026.06.29-beta1 | refactor: 搜索下拉提取为公共组件+项目/产品/任务三页统一复用 |
| 2026-06-27 | v2026.06.27-beta4 | fix: _getEffectiveTheme兜底默认值light→auto—与系统主题保持一致 |
| 2026-06-27 | v2026.06.27-beta3 | refactor: 视图注册表+按需加载JS+导航栏权限过滤—gotoView精简为通用分发器 |
| 2026-06-27 | v2026.06.27-beta2 | fix: 权限审计—修复/api/maintenance/customers未认证漏洞+补全VIEW_PERMS |
| 2026-06-27 | v2026.06.27-beta1 | refactor: 提取canAccess()权限检查函数—消除gotoView中9处重复样板代码 |
| 2026-06-23 | v2026.06.23-beta5 | feat: 永久备份最大保留数量配置—max_permanent_count限制+超量自动清理 |
| 2026-06-23 | v2026.06.23-beta4 | feat: 阶段拖拽排序+save/discard修复project_type丢失问题 |
| 2026-06-23 | v2026.06.23-beta3 | feat: 自定义项目类型全局可用—移除所有RD/SC硬编码+动态KPI/分类/下拉/标签 |
| 2026-06-23 | v2026.06.23-beta2 | feat: 多项目类型模板—DocumentTemplate新增project_type字段+动态Tab+自定义项目类型 |
| 2026-06-23 | v2026.06.23-beta1 | refactor: 导航栏文档模板→项目&模板管理—页面定位为管理项目类型/阶段/文档模板 |
| 2026-06-22 | v2026.06.22-beta7 | fix: 批量解决#31#32#34#35#36#38—模板跳转/日志分类/表头sticky/密码确认/Ctrl+K搜索/反馈选项 |
| 2026-06-22 | v2026.06.22-beta6 | feat: Issue解决流程文档化+GitLab issue查询API—AI可自动获取issue详情 |
| 2026-06-22 | v2026.06.22-beta5 | refactor: 清理旧issue模板+功能建议描述改为"详细描述" |
| 2026-06-22 | v2026.06.22-beta4 | feat: 反馈对话框组件选项对齐左侧导航栏—动态提取+标题[组件]前缀 |
| 2026-06-22 | v2026.06.22-beta3 | feat: 进度明细表格化—时间/用户名/操作类型/明细四列表头排序过滤+detail格式name:'old'->'new' |
| 2026-06-22 | v2026.06.22-beta2 | feat: 停服通知+重启强制重登—红色闪烁横幅+JWT重启校验+每5秒轮询 |
| 2026-06-21 | v2026.06.21-beta1 | feat: 项目编辑/删除+产品进度明细—ProductActivity记录所有产品状态变更 |
| 2026-06-18 | v2026.06.18-beta11 | fix: 项目详情/列表客户信息修复—从CustomerProjectLink关联表解析PMA手动关联的客户 |
| 2026-06-18 | v2026.06.18-beta10 | feat: 基本信息卡片全组件hover动画—dkpi+card+card-pad统一蓝色聚焦反馈 |
| 2026-06-18 | v2026.06.18-beta9 | refactor: 基本信息卡片移除PMA本地标签—来源标记仅保留项目标题旁 |
| 2026-06-18 | v2026.06.18-beta8 | refactor: 取消从禅道自动获取客户信息—客户仅通过PMA手动关联 |
| 2026-06-18 | v2026.06.18-beta7 | docs: 数据库文档补充备份机制—自动定时备份+操作前安全快照+永久备份 |
| 2026-06-18 | v2026.06.18-beta6 | refactor: 统一文档目录—db.md从doc/迁移到docs/；更新CLAUDE.md路径引用 |
| 2026-06-15 | v2026.06.15-beta1 | feat: 产品管理页面—产品树+关联产品/项目+本地创建+关联管理；文档模板去产品维护；导航栏滑动优化 |
| 2026-06-11 | v2026.06.11-beta9 | feat: 文档模板三Tab改造—项目/产品文档模板+标签模板，弹窗表单，去右上角X |
| 2026-06-11 | v2026.06.11-beta8 | fix: 文档模板左侧阶段类型点击区域扩大至整行，Closes #10 |
| 2026-06-11 | v2026.06.11-beta7 | feat: 反馈弹窗新增GitLab链接(↗ GitLab按钮) + 提交反馈toast链接可点击 |
| 2026-06-11 | v2026.06.11-beta6 | fix: 文档模板配置页权限检查改为permissions而非role，修复CTO等非admin/pm角色无法编辑 |
| 2026-06-11 | v2026.06.11-beta5 | fix: _sync_from_templates Phase1+2全量去重 + 占位文档清理 + stage_type更新 + sync-all端点+前端按钮 |
| 2026-06-11 | v2026.06.11-beta4 | fix: _sync_from_templates 增加去重—同execution_id+doc_name重复行自动清理 |
| 2026-06-11 | v2026.06.11-beta3 | fix: _sync_from_templates 修复—清理未匹配执行的孤立文档+更新跨阶段保留文档的stage_type |
| 2026-06-11 | v2026.06.11-beta2 | 移除项目名列中多余的PE编号显示（dashboard/product/topology），PE编号仅保留在项目编号列 Closes #11 |
| 2026-06-11 | v2026.06.11-beta1 | 项目总览表格风险列移至计划完成列之后 |
| 2026-06-11 | v2026.06.10-beta7 | 项目完成四条件严格判定（禅道done+文档齐套+任务100%+阶段精确匹配无异常）+ docs/status-conditions.md Closes #9 |
| 2026-06-10 | v2026.06.10-beta6 | 项目完成判定增加文档齐套检查：资料不全→状态"待完善"+风险"资料不全" Closes #9 |
| 2026-06-10 | v2026.06.10-beta5 | 弹窗全局改造：backdrop-filter背景模糊+禁止点击外部关闭+自动聚焦+ESC不关闭弹窗 Closes #5 |
| 2026-06-10 | v2026.06.10-beta4 | 系统日志时区修复：server.sh TZ=Asia/Shanghai + DatabaseLogHandler BEIJING_TZ |
| 2026-06-10 | v2026.06.10-beta3 | 数据源标签tooltip权限分级：admin/PM看详情，其他用户仅简要状态 |
| 2026-06-10 | v2026.06.10-beta2 | 同步按钮权限控制：CSS !important修复+默认隐藏+仅admin/sync显示+require_perm |
| 2026-06-10 | v2026.06.10-beta1 | 主题切换移至用户菜单+同步通知拆分为3源实时独立toast+phase检测 |
| 2026-06-09 | v2026.06.09-beta16 | Bug反馈对话框：类型/组件多选/指派给(GitLab成员+自动指派)+创建Issue API |
| 2026-06-09 | v2026.06.09-beta15 | 浏览器前进/后退键支持：history.pushState+popstate+URL hash路由 |
| 2026-06-09 | v2026.06.09-beta14 | _sync_from_templates Phase2 无执行阶段占位文档；_extract_gitlab_url href属性提取；outerjoin |
| 2026-06-09 | v2026.06.09-beta13 | GitLab 发布统计页：5 KPI 卡片+描述来源列；_sync_releases 去筛选同步全部产品 |
| 2026-06-09 | v2026.06.09-beta12 | GitLab 集成完成：Release 同步+URL 校验+告警+3 源独立通知；阶段类型独立持久化+0 模板可见 |
| 2026-06-09 | v2026.06.09-beta11 | GitLab 集成详细计划（Phase 2.1 A-E）+ `docs/gitlab-api.md` 开发手册 |
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
| 2026-06-03 | v2026.06.03-beta5 | 待办：项目研发/生产分类待确定来源 |
| 2026-06-03 | v2026.06.03-beta6 | 上线准备：README+清理.env.example硬编码+移除pm-platform.html+docker-compose生产化 |
| 2026-06-03 | v2026.06.03-beta7 | GitLab Issue/MR模板(.gitlab/issue_templates+Bug/Feature+MR Checklist) |
| 2026-06-04 | v2026.06.04-beta1 | 产品详情4卡片点击跳转禅道+Bug/Release专用URL+产品链接格式统一 |
| 2026-06-04 | v2026.06.04-beta2 | 角色组权限系统：Role/UserRole表+15角色+4权限+多对多关联+权限管理页+单表格calc(100vh-Npx)规范 |
| 2026-06-06 | v2026.06.06-beta1 | 批量添加用户+角色组搜索+passlib→bcrypt修复+前端bug修复 |
| 2026-06-06 | v2026.06.06-beta2 | 批量用户重构：5行默认+下拉多选+标签删除+回滚+路由修复+全局异常日志 |
| 2026-06-06 | v2026.06.06-beta3 | 文档全面更新：dev-plan重组+design-spec新增§17-18+deploy-guide API端点补充+requirements-spec版本1.2 |
| 2026-06-06 | v2026.06.06-beta4 | Dashboard全部卡片显示项目筛选配置(ZENTAO_PROJECT_FILTER) |
| 2026-06-06 | v2026.06.06-beta5 | 客户管理CRUD+项目维护Tab(关联产品/客户+搜索多选+密码确认)+CustomerProductLink |
| 2026-06-06 | v2026.06.06-beta6 | 客户详情页+双栏布局+实体颜色一致性(.gs-cust/proj/prod)+设计规范§19+快速检索客户链路修复 |
| 2026-06-06 | v2026.06.06-beta7 | customer_name全链路修复(CustomerProjectLink)+快速检索产品按钮+gotoCustomerProjects→openCustomerByName |
| 2026-06-06 | v2026.06.06-beta8 | 操作日志(AuditLog)+密码验证可配置(PmaSetting+6开关)+设计规范§19+关键操作密码确认 |
| 2026-06-06 | v2026.06.06-beta9 | 文档齐套性(DocumentTemplate+ProjectDocument+模板配置页)+交付状态修复(planned vs actual)+告警集成 |
| 2026-06-06 | v2026.06.06-beta10 | 标准阶段驱动(需求文档10/8阶段)+子串匹配恢复+阶段缺失/模糊/非标准告警+stage_name映射API |
| 2026-06-06 | v2026.06.06-beta11 | 模糊匹配阶段在风险列添加告警标记(⚠请修改禅道阶段名)+点击弹窗提示标准名 |
| 2026-06-06 | v2026.06.06-beta12 | 阶段名列清理(告警仅保留在风险列)+甘特图同步标准阶段驱动+缺失/模糊/非标准告警 |
| 2026-06-06 | v2026.06.06-beta13 | 超期阶段视觉警示:甘特图底部红色边框(gantt-overdue)+阶段详情状态列⚠超期标记 |
| 2026-06-06 | v2026.06.06-beta14 | 修复超期检测遗漏:非标准阶段(unmatched)也纳入超期检查范围 |
| 2026-06-06 | v2026.06.06-beta15 | 深色模式甘特图月份颜色修复:12个月份背景+网格替换为深色调(data-theme=dark) |
| 2026-06-06 | v2026.06.06-beta16 | 文档模板:责任人下拉选择+序号修复+阶段类型重命名/新增/删除API+UI |
| 2026-06-06 | v2026.06.06-beta17 | 新增权限:doc_template(文档模板配置)+stage_mapping(阶段映射)+pm/test_delivery角色分配 |
| 2026-06-07 | v2026.06.06-beta18 | 模糊匹配告警框显示精确目标名(请修改为:xxx)+showStageNameEdit预选 |
| 2026-06-07 | v2026.06.06-beta19 | 登录页跟随系统主题(prefers-color-scheme)+首次访问自动匹配+作为默认主题 |
| 2026-06-07 | v2026.06.06-beta20 | 文档齐套阶段名gs-btn风格+execution_url跳转+openDialog通用弹窗+告警对话框代码复用 |
| 2026-06-07 | v2026.06.06-beta21 | 文档模板添加/编辑逻辑修复:search-inp序号padding覆盖+sort=0处理+空指针保护+table-scroll取消高度限制 |
| 2026-06-07 | v2026.06.06-beta22 | 文档模板批量保存(保存配置按钮)+放弃更改+审计日志(log_audit) |
| 2026-06-07 | v2026.06.06-beta23 | 阶段名显示改为禅道原始名+取消映射按钮+仅告警提醒+回读校验+同步后异常通知 |
| 2026-06-07 | v2026.06.06-beta24 | 文档齐套:文件名列增加输出件图标+阶段列匹配状态指示+后端新增match_kind |
| 2026-06-08 | v2026.06.06-beta25 | 项目进度明细Tab+ProjectActivity日志+维护/交付操作记录+产品禅道链接f=dashboard |
| 2026-06-08 | v2026.06.06-beta26 | 项目列表新增风险等级列(正常/较低/中/高/已超期)+进度vs时间比较算法 |
| 2026-06-08 | v2026.06.06-beta27 | 文档齐套:列宽自适应+表头sticky+文档名title悬停说明+关键词匹配+docs.append修复 |
| 2026-06-08 | v2026.06.06-beta28 | 交付记录弹窗+产品下拉+编号动态行+序号+数量自动+PMA用户+客户下拉+search-inp对齐修复 |
| 2026-06-08 | v2026.06.08-beta29 | 流程规范子页面(ProcessStandard)+规则弹窗编辑+版本规则更新(日期自动更新)+search-inp对齐 |
| 2026-06-08 | v2026.06.08-beta30 | 权限控制:PM隐藏用户/权限/配置/日志导航项,仅显示文档模板+流程规范 |
| 2026-06-08 | v2026.06.08-beta31 | 操作日志详情:删除操作提前读取记录详情+log_audit异常日志+delivery edit日志 |
| 2026-06-08 | v2026.06.08-beta32 | 操作日志分类过滤:category(项目/产品/客户/工具/管理)+level(高/中/低)+搜索+分页 |
| 2026-06-08 | v2026.06.08-beta33 | 权限全面检查:customers页面customer_link守卫+侧边栏无权限隐藏+权限调试角色标签映射 |
| 2026-06-08 | v2026.06.08-beta34 | 表格设计规范:th居中nowrap+td左对齐垂直居中+列间竖线+设计规范文档§20 |
| 2026-06-08 | v2026.06.08-beta35 | 全局ESC快捷键:首次退出输入+二次关闭弹窗+三次清空搜索 |
| 2026-06-08 | v2026.06.08-beta36 | 配置页面批量保存:权限+标准+浮动保存栏+改动标记+放弃按钮+导航确认 |
| 2026-06-08 | v2026.06.08-beta37 | 用户管理:用户名统一字体+角色组管理表(增删改)+POST/DELETE roles API |
| 2026-06-08 | v2026.06.08-beta38 | 角色组管理:用户数可点击弹出成员列表 |
| 2026-06-08 | v2026.06.08-beta39 | public权限隐式化+双Tab+KPI卡片+序号列+角色排序+按钮成员管理+权限列改特殊权限 |
| 2026-06-08 | v2026.06.08-beta40 | admin权限显式化+不可修改+权限管理恢复保存栏+角色成员标签式选择 |
| 2026-06-08 | v2026.06.08-beta41 | 用户管理KPI卡片过滤+权限管理双Tab(按角色组/按权限)+角色成员标签选择 |
| 2026-06-08 | v2026.06.08-beta42 | 按权限视图支持交互修改:复选框切换角色权限+保存联动+schema更新 |
| 2026-06-08 | v2026.06.08-beta43 | 文档模板编辑修复:负ID本地编辑更新pending add而非创建新条目+删除tempID支持 |
| 2026-06-09 | v2026.06.09-beta1 | 文档模板动态同步+甘特图今日线呼吸效果+阶段详情同步修复 |
| 2026-06-09 | v2026.06.09-beta2 | permission fix
| 2026-06-09 | v2026.06.09-beta9 | 甘特图边框2px→1.5px细20%+fill覆盖边框区消除空隙 |
| 2026-06-11 | v2026.06.11-beta10 | deploy: 多session并行开发支持—端口隔离(p参数+数据按端口区分)+分支标识(badge+API)+IP自动检测 |
| 2026-06-11 | v2026.06.11-beta11 | docs: AI开发指南CLAUDE.md—整合19条规则/记忆为9章（项目概述+并行开发+commit规范+版本管理+前端规则+环境+Bug流程+速查） |
| 2026-06-11 | v2026.06.11-beta12 | docs: Merge流程修正—合入trunk后不自动push，push需用户单独指令 |
| 2026-06-11 | v2026.06.11-beta13 | docs: worktree触发规则改为`worktree:`前缀—用户显式前缀触发隔离开发，普通prompt直接在当前分支操作 |
| 2026-06-11 | v2026.06.11-beta14 | docs: worktree分支必须从trunk最新提交创建；feat: 项目维护增加标签功能—从标签模板选择并单击切换 |
| 2026-06-11 | v2026.06.11-beta15 | feat: 项目维护三个按钮改为对话框形式（客户单击切换+标签分类单击切换+产品checkbox确认）；server.sh支持多实例状态查看和批量停止 |
| 2026-06-11 | v2026.06.11-beta16 | docs: 重构并行开发约定—核心概念(每个worktree=独立开发者)+merge流程修正(三阶段)+多实例管理命令+清理指导+边界情况 |
| 2026-06-11 | v2026.06.11-beta16 | fix: saveAllProductChanges未处理add_line/delete_line导致产品线删除不生效 |
| 2026-06-11 | v2026.06.11-beta17 | fix: 登录页显示服务端错误详情(detail)；trunk分支server.sh强制使用默认端口 |
| 2026-06-11 | v2026.06.11-beta18 | fix: 产品线新增pma_product_lines表持久化+get_product_lines移除CachedProduct依赖+add_line/delete_line前后端全链路修复 |
| 2026-06-11 | v2026.06.11-beta19 | fix: 权限管理保存跳过admin+未修改+后端审计日志 |
| 2026-06-11 | v2026.06.11-beta20 | fix: 全面端口隔离—DB/日志/配置文件默认值按PMA_PORT区分，消除pma.db硬编码 |
| 2026-06-11 | v2026.06.11-beta21 | feat: 产品文档模板3层架构(product_line→product_series→product_model)+parent_id树形结构+级联删除 |
| 2026-06-12 | v2026.06.12-beta1 | fix: 权限检查修复—前端admin判断改为同时检查permissions聚合权限+页面刷新时同步最新用户权限 |
| 2026-06-12 | v2026.06.12-beta1 | fix: 权限检查修复—前端admin判断改为同时检查permissions聚合权限+页面刷新时同步最新用户权限 |
| 2026-06-12 | v2026.06.12-beta2 | feat: 数据源配置下拉菜单—同步按钮改为数据源配置+项目筛选对话框+project-filter API权限sync |
| 2026-06-15 | v2026.06.15-beta1 | feat: 产品管理页面—产品树+关联管理+本地创建，文档模板去产品维护，导航栏优化 |
| 2026-06-15 | v2026.06.15-beta2 | feat: 反馈对话框新增版本信息—version号+git commit hash自动获取并写入issue描述 |
| 2026-06-15 | v2026.06.15-beta3 | feat: 产品管理操作日志优化+删除/编辑密码校验—审计详情人可读+密码验证 |
| 2026-06-15 | v2026.06.15-beta4 | fix: 审计日志分类修正—产品/项目/客户/用户日志从管理分类改为对应业务分类 |
| 2026-06-15 | v2026.06.15-beta5 | feat: 产品来源标记—API返回is_local+synced_at+前端禅道同步/本地标签+来源列可过滤 |
| 2026-06-15 | v2026.06.15-beta6 | feat: 产品管理页面布局重构—2级产品导航+上下文操作+面包屑可点击+对话框样式优化 |
| 2026-06-18 | v2026.06.18-beta5 | refactor: multiSelectDialog工厂函数—4个对话框统一迁移+设计规范§15.1重写+旧辅助函数清理 |
| 2026-06-18 | v2026.06.18-beta4 | feat: 项目详情来源标记—is_local字段+PMA本地标签/禅道链接+基本信息tab来源显示 |
| 2026-06-18 | v2026.06.18-beta3 | refactor: 模块化UI组件—CSS class(btn-sm/xs/icon)+JS工厂(sectionHeader/iconBtn/linkChip)+全站内联按钮消除 |
| 2026-06-18 | v2026.06.18-beta2 | feat: 统一区块操作按钮规范—btn-primary蓝色按钮右上角布局+section-hd计数+维护tab对齐 |
| 2026-06-18 | v2026.06.18-beta1 | feat: 项目详情软硬件资料改为产品文档tab—显示关联产品列表+点击跳转产品文档tab |
| 2026-06-17 | v2026.06.17-beta26 | fix: 产品详情所属分类点击跳转产品管理页面并定位到对应L2节点 |
| 2026-06-17 | v2026.06.17-beta25 | feat: 项目详情新增基本信息tab—KPI卡片布局+项目背景+关联产品/项目+交付数量+本地标签描述 |
| 2026-06-17 | v2026.06.17-beta24 | fix: 产品总览点击进入产品详情默认打开基本信息tab |
| 2026-06-17 | v2026.06.17-beta23 | feat: 备份永久保存机制—自定义小时间隔+permanent目录隔离+滚动清理保护+旧值自动迁移；设计规范新增图标按钮优先原则 |
| 2026-06-17 | v2026.06.17-beta22 | feat: 产品详情页产品框图组件—上传/查看/放大/删除，product_link权限控制+密码确认删除 |
| 2026-06-17 | v2026.06.17-beta17 | feat: 多选对话框统一搜索过滤设计规范(searchable-item+_filterSearchableItems) |
| 2026-06-17 | v2026.06.17-beta16 | feat: 产品维护页关联客户+按钮统一风格+关联项目点击跳转+标签API路径修复 |
| 2026-06-17 | v2026.06.17-beta15 | feat: 产品描述改为标签多选(PmaTag)+搜索标签+ESC清空+全局Ctrl+K拦截 |
| 2026-06-17 | v2026.06.17-beta14 | feat: 产品文档独立tab+基本信息KPI风格统一+状态颜色区分 |
| 2026-06-17 | v2026.06.17-beta13 | feat: 产品详情基本信息KPI卡片风格+分类点击跳转+描述行对齐+tree_path修复 |
| 2026-06-17 | v2026.06.17-beta12 | feat: 产品总览卡片式布局—L1/L2/tab切换+搜索过滤展开+深浅适配+响应式grid |
| 2026-06-17 | v2026.06.17-beta11 | feat: 快速检索搜索框前增加类型标签(项目/产品/客户)+字体加大+搜索图标流式布局 |
| 2026-06-17 | v2026.06.17-beta10 | feat: 项目详情标题行展示关联产品标签(可点击跳转)+get_project_detail返回linked_products |
| 2026-06-17 | v2026.06.17-beta9 | feat: 产品维护tab支持编辑/删除/关联项目/标签管理+ProductUpdate扩展字段 |
| 2026-06-17 | v2026.06.17-beta8 | feat: 产品管理操作列图标化+编辑对话框+删除产品+审计日志详情可读 |
| 2026-06-17 | v2026.06.17-beta7 | feat: 产品编号徽章按钮跳转详情+L2节点产品数量徽章+L1取消数量 |
| 2026-06-17 | v2026.06.17-beta6 | feat: 产品导航树L1/L2节点拖拽排序+管理员权限+同级内限制 |
| 2026-06-17 | v2026.06.17-beta5 | feat: 删除禅道产品+禁用产品同步+标题数量徽章+清除L3空节点 |
| 2026-06-17 | v2026.06.17-beta4 | feat: 文档类型默认GitLab+placeholder联动+责任人必填+对话框风格统一 |
| 2026-06-24 | v2026.06.25-beta7 | refactor(ui): 操作按钮标准化—iconEdit等标准组件+全页面统一
| 2026-06-25 | v2026.06.25-beta6 | feat(feedback): 反馈对话框支持粘贴图片上传到GitLab
| 2026-06-25 | v2026.06.25-beta5 | fix(ui): 项目编号统一projCodeTag风格+等宽字体+返回定位行
| 2026-06-25 | v2026.06.25-beta4 | feat(ui): 用户中心优化—GitLab账户卡片+权限安全卡片
| 2026-06-25 | v2026.06.25-beta3 | fix(auth): 反馈Issue以登录用户身份提交+个人token+Bearer认证
| 2026-06-25 | v2026.06.25-beta2 | chore(security): 敏感配置gitignore+env.example清理
| 2026-06-25 | v2026.06.25-beta1 | feat(docs): 文档在线预览
| 2026-06-24 | v2026.06.24-beta6 | docs(skills): CLAUDE.md强化skill触发规则+4个skill改为user-invocable
| 2026-06-24 | v2026.06.24-beta5 | fix(auth): GitLab用户权限UI失效—user.role(legacy)改为permissions检查 |
| 2026-06-24 | v2026.06.24-beta4 | fix(ui): 多客户名(、分隔)点击查找逐个搜索 |
| 2026-06-24 | v2026.06.24-beta3 | style(ui): 主题切换移至铃铛旁(月亮/太阳图标)，从用户中心移除 |
| 2026-06-24 | v2026.06.24-beta2 | feat(auth): 切换账号—退出PMA+引导退出GitLab，删除退出登录 |
| 2026-06-24 | v2026.06.24-beta1 | feat(ui): 用户中心独立页面+主题配置保存按钮+登录页GitLab logo优化 |
| 2026-06-23 | v2026.06.23-beta16 | feat(notif): 一般/重要通知发布权限开放给所有登录用户 |
| 2026-06-23 | v2026.06.23-beta15 | perf(ui): GitLab登录弹窗优化—居中弹窗替代整页跳转 |
| 2026-06-23 | v2026.06.23-beta14 | refactor(time): 系统时间统一配置—config.py单一时区来源+修复UTC展示bug |
| 2026-06-23 | v2026.06.23-beta13 | style(ui): GitLab登录按钮使用GitLab官方logo图标 |
| 2026-06-23 | v2026.06.23-beta12 | refactor(log): 操作日志分类动态化—移除硬编码，从DB提取 |
| 2026-06-23 | v2026.06.23-beta11 | fix(auth): 密码确认→输入确认字符串—修复GitLab用户被踢+自定义对话框+复制按钮 |
| 2026-06-23 | v2026.06.23-beta10 | feat(notif): 顶部通知栏—发布通知+级别颜色+管理页面+个人关闭+北京时间规则 |
| 2026-06-23 | v2026.06.23-beta9 | fix(auth): UserInfo schema Optional类型修复 + auth_source NULL回填迁移 |
| 2026-06-23 | v2026.06.23-beta8 | fix(ui): 登录页管理员/GitLab切换bug修复 |
| 2026-06-23 | v2026.06.23-beta7 | feat(auth): GitLab OAuth 用户认证集成—GitLab登录、自动创建用户、用户中心、权限提示 、Closes #41|
| 2026-06-23 | v2026.06.23-beta6 | refactor(docs): CLAUDE.md模块化—拆分为6个独立skills，删除14个冗余memory文件，从506行精简至127行 |
| 2026-06-17 | v2026.06.17-beta3 | feat: doc_type文档类型属性(模型+模板表单+列表+上传)+SOLIDWORKS类型+按钮式选择+必填 |
| 2026-06-17 | v2026.06.17-beta2 | feat: 产品文档上传对话框(SVN/GitLab/NAS类型选择)+路径显示实际提交位置+图标操作按钮 |
| 2026-06-17 | v2026.06.17-beta1 | feat: ProductDocument模型+产品文档齐套系统+模板匹配跳转+completed_at缺失修复 |
| 2026-06-16 | v2026.06.16-beta17 | fix: releases同步排除PMA本地产品+failed_products统计+前端通知显示 |
| 2026-06-16 | v2026.06.16-beta16 | fix: 项目筛选清理NULL→0归一化+is_local!=True查询+同步失败通知+清理前置+ProductNodeLink导入修复 |
| 2026-06-16 | v2026.06.16-beta15 | feat: 产品详情文档列表stage_type分类+rowspan合并+分色底色+路径链接+上传人/时间/预览占位 |
| 2026-06-16 | v2026.06.16-beta14 | feat: 保存时自动检查并修正序号—按阶段顺序编号1,2,3...缺失自动补edit操作 |
| 2026-06-16 | v2026.06.16-beta13 | feat: 文档模板路径列可点击跳转(新标签页)+产品表格列宽自适应 |
| 2026-06-16 | v2026.06.16-beta12 | feat: 拖动排序仅序号列响应+tab蓝底+默认选首tab+使用说明提示 |
| 2026-06-16 | v2026.06.16-beta11 | feat: 产品文档模板stage_type开发阶段分类+复制模板+图标按钮+迁移server_default修复 |
| 2026-06-16 | v2026.06.16-beta10 | fix: 数据库恢复log_audit顺序修复+API.post返回值适配(只返回data不含code) |
| 2026-06-16 | v2026.06.16-beta9 | feat: 产品文档模板改为pendingOps待保存确认机制—与项目模板一致，closeSharedDialog统一关闭 |
| 2026-06-16 | v2026.06.16-beta8 | feat: 文档模板列表支持拖拽排序—序号自动更新+项目模板pendingOps/产品模板API保存 |
| 2026-06-16 | v2026.06.16-beta7 | feat: 文档模板新增路径(doc_path)必填属性—作为文档索引路径，导入时同步复制 |
| 2026-06-16 | v2026.06.16-beta6 | feat: 文档模板配置—导入模板功能(覆盖模式)，从其他产品系列一键复制文档模板 |
| 2026-06-16 | v2026.06.16-beta5 | feat: 数据库管理页优化—导入点击弹出文件选择+备份恢复+内联进度提示风格统一+按钮自适应 |
| 2026-06-16 | v2026.06.16-beta4 | feat: SQLCipher全数据库加密+Docker Secrets密钥管理+passphrase派生+在线rekey+数据库管理页集成 |
| 2026-06-16 | v2026.06.16-beta3 | docs: CLAUDE.md新增项目文档索引+数据层变更同步db.md规则 |
| 2026-06-16 | v2026.06.16-beta2 | feat: 产品管理页面权限改为product_link+require_any_perm多权限支持，权限页保存栏修复，文档模板添加快捷跳转 |
| 2026-06-16 | v2026.06.16-beta1 | feat: 产品详情页重构—tab式布局基本信息融合产品文档+产品笔记，产品维护tab含关联项目/客户/标签 |
| 2026-06-15 | v2026.06.15-beta8 | feat: 文档模板配置页改为2级产品导航+面包屑点击—与产品管理页布局一致 |
| 2026-06-15 | v2026.06.15-beta7 | feat: 关联已有三级产品对话框—搜索过滤+checkbox多选+全选/取消全选+批量关联 |
| 2026-06-12 | v2026.06.12-beta3 | feat: 数据库管理页面—导出/导入/自动备份配置+备份历史列表 |
| 2026-06-12 | v2026.06.12-beta4 | fix: 时间显示修复—SQLite UTC时间转换为北京时间(UTC+8)+全局to_local_str |
