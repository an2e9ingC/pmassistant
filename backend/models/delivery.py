from datetime import datetime
from sqlalchemy import Column, Integer, String, Date, DateTime, Text, ForeignKey, UniqueConstraint, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from backend.database import Base


class DeliveryRecord(Base):
    """PMA-local delivery tracking records."""
    __tablename__ = "delivery_records"

    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey("zenta_projects.id"), nullable=False, index=True)
    product_name = Column(String(256), nullable=False)
    product_code = Column(String(128), nullable=True)  # 产品型号（PMA product code）
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


class DeliveryBoard(Base):
    """Physical board (板卡) archive per project — lifecycle tracked via events."""
    __tablename__ = "delivery_boards"
    __table_args__ = (UniqueConstraint("project_id", "serial_no", name="uq_delivery_boards_project_serial"),)

    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey("zenta_projects.id"), nullable=False, index=True)
    serial_no = Column(String(128), nullable=False)
    product_code = Column(String(128), nullable=True)  # 产品型号（PMA product code）
    product_name = Column(String(256), nullable=True)
    status = Column(String(32), default="在库", nullable=False, index=True)
    owner = Column(String(128), nullable=True)  # 归属人 username
    current_holder = Column(String(128), nullable=True)  # 当前持有人（物理持有）
    note = Column(Text, nullable=True)
    created_by = Column(String(64), nullable=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    events = relationship("DeliveryBoardEvent", back_populates="board",
                          cascade="all, delete-orphan",
                          order_by="DeliveryBoardEvent.event_time")


class DeliveryBoardEvent(Base):
    """Lifecycle event on a board (timeline). Fields beyond common columns are
    stored generically in `data` JSON — schema defined by status config so future
    statuses can be added without altering this table."""
    __tablename__ = "delivery_board_events"

    id = Column(Integer, primary_key=True)
    board_id = Column(Integer, ForeignKey("delivery_boards.id", ondelete="CASCADE"),
                      nullable=False, index=True)
    from_status = Column(String(32), nullable=True)
    to_status = Column(String(32), nullable=False)
    event_time = Column(DateTime, nullable=True, default=func.now())
    actor = Column(String(128), nullable=True)
    note = Column(Text, nullable=True)
    data = Column(JSON, nullable=True)  # 目标状态表单字段通用存储 + 维修 Bug 关键信息
    delivery_record_id = Column(Integer, nullable=True, index=True)
    bug_id = Column(Integer, nullable=True, index=True)  # 关联维修 Bug
    created_by = Column(String(64), nullable=True)
    created_at = Column(DateTime, default=func.now())

    board = relationship("DeliveryBoard", back_populates="events")
