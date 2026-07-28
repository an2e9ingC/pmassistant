# PMA 日志系统说明

> 最后更新：2026-07-29

---

## 1. 日志系统架构

```
用户操作 ──► log_audit() ──► audit_logs 表 (结构化, 仅DB)
                └──────────► pma-8000.log ([操作日志] 文本备份)

系统运行 ──► Python logging ──► pma-8000.log (仅文件)
                         ──► server-8000.log (uvicorn访问日志, 10MB轮转)
```

| 存储 | 内容 | 清除方式 | 密码验证 |
|------|------|---------|:---:|
| `audit_logs` 表 | 用户操作审计（结构化） | 操作日志页 → 清除操作日志 | ✅ confirm + password |
| `pma-8000.log` | 系统运行日志（纯文本） | 系统日志页 → 清除日志 | ✅ confirm + password |
| `server-8000.log` | uvicorn HTTP 访问日志 | 重启时 10MB 轮转 | 自动 |

---

## 2. 操作日志（audit_logs）

### 2.1 表结构

| # | 列名 | 类型 | 约束 | 说明 |
|---|------|------|------|------|
| 1 | `id` | INTEGER | **PK** | — |
| 2 | `username` | VARCHAR(64) | NOT NULL | 操作人 |
| 3 | `action` | VARCHAR(64) | NOT NULL | 操作标识 |
| 4 | `category` | VARCHAR(32) | NULLABLE | 操作分类 |
| 5 | `level` | VARCHAR(16) | NULLABLE, default="medium" | 级别（low/medium/high） |
| 6 | `detail` | VARCHAR(512) | NULLABLE | 操作详情 |
| 7 | `created_at` | DATETIME | default=now | 创建时间 |

### 2.2 Category 分类

所有 category 统一定义在 [backend/audit_categories.py](backend/audit_categories.py)，8 个标准分类：

| 常量 | 值 | 说明 | 对应文件 |
|------|-----|------|---------|
| `AUDIT_CAT_PRODUCT` | 产品 | 产品维护、关联 | `product_management.py` |
| `AUDIT_CAT_PROJECT` | 项目 | 项目创建/更新/删除 | `projects.py`, `product_management.py` |
| `AUDIT_CAT_TASK` | 任务 | 任务 CRUD、工时延长 | `tasks.py`, `task_service.py` |
| `AUDIT_CAT_BUG` | Bug | Bug CRUD、工时、分析、附件 | `bugs.py` |
| `AUDIT_CAT_TEMPLATE` | 模板规范 | 模板、阶段、标签、标准、命名选项 | `*_template.py`, `standards.py`, `pma_tag.py` |
| `AUDIT_CAT_USER` | 用户 | 用户管理、角色权限 | `admin_users.py` |
| `AUDIT_CAT_CUSTOMER` | 客户 | 客户管理 | `customers.py` |
| `AUDIT_CAT_SYSTEM` | 系统 | 配置、DB管理、清理操作 | `config.py`, `db_manage.py`, `logs.py` |

### 2.3 操作 action 清单

