from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from backend.database import Base


class LocalUser(Base):
    __tablename__ = "local_users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(64), unique=True, nullable=False, index=True)
    password_hash = Column(String(256), nullable=True)  # NULL for GitLab users
    display_name = Column(String(128), nullable=True)
    role = Column(String(32), default="viewer")  # primary role (legacy)
    zentao_account = Column(String(64), nullable=True)
    auth_source = Column(String(16), default="local")  # 'local' or 'gitlab'
    gitlab_user_id = Column(Integer, nullable=True, index=True)  # GitLab user ID
    gitlab_access_token = Column(String(256), nullable=True)  # OAuth access token (for API calls as user)
    is_active = Column(Boolean, default=True)
    favorites = Column(Text, default="[]")  # JSON array of product IDs
    seen_version = Column(String(32), nullable=True)  # last seen changelog version
    last_login_at = Column(DateTime, nullable=True)  # last login timestamp
    last_login_ip = Column(String(64), nullable=True)  # last login IP address
    last_login_ua = Column(String(256), nullable=True)  # last login User-Agent (browser info)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    # Relationship to roles via UserRole link table
    user_roles = relationship("UserRole", back_populates="user", lazy="selectin")


class Role(Base):
    __tablename__ = "local_roles"

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String(32), unique=True, nullable=False, index=True)
    label = Column(String(64), nullable=False)
    permissions = Column(String(256), default="")  # comma-separated
    description = Column(String(256), nullable=True)
    created_at = Column(DateTime, default=func.now())

    # Relationship
    user_roles = relationship("UserRole", back_populates="role", lazy="selectin")


class UserRole(Base):
    __tablename__ = "user_roles"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("local_users.id"), nullable=False, index=True)
    role_id = Column(Integer, ForeignKey("local_roles.id"), nullable=False, index=True)

    user = relationship("LocalUser", back_populates="user_roles")
    role = relationship("Role", back_populates="user_roles")


class ProductNote(Base):
    __tablename__ = "product_notes"

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, nullable=False, index=True)
    content = Column(Text, nullable=False)
    category = Column(String(64), nullable=True, default="")  # 涉及领域
    parent_id = Column(Integer, nullable=True)  # 回复的父笔记ID
    recorded_by = Column(String(64), nullable=False, default="")
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, nullable=True)  # 编辑时间


class ProductBlockDiagram(Base):
    """Product system block diagram images uploaded by users."""

    __tablename__ = "product_block_diagrams"

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, nullable=False, index=True)
    filename = Column(String(256), nullable=False)
    file_path = Column(String(512), nullable=False)
    uploaded_by = Column(String(64), nullable=False, default="")
    created_at = Column(DateTime, default=func.now())


class ProjectNote(Base):
    __tablename__ = "project_notes"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, nullable=False, index=True)
    stage_name = Column(String(256), nullable=True, default="")
    content = Column(Text, nullable=False)
    parent_id = Column(Integer, nullable=True)  # 回复的父笔记ID
    recorded_by = Column(String(64), nullable=False, default="")
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, nullable=True)  # 编辑时间


class PmaSetting(Base):
    __tablename__ = "pma_settings"

    id = Column(Integer, primary_key=True)
    key = Column(String(64), unique=True, nullable=False, index=True)
    value = Column(String(256), default="")

    @classmethod
    def get(cls, db_session, key: str, default: str = "") -> str:
        row = db_session.query(cls).filter(cls.key == key).first()
        return row.value if row else default

    @classmethod
    def set(cls, db_session, key: str, value: str):
        row = db_session.query(cls).filter(cls.key == key).first()
        if row:
            row.value = value
        else:
            db_session.add(cls(key=key, value=value))
        db_session.commit()


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True)
    username = Column(String(64), nullable=False)
    action = Column(String(64), nullable=False)  # delete_user, delete_cust, clear_db, etc.
    category = Column(String(32), nullable=True)   # dynamic—derived from actual usage
    level = Column(String(16), nullable=True, default="medium")     # high/medium/low
    detail = Column(String(512), nullable=True)
    created_at = Column(DateTime, default=func.now())


class ProjectActivity(Base):
    """Per-project activity log for PMA operations (non-deletable)."""
    __tablename__ = "project_activities"

    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey("zenta_projects.id"), nullable=False, index=True)
    username = Column(String(64), nullable=False)
    action = Column(String(128), nullable=False)   # e.g. 交付计划, 文档状态, 阶段映射, 项目笔记
    detail = Column(String(512), nullable=True)     # e.g. "设置应交付总数 10 → 20"
    created_at = Column(DateTime, default=func.now())


class ProductActivity(Base):
    """Per-product activity log for PMA operations (non-deletable)."""
    __tablename__ = "product_activities"

    id = Column(Integer, primary_key=True)
    product_id = Column(Integer, ForeignKey("pma_products.id"), nullable=False, index=True)
    username = Column(String(64), nullable=False)
    action = Column(String(128), nullable=False)   # e.g. 编辑产品, 关联项目, 文档更新, 框图
    detail = Column(String(512), nullable=True)
    created_at = Column(DateTime, default=func.now())


class SyncLog(Base):
    __tablename__ = "sync_logs"

    id = Column(Integer, primary_key=True)
    started_at = Column(DateTime, nullable=False)
    finished_at = Column(DateTime, nullable=True)
    status = Column(String(16), default="running")  # running, success, failed
    entity_type = Column(String(32), nullable=False)
    items_fetched = Column(Integer, default=0)
    items_created = Column(Integer, default=0)
    items_updated = Column(Integer, default=0)
    error_message = Column(Text, nullable=True)


class PmaNotification(Base):
    """Admin-published broadcast notifications displayed in the top bar."""
    __tablename__ = "pma_notifications"

    id = Column(Integer, primary_key=True, index=True)
    level = Column(String(16), nullable=False, default="general")  # severe / important / general
    content = Column(String(128), nullable=False)
    created_by = Column(String(64), nullable=False)  # publisher username
    is_active = Column(Boolean, default=True)  # False = dismissed
    created_at = Column(DateTime, default=func.now())
