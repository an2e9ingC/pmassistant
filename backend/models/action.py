"""Entity action log (task/bug change history) — Zentao-style action + change model."""
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.sql import func

from backend.database import Base


class EntityAction(Base):
    """操作记录（任务/Bug 共用），参照禅道 action 表。"""
    __tablename__ = "pma_entity_actions"

    id = Column(Integer, primary_key=True)
    entity_type = Column(String(16), nullable=False, index=True)  # 'task' | 'bug'
    entity_id = Column(Integer, nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("local_users.id"), nullable=False)
    action = Column(String(32), nullable=False)  # created / updated / approved / rejected / deleted
    comment = Column(Text, nullable=True)  # 操作备注（可选）
    created_at = Column(DateTime, default=func.now())


class EntityActionChange(Base):
    """字段级变更（old/new），参照禅道 history 表。"""
    __tablename__ = "pma_entity_action_changes"

    id = Column(Integer, primary_key=True)
    action_id = Column(Integer, ForeignKey("pma_entity_actions.id"), nullable=False, index=True)
    field = Column(String(32), nullable=False)  # 字段名（英文，如 status/assignee_id）
    old_value = Column(Text, nullable=True)
    new_value = Column(Text, nullable=True)
