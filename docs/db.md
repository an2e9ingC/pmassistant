# PMA 数据库文档

> 最后更新：2026-07-08  
> 数据库：SQLite（文件 `data/pma-$PORT.db`）  
> ORM：SQLAlchemy + DeclarativeBase（`backend/database.py`）  
> 迁移策略：`Base.metadata.create_all()` + 启动时内联 SQL 补丁（`_migrate_sqlite()` / `_migrate_product_hierarchy()`）

---

## 1. 概述

PMA 使用单文件 SQLite 数据库，通过 SQLAlchemy ORM 管理。数据库分为两类表：

| 类别 | 前缀/特征 | 说明 |
|------|----------|------|
| **ZenTao 缓存表** | `zenta_*` | 从 ZenTao API 同步的项目、产品、任务、Bug、用户、发布等数据，只读缓存 |
| **PMA 本地表** | `local_*`, `pma_*`, `delivery_*`, `project_*`, `product_*`, `audit_*`, `sync_*`, `document_*`, `process_*`, `customer_*` | PMA 自身的业务数据和系统数据 |

**核心原则**：PMA 是只读聚合仪表盘，对 ZenTao/GitLab/NAS 绝不回写。`zenta_*` 表仅做全量同步缓存。

---

## 2. 表一览

| 表名 | 模型类 | 行数 | 分类 | 说明 |
|------|--------|:---:|------|------|
| `zenta_projects` | `CachedProject` | 39 | ZenTao 缓存 | 从 ZenTao 同步的项目数据，包含项目元信息、进度、工时、客户关联等 |
| `zenta_executions` | `CachedExecution` | 282 | ZenTao 缓存 | 项目下的执行/迭代/阶段，每个项目可有多个执行 |
| `zenta_tasks` | `CachedTask` | 330 | ZenTao 缓存 | 执行下的具体任务，包含指派人、工时、阻塞标记、交付物清单 |
| `pma_products` | `PmaProduct` | 82 | ZenTao 缓存 | 从 ZenTao 同步的产品数据，含 NAS 路径、Git 地址、客户标记等扩展字段 |
| `zenta_releases` | `CachedRelease` | 4 | ZenTao 缓存 | 产品下的发布版本/里程碑，含 GitLab 关联地址及校验状态 |
| `zenta_bugs` | `CachedBug` | 98 | ZenTao 缓存 | 产品/项目下的 Bug 缺陷数据，按严重程度、优先级、状态追踪 |
| `pma_bugs` | `PmaBug` | 0 | 本地-Bug | PMA 本地 Bug 系统：产品级追踪，支持组件、严重度、优先级、GitLab 联动、项目转移 |
| `pma_bug_worklogs` | `BugWorkLog` | 0 | 本地-Bug | Bug 工时记录：user_id、hours、date、description |
| `pma_bug_analysis` | `BugAnalysis` | 0 | 本地-Bug | Bug 分析解决记录：Markdown 内容 + JSON 附件列表 |
| `pma_bug_attachments` | `BugAttachment` | 0 | 本地-Bug | Bug 附件元数据：文件名、MIME、文件系统路径、大小 |
| `pma_bug_transfers` | `BugTransfer` | 0 | 本地-Bug | Bug 项目转移记录：move/copy、来源/目标项目、操作人 |
| `pma_tasks` | `Task` | 0 | 本地-任务 | PMA 本地任务：项目级，含阶段、状态、工时、进度、产出物 |
| `pma_worklogs` | `WorkLog` | 0 | 本地-任务 | 任务工时记录：user_id、hours、date、description |
| `pma_task_comments` | `TaskComment` | 0 | 本地-任务 | 任务评论：纯文本内容，user_id |
| `product_naming_options` | `ProductNamingOption` | 21 | 本地-产品 | 产品命名规范配置：系列/FPGA/CPU/ADC/形态各字段的可选值 |
| `zenta_users` | `CachedUser` | 73 | ZenTao 缓存 | ZenTao 系统中的用户列表，用于人员指派信息展示 |
| `pma_customers` | `PmaCustomer` | 4 | ZenTao 缓存 | 客户信息，与项目和产品通过链接表多对多关联 |
| `product_project_links` | `ProductProjectLink` | 2 | 关系表 | 产品与项目的 N:M 关联（组合唯一），维护产品-项目对应关系 |
| `customer_project_links` | `CustomerProjectLink` | 3 | 关系表 | 客户与项目的 N:M 关联（组合唯一） |
| `customer_product_links` | `CustomerProductLink` | 0 | 关系表 | 客户与产品的 N:M 关联（组合唯一） |
| `product_node_links` | `ProductNodeLink` | 4 | 关系表 | ZenTao 产品与 PMA 产品节点树的 N:M 关联（组合唯一），将缓存产品挂载到三级产品分类树上 |
| `local_users` | `LocalUser` | 8 | 本地-用户 | PMA 系统登录账户：用户名、bcrypt 密码哈希、关联 ZenTao 账号、启用状态 |
| `local_roles` | `Role` | 16 | 本地-角色 | RBAC 角色定义：角色 key、中文标签、逗号分隔的权限列表 |
| `user_roles` | `UserRole` | 17 | 本地-用户角色 | 用户与角色的 M:N 关系表，一个用户可拥有多个角色 |
| `pma_product_lines` | `ProductLine` | 27 | 本地-产品线 | 三级产品分类树：通过 parent_id 自引用构建一/二/三级节点 |
| `pma_settings` | `PmaSetting` | 5 | 本地-设置 | KV 键值对存储系统开关：密码验证开关、调试模式、备份策略、自定义阶段类型等 |
| `pma_tags` | `PmaTag` | 7 | 本地-标签 | 全局标签库，支持分类，用于标记项目或产品 |
| `document_templates` | `DocumentTemplate` | 32 | 本地-文档 | 按阶段类型定义的文档模板清单，定义每个阶段默认需要哪些文档 |
| `product_doc_templates` | `ProductDocTemplate` | 2 | 本地-文档 | 按产品节点定义的文档模板，用于产品视角的文档齐套管理 |
| `product_documents` | `ProductDocument` | — | 本地-文档 | 产品文档实例：状态、location、模板关联、自动扫描 |
| `project_documents` | `ProjectDocument` | 1542 | 本地-文档 | 每个项目每个执行的实际文档实例：状态、位置、完成时间、更新人 |
| `delivery_records` | `DeliveryRecord` | 0 | 本地-交付 | 项目交付记录：产品名称、序列号、数量、交付日期、接收人 |
| `product_notes` | `ProductNote` | 0 | 本地-笔记 | 产品维护笔记，记录人对产品的手动备注 |
| `project_notes` | `ProjectNote` | 14 | 本地-笔记 | 项目维护笔记，记录人对项目各阶段的手动备注 |
| `project_activities` | `ProjectActivity` | 22 | 本地-活动 | 项目操作审计：记录谁对项目做了什么操作 |
| `product_users` | —（无 ORM 模型） | 0 | 关系表 | 产品与本地用户的关联表（预留，尚未使用） |
| `project_users` | —（无 ORM 模型） | 0 | 关系表 | 项目与本地用户的关联表（预留，尚未使用） |
| `sync_logs` | `SyncLog` | 5228 | 系统 | 每次 ZenTao 数据同步的执行记录：实体类型、耗时、新增/更新数量、错误信息 |
| `audit_logs` | `AuditLog` | 16 | 系统 | 用户操作审计日志：谁在何时执行了什么操作，含级别和分类 |
| `process_standards` | `ProcessStandard` | 5 | 系统 | 流程标准配置：按分类存储 key-value 标准定义 |

---

## 3. 模型文件索引

所有 ORM 模型定义在 `backend/models/`：

| 文件 | 包含的模型 |
|------|-----------|
| `backend/models/zentao.py` | `CachedProject`, `CachedExecution`, `CachedTask`, `CachedUser`, `PmaProduct`, `CachedRelease`, `ProductProjectLink`, `ProductNodeLink`, `PmaCustomer`, `CustomerProjectLink`, `CustomerProductLink` |
| `backend/models/local.py` | `LocalUser`, `Role`, `UserRole`, `ProductNote`, `ProjectNote`, `PmaSetting`, `ProjectActivity`, `SyncLog`, `AuditLog` |
| `backend/models/document.py` | `DocumentTemplate`, `ProjectDocument`, `ProductDocTemplate`, `ProductLine`, `PmaTag`, `ProductNamingOption` |
| `backend/models/delivery.py` | `DeliveryRecord` |
| `backend/models/bug.py` | `CachedBug`, `PmaBug`, `BugWorkLog`, `BugAnalysis`, `BugAttachment`, `BugTransfer` |
| `backend/models/task.py` | `Task`, `WorkLog`, `TaskComment` |
| `backend/models/standard.py` | `ProcessStandard` |
| `backend/models/__init__.py` | 聚合导出所有模型 |

