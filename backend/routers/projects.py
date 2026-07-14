from typing import Optional, List
from datetime import date as DateType

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db, to_local_str
from backend.middleware.auth import get_current_user, require_perm
from backend.models.local import ProjectNote, ProjectActivity
from backend.models.zentao import CachedProject, CachedExecution
from backend.services.entity_resolver import resolve_project
from backend.services.project_service import log_project_activity
from backend.services import project_service

router = APIRouter(prefix="/api/projects", tags=["projects"])


# Separate router for user names (used by delivery form dropdown)
user_router = APIRouter(prefix="/api/users", tags=["users"])


@user_router.get("/names", response_model=dict)
def list_user_names(db: Session = Depends(get_db), _=Depends(get_current_user)):
    """Return PMA local user names for delivery form dropdown."""
    from backend.models.local import LocalUser
    users = db.query(LocalUser.username).filter(LocalUser.is_active == True).order_by(LocalUser.username).all()
    return {"code": 0, "data": [u[0] for u in users if u[0]], "message": "ok"}


@user_router.get("/options", response_model=dict)
def list_user_options(db: Session = Depends(get_db), _=Depends(get_current_user)):
    """Return PMA local users as {id, name} for dropdowns (task assignee etc.)."""
    from backend.models.local import LocalUser
    users = db.query(LocalUser.id, LocalUser.username, LocalUser.display_name).filter(
        LocalUser.is_active == True
    ).order_by(LocalUser.username).all()
    return {"code": 0, "data": [
        {"id": u[0], "name": (u[2] or u[1]), "code": u[1]} for u in users
    ], "message": "ok"}


@user_router.get("/customers/names", response_model=dict)
def list_customer_names(db: Session = Depends(get_db), _=Depends(get_current_user)):
    """Return cached customer names for delivery form dropdown."""
    from backend.models.zentao import PmaCustomer
    customers = db.query(PmaCustomer.name).order_by(PmaCustomer.name).all()
    return {"code": 0, "data": [c[0] for c in customers if c[0]], "message": "ok"}


@user_router.get("/pm-names", response_model=dict)
def list_pm_names(db: Session = Depends(get_db), _=Depends(get_current_user)):
    """Return distinct PM names from cached projects for dropdown."""
    from backend.models.zentao import CachedProject
    names = db.query(CachedProject.pm_name).filter(CachedProject.pm_name != "", CachedProject.pm_name.isnot(None)).distinct().order_by(CachedProject.pm_name).all()
    return {"code": 0, "data": [n[0] for n in names if n[0]], "message": "ok"}


@user_router.get("/program-names", response_model=dict)
def list_program_names(db: Session = Depends(get_db), _=Depends(get_current_user)):
    """Return distinct program names from cached projects for dropdown."""
    from backend.models.zentao import CachedProject
    names = db.query(CachedProject.program_name).filter(CachedProject.program_name != "", CachedProject.program_name.isnot(None)).distinct().order_by(CachedProject.program_name).all()
    return {"code": 0, "data": [n[0] for n in names if n[0]], "message": "ok"}


@user_router.get("/project-options", response_model=dict)
def list_project_options(db: Session = Depends(get_db), _=Depends(get_current_user)):
    """Return all projects (id+code+name) for linked-projects dropdown."""
    from backend.models.zentao import CachedProject
    projects = db.query(CachedProject.id, CachedProject.code, CachedProject.name).order_by(CachedProject.id).all()
    return {"code": 0, "data": [{"id": p[0], "code": p[1], "name": p[2]} for p in projects], "message": "ok"}


@router.get("", response_model=dict)
def list_projects(db: Session = Depends(get_db), _=Depends(get_current_user)):
    items = project_service.get_projects(db)
    return {"code": 0, "data": items, "message": "ok"}


@router.get("/{identifier}", response_model=dict)
def get_project(identifier: str, db: Session = Depends(get_db), _=Depends(get_current_user)):
    project = resolve_project(db, identifier)
    detail = project_service.get_project_detail(db, project.id)
    if not detail:
        raise HTTPException(status_code=404, detail="Project not found")
    products = project_service.get_project_products(db, project.id)
    detail["products"] = products
    return {"code": 0, "data": detail, "message": "ok"}


@router.get("/{identifier}/stages", response_model=dict)
def get_stages(identifier: str, db: Session = Depends(get_db), _=Depends(get_current_user)):
    project = resolve_project(db, identifier)
    result = project_service.get_project_stages(db, project.id)
    return {"code": 0, "data": result, "message": "ok"}


class StageNameUpdate(BaseModel):
    stage_name: str


