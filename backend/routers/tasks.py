"""Task CRUD API routes."""
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.middleware.auth import get_current_user, require_perm
from backend.services import task_service
from backend.services.entity_resolver import resolve_project

logger = logging.getLogger(__name__)


def _resolve_project_id(db: Session, pid: str) -> int:
    """Resolve a project identifier (code like PE0454 or numeric ID) to an integer ID."""
    from backend.models.zentao import CachedProject
    # Try as integer first
    try:
        int_id = int(pid)
        if db.query(CachedProject).filter(CachedProject.id == int_id).first():
            return int_id
    except (ValueError, TypeError):
        pass
    # Try as code
    p = db.query(CachedProject).filter(CachedProject.code == pid).first()
    if p:
        return p.id
    return 0
from backend.audit_categories import AUDIT_CAT_TASK
from backend.routers.logs import log_audit

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


class TaskCreate(BaseModel):
    project_id: int
    execution_id: Optional[int] = None
    stage_name: Optional[str] = None
    progress: Optional[int] = 0
    title: str
    description: Optional[str] = None
    status: Optional[str] = "todo"
    priority: Optional[str] = "medium"
    type: Optional[str] = "development"
    assignee_id: Optional[int] = None
    parent_id: Optional[int] = None
    blocked_by_id: Optional[int] = None
    estimate_hours: Optional[float] = 0.0
    start_date: Optional[str] = None
    due_date: Optional[str] = None
    output_items: Optional[List] = None


class TaskBatchCreate(BaseModel):
    tasks: List[dict]
    project_id: Optional[str] = None  # accepts code (PE0454) or numeric ID


class TaskImport(BaseModel):
    task_ids: List[int]
    target_project_id: int
    execution_mapping: Optional[dict] = None  # {source_exec_id: target_exec_id}


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    type: Optional[str] = None
    execution_id: Optional[int] = None
    stage_name: Optional[str] = None
    progress: Optional[int] = None
    assignee_id: Optional[int] = None
    parent_id: Optional[int] = None
    blocked_by_id: Optional[int] = None
    estimate_hours: Optional[float] = None
    start_date: Optional[str] = None
    due_date: Optional[str] = None
    output_items: Optional[List] = None
    sort_order: Optional[int] = None


@router.get("", response_model=dict)
def list_tasks(
    project_id: Optional[str] = Query(None),
    execution_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    assignee_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    pid = None
    if project_id:
        p = resolve_project(db, project_id)
        pid = p.id
    tasks = task_service.get_tasks(db, pid, execution_id, status, assignee_id)
    return {"code": 0, "data": tasks, "message": "ok"}


@router.get("/my", response_model=dict)
def my_tasks(
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    tasks = task_service.get_my_tasks(db, user.id)
    return {"code": 0, "data": tasks, "message": "ok"}


@router.get("/stats", response_model=dict)
def task_stats(
    project_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    pid = None
    if project_id:
        p = resolve_project(db, project_id)
        pid = p.id
    stats = task_service.get_task_stats(db, pid)
    return {"code": 0, "data": stats, "message": "ok"}


@router.get("/{task_id}", response_model=dict)
def get_task(
    task_id: int,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    t = task_service.get_task(db, task_id)
    if not t:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"code": 0, "data": t, "message": "ok"}


@router.post("", response_model=dict)
def create_task(
    payload: TaskCreate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("task_edit")),
):
    t = task_service.create_task(db, payload.model_dump(), user)
    log_audit(db, user, "task_create", f"任务「{payload.title}」", AUDIT_CAT_TASK, "medium")
    return {"code": 0, "data": t, "message": "ok"}


@router.post("/batch", response_model=dict)
def create_tasks_batch(
    payload: TaskBatchCreate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("task_edit")),
):
    if not payload.project_id:
        raise HTTPException(status_code=400, detail="project_id is required")
    # Resolve project_id: accepts code (PE0454) or numeric ID as string
    project_id = _resolve_project_id(db, payload.project_id)
    if not project_id:
        raise HTTPException(status_code=400, detail=f"project not found: {payload.project_id}")
    logger.info(f"[task-batch] user={user.username} project_id={project_id} task_count={len(payload.tasks)}")
    valid_tasks = []
    for i, d in enumerate(payload.tasks):
        d["project_id"] = project_id
        if not d.get("title", "").strip():
            logger.warning(f"[task-batch] skipping task #{i}: empty title")
            continue
        # Ensure numeric fields are valid
        if d.get("execution_id") is not None:
            try: d["execution_id"] = int(d["execution_id"])
            except (ValueError, TypeError): d["execution_id"] = None
        if d.get("assignee_id") is not None:
            try: d["assignee_id"] = int(d["assignee_id"])
            except (ValueError, TypeError): d["assignee_id"] = None
        valid_tasks.append(d)
    if not valid_tasks:
        raise HTTPException(status_code=400, detail="没有有效的任务数据")
    tasks = task_service.create_tasks_batch(db, valid_tasks, user)
    return {"code": 0, "data": tasks, "message": "ok"}


@router.post("/import", response_model=dict)
def import_tasks(
    payload: TaskImport,
    db: Session = Depends(get_db),
    user=Depends(require_perm("task_edit")),
):
    tasks = task_service.import_tasks(
        db, payload.task_ids, payload.target_project_id,
        payload.execution_mapping or {}, user
    )
    return {"code": 0, "data": tasks, "message": "ok"}


class TaskBatchUpdate(BaseModel):
    task_ids: List[int]
    updates: TaskUpdate


@router.put("/batch", response_model=dict)
def batch_update_tasks(
    payload: TaskBatchUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("task_edit")),
):
    """Batch update fields for multiple tasks."""
    if not payload.task_ids:
        raise HTTPException(status_code=400, detail="请选择至少一个任务")
    updates = payload.updates.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="请至少设置一个要更新的字段")
    updated = 0
    for tid in payload.task_ids:
        t = task_service.update_task(db, tid, updates, user)
        if t: updated += 1
    db.commit()
    return {"code": 0, "data": {"updated": updated, "total": len(payload.task_ids)}, "message": "ok"}