---

## 4. 实体关系图（ER）

```
┌──────────────────────┐
│    pma_customers   │
└────────┬─────────────┘
         │ 1
         │
    ┌────┴──────────────────────────┐
    │                               │
    │ N                             │ N
┌───┴──────────────────┐  ┌────────┴──────────────┐
│customer_project_links│  │customer_product_links  │
│ (UNIQUE customer+proj)│  │ (UNIQUE customer+prod) │
└───┬──────────────────┘  └────────┬──────────────┘
    │ N                            │ N
    │                              │
┌───┴───────────┐          ┌───────┴──────────────┐
│ zenta_projects│          │   pma_products     │
│ (id PK)       │          │   (id PK)            │
└───┬───────────┘          └──┬───────────────────┘
    │                         │
    │ ┌── product_project_links ──┘ (N:M, UNIQUE)
    │ │
    │ │
    │ 1                        │ 1
┌───┴───────────┐     ┌───────┴──────────────┐
│delivery_records│     │   zenta_releases     │
│ (FK: project)  │     │   (FK: product_id)   │
└────────────────┘     └──────────────────────┘
    │
    │ 1                         │ 1
┌───┴───────────────┐   ┌──────┴───────────────┐
│ zenta_executions  │   │ product_node_links   │
│ (FK: project_id)  │   │ (FK: product + node) │
└───┬───────────────┘   └──────┬───────────────┘
    │ 1                        │ N
    │                          │
┌───┴───────────┐      ┌───────┴──────────────┐
│  zenta_tasks  │      │  pma_product_lines   │
│(FK: execution)│      │ (self-referential)   │
└───────────────┘      │ parent_id -> id (1:N)│
                       └──────────────────────┘
    │
    │ 1
┌───┴────────────────┐
│ project_documents  │
│ (FK: project +     │
│      execution)    │
└────────────────────┘
    │
    │ 1
┌───┴────────────────┐
│ project_notes      │
│ (FK: project_id)   │
└────────────────────┘
    │
    │ 1
┌───┴────────────────┐
│ project_activities │
│ (FK: project_id)   │
└────────────────────┘


┌──────────────┐     ┌──────────────┐
│  local_users │     │ local_roles  │
│  (id PK)     │     │ (id PK)      │
└──────┬───────┘     └──────┬───────┘
       │ N                  │ N
       │    ┌───────────┐   │
       └────┤ user_roles├───┘
            │(M:N link) │
            └───────────┘


┌───────────────────┐
│ document_templates│  (独立，无 FK)
└───────────────────┘

┌───────────────────────┐
│ product_doc_templates │
│ (FK: product_id ->    │
│  pma_product_lines)   │
└───────────────────────┘

┌────────────────┐
│ product_notes  │  (独立 product_id，无 FK 约束)
└────────────────┘

┌──────────────┐  ┌──────────────┐
│ pma_settings │  │  pma_tags    │
│ (独立 KV)    │  │  (独立标签)  │
└──────────────┘  └──────────────┘

┌──────────────────┐  ┌──────────────┐  ┌──────────────┐
│  process_standards│  │  sync_logs   │  │  audit_logs  │
│  (独立)           │  │  (独立)      │  │  (独立)      │
└──────────────────┘  └──────────────┘  └──────────────┘

┌──────────────┐
│  log_entries │  (独立，应用运行日志)
└──────────────┘
```

---

## 5. 表详细定义

### 5.1 ZenTao 缓存表

#### 5.1.1 `zenta_projects` — 项目

| # | 列名 | 类型 | 约束 | 说明 |
|---|------|------|------|------|
| 1 | `id` | INTEGER | **PK** | ZenTao 项目 ID |
| 2 | `code` | VARCHAR(128) | INDEX | 项目代号 |
| 3 | `name` | VARCHAR(256) | NOT NULL | 项目名称 |
| 4 | `model` | VARCHAR(32) | — | 项目模型（scrum/waterfall/kanban） |
| 5 | `status` | VARCHAR(32) | INDEX | 项目状态 |
| 6 | `begin` | DATE | — | 计划开始日期 |
| 7 | `end` | DATE | — | 计划结束日期 |
| 8 | `real_began` | DATE | NULLABLE | 实际开始日期 |
| 9 | `real_end` | DATE | NULLABLE | 实际结束日期 |
| 10 | `progress` | VARCHAR(16) | — | 进度百分比 |
| 11 | `estimate` | FLOAT | default=0.0 | 预估工时 |
| 12 | `consumed` | FLOAT | default=0.0 | 已消耗工时 |
| 13 | `program_id` | INTEGER | NULLABLE, INDEX | 所属项目集 ID |
| 14 | `program_name` | VARCHAR(128) | NULLABLE | 所属项目集名称 |
| 15 | `pm_name` | VARCHAR(128) | NULLABLE | 项目经理姓名 |
| 16 | `pm_account` | VARCHAR(64) | NULLABLE | 项目经理账号 |
| 17 | `project_type` | VARCHAR(16) | default="RD" | 项目类型（RD/交付） |
| 18 | `alias_name` | VARCHAR(256) | NULLABLE | 别名 |
| 19 | `customer_name` | VARCHAR(256) | NULLABLE | 客户名称 |
| 20 | `planned_delivery_qty` | INTEGER | default=0 | 计划交付数量 |
| 21 | `delivery_note` | TEXT | NULLABLE | 交付备注 |
| 22 | `description` | TEXT | NULLABLE | 项目描述 |
| 23 | `tags` | TEXT | NULLABLE | 标签 |
| 24 | `raw_json` | TEXT | — | ZenTao 原始 JSON |
| 25 | `synced_at` | DATETIME | default=now | 同步时间 |
| 26 | `is_local` | BOOLEAN | default=False | 是否本地创建 |

**关系**：
- `executions` (backref) → `zenta_executions.project_id`（1:N）
- `project_documents` 引用 → `project_documents.project_id`（1:N）
- `project_notes` 引用 → `project_notes.project_id`（1:N）
- `project_activities` 引用 → `project_activities.project_id`（1:N）
- `delivery_records` 引用 → `delivery_records.project_id`（1:N）

---

#### 5.1.2 `zenta_executions` — 执行/迭代

| # | 列名 | 类型 | 约束 | 说明 |
|---|------|------|------|------|
| 1 | `id` | INTEGER | **PK** | ZenTao 执行 ID |
| 2 | `project_id` | INTEGER | NOT NULL, INDEX, **FK→zenta_projects.id** | 所属项目 |
| 3 | `name` | VARCHAR(256) | NOT NULL | 执行名称 |
| 4 | `type` | VARCHAR(32) | — | 类型（sprint/stage/kanban） |
| 5 | `status` | VARCHAR(32) | — | 状态 |
| 6 | `begin` | DATE | — | 开始日期 |
| 7 | `end` | DATE | — | 结束日期 |
| 8 | `progress` | VARCHAR(16) | — | 进度百分比 |
| 9 | `stage_name` | VARCHAR(128) | NULLABLE | 阶段名称（瀑布模型） |
| 10 | `stage_order` | INTEGER | NULLABLE | 阶段顺序 |
| 11 | `raw_json` | TEXT | — | ZenTao 原始 JSON |
| 12 | `synced_at` | DATETIME | default=now | 同步时间 |

**关系**：
- `project` → `zenta_projects.id`
- `tasks` (backref) → `zenta_tasks.execution_id`（1:N）

---

#### 5.1.3 `zenta_tasks` — 任务

