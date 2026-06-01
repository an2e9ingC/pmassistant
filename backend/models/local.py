from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text
from sqlalchemy.sql import func

from backend.database import Base


class LocalUser(Base):
    __tablename__ = "local_users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(64), unique=True, nullable=False, index=True)
    password_hash = Column(String(256), nullable=False)
    display_name = Column(String(128), nullable=False)
    role = Column(String(32), default="viewer")  # admin, manager, viewer
    zentao_account = Column(String(64), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


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
