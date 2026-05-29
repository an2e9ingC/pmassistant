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
- [ ] 交付状态需要 PMA 本地配置（Phase 2）
- [ ] GitLab 集成（commit 统计、发布验证）（Phase 2）
- [ ] 同步进度实时反馈（目前无进度条，Phase 2）

---

## Phase 2: 产品↔项目映射 (2026-05-29 完成)

- [x] FR-005/006: 产品-项目关联管理（link/unlink CRUD）
- [x] 后端: product_service + products router (list/search/update/link)
- [x] 前端: 映射视图（按产品查看 + 按项目查看）、分类筛选、关联弹窗
- [x] Product PMA 扩展字段管理（category, nas_path, git_url, alias_name）
- [ ] 关系图谱可视化（树形/思维导图模式 — 后续增强）
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
| 2026-05-28 | 0.1.0 | Phase 1 主体完成：后端全功能 + 前端 Dashboard + 项目详情 |
| 2026-05-29 | 0.1.1 | 甘特图优化：线性缩放(±1.05)、拖拽平移、固定宽度、双列布局、滚动防抖、版本号 |
| 2026-05-29 | 0.1.2 | 拖拽修复：移除gantt-root overflow:hidden；sticky固定阶段/负责人列 |
| 2026-05-29 | 0.1.3 | Bug修复：ProductProjectLink导入缺失、sync双次fetch任务、N+1查询、硬编码生产URL、sync状态接口权限、空集合清理、openProject重复调用、canceled样式缺失 |
| 2026-05-29 | 0.2.0 | Phase 2+3 完成：产品-项目映射（link CRUD + 前端双模式视图）、交付管理（DeliveryRecord CRUD + 前端增删）、Bug统计（Zentao同步 + 统计面板）、项目报表（周报/月报）、同步进度历史 |
