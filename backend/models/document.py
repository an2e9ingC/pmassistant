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
    doc_path = Column(String(512), nullable=True)  # 文档路径/NAS路径


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
    doc_path = Column(String(512), nullable=True)  # 文档路径/NAS路径


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
    completed_at = Column(DateTime, nullable=True)
    uploaded_by = Column(String(64), nullable=True)
    uploaded_at = Column(DateTime, nullable=True)
    updated_by = Column(String(64), nullable=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class PmaTag(Base):
    """Managed tags for products and projects. Configurable via admin UI."""
    __tablename__ = "pma_tags"

    id = Column(Integer, primary_key=True)
    name = Column(String(128), nullable=False, unique=True)
    category = Column(String(32), nullable=True)  # 'project' | 'product' | null(通用)
    created_at = Column(DateTime, default=func.now())
