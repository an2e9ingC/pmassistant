from datetime import datetime
from sqlalchemy import Column, Integer, String, Date, DateTime, Text, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from backend.database import Base


class DeliveryRecord(Base):
    """PMA-local delivery tracking records."""
    __tablename__ = "delivery_records"

    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey("zenta_projects.id"), nullable=False, index=True)
    product_name = Column(String(256), nullable=False)
    product_code = Column(String(128), nullable=True)  # PMA product code
    serial_numbers = Column(Text, nullable=True)  # deprecated, migrated to delivery_material_codes
    quantity = Column(Integer, default=0)
    delivery_date = Column(Date, nullable=True)
    receiver = Column(String(128), nullable=True)
    responsible_person = Column(String(128), nullable=True)  # 交付责任人
    delivery_method = Column(String(32), nullable=True)  # 交付形式: 快递 / 人工携带
    note = Column(Text, nullable=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    material_codes = relationship("DeliveryMaterialCode", back_populates="record",
                                  cascade="all, delete-orphan", order_by="DeliveryMaterialCode.sort_order")


class DeliveryMaterialCode(Base):
    """Material codes for a delivery record (one per row)."""
    __tablename__ = "delivery_material_codes"

    id = Column(Integer, primary_key=True)
    record_id = Column(Integer, ForeignKey("delivery_records.id", ondelete="CASCADE"),
                       nullable=False, index=True)
    material_code = Column(String(256), nullable=False)
    sort_order = Column(Integer, default=0)

    record = relationship("DeliveryRecord", back_populates="material_codes")
