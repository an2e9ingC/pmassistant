from sqlalchemy import Column, Integer, String, Text, DateTime
from sqlalchemy.sql import func

from backend.database import Base


class ProcessStandard(Base):
    """System-wide process standards and validation rules (key-value config)."""
    __tablename__ = "process_standards"

    id = Column(Integer, primary_key=True)
    category = Column(String(64), nullable=False, index=True)  # e.g. "产品编号", "GitLab发布"
    key = Column(String(128), nullable=False)                    # e.g. "format", "title_pattern"
    value = Column(Text, nullable=True)                          # the rule value/pattern
    description = Column(String(512), nullable=True)             # human-readable explanation
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