@router.put("/{identifier}/stages/{execution_id}/stage-name", response_model=dict)
def update_stage_name(
    identifier: str,
    execution_id: int,
    body: StageNameUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("stage_mapping")),
):
    project = resolve_project(db, identifier)
    e = db.query(CachedExecution).filter(
        CachedExecution.id == execution_id,
        CachedExecution.project_id == project.id,
    ).first()
    if not e:
        raise HTTPException(status_code=404, detail="Execution not found")
    e.stage_name = body.stage_name.strip()
    db.commit()
    return {"code": 0, "data": {"id": e.id, "stage_name": e.stage_name}, "message": "ok"}


@router.put("/{identifier}/stages/{execution_id}/sync-to-zentao", response_model=dict)
async def sync_stage_name_to_zentao(
    identifier: str,
    execution_id: int,
    body: StageNameUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("stage_mapping")),
):
    """Set PMA-local stage_name mapping for matching purposes.

    This does NOT push to Zentao (REST API v1 doesn't support execution
    updates via PUT). The user should manually update the execution name
    in Zentao's web interface. Once synced, the exact match will apply.
    """
    project = resolve_project(db, identifier)
    e = db.query(CachedExecution).filter(
        CachedExecution.id == execution_id,
        CachedExecution.project_id == project.id,
    ).first()
    if not e:
        raise HTTPException(status_code=404, detail="Execution not found")

    new_name = body.stage_name.strip()
    old_name = e.name
    e.stage_name = new_name
    db.commit()
    log_project_activity(db, project.id, user.username, "阶段映射",
        f"name:'{old_name}'->'{new_name}'")

    return {
        "code": 0,
        "data": {
            "id": e.id,
            "name": e.name,
            "stage_name": e.stage_name,
        },
        "message": f"PMA 阶段映射已保存: {e.name} → {new_name}（请在禅道中手动修改执行名为标准名）",
    }


@router.get("/{identifier}/documents", response_model=dict)
def get_documents(identifier: str, db: Session = Depends(get_db), _=Depends(get_current_user)):
    project = resolve_project(db, identifier)
    docs = project_service.get_project_documents(db, project.id)
    return {"code": 0, "data": docs, "message": "ok"}


class DocumentUpdate(BaseModel):
    status: Optional[str] = None  # "pending" | "submitted"
    location: Optional[str] = None
    completed_at: Optional[str] = None


@router.put("/{identifier}/documents/{doc_id}", response_model=dict)
def update_document(
    identifier: str,
    doc_id: int,
    body: DocumentUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("project_edit")),
):
    from backend.services import document_service
    project = resolve_project(db, identifier)
    result = document_service.update_project_document(
        db, doc_id, body.model_dump(exclude_none=True), user.username
    )
    if not result:
        raise HTTPException(status_code=404, detail="Document not found")
    log_project_activity(db, project.id, user.username, "文档状态",
        f"status:'{result.get('doc_name','')}'->'{result.get('status','')}'")
    return {"code": 0, "data": result, "message": "ok"}


@router.get("/{identifier}/gantt", response_model=dict)
def get_gantt(identifier: str, db: Session = Depends(get_db), _=Depends(get_current_user)):
    project = resolve_project(db, identifier)
    result = project_service.get_project_gantt(db, project.id)
    return {"code": 0, "data": result, "message": "ok"}


@router.get("/{identifier}/delivery", response_model=dict)
def get_delivery(identifier: str, db: Session = Depends(get_db), _=Depends(get_current_user)):
    project = resolve_project(db, identifier)
    delivery = project_service.get_project_delivery(db, project.id)
    return {"code": 0, "data": delivery, "message": "ok"}


class DeliveryPlanUpdate(BaseModel):
    planned_delivery_qty: Optional[int] = None
    delivery_note: Optional[str] = None


@router.put("/{identifier}/delivery-plan", response_model=dict)
def update_delivery_plan(
    identifier: str,
    body: DeliveryPlanUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("project_edit")),
):
    project = resolve_project(db, identifier)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    plan_changes = []
    if body.planned_delivery_qty is not None:
        old_qty = project.planned_delivery_qty
        if old_qty != body.planned_delivery_qty:
            plan_changes.append(f"planned_delivery_qty:'{old_qty}'->'{body.planned_delivery_qty}'")
        project.planned_delivery_qty = body.planned_delivery_qty
    if body.delivery_note is not None:
        old_note = project.delivery_note or ""
        if old_note != body.delivery_note:
            plan_changes.append(f"delivery_note:'{old_note}'->'{body.delivery_note}'")
        project.delivery_note = body.delivery_note
    db.commit()
    log_project_activity(db, project.id, user.username, "交付计划",
        "; ".join(plan_changes) if plan_changes else "无变更")
    return {
        "code": 0,
        "data": {
            "planned_delivery_qty": project.planned_delivery_qty,
            "delivery_note": project.delivery_note,
        },
        "message": "ok",
    }