| # | 列名 | 类型 | 约束 | 说明 |
|---|------|------|------|------|
| 1 | `id` | INTEGER | **PK** | ZenTao 任务 ID |
| 2 | `execution_id` | INTEGER | NOT NULL, INDEX, **FK→zenta_executions.id** | 所属执行 |
| 3 | `project_id` | INTEGER | NOT NULL, INDEX | 所属项目（冗余） |
| 4 | `parent_id` | INTEGER | NULLABLE | 父任务 ID（子任务场景） |
| 5 | `name` | VARCHAR(512) | NOT NULL | 任务名称 |
| 6 | `type` | VARCHAR(32) | — | 类型 |
| 7 | `status` | VARCHAR(32) | — | 状态 |
| 8 | `priority` | INTEGER | default=3 | 优先级 |
| 9 | `estimate` | FLOAT | default=0.0 | 预估工时 |
| 10 | `consumed` | FLOAT | default=0.0 | 已消耗工时 |
| 11 | `deadline` | DATE | NULLABLE | 截止日期 |
| 12 | `assigned_to` | VARCHAR(64) | NULLABLE | 指派人账号 |
| 13 | `assigned_realname` | VARCHAR(128) | NULLABLE | 指派人姓名 |
| 14 | `real_started` | DATETIME | NULLABLE | 实际开始时间 |
| 15 | `finished_date` | DATETIME | NULLABLE | 完成时间 |
| 16 | `has_files` | BOOLEAN | default=False | 是否包含附件 |
| 17 | `description` | TEXT | NULLABLE | 任务描述 |
| 18 | `is_blocker` | BOOLEAN | default=False | 是否为阻塞项 |
| 19 | `blocker_note` | TEXT | NULLABLE | 阻塞说明 |
| 20 | `output_items` | TEXT | NULLABLE | 交付物清单（JSON 数组） |
| 21 | `raw_json` | TEXT | — | ZenTao 原始 JSON |
| 22 | `synced_at` | DATETIME | default=now | 同步时间 |

**关系**：`execution` → `zenta_executions.id`

---

#### 5.1.4 `pma_products` — 产品

| # | 列名 | 类型 | 约束 | 说明 |
|---|------|------|------|------|
| 1 | `id` | INTEGER | **PK** | ZenTao 产品 ID |
| 2 | `code` | VARCHAR(128) | INDEX | 产品代号 |
| 3 | `name` | VARCHAR(256) | NOT NULL | 产品名称 |
| 4 | `type` | VARCHAR(32) | — | 产品类型（normal/branch/platform） |
| 5 | `status` | VARCHAR(32) | — | 状态 |
| 6 | `program_id` | INTEGER | NULLABLE | 所属项目集 ID |
| 7 | `program_name` | VARCHAR(128) | NULLABLE | 所属项目集名称 |
| 8 | `total_stories` | INTEGER | default=0 | 需求总数 |
| 9 | `total_bugs` | INTEGER | default=0 | Bug 总数 |
| 10 | `releases` | INTEGER | default=0 | 发布数量 |
| 11 | `category` | VARCHAR(32) | NULLABLE | 产品类别 |
| 12 | `alias_name` | VARCHAR(256) | NULLABLE | 别名 |
| 13 | `nas_path` | VARCHAR(512) | NULLABLE | NAS 路径 |
| 14 | `git_url` | VARCHAR(512) | NULLABLE | Git 仓库地址 |
| 15 | `pma_customer` | VARCHAR(256) | NULLABLE | PMA 客户标记 |
| 16 | `description` | TEXT | NULLABLE | 产品描述 |
| 17 | `tags` | TEXT | NULLABLE | 标签 |
| 18 | `raw_json` | TEXT | — | ZenTao 原始 JSON |
| 19 | `synced_at` | DATETIME | default=now | 同步时间 |
| 20 | `is_local` | BOOLEAN | default=False | 是否本地创建 |

**关系**：
- `releases_list` (backref) → `zenta_releases.product_id`（1:N）
- `product_project_links` → 多对多关联项目
- `product_node_links` → 多对多关联产品节点
- `customer_product_links` → 多对多关联客户

---

#### 5.1.5 `zenta_releases` — 发布/里程碑

| # | 列名 | 类型 | 约束 | 说明 |
|---|------|------|------|------|
| 1 | `id` | INTEGER | **PK** | ZenTao 发布 ID |
| 2 | `product_id` | INTEGER | NOT NULL, INDEX, **FK→pma_products.id** | 所属产品 |
| 3 | `name` | VARCHAR(256) | NOT NULL | 发布名称 |
| 4 | `marker` | INTEGER | default=0 | 标记：0=普通发布，1=里程碑 |
| 5 | `status` | VARCHAR(32) | default="normal" | 状态 |
| 6 | `date` | DATE | NULLABLE | 发布日期 |
| 7 | `desc` | TEXT | NULLABLE | 描述 |
| 8 | `gitlab_url` | VARCHAR(1024) | NULLABLE | GitLab 关联地址 |
| 9 | `gitlab_url_valid` | BOOLEAN | NULLABLE | GitLab 地址有效性 |
| 10 | `gitlab_url_checked_at` | DATETIME | NULLABLE | 最后校验时间 |
| 11 | `raw_json` | TEXT | — | ZenTao 原始 JSON |
| 12 | `synced_at` | DATETIME | default=now | 同步时间 |

**关系**：`product` → `pma_products.id`

---

#### 5.1.6 `zenta_bugs` — Bug

| # | 列名 | 类型 | 约束 | 说明 |
|---|------|------|------|------|
| 1 | `id` | INTEGER | **PK** | ZenTao Bug ID |
| 2 | `product_id` | INTEGER | NOT NULL, INDEX | 所属产品 ID |
| 3 | `project_id` | INTEGER | NULLABLE, INDEX | 所属项目 ID |
| 4 | `title` | VARCHAR(512) | NOT NULL | Bug 标题 |
| 5 | `severity` | INTEGER | default=3 | 严重程度 |
| 6 | `priority` | INTEGER | default=3 | 优先级 |
| 7 | `status` | VARCHAR(32) | INDEX | 状态 |
| 8 | `type` | VARCHAR(32) | — | 类型 |
| 9 | `opened_by` | VARCHAR(64) | — | 创建人 |
| 10 | `opened_date` | DATE | NULLABLE | 创建日期 |
| 11 | `assigned_to` | VARCHAR(64) | — | 指派人 |
| 12 | `resolved_by` | VARCHAR(64) | — | 解决人 |
| 13 | `resolved_date` | DATETIME | NULLABLE | 解决日期 |
| 14 | `closed_date` | DATETIME | NULLABLE | 关闭日期 |
| 15 | `raw_json` | TEXT | — | ZenTao 原始 JSON |
| 16 | `synced_at` | DATETIME | default=now | 同步时间 |

---

#### 5.1.7 `zenta_users` — 用户

| # | 列名 | 类型 | 约束 | 说明 |
|---|------|------|------|------|
| 1 | `id` | INTEGER | **PK** | ZenTao 用户 ID |
| 2 | `account` | VARCHAR(64) | UNIQUE, INDEX | 账号 |
| 3 | `realname` | VARCHAR(128) | — | 真实姓名 |
| 4 | `role` | VARCHAR(32) | — | 角色 |
| 5 | `email` | VARCHAR(128) | NULLABLE | 邮箱 |
| 6 | `dept` | INTEGER | default=0 | 部门 ID |
| 7 | `raw_json` | TEXT | — | ZenTao 原始 JSON |
| 8 | `synced_at` | DATETIME | default=now | 同步时间 |

---

#### 5.1.8 `pma_customers` — 客户

| # | 列名 | 类型 | 约束 | 说明 |
|---|------|------|------|------|
| 1 | `id` | INTEGER | **PK**, AUTOINCREMENT | 客户 ID |
| 2 | `name` | VARCHAR(128) | NOT NULL, UNIQUE, INDEX | 客户名称 |
| 3 | `full_name` | VARCHAR(256) | NULLABLE | 客户全称 |
| 4 | `created_at` | DATETIME | default=now | 创建时间 |
| 5 | `updated_at` | DATETIME | default=now, onupdate=now | 更新时间 |

---

### 5.2 关系/链接表

#### 5.2.1 `product_project_links` — 产品-项目关联

| # | 列名 | 类型 | 约束 | 说明 |
|---|------|------|------|------|
| 1 | `id` | INTEGER | **PK** | — |
| 2 | `product_id` | INTEGER | NOT NULL, INDEX, **FK→pma_products.id** | 产品 ID |
| 3 | `project_id` | INTEGER | NOT NULL, INDEX, **FK→zenta_projects.id** | 项目 ID |
| 4 | `created_at` | DATETIME | default=now | — |

**UNIQUE(product_id, project_id)**

#### 5.2.2 `customer_project_links` — 客户-项目关联