@router.put("/{task_id}", response_model=dict)
def update_task(
    task_id: int,
    payload: TaskUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("task_edit")),
):
    t = task_service.update_task(db, task_id, payload.model_dump(exclude_unset=True), user)
    if not t:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"code": 0, "data": t, "message": "ok"}


class ExtendEstimateBody(BaseModel):
    additional_hours: float


@router.post("/{task_id}/extend-estimate", response_model=dict)
def extend_estimate(
    task_id: int,
    body: ExtendEstimateBody,
    db: Session = Depends(get_db),
    user=Depends(require_perm("task_edit")),
):
    t = task_service.extend_task_estimate(db, task_id, body.additional_hours)
    if not t:
        raise HTTPException(status_code=404, detail="Task not found")
    log_audit(db, user, "task_extend", f"任务 #{task_id} 延长预估 {body.additional_hours}h", AUDIT_CAT_TASK, "medium")
    return {"code": 0, "data": t, "message": "已延长预估"}


@router.delete("/{task_id}", response_model=dict)
def delete_task(
    task_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_perm("task_edit")),
):
    ok = task_service.delete_task(db, task_id, user)
    if not ok:
        raise HTTPException(status_code=404, detail="Task not found")
    log_audit(db, user, "task_delete", f"删除任务 #{task_id}", AUDIT_CAT_TASK, "high")
    return {"code": 0, "data": None, "message": "ok"}


@router.post("/import-from-templates", response_model=dict)
def import_tasks_from_template(
    project_id: str = Query(...),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Import tasks from task templates for all stages of a project.
    Existing tasks (matched by template_id + project_id + stage_name) are not duplicated."""
    from backend.services.document_service import _sync_tasks_from_templates
    from backend.services.project_service import log_project_activity
    project = resolve_project(db, project_id)
    count = _sync_tasks_from_templates(db, project.id, project.project_type or "RD")
    log_audit(db, user, "task_import_templates", f"project={project.code} created={count}", AUDIT_CAT_TASK, "medium")
    log_project_activity(db, project.id, user.username, "导入模板任务", f"从模板创建了 {count} 个任务")
    return {"code": 0, "data": {"created": count}, "message": f"已创建 {count} 个任务"}


@router.delete("", response_model=dict)
def delete_all_tasks(
    project_id: str = Query(...),
    db: Session = Depends(get_db),
    user=Depends(require_perm("task_edit")),
):
    """Delete all PMA tasks for a project."""
    from backend.models.task import Task
    from backend.services.project_service import log_project_activity
    project = resolve_project(db, project_id)
    count = db.query(Task).filter(Task.project_id == project.id).delete()
    db.commit()
    log_audit(db, user, "task_delete_all", f"project={project.code} deleted={count}", AUDIT_CAT_TASK, "high")
    log_project_activity(db, project.id, user.username, "清空所有任务", f"删除了 {count} 个任务")
    return {"code": 0, "data": {"deleted": count}, "message": f"已删除 {count} 个任务"}


@router.post("/init-stages", response_model=dict)
def init_project_stages(
    project_id: str = Query(...),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Create ProjectStage rows for an existing project from template stage list.
    Idempotent: skips if stages already exist."""
    project = resolve_project(db, project_id)
    from backend.models.project_stage import ProjectStage
    existing = db.query(ProjectStage).filter(ProjectStage.project_id == project.id).count()
    if existing:
        return {"code": 0, "data": {"existed": existing}, "message": f"已有 {existing} 个阶段，无需初始化"}
    from backend.services.product_management_service import _init_project_stages
    count = _init_project_stages(db, project.id, project.project_type or "RD")
    # Auto-link existing tasks to new stages by matching stage_name
    linked = 0
    from backend.models.project_stage import ProjectStage
    from backend.models.task import Task
    stages = db.query(ProjectStage).filter(ProjectStage.project_id == project.id).all()
    for s in stages:
        updated = db.query(Task).filter(
            Task.project_id == project.id,
            Task.stage_name == s.name,
            Task.stage_id.is_(None),
        ).update({Task.stage_id: s.id}, synchronize_session=False)
        linked += updated
    if linked:
        db.commit()
    log_audit(db, user, "stage_init", f"project={project.code} created={count} linked_tasks={linked}", AUDIT_CAT_TASK, "medium")
    return {"code": 0, "data": {"created": count, "linked_tasks": linked}, "message": f"已创建 {count} 个阶段，关联 {linked} 个任务"}