| category | action | 来源文件 | 说明 |
|----------|--------|---------|------|
| **产品** | `product_node_link/unlink` | `product_management.py` | 产品-节点关联/取消关联 |
| | `local_product_create/update/delete` | `product_management.py` | PMA本地产品 CRUD |
| | `product_projects_update` | `product_management.py` | 更新产品关联项目 |
| **项目** | `local_project_create/update` | `product_management.py` | PMA本地项目创建/更新 |
| | `project_update` | `projects.py` | 更新项目字段 |
| | `project_background_update` | `projects.py` | 更新项目背景 |
| | `project_linked_projects_update` | `projects.py` | 更新关联项目 |
| | `project_delivery_plan_update` | `projects.py` | 更新交付计划 |
| | `project_delete` | `projects.py` | 删除项目 |
| **任务** | `task_create/create_batch/import/update/delete` | `task_service.py` | 任务 CRUD |
| | `task_extend` | `tasks.py` | 任务延长预估工时 |
| **Bug** | `bug_create/update/delete` | `bugs.py` | Bug CRUD |
| | `bug_worklog_add/edit/delete` | `bugs.py` | Bug 工时记录 |
| | `bug_analysis_add/edit/delete` | `bugs.py` | Bug 分析记录 |
| | `bug_attachment_add` | `bugs.py` | Bug 附件上传 |
| | `bug_import/import_batch` | `bugs.py` | 从禅道导入Bug |
| | `bug_transfer` | `bugs.py` | Bug 项目转移 |
| | `bug_gitlab_submit` | `bugs.py` | Bug → GitLab Issue |
| **模板规范** | `doc_ptype_add` | `document_template.py` | 新增项目类型 |
| | `doc_template_add/edit/del` | `document_template.py` | 文档模板 CRUD |
| | `doc_stage_add/rename/del/reorder` | `document_template.py` | 阶段管理 |
| | `doc_reset` | `document_template.py` | 重置项目文档 |
| | `doc_template_sync_all` | `document_template.py` | 批量同步模板 |
| | `product_doc_template_add/edit/del/import` | `product_doc_template.py` | 产品文档模板 CRUD |
| | `product_node_add/update/del` | `product_doc_template.py` | 产品节点 CRUD |
| | `naming_option_add/edit/delete` | `product_doc_template.py` | 命名选项 CRUD |
| | `bug_template_add/edit/delete` | `product_doc_template.py` | Bug模板 CRUD |
| | `pma_tag_add/edit/del` | `pma_tag.py` | 标签 CRUD |
| | `standard_edit` | `standards.py` | 流程标准编辑 |
| **用户** | `role_create/update/delete` | `admin_users.py` | 角色 CRUD |
| | `user_role_assign` | `admin_users.py` | 用户角色分配 |
| | `user_update` | `admin_users.py` | 用户编辑（禁用/启用/密码） |
| | `user_permissions_update` | `admin_users.py` | 用户权限更新 |
| | `user_password_reset` | `admin_users.py` | 重置用户密码 |
| | `delete_user` | `admin_users.py` | 删除用户 |
| **客户** | `delete_customer` | `customers.py` | 删除客户 |
| **系统** | `clear_svn` | `config.py` | 清除SVN缓存 |
| | `clear_database` | `config.py` | 清除数据库缓存 |
| | `clear_logs` | `logs.py` | 清除系统日志 |
| | `db_export/import/delete_backup/restore_backup/rekey` | `db_manage.py` | 数据库管理操作 |

### 2.4 写入方式

所有操作日志通过 `log_audit()` 函数统一写入：

```python
# backend/routers/logs.py
def log_audit(db: Session, user: LocalUser, action: str, detail: str = "",
              category: str = "", level: str = "medium"):
```

- **DB 写入**：结构化存入 `audit_logs` 表（权威数据源）
- **文件备份**：同步写入 `pma-8000.log`（`[操作日志]` 前缀，纯文本副本）
- **权限**：仅 admin 可通过"操作日志"页面查看和清除
- **清除**：`POST /api/logs/audit/clear`（需 confirm + 密码验证）

---

## 3. 系统日志（文件）

### 3.1 pma-8000.log

Python logging 模块的输出，通过 `RotatingFileHandler` 管理（5MB × 3 个备份）。包含：
- 同步进度（SVN 扫描、GitLab 同步）
- 错误堆栈
- `[操作日志]` 文本副本
- 启动/关闭信息

### 3.2 server-8000.log

uvicorn HTTP 访问日志，shell 重定向捕获（10MB × 5 个备份）。包含：
- 每个 HTTP 请求的 URL、状态码、客户端 IP
- stderr 警告

---

## 4. 开发规范

### 4.1 新增操作日志

```python
from backend.audit_categories import AUDIT_CAT_XXX
from backend.routers.logs import log_audit

# 在业务操作完成后调用
log_audit(db, user, "action_name", "详情描述", AUDIT_CAT_XXX, "medium")
```