| # | 列名 | 类型 | 约束 | 说明 |
|---|------|------|------|------|
| 1 | `id` | INTEGER | **PK** | — |
| 2 | `customer_id` | INTEGER | NOT NULL, INDEX, **FK→pma_customers.id** | 客户 ID |
| 3 | `project_id` | INTEGER | NOT NULL, INDEX, **FK→zenta_projects.id** | 项目 ID |
| 4 | `created_at` | DATETIME | default=now | — |

**UNIQUE(customer_id, project_id)**

#### 5.2.3 `customer_product_links` — 客户-产品关联

| # | 列名 | 类型 | 约束 | 说明 |
|---|------|------|------|------|
| 1 | `id` | INTEGER | **PK** | — |
| 2 | `customer_id` | INTEGER | NOT NULL, INDEX, **FK→pma_customers.id** | 客户 ID |
| 3 | `product_id` | INTEGER | NOT NULL, INDEX, **FK→pma_products.id** | 产品 ID |
| 4 | `created_at` | DATETIME | default=now | — |

**UNIQUE(customer_id, product_id)**

#### 5.2.4 `product_node_links` — 产品-产品节点关联

| # | 列名 | 类型 | 约束 | 说明 |
|---|------|------|------|------|
| 1 | `id` | INTEGER | **PK** | — |
| 2 | `product_id` | INTEGER | NOT NULL, INDEX, **FK→pma_products.id** | 产品 ID |
| 3 | `product_node_id` | INTEGER | NOT NULL, INDEX, **FK→pma_product_lines.id** | 产品节点 ID |
| 4 | `created_at` | DATETIME | default=now | — |

**UNIQUE(product_id, product_node_id)**

---

### 5.3 本地业务表

#### 5.3.1 `local_users` — 本地用户

| # | 列名 | 类型 | 约束 | 说明 |
|---|------|------|------|------|
| 1 | `id` | INTEGER | **PK**, INDEX | — |
| 2 | `username` | VARCHAR(64) | NOT NULL, UNIQUE, INDEX | 登录用户名 |
| 3 | `password_hash` | VARCHAR(256) | NOT NULL | bcrypt 密码哈希 |
| 4 | `display_name` | VARCHAR(128) | NULLABLE | 显示名称（已弃用） |
| 5 | `role` | VARCHAR(32) | default="viewer" | 角色（已弃用，由 user_roles 替代） |
| 6 | `zentao_account` | VARCHAR(64) | NULLABLE | 关联的 ZenTao 账号 |
| 7 | `is_active` | BOOLEAN | default=True | 是否启用 |
| 8 | `permissions` | VARCHAR(256) | NULLABLE（DB 中存在） | 权限（已弃用） |
| 9 | `created_at` | DATETIME | default=now | — |
| 10 | `updated_at` | DATETIME | default=now, onupdate=now | — |

**关系**：`user_roles` → `UserRole.user_id`（1:N, lazy="selectin"）

#### 5.3.2 `local_roles` — 角色定义

| # | 列名 | 类型 | 约束 | 说明 |
|---|------|------|------|------|
| 1 | `id` | INTEGER | **PK**, INDEX | — |
| 2 | `key` | VARCHAR(32) | NOT NULL, UNIQUE, INDEX | 角色 key（如 `admin`, `pm`, `viewer`） |
| 3 | `label` | VARCHAR(64) | NOT NULL | 显示名称 |
| 4 | `permissions` | VARCHAR(256) | default="" | 权限列表（逗号分隔） |
| 5 | `description` | VARCHAR(256) | NULLABLE | 角色描述 |
| 6 | `created_at` | DATETIME | default=now | — |

**关系**：`user_roles` → `UserRole.role_id`（1:N, lazy="selectin"）

#### 5.3.3 `user_roles` — 用户-角色关联

| # | 列名 | 类型 | 约束 | 说明 |
|---|------|------|------|------|
| 1 | `id` | INTEGER | **PK**, INDEX | — |
| 2 | `user_id` | INTEGER | NOT NULL, INDEX, **FK→local_users.id** | 用户 |
| 3 | `role_id` | INTEGER | NOT NULL, INDEX, **FK→local_roles.id** | 角色 |

**关系**：
- `user` → `local_users.id` (back_populates="user_roles")
- `role` → `local_roles.id` (back_populates="user_roles")

---

#### 5.3.4 `pma_product_lines` — 产品节点（三级树）

| # | 列名 | 类型 | 约束 | 说明 |
|---|------|------|------|------|
| 1 | `id` | INTEGER | **PK** | — |
| 2 | `name` | VARCHAR(128) | NOT NULL | 节点名称 |
| 3 | `parent_id` | INTEGER | NULLABLE, INDEX, **FK→pma_product_lines.id** | 父节点（自引用，构建树形结构） |
| 4 | `sort_order` | INTEGER | default=0 | 排序 |
| 5 | `created_at` | DATETIME | default=now | — |

**层级说明**：通过 `parent_id` 自引用实现三级树：
- **一级产品线**：`parent_id IS NULL`
- **二级产品线**：`parent_id` → 一级节点 ID
- **三级产品节点**（叶子）：`parent_id` → 二级节点 ID，通过 `product_node_links` 关联具体 ZenTao 产品

#### 5.3.5 `pma_tags` — 标签

| # | 列名 | 类型 | 约束 | 说明 |
|---|------|------|------|------|
| 1 | `id` | INTEGER | **PK** | — |
| 2 | `name` | VARCHAR(128) | NOT NULL, UNIQUE | 标签名 |
| 3 | `category` | VARCHAR(32) | NULLABLE | 标签分类 |
| 4 | `created_at` | DATETIME | default=now | — |

#### 5.3.6 `pma_settings` — 系统设置（KV）

| # | 列名 | 类型 | 约束 | 说明 |
|---|------|------|------|------|
| 1 | `id` | INTEGER | **PK** | — |
| 2 | `key` | VARCHAR(64) | NOT NULL, UNIQUE, INDEX | 设置项 key |
| 3 | `value` | VARCHAR(256) | default="" | 设置项 value |

**用法**：`PmaSetting.get(db, key, default)` / `PmaSetting.set(db, key, value)`

---

#### 5.3.7 `document_templates` — 文档模板

| # | 列名 | 类型 | 约束 | 说明 |
|---|------|------|------|------|
| 1 | `id` | INTEGER | **PK** | — |
| 2 | `stage_type` | VARCHAR(64) | NOT NULL, INDEX | 阶段类型（如 `plan`, `design`, `test`） |
| 3 | `doc_name` | VARCHAR(256) | NOT NULL | 文档名称 |
| 4 | `sort_order` | INTEGER | default=0 | 排序 |
| 5 | `description` | VARCHAR(512) | NULLABLE | 描述 |
| 6 | `responsible_role` | VARCHAR(128) | NULLABLE | 负责角色 |

> 这是一个**无外键的独立模板表**，定义每个阶段默认应有哪些文档。实际项目文档由 `project_documents` 表管理。

#### 5.3.8 `product_doc_templates` — 产品文档模板

| # | 列名 | 类型 | 约束 | 说明 |
|---|------|------|------|------|
| 1 | `id` | INTEGER | **PK** | — |
| 2 | `product_line` | VARCHAR(128) | NOT NULL, INDEX（legacy） | 产品线名称（已弃用，现用 product_id） |
| 3 | `product_id` | INTEGER | NULLABLE, INDEX, **FK→pma_product_lines.id** | 产品节点 ID |
| 4 | `doc_name` | VARCHAR(256) | NOT NULL | 文档名称 |
| 5 | `sort_order` | INTEGER | default=0 | 排序 |
| 6 | `description` | VARCHAR(512) | NULLABLE | 描述 |
| 7 | `responsible_role` | VARCHAR(128) | NULLABLE | 负责角色 |

#### 5.3.9 `product_documents` — 产品文档实例

