from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Boolean, DateTime, Text,
    Float, Date, ForeignKey, UniqueConstraint,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from backend.database import Base


class CachedProject(Base):
    __tablename__ = "zenta_projects"

    id = Column(Integer, primary_key=True)
    code = Column(String(128), index=True)
    name = Column(String(256), nullable=False)
    model = Column(String(32))
    status = Column(String(32), index=True)
    begin = Column(Date)
    end = Column(Date)
    real_began = Column(Date, nullable=True)
    real_end = Column(Date, nullable=True)
    progress = Column(String(16))
    estimate = Column(Float, default=0.0)
    consumed = Column(Float, default=0.0)
    pm_name = Column(String(128), nullable=True)
    pm_account = Column(String(64), nullable=True)
    # PMA-local enrichments (not overwritten by sync)
    project_type = Column(String(16), default="RD")
    alias_name = Column(String(256), nullable=True)
    customer_name = Column(String(256), nullable=True)
    raw_json = Column(Text)
    synced_at = Column(DateTime, default=func.now())


class CachedExecution(Base):
    __tablename__ = "zenta_executions"

    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey("zenta_projects.id"), nullable=False, index=True)
    name = Column(String(256), nullable=False)
    type = Column(String(32))
    status = Column(String(32))
    begin = Column(Date)
    end = Column(Date)
    progress = Column(String(16))
    # PMA-local enrichments
    stage_name = Column(String(128), nullable=True)
    stage_order = Column(Integer, nullable=True)
    raw_json = Column(Text)
    synced_at = Column(DateTime, default=func.now())

    project = relationship("CachedProject", backref="executions")


class CachedTask(Base):
    __tablename__ = "zenta_tasks"

    id = Column(Integer, primary_key=True)
    execution_id = Column(Integer, ForeignKey("zenta_executions.id"), nullable=False, index=True)
    project_id = Column(Integer, nullable=False, index=True)
    parent_id = Column(Integer, nullable=True)
    name = Column(String(512), nullable=False)
    type = Column(String(32))
    status = Column(String(32))
    priority = Column(Integer, default=3)
    estimate = Column(Float, default=0.0)
    consumed = Column(Float, default=0.0)
    deadline = Column(Date, nullable=True)
    assigned_to = Column(String(64), nullable=True)
    assigned_realname = Column(String(128), nullable=True)
    real_started = Column(DateTime, nullable=True)
    finished_date = Column(DateTime, nullable=True)
    has_files = Column(Boolean, default=False)
    description = Column(Text, nullable=True)
    # PMA-local enrichments
    is_blocker = Column(Boolean, default=False)
    blocker_note = Column(Text, nullable=True)
    output_items = Column(Text, nullable=True)  # JSON list of expected output files
    raw_json = Column(Text)
    synced_at = Column(DateTime, default=func.now())

    execution = relationship("CachedExecution", backref="tasks")


class CachedUser(Base):
    __tablename__ = "zenta_users"

    id = Column(Integer, primary_key=True)
    account = Column(String(64), unique=True, index=True)
    realname = Column(String(128))
    role = Column(String(32))
    email = Column(String(128), nullable=True)
    dept = Column(Integer, default=0)
    raw_json = Column(Text)
    synced_at = Column(DateTime, default=func.now())


class CachedProduct(Base):
    __tablename__ = "zenta_products"

    id = Column(Integer, primary_key=True)
    code = Column(String(128), index=True)
    name = Column(String(256), nullable=False)
    type = Column(String(32))
    status = Column(String(32))
    program_id = Column(Integer, nullable=True)
    program_name = Column(String(128), nullable=True)  # Zentao product line name
    total_stories = Column(Integer, default=0)
    total_bugs = Column(Integer, default=0)
    releases = Column(Integer, default=0)
    # PMA-local enrichments
    category = Column(String(32), nullable=True)
    alias_name = Column(String(256), nullable=True)
    nas_path = Column(String(512), nullable=True)
    git_url = Column(String(512), nullable=True)
    pma_customer = Column(String(256), nullable=True)
    raw_json = Column(Text)
    synced_at = Column(DateTime, default=func.now())


class ProductProjectLink(Base):
    __tablename__ = "product_project_links"

    id = Column(Integer, primary_key=True)
    product_id = Column(Integer, ForeignKey("zenta_products.id"), nullable=False, index=True)
    project_id = Column(Integer, ForeignKey("zenta_projects.id"), nullable=False, index=True)
    created_at = Column(DateTime, default=func.now())

    __table_args__ = (UniqueConstraint("product_id", "project_id"),)
