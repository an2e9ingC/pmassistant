from datetime import datetime
from sqlalchemy import Column, Integer, String, Date, DateTime, Text, ForeignKey
from sqlalchemy.sql import func

from backend.database import Base


class DeliveryRecord(Base):
    """PMA-local delivery tracking records."""
    __tablename__ = "delivery_records"

    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey("zenta_projects.id"), nullable=False, index=True)
    product_name = Column(String(256), nullable=False)
    serial_numbers = Column(Text, nullable=True)  # JSON array of serial numbers
    quantity = Column(Integer, default=0)
    delivery_date = Column(Date, nullable=True)
    receiver = Column(String(128), nullable=True)
    note = Column(Text, nullable=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