- `action`：kebab-case 标识（如 `product_create`、`bug_delete`）
- `detail`：包含关键信息（对象名称、ID、变更前后值），其中英文字段名必须通过 `FIELD_LABEL` 翻译为中文（见 [4.3 字段名中文化](#43-字段名中文化field_label)）
- `level`：`high`（删除/权限）、`medium`（编辑/新增）、`low`（查看/配置）
- `category`：必须使用 `AUDIT_CAT_*` 常量，禁止硬编码字符串

### 4.2 禁止的做法

- ❌ 不要在业务代码中直接 `logger.info()` 代替 `log_audit()`
- ❌ 不要直接构造 `AuditLog` 对象（应通过 `log_audit()` 统一入口）
- ❌ 不要硬编码 category 字符串（使用 `AUDIT_CAT_*` 常量）
- ❌ 系统日志不要写入数据库（已移除 `DatabaseLogHandler` 和 `log_entries` 表）

### 4.3 字段名中文化（FIELD_LABEL）

`backend/audit_categories.py` 中的 `FIELD_LABEL` 字典将英文字段名映射为中文标签，确保操作日志的 `detail` 字段可读。

**使用场景**：当 `log_audit()` 的 `detail` 中包含英文数据库字段名（如 `assignee_id`、`estimate_hours`）时，通过 `FIELD_LABEL` 翻译为中文（如 `负责人`、`预估工时`）。

```python
from backend.audit_categories import FIELD_LABEL

field_label = FIELD_LABEL.get(field, field)  # 未找到映射时回退为原文
changes.append(f"{field_label}: {old_val} -> {new_val}")
```

**维护规则**：
- 新增 `log_audit()` 调用的 `detail` 中包含英文字段名时，**必须同步在 `FIELD_LABEL` 中增加映射**
- 映射键（key）使用数据库列名或 API 字段名（snake_case），值（value）使用中文标签
- 同一字段名在多个实体中复用（如 `status` 对 Task 和 Project 都译为 `状态`），无需重复定义

**完整映射表**（`backend/audit_categories.py`）：

| 英文键 | 中文标签 | 适用实体 |
|--------|---------|---------|
| `title` | 标题 | Task |
| `description` | 描述 | Task / Project |
| `status` | 状态 | Task / Project |
| `priority` | 优先级 | Task |
| `type` | 类型 | Task |
| `execution_id` | 迭代 | Task |
| `stage_name` | 阶段名称 | Task |
| `assignee_id` | 负责人 | Task |
| `reviewer_id` | 审批人 | Task |
| `parent_id` | 父任务 | Task |
| `blocked_by_id` | 阻塞任务 | Task |
| `start_date` | 开始日期 | Task |
| `due_date` | 截止日期 | Task |
| `sort_order` | 排序 | Task |
| `progress` | 进度 | Task / Project |
| `estimate_hours` | 预估工时 | Task |
| `name` | 名称 | Project / Product |
| `code` | 编号 | Project / Product |
| `project_type` | 项目类型 | Project |
| `customer_name` | 客户名称 | Project |
| `pm_name` | 项目经理 | Project |
| `begin` | 开始日期 | Project |
| `end` | 结束日期 | Project |
| `real_began` | 实际开始 | Project |
| `real_end` | 实际结束 | Project |
| `estimate` | 预估工时 | Project |
| `consumed` | 已消耗工时 | Project |
| `program_name` | 项目集 | Project |
| `planned_delivery_qty` | 计划交付数量 | Project |
| `delivery_note` | 交付备注 | Project |
| `background` | 项目背景 | Project |
| `tags` | 标签 | Project |
| `linked_project_ids` | 关联项目ID | Project |
| `is_local` | 是否本地 | Project |
| `owner_id` | 负责人 | Project |
| `category` | 分类 | Product |
| `nas_path` | NAS路径 | Product |
| `git_url` | Git地址 | Product |
| `pma_customer` | PMA客户 | Product |
| `alias_name` | 别名 | Product |
| `project` | 项目 | 通用 |
| `product` | 产品 | 通用 |
| `doc` | 文档 | 通用 |
| `location` | 位置 | 通用 |
| `stage` | 阶段 | 通用 |
| `content` | 内容 | 通用 |
| `note_id` | 笔记ID | 通用 |
| `project_id` | 项目ID | 通用 |
| `doc_name` | 文档名称 | 通用 |
| `filename` | 文件名 | 通用 |
| `role` | 角色 | 通用 |
| `active` | 激活 | 通用 |
| `permissions` | 权限 | 通用 |
| `wecom_userid` | 企微用户ID | 通用 |
| `matched` | 匹配数 | 通用 |
| `created` | 创建数 | 通用 |
| `deleted` | 删除数 | 通用 |
| `linked_tasks` | 关联任务数 | 通用 |
| `products` | 产品数 | 通用 |
| `changes` | 变更 | 通用 |
| `password_changed` | 密码已修改 | 通用 |
