# PMA 开发计划与进度

> 当前版本：v2026.06.29-beta11 | 最后更新：2026-06-29

---

## 总体进度

| 模块 | 状态 | 说明 |
|------|------|------|
| 项目脚手架 | ✅ 完成 | FastAPI + SQLite + Docker Compose |
| 数据库层 | ✅ 完成 | 18 张表（4 本地 + 14 缓存） |
| 禅道同步 | ✅ 完成 | 全量/增量 + 并发优化 + 暂停/取消 |
| 认证系统 | ✅ 完成 | JWT + bcrypt + 角色组权限体系 |
| Dashboard | ✅ 完成 | KPI 卡片 + 4 分类 + 项目集过滤 + 告警联动 |
| 项目详情 | ✅ 完成 | 甘特图 + 阶段详情 + 文档 + 交付 + 资料 + 笔记 |
| 产品管理 | ✅ 完成 | 产品总览 + 产品详情 + 状态过滤 |
| 产品拓扑 | ✅ 完成 | 三维度 AND 搜索 |
| 交付管理 | ✅ 完成 | DeliveryRecord CRUD |
| Bug 统计 | ✅ 完成 | Zentao bug 同步 + 统计 |
| 项目报表 | ✅ 完成 | 周报/月报 + Bug 统计 |
| 用户管理 | ✅ 完成 | CRUD + 批量添加 + 角色组多选 |
| 权限管理 | ✅ 完成 | Role/UserRole 多对多 + 权限管理页 |
| 数据源配置 | ✅ 完成 | 禅道/GitLab/NAS + .env 持久化 |
| 系统日志 | ✅ 完成 | DB + 文件双写 + 实时查看 + 全局异常捕获 |
| 自动同步 | ✅ 完成 | 后台 asyncio + 前端进度 + 气泡通知 |
| 主题切换 | ✅ 完成 | 浅色/深色 + CSS var(--xxx) |
| 部署 | ⚠️ 待验证 | Docker Compose 就绪 |
| GitLab 集成 | ✅ 完成 | 禅道 Release 同步 + GitLab URL 校验 + 告警 + 3 源独立通知 |
| 文档模板 | ✅ 完成 | 阶段类型独立持久化 + 0 模板阶段可见 + 增删改查 |
| NAS 监控 | ❌ Phase 2 | 售前项目检测 |

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
- [x] 本地模型：`LocalUser`、`Role`、`UserRole`、`SyncLog`、`DeliveryRecord`、`ProjectNote`、`LogEntry`
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
