from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, Text, ForeignKey
from sqlalchemy.sql import func

from backend.database import Base


class DocumentTemplate(Base):
    """Global document template per stage type. Configurable via admin UI."""
    __tablename__ = "document_templates"

    id = Column(Integer, primary_key=True)
    stage_type = Column(String(64), nullable=False, index=True)
    doc_name = Column(String(256), nullable=False)
    sort_order = Column(Integer, default=0)
    description = Column(String(512), nullable=True)
    responsible_role = Column(String(128), nullable=True)  # 责任人/岗位


class ProjectDocument(Base):
    """Per-project document instance, initialized from templates on first view."""
    __tablename__ = "project_documents"

    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey("zenta_projects.id"), nullable=False, index=True)
    execution_id = Column(Integer, ForeignKey("zenta_executions.id"), nullable=False, index=True)
    stage_type = Column(String(64), nullable=False)
    doc_name = Column(String(256), nullable=False)
    sort_order = Column(Integer, default=0)
    status = Column(String(32), default="pending")  # pending | submitted
    responsible_role = Column(String(128), nullable=True)  # 责任人/岗位（从模板复制）
    description = Column(String(512), nullable=True)  # 说明（从模板复制）
    completed_at = Column(DateTime, nullable=True)
    location = Column(Text, nullable=True)
    updated_by = Column(String(64), nullable=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
