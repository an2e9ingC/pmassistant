from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, Text, ForeignKey, UniqueConstraint
from sqlalchemy.sql import func

from backend.database import Base


class DocumentTemplate(Base):
    """Global document template per stage type and project type. Configurable via admin UI.

    project_type groups templates into tabs: 'RD' (研发项目), 'SC' (生产项目), custom types.
    """
    __tablename__ = "document_templates"

    id = Column(Integer, primary_key=True)
    project_type = Column(String(32), nullable=False, default="RD", server_default="RD", index=True)
    stage_type = Column(String(64), nullable=False, index=True)
    doc_name = Column(String(256), nullable=False)
    sort_order = Column(Integer, default=0)
    description = Column(String(512), nullable=True)
    responsible_role = Column(String(128), nullable=True)  # 责任人/岗位
    doc_path = Column(String(512), nullable=True)  # 文档路径/NAS路径（旧，合并了base+file）
    base_path = Column(String(512), nullable=True)  # 基础路径（如 http://.../信号板/{code}/）
    file_pattern = Column(String(256), nullable=True)  # 文件名模板（如 01_{code}_SCH-FINAL.rar）
    doc_type = Column(String(32), nullable=True)  # 文档类型: gitlab/svn/nas
    is_unnecessary = Column(Integer, default=0)  # 0=正常 1=无需文档
    is_optional = Column(Integer, default=0)  # 0=必选 1=可选（项目可按需删除）


class ProjectDocument(Base):
    """Per-project document instance, initialized from templates on first view."""
    __tablename__ = "project_documents"

    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey("zenta_projects.id"), nullable=False, index=True)
    template_id = Column(Integer, ForeignKey("document_templates.id"), nullable=True, index=True)
    stage_type = Column(String(64), nullable=False)
    doc_name = Column(String(256), nullable=False)
    sort_order = Column(Integer, default=0)
    status = Column(String(32), default="pending")  # pending | submitted
    responsible_role = Column(String(128), nullable=True)  # 责任人/岗位（从模板复制）
    description = Column(String(512), nullable=True)  # 说明（从模板复制）
    completed_at = Column(DateTime, nullable=True)
    location = Column(Text, nullable=True)
    doc_path = Column(String(512), nullable=True)  # 完整文档路径
    doc_type = Column(String(32), nullable=True)  # 文档类型: gitlab/svn/nas
    base_path = Column(String(512), nullable=True)  # 基础路径
    file_pattern = Column(String(256), nullable=True)  # 文件名模板
    updated_by = Column(String(64), nullable=True)
    is_optional = Column(Integer, default=0)  # 0=必选 1=可选（从模板复制）
    is_removed = Column(Integer, default=0)  # 0=正常 1=已删除（可选项被项目移除）
    file_count = Column(Integer, default=0)  # 文件夹内条目数（0=单文件/不适用，>0=PDM文件夹级模板）
    use_product_versions = Column(Integer, default=0)  # 0=按模板路径匹配项目仓库 1=使用产品基础版本（自动创建按产品FPGA文档）
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class ProductDocTemplate(Base):
    """Global document template per leaf product (level 3). Configurable via admin UI."""
    __tablename__ = "product_doc_templates"

    id = Column(Integer, primary_key=True)
    product_line = Column(String(128), nullable=False, default="", server_default="", index=True)  # legacy, migrated to product_id
    product_id = Column(Integer, ForeignKey("pma_product_lines.id"), nullable=True, index=True)
    stage_type = Column(String(64), nullable=False, default="通用", server_default="通用", index=True)  # 开发阶段
    doc_name = Column(String(256), nullable=False)
    sort_order = Column(Integer, default=0)
    description = Column(String(512), nullable=True)
    responsible_role = Column(String(128), nullable=True)  # 责任人/岗位
    doc_path = Column(String(512), nullable=True)  # 文档路径/NAS路径 (legacy, computed from base_path+file_pattern)
    base_path = Column(String(512), nullable=True)  # 路径模板, * = 产品代号占位符
    file_pattern = Column(String(256), nullable=True)  # 文件名模板, * = 产品代号占位符
    doc_type = Column(String(32), nullable=True)  # 文档类型: gitlab/svn/nas
    is_optional = Column(Integer, default=0)  # 0=必选 1=可选（产品可按需删除）


class ProductNamingOption(Base):
    """Configurable product naming convention options (e.g., series codes, FPGA options)."""
    __tablename__ = "product_naming_options"

    id = Column(Integer, primary_key=True)
    field_key = Column(String(32), nullable=False, index=True)  # series / fpga / cpu / adc / form
    code = Column(String(8), nullable=False)
    description = Column(String(64), nullable=False)
    sort_order = Column(Integer, default=0)


class BugTemplate(Base):
    """Bug submission templates — name + markdown content, managed in doc-templates page."""
    __tablename__ = "pma_bug_templates"

    id = Column(Integer, primary_key=True)
    name = Column(String(128), nullable=False)
    content = Column(Text, nullable=True)  # Markdown
    is_default = Column(Integer, default=0)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, default=func.now())


