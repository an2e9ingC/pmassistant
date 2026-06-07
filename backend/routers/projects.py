from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.middleware.auth import get_current_user, require_perm
from backend.models.local import ProjectNote, ProjectActivity
from backend.models.zentao import CachedProject, CachedExecution
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


@user_router.get("/customers/names", response_model=dict)
def list_customer_names(db: Session = Depends(get_db), _=Depends(get_current_user)):
    """Return cached customer names for delivery form dropdown."""
    from backend.models.zentao import CachedCustomer
    customers = db.query(CachedCustomer.name).order_by(CachedCustomer.name).all()
    return {"code": 0, "data": [c[0] for c in customers if c[0]], "message": "ok"}


@router.get("", response_model=dict)
def list_projects(db: Session = Depends(get_db), _=Depends(get_current_user)):
    items = project_service.get_projects(db)
    return {"code": 0, "data": items, "message": "ok"}


@router.get("/{project_id}", response_model=dict)
def get_project(project_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    detail = project_service.get_project_detail(db, project_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Project not found")
    products = project_service.get_project_products(db, project_id)
    detail["products"] = products
    return {"code": 0, "data": detail, "message": "ok"}


@router.get("/{project_id}/stages", response_model=dict)
def get_stages(project_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    result = project_service.get_project_stages(db, project_id)
    return {"code": 0, "data": result, "message": "ok"}


class StageNameUpdate(BaseModel):
    stage_name: str


@router.put("/{project_id}/stages/{execution_id}/stage-name", response_model=dict)
def update_stage_name(
    project_id: int,
    execution_id: int,
    body: StageNameUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("stage_mapping")),
):
    e = db.query(CachedExecution).filter(
        CachedExecution.id == execution_id,
        CachedExecution.project_id == project_id,
    ).first()
    if not e:
        raise HTTPException(status_code=404, detail="Execution not found")
    e.stage_name = body.stage_name.strip()
    db.commit()
    return {"code": 0, "data": {"id": e.id, "stage_name": e.stage_name}, "message": "ok"}


@router.put("/{project_id}/stages/{execution_id}/sync-to-zentao", response_model=dict)
async def sync_stage_name_to_zentao(
    project_id: int,
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
    e = db.query(CachedExecution).filter(
        CachedExecution.id == execution_id,
        CachedExecution.project_id == project_id,
    ).first()
    if not e:
        raise HTTPException(status_code=404, detail="Execution not found")

    new_name = body.stage_name.strip()
    old_name = e.name
    e.stage_name = new_name
    db.commit()
    log_project_activity(db, project_id, user.username, "阶段映射",
        f"{old_name} → {new_name}")

    return {
        "code": 0,
        "data": {
            "id": e.id,
            "name": e.name,
            "stage_name": e.stage_name,
        },
        "message": f"PMA 阶段映射已保存: {e.name} → {new_name}（请在禅道中手动修改执行名为标准名）",
    }


@router.get("/{project_id}/documents", response_model=dict)
def get_documents(project_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    docs = project_service.get_project_documents(db, project_id)
    return {"code": 0, "data": docs, "message": "ok"}


class DocumentUpdate(BaseModel):
    status: Optional[str] = None  # "pending" | "submitted"
    location: Optional[str] = None
    completed_at: Optional[str] = None


@router.put("/{project_id}/documents/{doc_id}", response_model=dict)
def update_document(
    project_id: int,
    doc_id: int,
    body: DocumentUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("project_edit")),
):
    from backend.services import document_service
    result = document_service.update_project_document(
        db, doc_id, body.model_dump(exclude_none=True), user.username
    )
    if not result:
        raise HTTPException(status_code=404, detail="Document not found")
    log_project_activity(db, project_id, user.username, "文档状态",
        f"{result.get('doc_name','')} → {result.get('status','')}")
    return {"code": 0, "data": result, "message": "ok"}


@router.get("/{project_id}/gantt", response_model=dict)
def get_gantt(project_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    result = project_service.get_project_gantt(db, project_id)
    return {"code": 0, "data": result, "message": "ok"}


@router.get("/{project_id}/delivery", response_model=dict)
def get_delivery(project_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    delivery = project_service.get_project_delivery(db, project_id)
    return {"code": 0, "data": delivery, "message": "ok"}


class DeliveryPlanUpdate(BaseModel):
    planned_delivery_qty: Optional[int] = None
    delivery_note: Optional[str] = None


@router.put("/{project_id}/delivery-plan", response_model=dict)
def update_delivery_plan(
    project_id: int,
    body: DeliveryPlanUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("project_edit")),
):
    project = db.query(CachedProject).filter(CachedProject.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if body.planned_delivery_qty is not None:
        project.planned_delivery_qty = body.planned_delivery_qty
    if body.delivery_note is not None:
        project.delivery_note = body.delivery_note
    db.commit()
    log_project_activity(db, project_id, user.username, "交付计划",
        f"应交付总数={project.planned_delivery_qty}, 备注={project.delivery_note or ''}")
    return {
        "code": 0,
        "data": {
            "planned_delivery_qty": project.planned_delivery_qty,
            "delivery_note": project.delivery_note,
        },
        "message": "ok",
    }


@router.get("/{project_id}/resources", response_model=dict)
def get_resources(project_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    resources = project_service.get_project_resources(db, project_id)
    return {"code": 0, "data": resources, "message": "ok"}


class NoteCreate(BaseModel):
    content: str
    stage_name: str = ""


@router.get("/{project_id}/notes", response_model=dict)
def get_notes(project_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    notes = (
        db.query(ProjectNote)
        .filter(ProjectNote.project_id == project_id)
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
                "created_at": str(n.created_at)[:19] if n.created_at else "",
            }
            for n in notes
        ],
        "message": "ok",
    }


@router.post("/{project_id}/notes", response_model=dict)
def add_note(
    project_id: int,
    payload: NoteCreate,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    note = ProjectNote(
        project_id=project_id,
        content=payload.content,
        stage_name=payload.stage_name,
        recorded_by=user.username,
    )
    db.add(note)
    db.commit()
    db.refresh(note)
    log_project_activity(db, project_id, user.username, "项目笔记",
        f"{payload.stage_name or '项目整体'}: {payload.content[:80]}")
    return {
        "code": 0,
        "data": {
            "id": note.id,
            "content": note.content,
            "stage_name": note.stage_name or "",
            "recorded_by": note.recorded_by,
            "created_at": str(note.created_at)[:19] if note.created_at else "",
        },
        "message": "ok",
    }


@router.get("/{project_id}/activities", response_model=dict)
def get_activities(
    project_id: int,
    sort: str = "desc",  # "asc" or "desc"
    limit: int = 200,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """Get project activity log (non-deletable audit trail)."""
    order = ProjectActivity.id.desc() if sort == "desc" else ProjectActivity.id.asc()
    rows = db.query(ProjectActivity).filter(
        ProjectActivity.project_id == project_id
    ).order_by(order).limit(limit).all()
    return {
        "code": 0,
        "data": [
            {
                "id": r.id,
                "username": r.username,
                "action": r.action,
                "detail": r.detail or "",
                "created_at": str(r.created_at)[:19] if r.created_at else "",
            }
            for r in rows
        ],
        "message": "ok",
    }
