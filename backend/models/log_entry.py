from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, Text
from sqlalchemy.sql import func

from backend.database import Base


class LogEntry(Base):
    """Persistent log entries for system diagnostics."""
    __tablename__ = "log_entries"

    id = Column(Integer, primary_key=True)
    timestamp = Column(DateTime, default=func.now(), index=True)
    level = Column(String(16), index=True)   # DEBUG, INFO, WARNING, ERROR, CRITICAL
    logger = Column(String(128))
    message = Column(Text)
    module = Column(String(256), nullable=True)
    created_at = Column(DateTime, default=func.now())
