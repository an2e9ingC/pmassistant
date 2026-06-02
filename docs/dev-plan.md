# PMA 开发计划与进度

## Phase 1: 项目进度视图 (2026-05-28 ~ )

> 目标：对接禅道 REST API，替换 mock 数据，实现 Dashboard + 项目列表 + 项目详情

### 1.1 项目脚手架
- [x] 目录结构、requirements.txt、Dockerfile、docker-compose.yml
- [x] FastAPI 入口 + CORS + 静态文件挂载
- [x] 配置管理（`.env` 自动加载）

### 1.2 数据库层
- [x] SQLAlchemy 引擎 + Session + Base
- [x] 本地模型：`LocalUser`、`SyncLog`
- [x] 禅道缓存模型：`CachedProject`、`CachedExecution`、`CachedTask`、`CachedUser`、`CachedProduct`、`ProductProjectLink`
- [x] 启动时自动建表 + seed 默认 admin 用户

### 1.3 禅道 Client + 同步服务
- [x] `ZentaoClient`：认证、分页、重试、token 过期自动刷新
- [x] `SyncService`：全量同步 users → products → projects → executions → tasks
- [x] Upsert 逻辑：PMA 扩展字段不被同步覆盖
- [x] 手动触发同步（`POST /api/sync/trigger`）+ 同步状态查询（`GET /api/sync/status`）
- [x] 容错处理：日期字段非标准值（如 `长期`）、数值字段带单位（如 `24h`）

### 1.4 认证
- [x] JWT 签发/验证（`/api/auth/login`、`/api/auth/me`）
- [x] bcrypt 密码哈希
- [x] 登录页面（`login.html`）
- [x] 前端 API client（fetch 封装，JWT header，401 跳转登录页）

### 1.5 Dashboard 前后端
- [x] KPI 接口（进行中项目、告警数、交付数、整体进度）
- [x] 项目列表接口（支持搜索 `?search=`、类型筛选 `?type=RD|SC`、分页）
- [x] 告警列表接口（超期、输出件缺失、审核关键字缺失）
- [x] 前端 KPI 卡片渲染
- [x] 前端项目表格（搜索框 + 全部/研发/生产 Tab 切换）
- [x] 前端告警列表渲染
- [x] Loading / Empty / Error 状态处理

### 1.6 项目详情前后端
- [x] 项目详情接口（`/api/projects/{id}`）
- [x] 甘特图接口（`/api/projects/{id}/gantt`）+ 前端渲染
- [x] 阶段详情接口（`/api/projects/{id}/stages`）+ 前端表格
- [x] 文档齐套接口（`/api/projects/{id}/documents`）+ 前端表格
- [x] 交付状态接口（`/api/projects/{id}/delivery`）+ 前端展示
- [x] 资料链接接口（`/api/projects/{id}/resources`）+ 前端快捷跳转
- [x] 项目下拉选择器（可搜索 combobox）
- [x] 责任人显示：从任务指派人聚合去重
- [x] 5 个 Tab 切换

### 1.7 前端模块化
- [x] CSS 拆分：tokens / reset / layout / components / gantt / detail
- [x] JS 拆分：utils / api / auth / components / dashboard / detail / app
- [x] 主题切换（浅色/深色）
- [x] 侧边栏数据源状态
- [x] Toast 通知

### 1.8 部署
- [x] Docker Compose 配置
- [x] 部署文档（`docs/deploy-guide.md`）
- [ ] 生产环境部署验证

### 其他
- [x] 数据库结构文档：对照禅道数据字典，34张表完整定义（EN/ZH），用于后续数据库设计
- [x] 需求规格文档（`docs/requirements-spec.md`）：FR-001~FR-031 完整定义

