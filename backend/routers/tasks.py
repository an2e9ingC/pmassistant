"""Task CRUD API routes."""
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import or_
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
    reviewer_id: Optional[int] = None
    parent_id: Optional[int] = None
    blocked_by_id: Optional[int] = None
    estimate_hours: Optional[float] = 0.0
    start_date: Optional[str] = None
    due_date: Optional[str] = None
    output_items: Optional[List] = None
    cc_user_ids: Optional[List[int]] = None


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
    reviewer_id: Optional[int] = None
    parent_id: Optional[int] = None
    blocked_by_id: Optional[int] = None
    estimate_hours: Optional[float] = None
    start_date: Optional[str] = None
    due_date: Optional[str] = None
    output_items: Optional[List] = None
    sort_order: Optional[int] = None
    cc_user_ids: Optional[List[int]] = None


@router.get("", response_model=dict)
def list_tasks(
    project_id: Optional[str] = Query(None),
    execution_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    assignee_id: Optional[int] = Query(None),
    reviewer_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    pid = None
    if project_id:
        p = resolve_project(db, project_id)
        pid = p.id
    tasks = task_service.get_tasks(db, pid, execution_id, status, assignee_id, reviewer_id)
    return {"code": 0, "data": tasks, "message": "ok"}


@router.get("/my", response_model=dict)
def my_tasks(
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    tasks = task_service.get_my_tasks(db, user.id)
    return {"code": 0, "data": tasks, "message": "ok"}


@router.get("/user/{user_id}", response_model=dict)
def get_user_tasks(user_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    """返回某用户的所有相关任务：负责人 + 创建人 + 被抄送"""
    tasks = task_service.get_user_tasks(db, user_id)
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




@router.get("/template-preview", response_model=dict)
def preview_template_tasks(
    project_id: str = Query(...),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Return template tasks + existing project tasks, annotated with status.

    Shows both:
      - Template tasks (from TaskTemplate) with their import status
      - Existing project tasks (including manual ones without template_id)
    Grouped by stage.
    """
    from backend.models.document import TaskTemplate
    from backend.models.task import Task
    from backend.services.document_service import get_stage_types_for_project_type

    project = resolve_project(db, project_id)
    project_type = project.project_type or "RD"
    standard_stages = get_stage_types_for_project_type(db, project_type)

    # Build lookup of existing tasks by template_id (for template matching)
    # Also track which stage+template combinations are covered
    existing_tasks = (
        db.query(Task)
        .filter(Task.project_id == project.id)
        .all()
    )

    # Index existing tasks by template_id
    task_by_template = {}  # template_id -> Task
    manual_tasks = []  # tasks without template_id
    template_task_ids = set()  # templates that have a matching task

    for t in existing_tasks:
        if t.template_id:
            task_by_template[t.template_id] = t
            template_task_ids.add(t.template_id)
        else:
            manual_tasks.append(t)

    # Group manual tasks by stage_name
    manual_by_stage = {}
    for t in manual_tasks:
        st = t.stage_name or ""
        manual_by_stage.setdefault(st, []).append(t)

    stages_result = []

    for st in standard_stages:
        items = []  # items for this stage: template-based + manual

        # 1. Template tasks for this stage
        templates = (
            db.query(TaskTemplate)
            .filter(
                TaskTemplate.stage_type == st,
                TaskTemplate.project_type == project_type,
                or_(TaskTemplate.is_unnecessary == 0, TaskTemplate.is_unnecessary == None),
            )
            .order_by(TaskTemplate.sort_order)
            .all()
        )

        for tpl in templates:
            existing = task_by_template.get(tpl.id)
            if not existing:
                status = "missing"
                existing_task_id = None
            elif existing.is_deleted:
                status = "exists_deleted"
                existing_task_id = existing.id
            elif existing.is_diverged:
                status = "exists_diverged"
                existing_task_id = existing.id
            else:
                status = "exists_active"
                existing_task_id = existing.id

            items.append({
                "template_id": tpl.id,
                "task_name": tpl.task_name,
                "sort_order": tpl.sort_order,
                "status": status,
                "existing_task_id": existing_task_id,
            })

        # 2. Manual tasks (no template) in this stage
        stage_manual = manual_by_stage.pop(st, [])
        for t in sorted(stage_manual, key=lambda x: x.sort_order or 0):
            items.append({
                "template_id": None,
                "task_name": t.title,
                "sort_order": t.sort_order or 0,
                "status": "exists_manual",
                "existing_task_id": t.id,
            })

        # 3. Deleted tasks whose template no longer exists (template_id set but template deleted)
        for t in existing_tasks:
            if t.template_id and t.template_id not in template_task_ids and t.stage_name == st:
                # This task has a template_id but the template was deleted
                # It would have been caught by task_by_template if template existed
                # Already handled above via templates loop
                pass

        if items:
            stages_result.append({
                "stage_name": st,
                "tasks": items,
            })

    # Add any remaining manual tasks in stages not in standard_stages
    for st, tasks in manual_by_stage.items():
        items = []
        for t in sorted(tasks, key=lambda x: x.sort_order or 0):
            items.append({
                "template_id": None,
                "task_name": t.title,
                "sort_order": t.sort_order or 0,
                "status": "exists_manual",
                "existing_task_id": t.id,
            })
        if items:
            stages_result.append({
                "stage_name": st,
                "tasks": items,
            })

    return {"code": 0, "data": {"stages": stages_result, "standard_stages": standard_stages}, "message": "ok"}


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
    skipped = 0
    for tid in payload.task_ids:
        try:
            t = task_service.update_task(db, tid, updates, user)
            if t:
                updated += 1
        except PermissionError:
            skipped += 1
    db.commit()
    return {"code": 0, "data": {"updated": updated, "skipped": skipped, "total": len(payload.task_ids)}, "message": "ok"}


@router.put("/{task_id}", response_model=dict)
def update_task(
    task_id: int,
    payload: TaskUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("task_edit")),
):
    try:
        t = task_service.update_task(db, task_id, payload.model_dump(exclude_unset=True), user)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
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


@router.post("/{task_id}/approve", response_model=dict)
def approve_task(
    task_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Approve a task in review status. Only the assigned reviewer can approve."""
    try:
        result = task_service.approve_task(db, task_id, user)
        if not result:
            raise HTTPException(status_code=404, detail="Task not found")
        log_audit(db, user, "task_update", f"审批通过任务 #{task_id}", AUDIT_CAT_TASK, "medium")
        return {"code": 0, "data": result, "message": "审批已通过，任务已完成"}
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/{task_id}/reject", response_model=dict)
def reject_task(
    task_id: int,
    reason: str = Query(..., description="驳回原因"),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Reject a task in review status. Only the assigned reviewer can reject."""
    try:
        result = task_service.reject_task(db, task_id, reason, user)
        if not result:
            raise HTTPException(status_code=404, detail="Task not found")
        log_audit(db, user, "task_update", f"驳回任务 #{task_id}: {reason}", AUDIT_CAT_TASK, "medium")
        return {"code": 0, "data": result, "message": "已驳回，任务状态已改为进行中"}
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


class TaskImportBody(BaseModel):
    """Body for selective template task import."""
    template_ids: List[int] = []


@router.post("/import-from-templates", response_model=dict)
def import_tasks_from_template(
    project_id: str = Query(...),
    body: TaskImportBody = TaskImportBody(),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Import tasks from task templates for all stages of a project.

    If template_ids is provided, only those template IDs are imported
    (deleted tasks are force-restored). Otherwise all templates are synced.
    """
    from backend.services.document_service import _sync_tasks_from_templates
    from backend.services.project_service import log_project_activity
    project = resolve_project(db, project_id)
    # Block template import for wait/abolished projects (#231)
    if project.status in ("wait", "abolished"):
        raise HTTPException(status_code=400, detail="待启动或已废止的项目不允许导入模板任务，请先将项目状态切换为进行中")
    force_ids = set(body.template_ids) if body.template_ids else None
    count = _sync_tasks_from_templates(
        db, project.id,
        project.project_type or "RD",
        force_template_ids=force_ids,
        reporter_id=user.id,
    )
    if force_ids:
        msg = f"项目={project.code} 选择性导入 {len(force_ids)} 个模板, 创建/恢复数={count}"
    else:
        msg = f"项目={project.code} 创建数={count}"
    log_audit(db, user, "task_import_templates", msg, AUDIT_CAT_TASK, "medium")
    log_project_activity(db, project.id, user.username, "导入模板任务", msg)
    return {"code": 0, "data": {"created": count}, "message": f"已创建/恢复 {count} 个任务"}


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
    log_audit(db, user, "task_delete_all", f"项目={project.code} 删除数={count}", AUDIT_CAT_TASK, "high")
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
    log_audit(db, user, "stage_init", f"项目={project.code} 创建数={count} 关联任务数={linked}", AUDIT_CAT_TASK, "medium")
    return {"code": 0, "data": {"created": count, "linked_tasks": linked}, "message": f"已创建 {count} 个阶段，关联 {linked} 个任务"}
