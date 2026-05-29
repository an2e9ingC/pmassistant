from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, Text, Date
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
