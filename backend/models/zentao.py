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
    code = Column(String(128), unique=True, index=True)
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
    program_id = Column(Integer, nullable=True, index=True)
    program_name = Column(String(128), nullable=True)
    pm_name = Column(String(128), nullable=True)
    # PMA-local enrichments (not overwritten by sync)
    project_type = Column(String(16), default="RD")
    customer_name = Column(String(256), nullable=True)
    # Delivery plan (PMA-local, not overwritten by sync)
    planned_delivery_qty = Column(Integer, default=0)
    delivered_sets_qty = Column(Integer, default=0)  # manual delivered sets count for big ring
    delivery_note = Column(Text, nullable=True)
    # Per-product delivery plans: JSON array [{"product_code":"xx","product_name":"yy","planned_qty":5},...]
    product_delivery_plans = Column(Text, nullable=True)
    # PMA-local project background (not overwritten by sync)
    background = Column(Text, nullable=True)
    # PMA-local linked projects (comma-separated project IDs, not overwritten by sync)
    linked_project_ids = Column(Text, nullable=True)
    # Extracted from Zentao project desc
    description = Column(Text, nullable=True)
    tags = Column(Text, nullable=True)  # comma-separated #tags extracted from desc
    raw_json = Column(Text)
    synced_at = Column(DateTime, default=func.now())
    # PMA-local flag: True for manually created projects (not synced from Zentao)
    is_local = Column(Boolean, default=False)
    # Creator info
    reporter_id = Column(Integer, ForeignKey("local_users.id"), nullable=True)


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


class PmaProduct(Base):
    __tablename__ = "pma_products"

    id = Column(Integer, primary_key=True)
    code = Column(String(128), unique=True, index=True)
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
    # Extracted from Zentao product desc
    description = Column(Text, nullable=True)
    tags = Column(Text, nullable=True)  # comma-separated #tags extracted from desc
    raw_json = Column(Text)
    synced_at = Column(DateTime, default=func.now())
    # PMA-local flag: True for manually created products (not synced from Zentao)
    is_local = Column(Boolean, default=False)
    # Creator info
    reporter_id = Column(Integer, ForeignKey("local_users.id"), nullable=True)


class ProductProjectLink(Base):
    __tablename__ = "product_project_links"

    id = Column(Integer, primary_key=True)
    product_id = Column(Integer, ForeignKey("pma_products.id"), nullable=False, index=True)
    project_id = Column(Integer, ForeignKey("zenta_projects.id"), nullable=False, index=True)
    created_at = Column(DateTime, default=func.now())
    quantity = Column(Integer, nullable=False, default=1, server_default="1")

    __table_args__ = (UniqueConstraint("product_id", "project_id"),)


class PmaCustomer(Base):
    __tablename__ = "pma_customers"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(128), unique=True, nullable=False, index=True)
    full_name = Column(String(256), nullable=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class CustomerProjectLink(Base):
    __tablename__ = "customer_project_links"

    id = Column(Integer, primary_key=True)
    customer_id = Column(Integer, ForeignKey("pma_customers.id"), nullable=False, index=True)
    project_id = Column(Integer, ForeignKey("zenta_projects.id"), nullable=False, index=True)
    created_at = Column(DateTime, default=func.now())

    __table_args__ = (UniqueConstraint("customer_id", "project_id"),)


class CustomerProductLink(Base):
    __tablename__ = "customer_product_links"

    id = Column(Integer, primary_key=True)
    customer_id = Column(Integer, ForeignKey("pma_customers.id"), nullable=False, index=True)
    product_id = Column(Integer, ForeignKey("pma_products.id"), nullable=False, index=True)
    created_at = Column(DateTime, default=func.now())

    __table_args__ = (UniqueConstraint("customer_id", "product_id"),)


class CachedRelease(Base):
    """Zentao product releases/versions — synced from /products/:id/releases."""
    __tablename__ = "zenta_releases"

    id = Column(Integer, primary_key=True)
    product_id = Column(Integer, ForeignKey("pma_products.id"), nullable=False, index=True)
    name = Column(String(256), nullable=False)            # version name, e.g. "v1.0.0"
    marker = Column(Integer, default=0)                    # 0=normal, 1=milestone
    status = Column(String(32), default="normal")          # normal / terminated
    date = Column(Date, nullable=True)                     # release date
    desc = Column(Text, nullable=True)                     # description (may contain GitLab URLs)
    # PMA-local enrichments
    gitlab_url = Column(String(1024), nullable=True)       # extracted GitLab release URL
    gitlab_url_valid = Column(Boolean, nullable=True)      # None=not checked, True=valid, False=invalid
    gitlab_url_checked_at = Column(DateTime, nullable=True)  # last validation time
    raw_json = Column(Text)
    synced_at = Column(DateTime, default=func.now())

    product = relationship("PmaProduct", backref="releases_list")


class ProductNodeLink(Base):
    """Link ZenTao/local products (zenta_products) to product hierarchy tree nodes (pma_product_lines)."""
    __tablename__ = "product_node_links"

    id = Column(Integer, primary_key=True)
    product_id = Column(Integer, ForeignKey("pma_products.id"), nullable=False, index=True)
    product_node_id = Column(Integer, ForeignKey("pma_product_lines.id"), nullable=False, index=True)
    created_at = Column(DateTime, default=func.now())

    __table_args__ = (UniqueConstraint("product_id", "product_node_id"),)
