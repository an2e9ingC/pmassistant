"""PMA-native Task and WorkLog models."""
from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, Date, DateTime, Text, ForeignKey, JSON
from sqlalchemy.sql import func

from backend.database import Base


class Task(Base):
    """PMA-local tasks — project-scoped, stage-linked, with worklog tracking."""
    __tablename__ = "pma_tasks"

    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey("zenta_projects.id"), nullable=False, index=True)
    product_id = Column(Integer, ForeignKey("pma_products.id"), nullable=True, index=True)  # 可选：多产品项目时显式指定归属产品
    stage_name = Column(String(128), nullable=True)  # template stage name
    stage_id = Column(Integer, ForeignKey("pma_project_stages.id"), nullable=True, index=True)  # FK to ProjectStage
    title = Column(String(256), nullable=False)
    description = Column(Text, nullable=True)
    status = Column(String(32), default="todo")  # todo / in_progress / review / done / closed
    priority = Column(String(16), default="medium")  # low / medium / high / critical
    type = Column(String(32), default="development")  # development / bugfix / review / documentation / testing / other
    assignee_id = Column(Integer, ForeignKey("local_users.id"), nullable=True)
    assignee_ids = Column(JSON, nullable=True, default=list)
    # List of user IDs assigned to this task, e.g. [2, 5, 7]
    # assignee_id is derived as assignee_ids[0] (or null if empty) for backward compatibility
    assignee_progress = Column(JSON, nullable=True, default=dict)
    # Per-person progress: {user_id: progress_0_to_100, ...}  e.g. {"2": 100, "5": 50}
    # Task overall progress = average of all assignee progress values (unset = 0)
    reviewer_id = Column(Integer, ForeignKey("local_users.id"), nullable=True)  # 审批人，进度100%时从 stage.owner_id 解析
    reporter_id = Column(Integer, ForeignKey("local_users.id"), nullable=False)
    cc_user_ids = Column(JSON, nullable=True, default=list)
    # List of user IDs who are CC'd on this task, e.g. [2, 5, 7]
    parent_id = Column(Integer, ForeignKey("pma_tasks.id"), nullable=True)
    blocked_by_id = Column(Integer, ForeignKey("pma_tasks.id"), nullable=True)
    progress = Column(Integer, default=0)  # 0-100, manually updated by user
    estimate_hours = Column(Float, default=0.0)
    original_estimate_hours = Column(Float, default=0.0)  # 原计划耗时，超预算延长后保留初始值
    consumed_hours = Column(Float, default=0.0)  # Redundant: SUM(pma_worklogs.hours), maintained by service
    start_date = Column(Date, nullable=True)
    due_date = Column(Date, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    output_items = Column(Text, nullable=True)  # JSON: [{"name": "...", "url": "...", "type": "link"}]
    template_id = Column(Integer, ForeignKey("task_templates.id"), nullable=True)  # NULL = manually created or template deleted
    is_diverged = Column(Integer, default=0)  # 1=用户手动修改过，模板同步时跳过该任务（不再覆盖用户修改）
    is_deleted = Column(Integer, default=0)   # 1=用户已删除（软删除），任务列表中隐藏
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
    percentage = Column(Float, nullable=True)         # 工时占比 0-100（用户填写）
    calculated_hours = Column(Float, nullable=True)   # 根据百分比×打卡工时自动计算的小时数
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