| # | 列名 | 类型 | 约束 | 说明 |
|---|------|------|------|------|
| 1 | `id` | INTEGER | **PK** | — |
| 2 | `product_id` | INTEGER | NOT NULL, INDEX | 关联产品 ID |
| 3 | `template_id` | INTEGER | NULLABLE, INDEX, **FK→product_doc_templates.id** | 关联模板 |
| 4 | `stage_type` | VARCHAR(64) | NOT NULL, default="通用" | 开发阶段 |
| 5 | `doc_name` | VARCHAR(256) | NOT NULL | 文档名称 |
| 6 | `sort_order` | INTEGER | default=0 | 排序 |
| 7 | `status` | VARCHAR(32) | default="pending" | 状态（pending/submitted） |
| 8 | `responsible_role` | VARCHAR(128) | NULLABLE | 负责角色 |
| 9 | `description` | VARCHAR(512) | NULLABLE | 描述 |
| 10 | `doc_path` | VARCHAR(512) | NULLABLE | 模板文档路径（自动从 base_path+file_pattern 计算） |
| 11 | `location` | TEXT | NULLABLE | 用户提交的文档位置/链接 |
| 12 | `doc_type` | VARCHAR(32) | NULLABLE | 文档类型（gitlab/svn/nas/solidworks/pma） |
| 13 | `completed_at` | DATETIME | NULLABLE | 文档提交/完成时间 |
| 14 | `uploaded_by` | VARCHAR(64) | NULLABLE | 上传人 |
| 15 | `uploaded_at` | DATETIME | NULLABLE | 上传时间 |
| 16 | `updated_by` | VARCHAR(64) | NULLABLE | 更新人（PMA 内部记录） |
| 17 | `svn_author` | VARCHAR(128) | NULLABLE | SVN 最后提交人（PROPFIND creator-displayname） |
| 18 | `svn_last_modified` | VARCHAR(128) | NULLABLE | SVN 最后修改时间（PROPFIND getlastmodified，已转北京时间） |
| 19 | `svn_rev` | VARCHAR(32) | NULLABLE | SVN 版本号（PROPFIND version-name） |
| 20 | `created_at` | DATETIME | default=now | — |
| 21 | `updated_at` | DATETIME | default=now, onupdate=now | — |

> 从 `product_doc_templates` 初始化，为每个产品的每个文档模板创建实例。`svn_author` 和 `svn_last_modified` 通过 SVN PROPFIND 请求自动填充（仅 SVN 类型文档）。

#### 5.3.10 `project_documents` — 项目文档实例

| # | 列名 | 类型 | 约束 | 说明 |
|---|------|------|------|------|
| 1 | `id` | INTEGER | **PK** | — |
| 2 | `project_id` | INTEGER | NOT NULL, INDEX, **FK→zenta_projects.id** | 所属项目 |
| 3 | `execution_id` | INTEGER | NOT NULL, INDEX, **FK→zenta_executions.id** | 所属执行/阶段 |
| 4 | `stage_type` | VARCHAR(64) | NOT NULL | 阶段类型 |
| 5 | `doc_name` | VARCHAR(256) | NOT NULL | 文档名称 |
| 6 | `sort_order` | INTEGER | default=0 | 排序 |
| 7 | `status` | VARCHAR(32) | default="pending" | 状态（pending/completed） |
| 8 | `responsible_role` | VARCHAR(128) | NULLABLE | 负责角色 |
| 9 | `description` | VARCHAR(512) | NULLABLE | 描述 |
| 10 | `completed_at` | DATETIME | NULLABLE | 完成时间 |
| 11 | `location` | TEXT | NULLABLE | 文档位置/链接 |
| 12 | `updated_by` | VARCHAR(64) | NULLABLE | 更新人 |
| 13 | `created_at` | DATETIME | default=now | — |
| 14 | `updated_at` | DATETIME | default=now, onupdate=now | — |

> 从 `document_templates` 初始化，为每个项目的每个执行创建实例。

---

#### 5.3.10 `delivery_records` — 交付记录

| # | 列名 | 类型 | 约束 | 说明 |
|---|------|------|------|------|
| 1 | `id` | INTEGER | **PK** | — |
| 2 | `project_id` | INTEGER | NOT NULL, INDEX, **FK→zenta_projects.id** | 所属项目 |
| 3 | `product_name` | VARCHAR(256) | NOT NULL | 产品名称 |
| 4 | `serial_numbers` | TEXT | NULLABLE | 序列号列表（JSON 数组） |
| 5 | `quantity` | INTEGER | default=0 | 数量 |
| 6 | `delivery_date` | DATE | NULLABLE | 交付日期 |
| 7 | `receiver` | VARCHAR(128) | NULLABLE | 接收人 |
| 8 | `responsible_person` | VARCHAR(128) | NULLABLE | 负责人 |
| 9 | `note` | TEXT | NULLABLE | 备注 |
| 10 | `created_at` | DATETIME | default=now | — |
| 11 | `updated_at` | DATETIME | default=now, onupdate=now | — |

---

#### 5.3.11 `product_notes` — 产品笔记

| # | 列名 | 类型 | 约束 | 说明 |
|---|------|------|------|------|
| 1 | `id` | INTEGER | **PK**, INDEX | — |
| 2 | `product_id` | INTEGER | NOT NULL, INDEX | 产品 ID |
| 3 | `content` | TEXT | NOT NULL | 笔记内容 |
| 4 | `recorded_by` | VARCHAR(64) | NOT NULL, default="" | 记录人 |
| 5 | `created_at` | DATETIME | default=now | — |

> 注意：`product_id` 无 FK 约束，引用 `pma_products.id` 或 `pma_product_lines.id` 视业务场景而定。

#### 5.3.12 `project_notes` — 项目笔记

| # | 列名 | 类型 | 约束 | 说明 |
|---|------|------|------|------|
| 1 | `id` | INTEGER | **PK**, INDEX | — |
| 2 | `project_id` | INTEGER | NOT NULL, INDEX | 项目 ID |
| 3 | `stage_name` | VARCHAR(256) | NULLABLE, default="" | 阶段名称 |
| 4 | `content` | TEXT | NOT NULL | 笔记内容 |
| 5 | `recorded_by` | VARCHAR(64) | NOT NULL, default="" | 记录人 |
| 6 | `created_at` | DATETIME | default=now | — |

#### 5.3.13 `project_activities` — 项目活动日志

| # | 列名 | 类型 | 约束 | 说明 |
|---|------|------|------|------|
| 1 | `id` | INTEGER | **PK** | — |
| 2 | `project_id` | INTEGER | NOT NULL, INDEX, **FK→zenta_projects.id** | 所属项目 |
| 3 | `username` | VARCHAR(64) | NOT NULL | 操作人 |
| 4 | `action` | VARCHAR(128) | NOT NULL | 操作类型 |
| 5 | `detail` | VARCHAR(512) | NULLABLE | 操作详情 |
| 6 | `task_name` | VARCHAR(256) | NULLABLE | 任务名（任务操作时填充） |
| 7 | `task_assignee` | VARCHAR(64) | NULLABLE | 责任人（任务操作时填充） |
| 8 | `created_at` | DATETIME | default=now | — |

---

### 5.4 系统表

#### 5.4.1 `sync_logs` — 同步日志

| # | 列名 | 类型 | 约束 | 说明 |
|---|------|------|------|------|
| 1 | `id` | INTEGER | **PK** | — |
| 2 | `started_at` | DATETIME | NOT NULL | 开始时间 |
| 3 | `finished_at` | DATETIME | NULLABLE | 结束时间 |
| 4 | `status` | VARCHAR(16) | default="running" | 状态（running/success/failed） |
| 5 | `entity_type` | VARCHAR(32) | NOT NULL | 同步实体类型（如 `projects`, `products`, `tasks`） |
| 6 | `items_fetched` | INTEGER | default=0 | 获取数量 |
| 7 | `items_created` | INTEGER | default=0 | 新建数量 |
| 8 | `items_updated` | INTEGER | default=0 | 更新数量 |
| 9 | `error_message` | TEXT | NULLABLE | 错误信息 |

#### 5.4.2 `audit_logs` — 审计日志

> 详见 [日志系统说明](audit-log.md)

| # | 列名 | 类型 | 约束 | 说明 |
|---|------|------|------|------|
| 1 | `id` | INTEGER | **PK** | — |
| 2 | `username` | VARCHAR(64) | NOT NULL | 操作人 |
| 3 | `action` | VARCHAR(64) | NOT NULL | 操作 |
| 4 | `category` | VARCHAR(32) | NULLABLE | 操作分类 |
| 5 | `level` | VARCHAR(16) | NULLABLE, default="medium" | 级别（low/medium/high） |
| 6 | `detail` | VARCHAR(512) | NULLABLE | 详情 |
| 7 | `created_at` | DATETIME | default=now | — |

#### 5.4.3 `process_standards` — 流程标准

| # | 列名 | 类型 | 约束 | 说明 |
|---|------|------|------|------|
| 1 | `id` | INTEGER | **PK** | — |
| 2 | `category` | VARCHAR(64) | NOT NULL, INDEX | 分类 |
| 3 | `key` | VARCHAR(128) | NOT NULL | 键 |
| 4 | `value` | TEXT | NULLABLE | 值 |
| 5 | `description` | VARCHAR(512) | NULLABLE | 描述 |
| 6 | `updated_at` | DATETIME | default=now, onupdate=now | — |

