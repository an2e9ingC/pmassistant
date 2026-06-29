"""PMA-native Task and WorkLog models."""
from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, Date, DateTime, Text, ForeignKey
from sqlalchemy.sql import func

from backend.database import Base


class Task(Base):
    """PMA-local tasks — project-scoped, stage-linked, with worklog tracking."""
    __tablename__ = "pma_tasks"

    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey("zenta_projects.id"), nullable=False, index=True)
    execution_id = Column(Integer, ForeignKey("zenta_executions.id"), nullable=True, index=True)
    title = Column(String(256), nullable=False)
    description = Column(Text, nullable=True)
    status = Column(String(32), default="todo")  # todo / in_progress / review / done / closed
    priority = Column(String(16), default="medium")  # low / medium / high / critical
    type = Column(String(32), default="development")  # development / bugfix / review / documentation / testing / other
    assignee_id = Column(Integer, ForeignKey("local_users.id"), nullable=True)
    reporter_id = Column(Integer, ForeignKey("local_users.id"), nullable=False)
    parent_id = Column(Integer, ForeignKey("pma_tasks.id"), nullable=True)
    blocked_by_id = Column(Integer, ForeignKey("pma_tasks.id"), nullable=True)
    estimate_hours = Column(Float, default=0.0)
    consumed_hours = Column(Float, default=0.0)  # Redundant: SUM(pma_worklogs.hours), maintained by service
    start_date = Column(Date, nullable=True)
    due_date = Column(Date, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    output_items = Column(Text, nullable=True)  # JSON: [{"name": "...", "url": "...", "type": "link"}]
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class WorkLog(Base):
    """Time tracking: each entry records hours spent on a task."""
    __tablename__ = "pma_worklogs"

    id = Column(Integer, primary_key=True)
    task_id = Column(Integer, ForeignKey("pma_tasks.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("local_users.id"), nullable=False)
    hours = Column(Float, nullable=False)
    date = Column(Date, nullable=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, default=func.now())


class TaskComment(Base):
    """Comments/discussion on tasks."""
    __tablename__ = "pma_task_comments"

    id = Column(Integer, primary_key=True)
    task_id = Column(Integer, ForeignKey("pma_tasks.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("local_users.id"), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=func.now())
