"""ProjectStage model — per-project stage instances with dates, owner, and progress."""
from datetime import datetime
from sqlalchemy import Column, Integer, String, Date, DateTime, Text, ForeignKey
from sqlalchemy.sql import func

from backend.database import Base


class ProjectStage(Base):
    __tablename__ = "pma_project_stages"

    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey("zenta_projects.id"), nullable=False, index=True)
    name = Column(String(128), nullable=False)
    sort_order = Column(Integer, default=0)
    status = Column(String(32), default="active")  # active / completed / blocked
    start_date = Column(Date, nullable=True)
    end_date = Column(Date, nullable=True)
    completed_date = Column(Date, nullable=True)
    owner_id = Column(Integer, ForeignKey("local_users.id"), nullable=True)
    progress = Column(Integer, default=0)       # cached: avg progress of all tasks in this stage
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