class TaskTemplate(Base):
    """Global task template per stage type and project type. Configurable via admin UI.

    When a project is initialized, tasks are auto-created from these templates
    in the corresponding stages and assigned to the responsible_role person.
    """
    __tablename__ = "task_templates"

    id = Column(Integer, primary_key=True)
    project_type = Column(String(32), nullable=False, default="RD", server_default="RD", index=True)
    stage_type = Column(String(64), nullable=False, index=True)
    task_name = Column(String(256), nullable=False)
    sort_order = Column(Integer, default=0)
    description = Column(String(512), nullable=True)
    responsible_role = Column(String(128), nullable=True)  # 责任人/岗位
    priority = Column(String(16), default="medium")  # low / medium / high / critical — 缺省优先级
    is_unnecessary = Column(Integer, default=0)  # 0=正常 1=无需任务
    is_optional = Column(Integer, default=0)  # 0=必选 1=可选（项目可按需删除）
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class ProductLine(Base):
    """Hierarchical product tree nodes (3 levels).
    Level 1 = 产品线, Level 2 = 产品系列, Level 3 = 产品型号.
    Doc templates attach to leaf nodes (level 3)."""
    __tablename__ = "pma_product_lines"

    id = Column(Integer, primary_key=True)
    name = Column(String(128), nullable=False)
    parent_id = Column(Integer, ForeignKey("pma_product_lines.id"), nullable=True, index=True)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, default=func.now())


class ProductDocument(Base):
    """Per-product document instance, initialized from ProductDocTemplate on first view.
    Tracks actual document status, location, and upload info for each product."""
    __tablename__ = "product_documents"

    id = Column(Integer, primary_key=True)
    product_id = Column(Integer, nullable=False, index=True)
    template_id = Column(Integer, ForeignKey("product_doc_templates.id"), nullable=True, index=True)
    stage_type = Column(String(64), nullable=False, default="通用")
    doc_name = Column(String(256), nullable=False)
    sort_order = Column(Integer, default=0)
    status = Column(String(32), default="pending")
    responsible_role = Column(String(128), nullable=True)
    description = Column(String(512), nullable=True)
    doc_path = Column(String(512), nullable=True)
    location = Column(Text, nullable=True)
    doc_type = Column(String(32), nullable=True)  # gitlab/svn/nas/solidworks/pma
    completed_at = Column(DateTime, nullable=True)
    uploaded_by = Column(String(64), nullable=True)
    uploaded_at = Column(DateTime, nullable=True)
    updated_by = Column(String(64), nullable=True)
    is_optional = Column(Integer, default=0)  # 0=必选 1=可选（从模板复制）
    is_removed = Column(Integer, default=0)  # 0=正常 1=已删除（可选项被移除）
    file_count = Column(Integer, default=0)  # 文件夹内条目数（0=单文件/不适用，>0=PDM文件夹级模板）
    svn_author = Column(String(128), nullable=True)  # SVN 最后提交人
    svn_last_modified = Column(String(128), nullable=True)  # SVN 最后修改时间（北京时间 YYYY-MM-DD HH:MM:SS）
    svn_rev = Column(String(32), nullable=True)  # SVN 最后提交版本号（version-name）
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class PmaTag(Base):
    """Managed tags for products and projects. Configurable via admin UI."""
    __tablename__ = "pma_tags"

    id = Column(Integer, primary_key=True)
    name = Column(String(128), nullable=False, unique=True)
    category = Column(String(32), nullable=True)  # 'project' | 'product' | null(通用)
    created_at = Column(DateTime, default=func.now())


class DocReleaseMatch(Base):
    """Every GitLab release matched by a document's path pattern.

    Shared by project documents (project_doc_id) and product documents
    (product_doc_id). The scanner rewrites rows per doc on each scan so the
    source of truth stays GitLab. `is_current` flags the version that equals
    the doc's location (the auto-tracked latest).
    """
    __tablename__ = "doc_release_matches"

    id = Column(Integer, primary_key=True)
    project_doc_id = Column(Integer, nullable=True, index=True)  # project_documents.id
    product_doc_id = Column(Integer, nullable=True, index=True)  # product_documents.id
    version_name = Column(String(256), nullable=False)  # GitLab release tag_name
    gitlab_url = Column(String(1024), nullable=True)  # 完整发布 URL
    released_at = Column(DateTime, nullable=True)  # release created_at（naive UTC）
    is_current = Column(Integer, default=0)  # 1 = 等于该文档 doc.location 对应版本
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class ProjectReleaseLock(Base):
    """Per-project version selection (lock) on a release document.

    Display-layer override for the 软件版本 tab: a doc's shown "current" version
    is the locked one (default: the auto-tracked latest). The underlying doc
    location keeps auto-tracking latest on scans.
    """
    __tablename__ = "project_release_lock"

    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, nullable=False, index=True)
    source_type = Column(String(16), nullable=False)  # 'project_doc' | 'product_doc'
    doc_id = Column(Integer, nullable=False)  # project_documents.id / product_documents.id
    version_name = Column(String(256), nullable=False)  # 选定的当前版本 tag
    locked_by = Column(String(128), nullable=True)
    locked_at = Column(DateTime, default=func.now())
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    __table_args__ = (UniqueConstraint("project_id", "source_type", "doc_id"),)


class ProjectReleaseAuto(Base):
    """Per-doc「自动锁定最新版本」开关（per-project × per-doc）。

    项目发布卡片的「全部使用产品基础版本」、产品BSP卡片的「全部使用最新版本」
    均为批量开关；本表记录每个文档的**单独**开关状态（子项级控制）：

    - project_doc：仅 `FPGA版本开发-<产品代码>` 自动文档（mode 开启时按产品自动管理）；
    - product_doc：产品 BSP 文档。
    - enabled=1 → 该文档自动锁定最新版本（auto_managed，禁止手动选择）；
    - enabled=0 → 该文档手动管理。

    批量开关开启时批量置 1（/关闭时置 0），之后可对单个文档精细调整。
    """
    __tablename__ = "project_release_auto"

    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, nullable=False, index=True)
    source_type = Column(String(16), nullable=False)  # 'project_doc' | 'product_doc'
    doc_id = Column(Integer, nullable=False)  # project_documents.id / product_documents.id
    enabled = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    __table_args__ = (UniqueConstraint("project_id", "source_type", "doc_id"),)
