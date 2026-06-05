from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from backend.database import Base


class LocalUser(Base):
    __tablename__ = "local_users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(64), unique=True, nullable=False, index=True)
    password_hash = Column(String(256), nullable=False)
    display_name = Column(String(128), nullable=True)  # deprecated, use username
    role = Column(String(32), default="viewer")  # primary role (legacy)
    zentao_account = Column(String(64), nullable=True)
    is_active = Column(Boolean, default=True)
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


class ProjectNote(Base):
    __tablename__ = "project_notes"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, nullable=False, index=True)
    stage_name = Column(String(256), nullable=True, default="")
    content = Column(Text, nullable=False)
    recorded_by = Column(String(64), nullable=False, default="")
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