---

### 5.5 无 ORM 模型的关系表

以下表存在于 SQLite 中，但尚无对应的 SQLAlchemy 模型定义：

#### 5.5.1 `product_users` — 产品-用户关联

| # | 列名 | 类型 | 约束 | 说明 |
|---|------|------|------|------|
| 1 | `id` | INTEGER | **PK** | — |
| 2 | `product_id` | INTEGER | INDEX | 产品 ID |
| 3 | `user_id` | INTEGER | INDEX | 用户 ID |
| 4 | `created_at` | DATETIME | — | — |

#### 5.5.2 `project_users` — 项目-用户关联

| # | 列名 | 类型 | 约束 | 说明 |
|---|------|------|------|------|
| 1 | `id` | INTEGER | **PK** | — |
| 2 | `project_id` | INTEGER | INDEX | 项目 ID |
| 3 | `user_id` | INTEGER | INDEX | 用户 ID |
| 4 | `created_at` | DATETIME | — | — |

---

## 6. 外键关系汇总

| 源表 | 外键列 | 目标表 | 目标列 | 关系类型 |
|------|--------|--------|--------|:---:|
| `zenta_executions` | `project_id` | `zenta_projects` | `id` | N:1 |
| `zenta_tasks` | `execution_id` | `zenta_executions` | `id` | N:1 |
| `zenta_releases` | `product_id` | `pma_products` | `id` | N:1 |
| `product_project_links` | `product_id` | `pma_products` | `id` | N:M |
| `product_project_links` | `project_id` | `zenta_projects` | `id` | N:M |
| `product_node_links` | `product_id` | `pma_products` | `id` | N:M |
| `product_node_links` | `product_node_id` | `pma_product_lines` | `id` | N:M |
| `customer_project_links` | `customer_id` | `pma_customers` | `id` | N:M |
| `customer_project_links` | `project_id` | `zenta_projects` | `id` | N:M |
| `customer_product_links` | `customer_id` | `pma_customers` | `id` | N:M |
| `customer_product_links` | `product_id` | `pma_products` | `id` | N:M |
| `user_roles` | `user_id` | `local_users` | `id` | N:M |
| `user_roles` | `role_id` | `local_roles` | `id` | N:M |
| `pma_product_lines` | `parent_id` | `pma_product_lines` | `id` | 自引用 N:1 |
| `project_documents` | `project_id` | `zenta_projects` | `id` | N:1 |
| `project_documents` | `execution_id` | `zenta_executions` | `id` | N:1 |
| `delivery_records` | `project_id` | `zenta_projects` | `id` | N:1 |
| `project_activities` | `project_id` | `zenta_projects` | `id` | N:1 |
| `product_doc_templates` | `product_id` | `pma_product_lines` | `id` | N:1 |

---

## 7. 唯一约束汇总

| 表 | 约束列 | 说明 |
|----|--------|------|
| `local_users` | `username` | 用户名唯一 |
| `local_roles` | `key` | 角色 key 唯一 |
| `zenta_users` | `account` | ZenTao 账号唯一 |
| `pma_customers` | `name` | 客户名唯一 |
| `pma_settings` | `key` | 设置 key 唯一 |
| `pma_tags` | `name` | 标签名唯一 |
| `product_project_links` | (`product_id`, `project_id`) | 组合唯一 |
| `customer_project_links` | (`customer_id`, `project_id`) | 组合唯一 |
| `customer_product_links` | (`customer_id`, `product_id`) | 组合唯一 |
| `product_node_links` | (`product_id`, `product_node_id`) | 组合唯一 |

---

## 8. 数据流

```
ZenTao API ──全量同步──► sync_service.py
                            │
                            ├──► pma_products ──► product_node_links ◄── pma_product_lines
                            ├──► zenta_projects ◄── product_project_links
                            ├──► zenta_executions
                            ├──► zenta_tasks
                            ├──► zenta_bugs
                            ├──► zenta_users
                            ├──► zenta_releases
                            └──► pma_customers
                                      │
                    客户关联 ◄─────────┤
                    customer_project_links
                    customer_product_links

sync_logs ◄── 每次同步写入

FastAPI API ──查询/展示──► 各缓存表 + 本地表
                              │
     ┌────────────────────────┤
     │                        │
  前端操作 ──写入──► 本地表（project_documents, project_notes,
     │              product_notes, delivery_records,
     │              project_activities, pma_settings, pma_tags）
     │
     └──绝不写入──► zenta_* 缓存表（只读）
```

---

## 9. 数据库管理

### 9.1 创建

数据库由 SQLAlchemy 在首次请求时自动创建：

```python
Base.metadata.create_all(bind=engine)   # backend/database.py
```

### 9.2 迁移

无 Alembic 等迁移框架。schema 变更是通过启动时内联 SQL 函数实现：

- **`_migrate_sqlite()`** — 检测缺失列，使用 `ALTER TABLE ADD COLUMN` 逐个补全
- **`_migrate_product_hierarchy()`** — 将旧版平铺产品线数据迁移到三级树 `pma_product_lines` 结构

### 9.3 多实例隔离