@router.get("/{identifier}/resources", response_model=dict)
def get_resources(identifier: str, db: Session = Depends(get_db), _=Depends(get_current_user)):
    project = resolve_project(db, identifier)
    resources = project_service.get_project_resources(db, project.id)
    return {"code": 0, "data": resources, "message": "ok"}


class NoteCreate(BaseModel):
    content: str
    stage_name: str = ""


@router.get("/{identifier}/notes", response_model=dict)
def get_notes(identifier: str, db: Session = Depends(get_db), _=Depends(get_current_user)):
    project = resolve_project(db, identifier)
    notes = (
        db.query(ProjectNote)
        .filter(ProjectNote.project_id == project.id)
        .order_by(ProjectNote.created_at.desc())
        .limit(50)
        .all()
    )
    return {
        "code": 0,
        "data": [
            {
                "id": n.id,
                "content": n.content,
                "stage_name": n.stage_name or "",
                "recorded_by": n.recorded_by,
                "created_at": to_local_str(n.created_at),
            }
            for n in notes
        ],
        "message": "ok",
    }


@router.post("/{identifier}/notes", response_model=dict)
def add_note(
    identifier: str,
    payload: NoteCreate,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    project = resolve_project(db, identifier)
    note = ProjectNote(
        project_id=project.id,
        content=payload.content,
        stage_name=payload.stage_name,
        recorded_by=user.username,
    )
    db.add(note)
    db.commit()
    db.refresh(note)
    log_project_activity(db, project.id, user.username, "项目笔记",
        f"{payload.stage_name or '项目整体'}: {payload.content[:80]}")
    return {
        "code": 0,
        "data": {
            "id": note.id,
            "content": note.content,
            "stage_name": note.stage_name or "",
            "recorded_by": note.recorded_by,
            "created_at": to_local_str(note.created_at),
        },
        "message": "ok",
    }


@router.get("/{identifier}/activities", response_model=dict)
def get_activities(
    identifier: str,
    sort: str = "desc",  # "asc" or "desc"
    limit: int = 200,
    username: str = Query("", description="Filter by username"),
    action: str = Query("", description="Filter by action type"),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """Get project activity log (non-deletable audit trail)."""
    project = resolve_project(db, identifier)
    order = ProjectActivity.id.desc() if sort == "desc" else ProjectActivity.id.asc()
    q = db.query(ProjectActivity).filter(
        ProjectActivity.project_id == project.id
    )
    if username:
        q = q.filter(ProjectActivity.username == username)
    if action:
        q = q.filter(ProjectActivity.action == action)
    rows = q.order_by(order).limit(limit).all()

    # Distinct filter options (always all values for this project, ignoring current filter)
    opts_q = db.query(ProjectActivity).filter(ProjectActivity.project_id == project.id)
    usernames = sorted(set(
        r[0] for r in db.query(ProjectActivity.username).filter(
            ProjectActivity.project_id == project.id
        ).distinct().all() if r[0]
    ))
    actions = sorted(set(
        r[0] for r in db.query(ProjectActivity.action).filter(
            ProjectActivity.project_id == project.id
        ).distinct().all() if r[0]
    ))

    return {
        "code": 0,
        "data": {
            "items": [
                {
                    "id": r.id,
                    "username": r.username,
                    "action": r.action,
                    "detail": r.detail or "",
                    "created_at": to_local_str(r.created_at),
                }
                for r in rows
            ],
            "options": {"usernames": usernames, "actions": actions},
        },
        "message": "ok",
    }


class BackgroundUpdate(BaseModel):
    background: str


@router.put("/{identifier}/background", response_model=dict)
def update_project_background(
    identifier: str,
    payload: BackgroundUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("project_edit")),
):
    """Update the PMA-local project background description."""
    project = resolve_project(db, identifier)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    project.background = payload.background
    db.commit()
    return {"code": 0, "data": {"background": payload.background}, "message": "ok"}


class LinkedProjectsUpdate(BaseModel):
    ids: list = []  # list of int project IDs


@router.get("/{identifier}/linked-projects", response_model=dict)
def get_linked_projects(identifier: str, db: Session = Depends(get_db), _=Depends(get_current_user)):
    project = resolve_project(db, identifier)
    """Get linked/sibling projects for a project."""
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    ids_str = project.linked_project_ids or ""
    ids = [int(x.strip()) for x in ids_str.split(",") if x.strip()]
    if not ids:
        return {"code": 0, "data": [], "message": "ok"}
    rows = db.query(CachedProject).filter(CachedProject.id.in_(ids)).all()
    return {
        "code": 0,
        "data": [{"id": r.id, "name": r.name, "code": r.code or ""} for r in rows],
        "message": "ok",
    }


@router.put("/{identifier}/linked-projects", response_model=dict)
def set_linked_projects(
    identifier: str,
    payload: LinkedProjectsUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("project_edit")),
):
    """Set linked/sibling projects."""
    project = resolve_project(db, identifier)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    project.linked_project_ids = ",".join(str(i) for i in payload.ids) if payload.ids else ""
    db.commit()
    return {"code": 0, "data": payload.ids, "message": "ok"}


