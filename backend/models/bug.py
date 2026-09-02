"""PMA-native Bug tracking models."""
from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, DateTime, Text, Date, ForeignKey, JSON
from sqlalchemy.sql import func

from backend.database import Base


class CachedBug(Base):
    """Cached Zentao bugs for statistics."""
    __tablename__ = "zenta_bugs"

    id = Column(Integer, primary_key=True)
    product_id = Column(Integer, nullable=False, index=True)
    project_id = Column(Integer, nullable=True, index=True)
    title = Column(String(512), nullable=False)
    severity = Column(Integer, default=3)  # 1-4
    priority = Column(Integer, default=3)
    status = Column(String(32), index=True)
    type = Column(String(32))
    opened_by = Column(String(64))
    opened_date = Column(Date, nullable=True)
    assigned_to = Column(String(64))
    resolved_by = Column(String(64))
    resolved_date = Column(DateTime, nullable=True)
    closed_date = Column(DateTime, nullable=True)
    raw_json = Column(Text)
    synced_at = Column(DateTime, default=func.now())


class PmaBug(Base):
    """PMA-native bug tracking — product-scoped, with project optionally linked."""
    __tablename__ = "pma_bugs"

    id = Column(Integer, primary_key=True)
    title = Column(String(512), nullable=False)
    description = Column(Text, nullable=True)  # Markdown

    # Core relationships
    product_id = Column(Integer, ForeignKey("pma_products.id"), nullable=False, index=True)
    project_id = Column(Integer, ForeignKey("zenta_projects.id"), nullable=True, index=True)
    component_id = Column(Integer, ForeignKey("product_doc_templates.id"), nullable=True)

    # Status & resolution
    status = Column(String(32), default="open", index=True)
    # open / confirmed / in_progress / gitlab_submitted / resolved / closed
    resolution = Column(String(32), nullable=True)
    # resolved / unresolved / duplicate / wontfix / invalid / postponed

    # Severity & priority
    severity = Column(Integer, default=3)  # 1-4
    priority = Column(String(16), default="medium")  # low / medium / high / critical
    type = Column(String(32), default="codeerror")
    # codeerror / design / compatibility / standard / security / performance / other / repair

    # 维修类 Bug 关联的板卡 id 列表（DeliveryBoard.id）
    board_ids = Column(JSON, nullable=True, default=list)

    # People
    reporter_id = Column(Integer, ForeignKey("local_users.id"), nullable=False)
    assignee_id = Column(Integer, ForeignKey("local_users.id"), nullable=True)
    resolved_by_id = Column(Integer, ForeignKey("local_users.id"), nullable=True)
    cc_user_ids = Column(JSON, nullable=True, default=list)
    # List of user IDs who are CC'd on this bug, e.g. [2, 5, 7]

    # Genealogy
    original_bug_id = Column(Integer, ForeignKey("pma_bugs.id"), nullable=True)  # copy/clone source
    source_bug_id = Column(Integer, nullable=True)  # Zentao original bug ID

    # GitLab integration
    gitlab_url = Column(String(512), nullable=True)
    gitlab_iid = Column(Integer, nullable=True)

    # Work tracking
    estimate_hours = Column(Float, default=0.0)
    consumed_hours = Column(Float, default=0.0)
    progress = Column(Integer, default=0)  # 0-100

    # Dates
    due_date = Column(Date, nullable=True)
    resolved_at = Column(DateTime, nullable=True)
    closed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class BugWorkLog(Base):
    """Time tracking for bugs: percentage-authoritative (Issue #9).

    Same semantics as WorkLog — stores only the user-entered `percentage`;
    hour values are derived live via backend/services/worklog_hours.py.
    """
    __tablename__ = "pma_bug_worklogs"

    id = Column(Integer, primary_key=True)
    bug_id = Column(Integer, ForeignKey("pma_bugs.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("local_users.id"), nullable=False)
    hours = Column(Float, nullable=False)             # 休眠列：NOT NULL 占位（新行写 0.0），不再被读；仅史前 percentage IS NULL 行回退用
    percentage = Column(Float, nullable=True)         # 权威输入：工时占比 0-100（用户填写）
    calculated_hours = Column(Float, nullable=True)   # 休眠列：历史按行落库的派生值，不再被读/写
    date = Column(Date, nullable=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, default=func.now())


class BugAnalysis(Base):
    """Analysis/comment records on bugs — enhanced with markdown + attachments."""
    __tablename__ = "pma_bug_analysis"

    id = Column(Integer, primary_key=True)
    bug_id = Column(Integer, ForeignKey("pma_bugs.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("local_users.id"), nullable=False)
    title = Column(String(256), nullable=True)  # 分析标题（时间线默认显示）
    content = Column(Text, nullable=False)  # Markdown
    attachments = Column(JSON, nullable=True)  # [{"filename": "...", "url": "..."}]
    is_deleted = Column(Integer, default=0)   # 1=已删除（软删除），分析列表显示删除线
    created_at = Column(DateTime, default=func.now())


class BugAttachment(Base):
    """File attachments for bugs — stored on filesystem, DB holds metadata."""
    __tablename__ = "pma_bug_attachments"

    id = Column(Integer, primary_key=True)
    bug_id = Column(Integer, ForeignKey("pma_bugs.id"), nullable=False, index=True)
    analysis_id = Column(Integer, ForeignKey("pma_bug_analysis.id"), nullable=True, index=True)
    filename = Column(String(256), nullable=False)
    mime_type = Column(String(128), nullable=False)
    file_path = Column(String(512), nullable=False)  # relative to data/uploads/
    file_size = Column(Integer, default=0)
    uploaded_by = Column(Integer, ForeignKey("local_users.id"), nullable=False)
    created_at = Column(DateTime, default=func.now())


class BugTransfer(Base):
    """Records of bug transfers between projects."""
    __tablename__ = "pma_bug_transfers"

    id = Column(Integer, primary_key=True)
    bug_id = Column(Integer, ForeignKey("pma_bugs.id"), nullable=False, index=True)
    from_project_id = Column(Integer, ForeignKey("zenta_projects.id"), nullable=True)
    to_project_id = Column(Integer, ForeignKey("zenta_projects.id"), nullable=False)
    transfer_type = Column(String(16), nullable=False)  # move / copy
    transferred_by = Column(Integer, ForeignKey("local_users.id"), nullable=False)
    created_at = Column(DateTime, default=func.now())


class BugComment(Base):
    """Comments on bugs — manual user comments + auto system activity log."""
    __tablename__ = "pma_bug_comments"

    id = Column(Integer, primary_key=True)
    bug_id = Column(Integer, ForeignKey("pma_bugs.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("local_users.id"), nullable=False)
    content = Column(Text, nullable=False)
    is_system = Column(Integer, default=0)  # 0=user comment, 1=system auto-log
    is_deleted = Column(Integer, default=0)   # 1=已删除（软删除），时间线显示删除线
    created_at = Column(DateTime, default=func.now())