### 待完成
- [x] 项目代号 `code` 字段在禅道中为空时的回退显示（FR-020）
- [x] 同步按钮禁用 + 文字反馈（防止重复点击）
- [x] 甘特图时间轴动态范围（从阶段数据自动计算）
- [x] 甘特图缩放：Ctrl+滚轮切换日/周/月/季粒度，自动调整时间颗粒度
- [x] 甘特图拖拽：鼠标拖拽平移时间轴
- [x] 甘特图今日居中：渲染后自动滚动到今日位置
- [x] 甘特图双列布局：阶段名称和负责人分两列显示
- [x] 甘特图未开始颜色优化：从灰色改为 #B0B8C9（与背景对比更明显）
- [x] 同步清理：删除禅道中已移除的项目/执行/任务
- [x] 搜索防抖（300ms 延迟减少 API 调用）
- [x] FR-026: Dashboard 4分类筛选卡片（进行中/已完成/高风险/资料不全），点击过滤+颜色联动
- [x] FR-027~029: 产品管理模块（产品列表、标签提取#keyword、产品详情页）
- [x] FR-030~031: 侧边栏"产品"导航 + 产品卡片样式
- [x] 客户信息自动提取：项目名 PE0406-CDLY → CDLY，描述【CDLY】→ CDLY
- [x] CachedCustomer + CustomerProjectLink：客户独立实体表 + 项目关联表
- [x] Customer API：list/detail 端点，支持按客户查询关联项目
- [x] 项目描述/标签提取：CachedProject.description/tags，同步时从禅道desc提取
- [x] 项目列表拆分为 编号/项目名/客户/类型/阶段/状态/进度/计划完成/描述 9列
- [x] 所有表格改为百分比宽度 + auto布局，协调统一
- [x] 侧边栏重组：工作台→项目，新增客户分组，映射页拆分为3个独立视图
- [ ] 交付状态需要 PMA 本地配置（Phase 2）
- [ ] GitLab 集成（commit 统计、发布验证）（Phase 2）
- [ ] 同步进度实时反馈（目前无进度条，Phase 2）

---

## Phase 2: 产品↔项目映射 (2026-05-29 完成)

- [x] FR-005/006: 产品-项目关联管理（link/unlink CRUD）
- [x] 后端: product_service + products router (list/search/update/link)
- [x] 前端: 映射视图（按产品查看 + 按项目查看）、分类筛选、关联弹窗
- [x] Product PMA 扩展字段管理（category, nas_path, git_url, alias_name）
- [ ] 关系图谱可视化（思维导图 SVG 渲染 — 后续增强）
- [ ] 客户维度映射（Phase 2 后续）

## Phase 3: 交付管理 & 报表 (2026-05-29 完成)

- [x] FR-007-011: DeliveryRecord 模型 + CRUD API + 前端交付记录管理
- [x] FR-013: Bug 统计（Zentao bug 同步 + 统计/列表 API + 前端展示）
- [x] FR-015: 项目报表（周报/月报 API + 前端报表视图）
- [x] 同步进度/历史 API（sync/history + 增强 status 含 duration）
- [ ] FR-014: Gitlab 提交统计（需真实 GitLab API）
- [ ] FR-016: 售前项目检测（NAS 监控，需 NAS 路径配置）
- [ ] FR-022: 外协进度跟踪

---

## 变更记录

