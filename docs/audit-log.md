# PMA 日志系统说明

> 最后更新：2026-07-08

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
- `detail`：包含关键信息（对象名称、ID、变更前后值）
- `level`：`high`（删除/权限）、`medium`（编辑/新增）、`low`（查看/配置）
- `category`：必须使用 `AUDIT_CAT_*` 常量，禁止硬编码字符串

### 4.2 禁止的做法

- ❌ 不要在业务代码中直接 `logger.info()` 代替 `log_audit()`
- ❌ 不要直接构造 `AuditLog` 对象（应通过 `log_audit()` 统一入口）
- ❌ 不要硬编码 category 字符串（使用 `AUDIT_CAT_*` 常量）
- ❌ 系统日志不要写入数据库（已移除 `DatabaseLogHandler` 和 `log_entries` 表）