# ── Edit project (all PMA-managed fields) ──

class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    project_type: Optional[str] = None
    customer_name: Optional[str] = None
    pm_name: Optional[str] = None
    status: Optional[str] = None
    begin: Optional[str] = None
    end: Optional[str] = None
    real_began: Optional[str] = None
    real_end: Optional[str] = None
    progress: Optional[str] = None
    estimate: Optional[float] = None
    consumed: Optional[float] = None
    program_name: Optional[str] = None
    planned_delivery_qty: Optional[int] = None
    delivery_note: Optional[str] = None
    background: Optional[str] = None
    tags: Optional[str] = None
    linked_project_ids: Optional[str] = None
    description: Optional[str] = None
    is_local: Optional[bool] = None


@router.put("/{identifier}", response_model=dict)
def update_project(
    identifier: str,
    payload: ProjectUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("project_edit")),
):
    """Update PMA-managed project fields."""
    project = resolve_project(db, identifier)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    changes = []
    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        if field in ("begin", "end", "real_began", "real_end"):
            if value is not None:
                if isinstance(value, str) and not value.strip():
                    value = None
                else:
                    try:
                        value = DateType.fromisoformat(str(value))
                    except (ValueError, TypeError):
                        value = None
        if hasattr(project, field):
            old_val = getattr(project, field)
            if str(old_val) != str(value):
                changes.append(f"{field}:'{old_val}'->'{value}'")
            setattr(project, field, value)

    db.commit()
    log_project_activity(db, project.id, user.username, "编辑项目",
                         "; ".join(changes) if changes else "no changes")

    # Return updated project detail
    detail = project_service.get_project_detail(db, project.id)
    return {"code": 0, "data": detail, "message": f"已更新 {len(changes)} 个字段"}


# ── Delete project ──

@router.delete("/{identifier}", response_model=dict)
def delete_project(
    identifier: str,
    db: Session = Depends(get_db),
    user=Depends(require_perm("project_edit")),
):
    """Delete a project and all related data (executions, tasks, documents, notes, links, activities, delivery records)."""
    project = resolve_project(db, identifier)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    proj_name = project.name or str(project.id)

    # Delete related records (cascade)
    from backend.models.zentao import ProductProjectLink, CustomerProjectLink
    from backend.models.document import ProjectDocument
    from backend.models.local import ProjectNote, ProjectActivity
    from backend.models.delivery import DeliveryRecord
    from backend.models.bug import CachedBug
    from backend.models.zentao import CachedTask

    # Product-project links
    db.query(ProductProjectLink).filter(ProductProjectLink.project_id == project.id).delete()
    # Customer-project links
    db.query(CustomerProjectLink).filter(CustomerProjectLink.project_id == project.id).delete()
    # Tasks
    db.query(CachedTask).filter(CachedTask.project_id == project.id).delete()
    # Executions
    db.query(CachedExecution).filter(CachedExecution.project_id == project.id).delete()
    # Bugs
    db.query(CachedBug).filter(CachedBug.project_id == project.id).delete()
    # Documents
    db.query(ProjectDocument).filter(ProjectDocument.project_id == project.id).delete()
    # Notes
    db.query(ProjectNote).filter(ProjectNote.project_id == project.id).delete()
    # Activities
    db.query(ProjectActivity).filter(ProjectActivity.project_id == project.id).delete()
    # Delivery records
    db.query(DeliveryRecord).filter(DeliveryRecord.project_id == project.id).delete()
    # PMA tasks + worklogs + comments
    from backend.models.task import Task as PmaTask, WorkLog, TaskComment
    pma_task_ids = [r[0] for r in db.query(PmaTask.id).filter(PmaTask.project_id == project.id).all()]
    if pma_task_ids:
        db.query(WorkLog).filter(WorkLog.task_id.in_(pma_task_ids)).delete()
        db.query(TaskComment).filter(TaskComment.task_id.in_(pma_task_ids)).delete()
        db.query(PmaTask).filter(PmaTask.project_id == project.id).delete()
    # Finally delete the project itself
    db.delete(project)
    db.commit()

    # Clean orphaned favorites
    from backend.database import clean_orphan_favorites
    clean_orphan_favorites(db)

    # Log to audit
    from backend.audit_categories import AUDIT_CAT_PROJECT
    from backend.routers.logs import log_audit
    log_audit(db, user, "project_delete", f"删除项目「{proj_name}」（ID: {project.id}）", AUDIT_CAT_PROJECT, "high")

    return {"code": 0, "data": {"id": project.id, "name": proj_name}, "message": f"项目「{proj_name}」已删除"}