见 [并行开发约定](../CLAUDE.md#24-资源隔离端口数据库日志)：

| 实例 | 数据库文件 |
|------|-----------|
| 主 session (port 8000) | `data/pma-8000.db` |
| Worktree A (port 8001) | `data/pma-8001.db` |
| Worktree B (port 8002) | `data/pma-8002.db` |

### 9.4 备份

PMA 有两层备份机制：**自动定时备份** + **操作前安全快照**。

#### 9.4.1 备份目录

| 目录 | 用途 | 清理策略 |
|------|------|---------|
| `data/backups/` | 滚动备份 + 操作前安全快照 | 滚动备份按 `db_backup_retention`（默认 5）自动清理；`-before-*` 文件不自动清理 |
| `data/backups/permanent/` | 永久备份 | 按 `db_backup_keep_interval`（小时）窗口保留，不会被滚动清理删除 |

#### 9.4.2 自动定时备份

后台任务 `auto_backup_loop()`（[backend/routers/db_manage.py](backend/routers/db_manage.py)）每 30 秒检查一次，到达设定的备份间隔后执行 `_do_backup()`：

1. **滚动备份**：`data/backups/pma-backup-{时间}.db`，超过 `db_backup_retention` 数量后自动删除最旧的
2. **永久备份**：若距上一个 `permanent/` 中的备份超过 `db_backup_keep_interval` 小时，则复制一份到 `data/backups/permanent/pma-backup-{时间}-keep.db`

备份配置在数据库管理页面（需 admin 权限）设置：

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `db_backup_interval` | `0`（关闭） | 自动备份间隔（分钟） |
| `db_backup_retention` | `5` | 滚动备份保留数量 |
| `db_backup_keep_interval` | `0`（关闭） | 永久备份间隔（小时） |

#### 9.4.3 操作前安全快照

管理员在数据库管理页面执行**导入**或**从备份恢复**操作时，系统会在操作前自动创建当前数据库的快照，失败时自动回滚：

**`-before-import.db`（导入前快照）**：

```
用户上传 .db 文件导入
  → copy2 当前数据库 → data/backups/pma-backup-{时间}-before-import.db
  → shutil.move 用上传文件替换当前数据库
  → 若 move 失败 → 自动从 before-import 恢复 → 返回错误
```

**`-before-restore.db`（恢复前快照）**：

```
用户点击某个备份的"恢复"按钮
  → engine.dispose() 关闭所有连接
  → copy2 当前数据库 → data/backups/pma-backup-{时间}-before-restore.db
  → shutil.copy2 用选中备份覆盖当前数据库
  → 若 copy2 失败 → 自动从 before-restore 回滚 → 返回错误
```

> **注意**：自动回滚只覆盖文件系统层面的异常（磁盘 IO 错误、权限问题等）。如果文件替换成功但数据本身有问题（如恢复了损坏的备份），不会触发自动回滚——此时 `-before-*` 文件就是手动恢复的后路。

`-before-*` 文件不会出现在备份列表页面中（代码明确过滤了含 `-before-` 的文件名），也不会被自动滚动清理删除。

#### 9.4.4 手动备份

```bash
cp data/pma-8000.db data/pma-8000.db.bak.$(date +%Y%m%d)
```

### 9.5 查询调试

```bash
python3 -c "
from backend.database import engine, Base, get_session
# 直接使用 sqlite3 或 SQLAlchemy session 查询
"
```

---

## 11. 权限配置体系（RBAC）

### 11.1 总览

PMA 采用**基于角色的访问控制（RBAC）**模型，核心由 3 张表 + 1 张 KV 配置表组成：

```
local_users (用户账号) ──N:M── user_roles ──N:M── local_roles (角色+权限)
                                                        │
                                              permissions 字段（逗号分隔）
                                                        │
                                              pma_settings（密码验证开关等）
```

**认证流程**：用户名+密码 → bcrypt 验证 → 签发 JWT（HS256, 8h 有效期）→ 后续请求携带 Bearer Token → `get_current_user` 解析 JWT 获取用户对象 → `has_perm(user, perm)` 聚合用户所有角色的权限集进行鉴权。

### 11.2 用户账号：`local_users`

用户登录账户存储在此表，包含：

| 字段 | 说明 |
|------|------|
| `username` | 登录用户名（唯一） |
| `password_hash` | bcrypt 哈希（12 轮），明文密码绝不存储 |
| `is_active` | 是否启用，禁用后无法登录 |
| `zentao_account` | 关联的 ZenTao 系统账号（用于数据映射） |
| `role` | **已弃用**的单角色字符串，已被 `user_roles` 多角色体系取代 |
| `permissions` | **已弃用**的直接权限字符串，已被 RBAC 取代 |

默认管理员账户：`admin` / `admin123`（由 `database.py::init_db()` 自动创建）。

### 11.3 角色定义：`local_roles`

16 个预定义角色在系统启动时自动创建（如果不存在）。每个角色包含一个逗号分隔的 `permissions` 字符串。

| 角色 key | 中文标签 | 拥有的权限 | 说明 |
|----------|---------|-----------|------|
| `admin` | 管理员 | `admin,sync,project_edit,product_link,customer_link,doc_template,stage_mapping` | 全部权限，角色不可删除 |
| `pm` | 项目经理 | `sync,project_edit,product_link,customer_link,doc_template,stage_mapping` | 除系统管理外的全部业务权限 |
| `test_delivery` | 测试交付 | `project_edit,doc_template` | 可编辑项目文档和交付记录 |
| `public` | 普通用户 | —（无） | 默认角色，新用户自动分配，仅可查看 |
| `ceo` | CEO | —（无） | 只读查看 |
| `cto` | CTO | —（无） | 只读查看 |
| `sales` | 销售及售前 | —（无） | 只读查看 |
| `hw_dev` | 硬件开发 | —（无） | 只读查看 |
| `structure` | 结构设计及装配 | —（无） | 只读查看 |
| `hw_test` | 硬件测试 | —（无） | 只读查看 |
| `bsp_dev` | BSP 开发 | —（无） | 只读查看 |
| `sw_dev` | 业务软件开发 | —（无） | 只读查看 |
| `procurement` | 采购 | —（无） | 只读查看 |
| `quality` | 质检 | —（无） | 只读查看 |
| `warehouse` | 库房管理 | —（无） | 只读查看 |
| `viewer` | — | —（无） | 额外角色（DB 中存在，代码中声明） |

### 11.4 7 个权限原子及其保护范围

| 权限 key | 中文标签 | 保护的操作 |
|----------|---------|-----------|
| `admin` | 系统管理 | 用户 CRUD、角色 CRUD、系统配置、数据库导出/导入/备份、清除缓存数据、暂停/恢复/取消同步 |
| `sync` | 数据同步 | 手动触发同步、查看/修改项目筛选器 |
| `project_edit` | 项目维护 | 更新文档状态/位置、更新交付计划、管理项目-产品/客户/标签关联、编辑阶段名称 |
| `product_link` | 产品维护 | 产品节点 CRUD、产品-节点链接、本地产品/项目 CRUD、产品-项目/客户关联 |
| `customer_link` | 客户维护 | 客户创建、更新、删除 |
| `doc_template` | 文档模板配置 | 文档模板 CRUD、阶段类型管理、模板同步到项目、重置项目文档、标准编辑、标签 CRUD、产品文档模板 CRUD |
| `stage_mapping` | 阶段映射 | 更新阶段名称、阶段名称映射同步到 ZenTao |

### 11.5 权限计算逻辑

```python
# backend/middleware/auth.py
def _get_perms(user: LocalUser) -> set[str]:
    perms = set()
    for ur in user.user_roles:          # 遍历用户的所有 UserRole
        if ur.role and ur.role.permissions:
            for p in ur.role.permissions.split(","):
                p = p.strip()
                if p:
                    perms.add(p)
    return perms

def has_perm(user, perm: str) -> bool:
    return perm in _get_perms(user)
```

用户的**有效权限 = 所有角色权限的并集**。例如用户同时拥有 `pm`（含 `sync,project_edit,...`）和 `test_delivery`（含 `project_edit,doc_template`）角色，则有效权限为 `{sync, project_edit, product_link, customer_link, doc_template, stage_mapping}`。

### 11.6 密码验证开关：`pma_settings`

以下设置项存储为 KV 键值对，用于控制敏感操作是否需要二次密码验证：

| key | 控制的操作 |
|-----|-----------|
| `pw_verify_delete_user` | 删除用户时需验证密码 |
| `pw_verify_delete_cust` | 删除客户时需验证密码 |
| `pw_verify_delete_delivery` | 删除交付记录时需验证密码 |
| `pw_verify_clear_logs` | 清除日志时需验证密码 |
| `pw_verify_clear_db` | 清除数据库时需验证密码 |
| `pw_verify_maint_remove` | 维护页面移除关联时需验证密码 |
| `pw_verify_product_node_del` | 删除产品节点时需验证密码 |
| `pw_verify_product_node_edit` | 编辑产品节点时需验证密码 |

此外还有：
| key | 说明 |
|-----|------|
| `debug_perm` | 前端是否显示权限调试信息 |
| `db_backup_interval` | 自动数据库备份间隔（分钟） |
| `db_backup_retention` | 备份保留数量 |
| `custom_stage_types` | 自定义阶段类型（逗号分隔） |

### 11.7 路由鉴权机制

API 路由通过 FastAPI `Depends` 注入进行鉴权：

| 注入器 | 作用 |
|--------|------|
| `get_current_user` | 仅要求登录（Bearer Token 有效 + 用户启用），用于所有读操作 |
| `require_admin` | 必须拥有 `admin` 权限 |
| `require_perm("xxx")` | 必须拥有指定权限 |
| `require_any_perm("a", "b")` | 必须拥有至少一个指定权限 |

### 11.8 JWT 配置

JWT 密钥和参数来自 `backend/config.py`，可通过 `.env` 文件覆盖：

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `JWT_SECRET_KEY` | `dev-secret-change-in-production` | JWT 签名密钥（**生产环境必须更换**） |
| `JWT_ALGORITHM` | `HS256` | 签名算法 |
| `JWT_EXPIRE_MINUTES` | `480` | Token 过期时间（8 小时） |

---

## 12. 数据保护方案

### 12.1 当前保护状态

| 保护层面 | 当前状态 |
|----------|---------|
| 密码存储 | bcrypt 哈希（12 轮），不存储明文 |
| API 认证 | JWT Bearer Token（HS256, 8h 过期） |
| 传输加密 | 无（HTTP 明文），建议前置 Nginx/Traefik 做 TLS 终止 |
| 数据库文件 | **SQLCipher AES-256 加密**（需配置 `SQLCIPHER_KEY`） |
| 敏感字段 | 随数据库整体加密 |
| 备份文件 | 加密 `.db` 文件，直接拷贝即为加密状态 |

> **已实现**: 在 `.env` 中设置 `SQLCIPHER_KEY` 即可启用全数据库加密。首次启动时自动检测未加密数据库并完成迁移。

### 12.2 SQLCipher 实施详情

#### 密钥读取优先级

`config.py` 按以下优先级读取密钥（高到低）：

```
1. Docker secrets 文件  →  SQLCIPHER_KEY_FILE=/run/secrets/sqlcipher_key
2. 环境变量             →  SQLCIPHER_KEY=<hex-64>
3. .env 文件            →  SQLCIPHER_KEY=<hex-64>
```

#### 密钥生成（Passphrase 派生）

PMA 使用 passphrase 派生密钥，而非随机 hex key。这样即使 `sqlcipher_key.txt` 丢失，只要记得 passphrase 就能恢复。

```bash
# 交互式输入 passphrase，派生 64 位 hex 密钥
python3 gen-sqlcipher-key.py gen

# 非交互（脚本中）
echo "我的长口令" | python3 gen-sqlcipher-key.py gen

# 写入 Docker secrets 文件
python3 gen-sqlcipher-key.py gen > secrets/sqlcipher_key.txt
```

**派生原理**（Python 标准库，无外部依赖）：

```
passphrase ──► PBKDF2-HMAC-SHA512(iter=1,000,000, salt="pma-sqlcipher-salt-v1")
                  │
                  └──► 32 字节 (256-bit) hex key → SQLCIPHER_KEY
```

关键设计：
- **100 万次 SHA-512 迭代**：即使拿到 `.db` 文件，暴力破解 passphrase 也极其昂贵（每次猜测需 100 万次哈希）
- **固定 salt**：同样的 passphrase 永远产出同样的 hex key，丢失可重新派生
- **可记忆恢复**：passphrase 记在脑中，不依赖文件备份

> **警告**：如果修改 `gen-sqlcipher-key.py` 中的 `SALT` 变量，所有已加密数据库的密钥都会变化——已加密的数据库将无法解密。

#### 更换密码（PRAGMA rekey）

SQLCipher 支持在线更换密钥，无需导出/导入：

```bash
# 交互式：输入旧 passphrase + 新 passphrase
python3 gen-sqlcipher-key.py rekey data/pma-8000.db

# 非交互：
echo -e "旧口令\n新口令" | python3 gen-sqlcipher-key.py rekey data/pma-8000.db
```

执行流程：

```
旧 passphrase ──► PBKDF2 ──► old_key ──► PRAGMA key = old_key  (打开 DB)
                                                  │
新 passphrase ──► PBKDF2 ──► new_key ──► PRAGMA rekey = new_key (重新加密)
                                                  │
                                            .db 文件用新密钥重新加密完成
```

> **注意**：rekey 需要 sqlcipher CLI 或 pysqlcipher3。Docker 容器中已包含（`libsqlcipher-dev` + `pysqlcipher3`）。开发环境如未安装，可 `apt install sqlcipher` 后执行。

#### 启用方式

##### Docker Compose（生产推荐）

```bash
# 1. 生成密钥（从 passphrase 派生）
python3 gen-sqlcipher-key.py gen > secrets/sqlcipher_key.txt

# 2. 启动（docker-compose 自动挂载 secrets → /run/secrets/sqlcipher_key）
docker compose up -d
```

##### 直接部署（开发环境）

```bash
# 1. 生成密钥并写入 .env
echo "SQLCIPHER_KEY=$(python3 gen-sqlcipher-key.py gen)" >> .env

# 2. 重启
./server.sh restart
```

首次启动自动将未加密的 `.db` 文件迁移为加密数据库（原始文件保留为 `.pre-sqlcipher.bak`）。

#### Docker Secrets 安全模型

```
┌─────────────────────────────────────────────────────────┐
│  宿主机                                                  │
│  ./secrets/sqlcipher_key.txt  (文件权限 600, .gitignore) │
└──────────────────┬──────────────────────────────────────┘
                   │ docker compose 挂载
                   ▼
┌─────────────────────────────────────────────────────────┐
│  容器内 /run/secrets/sqlcipher_key                       │
│  tmpfs 内存文件系统 — 不落磁盘，容器停止后消失             │
│  仅 root + 应用用户可读                                   │
└──────────────────┬──────────────────────────────────────┘
                   │ config.py 读取
                   ▼
┌─────────────────────────────────────────────────────────┐
│  pysqlcipher3 → PRAGMA key → 解密 .db 文件               │
└─────────────────────────────────────────────────────────┘
```

**防护效果**：
- 代码仓库不包含密钥（`secrets/` 在 `.gitignore` 中）
- 容器外无法通过 `docker inspect` 看到密钥（与 env 不同）
- `.db` 文件即使被拷贝走也无法解密
- 密钥仅在容器运行期间存在于内存中

#### 技术架构

```
┌────────────────────────────────────────────────┐
│  backend/config.py                             │
│  SQLCIPHER_KEY_FILE → 从文件读取（Docker secrets）│
│  SQLCIPHER_KEY      → 从环境变量读取（降级）      │
│  优先级：文件 > 环境变量 > .env                   │
└──────────────────┬─────────────────────────────┘
                   │
                   ▼
┌────────────────────────────────────────────────┐
│  backend/database.py                           │
│  ┌──────────────────────────────────────────┐  │
│  │ if SQLCIPHER_KEY:                        │  │
│  │   driver = "sqlite+pysqlcipher:///"       │  │
│  │   PRAGMA key = SQLCIPHER_KEY  (on connect)│  │
│  │ else:                                     │  │
│  │   driver = "sqlite:///" (plain)           │  │
│  └──────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────┐  │
│  │ _migrate_to_sqlcipher():                 │  │
│  │   启动时检测未加密 DB → 自动导出加密副本   │  │
│  │   → 替换原文件 + .pre-sqlcipher.bak 备份  │  │
│  └──────────────────────────────────────────┘  │
└────────────────────────────────────────────────┘
```

#### 迁移策略

1. 检测 DB 是否已加密：用标准 `sqlite3` 尝试打开，成功则说明未加密
2. 优先使用 `sqlcipher` CLI 工具导出（速度快，内存占用低）
3. 降级使用 `pysqlcipher3` Python 包逐表复制数据
4. 迁移成功后保留原始文件为 `.pre-sqlcipher.bak` 备份

#### 密钥管理

| 方案 | 适用场景 | 说明 |
|------|---------|------|
| **Docker secrets**（推荐） | Docker 生产 | `secrets/sqlcipher_key.txt` → `/run/secrets/sqlcipher_key`（tmpfs） |
| `.env` 文件 | 开发/单机部署 | `SQLCIPHER_KEY=<hex-64>` → `config.py` 读取 |
| 环境变量 | 通用 | `export SQLCIPHER_KEY=$(openssl rand -hex 32)` |
| HashiCorp Vault | 企业 | 通过 Vault Agent 自动注入 |

> **警告**：密钥丢失将导致数据库永久无法解密。请妥善保管密钥，建议离线备份 `secrets/sqlcipher_key.txt` 到安全位置。

### 12.3 备选方案参考

| 方案 | 保护级别 | 改动量 | 适用场景 |
|------|:---:|:---:|------|
| **SQLCipher**（已实施） | 全库加密 | 中 | 需要完整数据保护的场景 |
| 文件系统加密（LUKS/eCryptfs） | 全盘/目录 | 低（运维层面） | 已有加密基础设施的场景 |
| 敏感字段加密（应用层 AES） | 字段级 | 高 | 只需保护部分字段（如 Token）的场景 |
| WAL 模式 + 文件权限 `600` | 访问控制 | 极低 | 最低保护（限制文件读取权限） |

### 12.4 补充安全建议

| 优先级 | 措施 | 难度 | 效果 |
|:---:|------|:---:|------|
| **P0** | 更换 JWT 密钥 + 收紧文件权限 | 极低 | 防止简单攻击 |
| **P1** | 前置 HTTPS（Nginx/Traefik TLS 终止） | 低 | 防止传输层嗅探 |
| **P2** | ~~SQLCipher 加密~~（已实施，配置即可） | 中 | 防止数据文件泄露 |
| **P3** | 密钥管理基础设施（Vault/Docker secrets） | 高 | 企业级安全 |

---

## 13. 命名规范

| 前缀 | 含义 | 示例 |
|------|------|------|
| `zenta_` | ZenTao 缓存数据 | `zenta_projects`, `zenta_tasks` |
| `local_` | PMA 本地核心数据 | `local_users`, `local_roles` |
| `pma_` | PMA 业务扩展数据 | `pma_product_lines`, `pma_settings`, `pma_tags` |
| `product_` | 产品相关本地数据 | `product_notes`, `product_doc_templates`, `product_node_links` |
| `project_` | 项目相关本地数据 | `project_documents`, `project_notes`, `project_activities` |
| `customer_` | 客户关联 | `customer_project_links`, `customer_product_links` |
| `delivery_` | 交付记录 | `delivery_records` |
| `document_` | 文档模板 | `document_templates` |
| `process_` | 流程标准 | `process_standards` |
| `sync_` | 同步日志 | `sync_logs` |
| `audit_` | 审计日志 | `audit_logs` |
| `log_` | 应用日志 | `log_entries` |