| 日期 | 版本 | 说明 |
|------|------|------|
| 2026-05-28 | v2026.05.28-beta1 | Phase 1 主体完成：后端全功能 + 前端 Dashboard + 项目详情 |
| 2026-05-29 | v2026.05.29-beta1 | 甘特图优化：线性缩放(±1.05)、拖拽平移、固定宽度、双列布局、滚动防抖、版本号 |
| 2026-05-29 | v2026.05.29-beta2 | 拖拽修复：移除gantt-root overflow:hidden；sticky固定阶段/负责人列 |
| 2026-05-29 | v2026.05.29-beta8 | Bug修复：ProductProjectLink导入、sync双次fetch、N+1查询、硬编码URL、sync权限、空集合清理、openProject重复调用、canceled样式 |
| 2026-05-29 | v2026.05.29-beta9 | Phase 2+3 完成：产品-项目映射、交付管理（DeliveryRecord CRUD）、Bug统计（Zentao同步）、项目报表（周报/月报）、同步进度历史 |
| 2026-05-29 | v2026.05.29-beta11 | 系统日志查看器：RotatingFileHandler+DB双写、日志API（level过滤/搜索）、前端页面（实时刷新/级别筛选）；告警铃铛下拉框 |
| 2026-05-29 | v2026.05.29-beta13 | 数据库日志存储：LogEntry+DatabaseLogHandler、前端下拉选择器+按级别自动刷新、deploy-guide更新日志诊断说明 |
| 2026-05-29 | v2026.05.29-beta14 | DB路径绝对化+权限修复、日志API Depends冲突修复、数据源标签重构移到右上角、server.sh脚本 |
| 2026-05-29 | v2026.05.29-beta17 | 数据源标签UI迭代（独立pill、彩色圆点+边框、深浅主题兼容）、规则完善（no-auto-commit/docs-sync/auto-restart/theme-compat） |
| 2026-05-29 | v2026.05.29-beta20 | Toast通知顶部居中+error手动关闭、铃铛通知队列+未读badge、日志智能滚动、同步按钮文字、数据源标签简化、design-spec.md设计规范文档 |
| 2026-05-29 | v2026.05.29-beta24 | 动态数据源检测(/sync/sources)、项目状态映射(doing→进行中)、产品线同步(/programs)、客户提取(【】标记)、映射页重构(4Tab+侧边栏+可展开树+矩阵+排序)、TODO占位规范 |
| 2026-05-30 | v2026.05.30-beta1 | FR-026~031: Dashboard分类卡片(配色+过滤联动)、产品管理(列表/标签提取/详情)、客户名自动提取(PE0406-CDLY→CDLY)、项目描述#标签提取、列表9列拆分、表格百分比宽度布局、侧边栏重组(项目/产品/客户三分组)、映射页拆分为3独立视图 |
| 2026-05-31 | v2026.05.31-beta1 | 甘特图修复：工具栏移出滚动区、displayWidth确保任意缩放可拖拽、滚轮乘法缩放、日期起点=最早阶段 |
| 2026-05-31 | v2026.05.31-beta2 | 甘特图多层时间轴(年/月/周/日)、12月季节配色、z-index体系重构(head-row>body-row,stage-cell>today-line>bar) |
| 2026-05-31 | v2026.05.31-beta3 | 甘特图：进度圆环列+百分比取整+文本入SVG、Grid对齐、列宽拖拽、阶段名换行、风险列+可点击跳转阶段详情 |
| 2026-06-01 | v2026.06.01-beta1 | 阶段详情：风险判断(getStageRisk)、进度圆环、列序统一(阶段/风险/进度/责任人)；告警：项目编号chip、高风险页筛选、API project_id过滤 |
| 2026-06-01 | v2026.06.01-beta2 | 缩放预设×6/×16/×24(默认×16)、方向感知滚轮吸附、缩放值显式在±按钮间、日视图去重(仅显式日期数字) |
| 2026-06-01 | v2026.06.01-beta3 | 数据源配置页：GET/PUT /api/admin/config、JSON+.env双写、禅道/GitLab/NAS三卡片(蓝/琥珀/绿)、密码显隐+CapsLock提醒、favicon |
| 2026-06-01 | v2026.06.01-beta4 | 客户模块删除：customers.py路由+mapping.js+客户sidebar+6关联视图全删；产品拓扑页：GET /api/topology三维度AND搜索、3搜索框+5列结果表；净减1525行 |
| 2026-06-01 | v2026.06.01-beta5 | 产品列表→产品总览：KPI卡片(产品线动态+4色循环)+表格布局(编号/品名/产品线/状态/项目数/标签)；请选择占位去loading动画 |
| 2026-06-01 | v2026.06.01-beta6 | 产品拓扑→快速检索、移至工具组；报表→工具(含快速检索+统计报告) |
| 2026-06-01 | v2026.06.01-beta7 | Logo系统：logo-mark-light/dark深浅主题自适应、favicon更新、侧边栏品牌区+登录页logo替换、删除旧临时PMA方块 |
| 2026-06-01 | v2026.06.01-beta8 | 项目笔记：project_notes表+CRUD API、弹窗添加(阶段关联下拉)、表格展示(时间/阶段/记录人/内容)；产品详情关联项目移到底部、删除客户信息 |
| 2026-06-01 | v2026.06.01-beta9 | 用户管理：admin_users CRUD API、用户列表表格(添加/编辑/禁用/删除)、角色管理、弹窗表单；display_name废弃统一用username；管理菜单仅admin可见；退出登录移到用户头像 |
| 2026-06-01 | v2026.06.01-beta10 | 禅道MD5认证+权限不足容错跳过、数据源密码明文+眼睛图标、Settings.reload+SyncService重建client、系统日志2s实时刷新+清除(DB+文件)+sticky工具栏 |
| 2026-06-01 | v2026.06.01-beta11 | 同步进度条+两阶段执行(先收集再任务)、详细进度统计(项目/执行/任务)、当前项显示+每50条日志进度 |
| 2026-06-01 | v2026.06.01-beta12 | 项目筛选(config)+暂停/取消同步+执行过滤修复(仅同步筛选范围内执行)、全局executions一次获取+按project过滤 |
| 2026-06-01 | v2026.06.01-beta13 | 产品同步增加过期清理(Stale Product Cleanup)防止数据累加 |
| 2026-06-01 | v2026.06.01-beta14 | 项目编号列排序(⇅▲▼循环)+计划完成排序统一交互设计、后端sort_by支持code |
| 2026-06-01 | v2026.06.01-beta15 | KPI增加total_projects；类型筛选tab移到项目列表右侧+数字(全部25/研发20/生产5) |
| 2026-06-01 | v2026.06.01-beta16 | 同步性能优化：asyncio.gather+Semaphore(20)并发获取任务、三阶段(获取执行→保存执行→并发任务)、耗时7.5min→1min |
| 2026-06-02 | v2026.06.02-beta1 | Bug同步修复(openedBy对象→字符串)+增量跳过未变更执行(raw_json对比)+Bug并发获取+同步耗时计时+转圈圈实时计时+清除数据库缓存按钮+项目筛选优化 |
| 2026-06-02 | v2026.06.02-beta2 | 后台自动同步(可配置间隔)+自动同步完成气泡通知 |
| 2026-06-02 | v2026.06.02-beta3 | 项目列表10行+告警列表5行固定高度局部滚动 |
| 2026-06-02 | v2026.06.02-beta4 | 自动同步30s检查+前端同步进度显示+完成气泡通知+sync_interval持久化修复 |
| 2026-06-02 | v2026.06.02-beta5 | 同步进度提示框紧凑化：单行flex布局+16px spinner+移除进度条，高度对齐顶栏54px |
| 2026-06-02 | v2026.06.02-beta6 | 修复auto_sync_loop缩进bug（try未在if内导致每30s执行）+完成后日志打印下次同步时间 |
| 2026-06-02 | v2026.06.02-beta7 | 甘特图项目起止时间线：后端gantt API返回project_begin/end，前端渲染醒目半透明条+日期文本+JS悬浮提示 |
| 2026-06-02 | v2026.06.02-beta8 | 甘特图项目竖线标记：start绿色虚线+end红色虚线+今日蓝色实线+图例8项说明 |
| 2026-06-02 | v2026.06.02-beta9 | 甘特图进度条改为双层：浅色track（完整周期）+实色fill（完成%），color-mix边框确保track默认可见 |
| 2026-06-02 | v2026.06.02-beta10 | 禅道项目链接修复（index.php?m=project格式）+甘特图阶段按钮跳转高亮+进度条悬浮显示已完成任务n/m+增量同步无任务时重新拉取 |
| 2026-06-02 | v2026.06.02-beta11 | 修复多余</div>导致view-detail提前关闭泄漏所有内容到全局+甘特图提示精简(7/16→9/30+任务:n/m)+风险标签去圆点+简化文字 |
| 2026-06-02 | v2026.06.02-beta12 | 甘特图Ctrl+滚轮缩放，未按Ctrl时滚轮恢复默认滚动行为 |
| 2026-06-02 | v2026.06.02-beta13 | 甘特图竖线去顶部圆点（今日线+项目开始线+项目结束线） |
| 2026-06-02 | v2026.06.02-beta14 | 添加笔记按钮移至标题右侧+阶段高亮修复(内联样式→CSS斑马纹)+呼吸动画6次+行悬停+深浅主题适配 |
