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
from backend.routers.logs import log_audit
from backend.audit_categories import AUDIT_CAT_PROJECT, AUDIT_CAT_TASK, FIELD_LABEL
from backend.services import project_service
import re as _re, os as _os


def _delete_note_images(content: str):
    """Delete image files referenced in note content from disk."""
    if not content:
        return
    for m in _re.finditer(r'/api/note-images/([a-f0-9]+\.\w+)', content or ""):
        fpath = _os.path.join("data", "uploads", "note_images", m.group(1))
        if _os.path.exists(fpath):
            try:
                _os.remove(fpath)
            except OSError:
                pass

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
def list_customer_names(
    search: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """Return cached customer names for project form dropdown. Supports Chinese search."""
    from backend.models.zentao import PmaCustomer
    q = db.query(PmaCustomer).order_by(PmaCustomer.name)
    if search:
        q = q.filter(
            PmaCustomer.name.ilike(f"%{search}%") |
            PmaCustomer.full_name.ilike(f"%{search}%")
        )
    customers = q.all()
    return {"code": 0, "data": [
        {"name": c.name, "full_name": c.full_name or ""} for c in customers if c.name
    ], "message": "ok"}


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


class StageInfoUpdate(BaseModel):
    name: Optional[str] = None
    sort_order: Optional[int] = None
    status: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    owner_id: Optional[int] = None
    description: Optional[str] = None


@router.put("/{identifier}/stages/{stage_id}", response_model=dict)
def update_stage(
    identifier: str,
    stage_id: int,
    body: StageInfoUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("stage_mapping")),
):
    """Update a project stage's metadata (dates, owner, status, etc.)."""
    project = resolve_project(db, identifier)
    from backend.models.project_stage import ProjectStage
    s = db.query(ProjectStage).filter(
        ProjectStage.id == stage_id,
        ProjectStage.project_id == project.id,
    ).first()
    if not s:
        raise HTTPException(status_code=404, detail="Stage not found")
    data = body.model_dump(exclude_none=True)
    changes = []
    date_fields = {"start_date", "end_date"}
    # Resolve user names for owner_id changes
    from backend.models.local import LocalUser
    def _user_name(uid):
        if not uid: return "无"
        u = db.query(LocalUser).filter(LocalUser.id == uid).first()
        return (u.display_name or u.username) if u else str(uid)
    for k, v in data.items():
        old = getattr(s, k, None)
        if k in date_fields and v is not None:
            from datetime import date as dt_date
            try:
                v = dt_date.fromisoformat(v)
            except (ValueError, TypeError):
                pass
        old_str = _user_name(old) if k == "owner_id" else str(old)
        new_str = _user_name(v) if k == "owner_id" else str(v)
        if old_str != new_str:
            changes.append(f"{k}:{old_str}->{new_str}")
        setattr(s, k, v)
    db.commit()
    log_project_activity(db, project.id, user.username, "编辑阶段",
        f"stage:{s.name}; {'; '.join(changes) if changes else '无变更'}")
    return {"code": 0, "data": {"id": s.id, "name": s.name}, "message": "ok"}


class StageCreate(BaseModel):
    name: str
    sort_order: Optional[int] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    owner_id: Optional[int] = None
    description: Optional[str] = None


@router.post("/{identifier}/stages", response_model=dict)
def create_stage(
    identifier: str,
    body: StageCreate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("stage_mapping")),
):
    """Add a custom stage to a project."""
    project = resolve_project(db, identifier)
    from backend.models.project_stage import ProjectStage
    from datetime import date as dt_date
    # Determine sort_order: place after the last existing stage
    max_order = db.query(ProjectStage).filter(
        ProjectStage.project_id == project.id
    ).order_by(ProjectStage.sort_order.desc()).first()
    sort_order = body.sort_order if body.sort_order is not None else ((max_order.sort_order + 1) if max_order else 0)
    start_date = None
    end_date = None
    if body.start_date:
        try: start_date = dt_date.fromisoformat(body.start_date)
        except (ValueError, TypeError): pass
    if body.end_date:
        try: end_date = dt_date.fromisoformat(body.end_date)
        except (ValueError, TypeError): pass
    s = ProjectStage(
        project_id=project.id,
        name=body.name,
        sort_order=sort_order,
        status="active",
        start_date=start_date,
        end_date=end_date,
        owner_id=body.owner_id,
        description=body.description or "",
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    log_project_activity(db, project.id, user.username, "添加阶段",
        f"stage:{s.name} sort_order={sort_order}")
    return {"code": 0, "data": {"id": s.id, "name": s.name}, "message": "ok"}


@router.delete("/{identifier}/stages/{stage_id}", response_model=dict)
def delete_stage(
    identifier: str,
    stage_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_perm("stage_mapping")),
):
    """Delete a project stage. Tasks in this stage are NOT deleted (stage_id is set to NULL)."""
    project = resolve_project(db, identifier)
    from backend.models.project_stage import ProjectStage
    from backend.models.task import Task
    s = db.query(ProjectStage).filter(
        ProjectStage.id == stage_id,
        ProjectStage.project_id == project.id,
    ).first()
    if not s:
        raise HTTPException(status_code=404, detail="Stage not found")
    name = s.name
    # Unlink tasks from this stage (don't delete them)
    db.query(Task).filter(Task.stage_id == stage_id).update({Task.stage_id: None}, synchronize_session=False)
    db.delete(s)
    db.commit()
    log_project_activity(db, project.id, user.username, "删除阶段",
        f"stage:{name} (id={stage_id})")
    return {"code": 0, "data": {"id": stage_id, "name": name}, "message": f"阶段「{name}」已删除"}


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
def get_documents(
    identifier: str,
    include_removed: bool = Query(False),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    project = resolve_project(db, identifier)
    docs = project_service.get_project_documents(db, project.id, include_removed=include_removed)
    return {"code": 0, "data": docs, "message": "ok"}


class DocSyncBody(BaseModel):
    doc_ids: list = []  # specific doc IDs to force re-import (for deleted docs)


@router.post("/{identifier}/documents/sync", response_model=dict)
def sync_documents(
    identifier: str,
    body: DocSyncBody,
    db: Session = Depends(get_db),
    user=Depends(require_perm("project_edit")),
):
    """Manually trigger document sync from templates, with optional force re-import."""
    project = resolve_project(db, identifier)
    from backend.services.document_service import _sync_from_templates
    from backend.models.document import ProjectDocument

    # Force re-import specified docs (e.g., previously deleted)
    force_count = 0
    restored_names = []
    if body.doc_ids:
        for did in body.doc_ids:
            pd = db.query(ProjectDocument).filter(ProjectDocument.id == did).first()
            if pd and pd.is_removed:
                # Re-create from template: find the template and recreate
                from backend.models.document import DocumentTemplate
                tpl = db.query(DocumentTemplate).filter(
                    DocumentTemplate.stage_type == pd.stage_type,
                    DocumentTemplate.doc_name == pd.doc_name,
                ).first()
                if tpl:
                    pd.is_removed = 0
                    pd.status = "pending"
                    pd.location = None
                    force_count += 1
                    restored_names.append(pd.doc_name)

    # Run normal sync
    _sync_from_templates(db, project.id, project.project_type or "RD")
    db.commit()

    if restored_names:
        log_audit(db, user, "project_doc_restore",
                  f"project={project.code} 强制恢复 {len(restored_names)} 个文档: {', '.join(restored_names)}",
                  AUDIT_CAT_PROJECT, "medium")

    docs = project_service.get_project_documents(db, project.id)
    return {"code": 0, "data": docs, "message": f"同步完成，强制恢复 {force_count} 个文档"}


class CustomDocCreate(BaseModel):
    doc_name: str
    stage_type: str
    doc_type: str = ""
    location: str = ""
    description: str = ""
    responsible_role: str = ""
    is_optional: bool = False


@router.post("/{identifier}/documents/add", response_model=dict)
def add_custom_document(
    identifier: str,
    body: CustomDocCreate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("project_edit")),
):
    """Add a custom project document (not from a template)."""
    project = resolve_project(db, identifier)
    from backend.models.document import ProjectDocument

    # Check for duplicate active doc with same name
    from sqlalchemy import or_
    existing = db.query(ProjectDocument).filter(
        ProjectDocument.project_id == project.id,
        ProjectDocument.doc_name == body.doc_name,
        or_(ProjectDocument.is_removed == 0, ProjectDocument.is_removed == None),
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"文档「{body.doc_name}」已存在")

    pd = ProjectDocument(
        project_id=project.id,
        execution_id=0,
        stage_type=body.stage_type,
        doc_name=body.doc_name,
        sort_order=99,
        status="pending",
        doc_type=body.doc_type or "",
        doc_path=body.location or "",
        location=body.location or "",
        description=body.description or "",
        responsible_role=body.responsible_role or "",
        is_optional=body.is_optional,
    )
    db.add(pd)
    db.commit()
    log_audit(db, user, "doc_add", f"项目={project.code} 新增自定义文档「{body.doc_name}」", AUDIT_CAT_PROJECT, "medium")
    return {"code": 0, "data": {"id": pd.id}, "message": f"文档「{body.doc_name}」已添加"}


class DocumentUpdate(BaseModel):
    status: Optional[str] = None  # "pending" | "submitted"
    location: Optional[str] = None
    completed_at: Optional[str] = None
    is_removed: Optional[int] = None  # 0=正常 1=已删除（可选项）
    # Custom document fields (editable for manually added docs, template_id is None)
    doc_name: Optional[str] = None
    stage_type: Optional[str] = None
    doc_type: Optional[str] = None
    doc_path: Optional[str] = None
    description: Optional[str] = None
    responsible_role: Optional[str] = None


@router.put("/{identifier}/documents/{doc_id}", response_model=dict)
def update_document(
    identifier: str,
    doc_id: int,
    body: DocumentUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("project_edit")),
):
    from backend.services import document_service
    from backend.models.document import ProjectDocument
    project = resolve_project(db, identifier)
    # Get old values before update (must capture BEFORE update_project_document
    # because it shares the same SQLAlchemy session object — old and pd are the
    # same Python object, so the update mutates old in-place)
    old = db.query(ProjectDocument).filter(ProjectDocument.id == doc_id).first()
    old_status = old.status if old else '?'
    old_location = (old.location or '') if old else '?'
    old_removed = old.is_removed if old else 0
    result = document_service.update_project_document(
        db, doc_id, body.model_dump(exclude_none=True), user.username
    )
    if not result:
        raise HTTPException(status_code=404, detail="Document not found")

    # Build human-readable change description
    STATUS_TXT = {'pending': '未提交', 'submitted': '已提交'}
    doc_name = result.get('doc_name', '?')
    parts = []

    new_status = result.get('status', '?')
    if old_status != new_status:
        parts.append(f"状态: {STATUS_TXT.get(old_status, old_status)} → {STATUS_TXT.get(new_status, new_status)}")

    new_location = result.get('location') or ''
    if old_location != new_location:
        parts.append("路径已更新")

    new_removed = result.get('is_removed')
    if old_removed != new_removed:
        if new_removed:
            parts.append("已标记删除")
        else:
            parts.append("已恢复")

    detail = f"「{doc_name}」{'; '.join(parts)}" if parts else f"「{doc_name}」无变更"
    log_project_activity(db, project.id, user.username, "文档状态", detail)
    log_audit(db, user, "project_doc_update", f"project={project.code} {detail}", AUDIT_CAT_PROJECT, "low")
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
    # Build audit-friendly change description with Chinese field labels
    audit_changes = []
    if plan_changes:
        for c in plan_changes:
            # plan_changes format: "field_name:'old'->'new'"
            if ':' in c:
                field_name, vals = c.split(':', 1)
                label = FIELD_LABEL.get(field_name, field_name)
                audit_changes.append(f"{label}: {vals}")
    log_audit(db, user, "project_delivery_plan_update",
              f"项目={project.code} {'; '.join(audit_changes) if audit_changes else '无变更'}",
              AUDIT_CAT_PROJECT, "medium")
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
    parent_id: Optional[int] = None


class NoteUpdate(BaseModel):
    content: Optional[str] = None
    stage_name: Optional[str] = None


@router.get("/{identifier}/notes", response_model=dict)
def get_notes(identifier: str, db: Session = Depends(get_db), _=Depends(get_current_user)):
    project = resolve_project(db, identifier)
    notes = (
        db.query(ProjectNote)
        .filter(ProjectNote.project_id == project.id)
        .order_by(ProjectNote.created_at.desc())
        .limit(100)
        .all()
    )
    # Build parent -> children mapping
    children = {}
    for n in notes:
        if n.parent_id:
            children.setdefault(n.parent_id, []).append(n)
    # Sort: top-level notes first, each followed by its children
    result = []
    for n in notes:
        if not n.parent_id:
            result.append(n)
            for child in children.get(n.id, []):
                result.append(child)
    return {
        "code": 0,
        "data": [
            {
                "id": n.id,
                "content": n.content,
                "stage_name": n.stage_name or "",
                "parent_id": n.parent_id,
                "recorded_by": n.recorded_by,
                "created_at": to_local_str(n.created_at),
                "updated_at": to_local_str(n.updated_at) if n.updated_at else None,
            }
            for n in result
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
    # Comment on someone else's note: check parent ownership
    if payload.parent_id:
        parent = db.query(ProjectNote).filter(ProjectNote.id == payload.parent_id).first()
        if not parent:
            raise HTTPException(status_code=404, detail="父笔记不存在")
        if parent.recorded_by == user.username:
            raise HTTPException(status_code=400, detail="不能评论自己的笔记，请直接编辑")
    note = ProjectNote(
        project_id=project.id,
        content=payload.content,
        stage_name=payload.stage_name,
        parent_id=payload.parent_id,
        recorded_by=user.username,
    )
    db.add(note)
    db.commit()
    db.refresh(note)
    log_project_activity(db, project.id, user.username, "项目笔记",
        f"{payload.stage_name or '项目整体'}: {payload.content[:80]}")
    log_audit(db, user, "project_note_add",
        f"project={project.code} stage={payload.stage_name or '项目整体'} content={payload.content[:60]}",
        AUDIT_CAT_PROJECT, "low")
    return {
        "code": 0,
        "data": {
            "id": note.id,
            "content": note.content,
            "stage_name": note.stage_name or "",
            "parent_id": note.parent_id,
            "recorded_by": note.recorded_by,
            "created_at": to_local_str(note.created_at),
        },
        "message": "ok",
    }


@router.put("/{identifier}/notes/{note_id}", response_model=dict)
def update_note(
    identifier: str,
    note_id: int,
    body: NoteUpdate,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    project = resolve_project(db, identifier)
    note = db.query(ProjectNote).filter(
        ProjectNote.id == note_id,
        ProjectNote.project_id == project.id,
    ).first()
    if not note:
        raise HTTPException(status_code=404, detail="笔记不存在")
    if note.recorded_by != user.username:
        raise HTTPException(status_code=403, detail="只能编辑自己的笔记")
    from datetime import datetime as _dt
    if body.content is not None:
        note.content = body.content
    if body.stage_name is not None:
        note.stage_name = body.stage_name
    note.updated_at = _dt.utcnow()
    db.commit()
    log_project_activity(db, project.id, user.username, "编辑笔记",
        f"note_id={note_id} stage={note.stage_name or '项目整体'}: {note.content[:60]}")
    log_audit(db, user, "project_note_edit",
        f"project={project.code} note_id={note_id}", AUDIT_CAT_PROJECT, "low")
    return {"code": 0, "data": {"id": note.id, "content": note.content, "stage_name": note.stage_name or ""}, "message": "ok"}


@router.delete("/{identifier}/notes/{note_id}", response_model=dict)
def delete_note(
    identifier: str,
    note_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    project = resolve_project(db, identifier)
    note = db.query(ProjectNote).filter(
        ProjectNote.id == note_id,
        ProjectNote.project_id == project.id,
    ).first()
    if not note:
        raise HTTPException(status_code=404, detail="笔记不存在")
    if note.recorded_by != user.username:
        raise HTTPException(status_code=403, detail="只能删除自己的笔记")
    # Prevent deletion if note has replies
    has_replies = db.query(ProjectNote).filter(ProjectNote.parent_id == note_id).first()
    if has_replies:
        raise HTTPException(status_code=400, detail="该笔记有回复，不能删除")
    _delete_note_images(note.content)
    db.delete(note)
    db.commit()
    log_project_activity(db, project.id, user.username, "删除笔记",
        f"note_id={note_id} stage={note.stage_name or '项目整体'}: {(note.content or '')[:60]}")
    log_audit(db, user, "project_note_delete",
        f"project={project.code} note_id={note_id}", AUDIT_CAT_PROJECT, "medium")
    return {"code": 0, "message": "已删除"}


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

    # Resolve display_name for all usernames at once
    usernames_set = {r.username for r in rows if r.username}
    display_map = {}
    if usernames_set:
        from backend.models.local import LocalUser as _LU
        lu_rows = db.query(_LU.username, _LU.display_name).filter(_LU.username.in_(usernames_set)).all()
        for uname, dname in lu_rows:
            if dname:
                display_map[uname] = dname

    return {
        "code": 0,
        "data": {
            "items": [
                {
                    "id": r.id,
                    "username": r.username,
                    "display_name": display_map.get(r.username, "") or "",
                    "action": r.action,
                    "detail": r.detail or "",
                    "task_id": r.task_id,
                    "task_name": r.task_name or "",
                    "task_assignee": r.task_assignee or "",
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
    old_bg = project.background or ""
    project.background = payload.background
    db.commit()
    log_audit(db, user, "project_background_update",
              f"项目={project.code} 项目背景已更新", AUDIT_CAT_PROJECT, "medium")
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
    """Set linked/sibling projects with bidirectional sync."""
    project = resolve_project(db, identifier)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Parse old IDs
    old_str = project.linked_project_ids or ""
    old_ids = [int(x.strip()) for x in old_str.split(",") if x.strip()]
    new_ids = list(dict.fromkeys(payload.ids or []))  # deduplicate, preserve order

    # Update target project
    project.linked_project_ids = ",".join(str(i) for i in new_ids) if new_ids else ""

    # Bidirectional sync
    added = [i for i in new_ids if i not in old_ids]
    removed = [i for i in old_ids if i not in new_ids]
    my_id = project.id

    for peer_id in added:
        peer = db.query(CachedProject).filter(CachedProject.id == peer_id).first()
        if peer:
            peer_ids_str = peer.linked_project_ids or ""
            peer_ids = [int(x.strip()) for x in peer_ids_str.split(",") if x.strip()]
            if my_id not in peer_ids:
                peer_ids.append(my_id)
                peer.linked_project_ids = ",".join(str(i) for i in peer_ids)

    for peer_id in removed:
        peer = db.query(CachedProject).filter(CachedProject.id == peer_id).first()
        if peer:
            peer_ids_str = peer.linked_project_ids or ""
            peer_ids = [int(x.strip()) for x in peer_ids_str.split(",") if x.strip()]
            if my_id in peer_ids:
                peer_ids.remove(my_id)
                peer.linked_project_ids = ",".join(str(i) for i in peer_ids) if peer_ids else ""

    db.commit()
    log_audit(db, user, "project_linked_projects_update",
              f"项目={project.code} 关联项目已更新 ({len(new_ids)}个)", AUDIT_CAT_PROJECT, "medium")
    return {"code": 0, "data": new_ids, "message": "ok"}


# ── Convert LSJ opportunity to RD/SC project ──

class LsjConvertRequest(BaseModel):
    project_type: str  # "RD" or "SC"
    name: str          # user-entered project name


@router.post("/{identifier}/convert", response_model=dict)
def convert_lsj_project(
    identifier: str,
    body: LsjConvertRequest,
    db: Session = Depends(get_db),
    user=Depends(require_perm("project_edit")),
):
    """Convert an LSJ (opportunity) project to an RD or SC project."""
    source = resolve_project(db, identifier)
    if not source:
        raise HTTPException(status_code=404, detail="Project not found")
    if source.project_type in ("RD", "SC"):
        raise HTTPException(status_code=400, detail="Only non-RD/SC projects can be converted")

    if body.project_type not in ("RD", "SC"):
        raise HTTPException(status_code=400, detail="Target type must be RD or SC")

    from backend.services.document_service import _get_project_code_prefix
    prefix, start = _get_project_code_prefix(db, body.project_type)

    # Auto-generate code
    from sqlalchemy import func
    result = db.query(func.max(CachedProject.code)).filter(
        CachedProject.code.like(f"{prefix}%")
    ).scalar()
    if result:
        try:
            num = int(result[len(prefix):])
            next_num = max(start, num + 1)
        except (ValueError, TypeError):
            next_num = start
    else:
        next_num = start
    new_code = f"{prefix}{next_num:04d}"

    # Create new project with auto-filled data from source
    new_project = CachedProject(
        name=body.name,
        code=new_code,
        project_type=body.project_type,
        status="wait",
        model="scrum",
        is_local=True,
        description=source.description or "",
        begin=source.begin,
        end=source.end,
        customer_name=source.customer_name,
        estimate=source.estimate or 0,
        tags=source.tags,
        planned_delivery_qty=source.planned_delivery_qty or 0,
        reporter_id=user.id,
        synced_at=None,
        linked_project_ids=str(source.id),
    )
    db.add(new_project)
    db.flush()

    # Copy product links from source
    try:
        from backend.models.zentao import ProductProjectLink
        source_links = db.query(ProductProjectLink).filter(
            ProductProjectLink.project_id == source.id
        ).all()
        for link in source_links:
            db.add(ProductProjectLink(
                product_id=link.product_id,
                project_id=new_project.id,
                quantity=link.quantity,
            ))
    except Exception:
        pass

    # Copy customer links
    try:
        from backend.models.zentao import CustomerProjectLink
        source_cust_links = db.query(CustomerProjectLink).filter(
            CustomerProjectLink.project_id == source.id
        ).all()
        for link in source_cust_links:
            db.add(CustomerProjectLink(
                project_id=new_project.id,
                customer_id=link.customer_id,
            ))
    except Exception:
        pass

    # Bidirectional: add new project to source's linked_project_ids
    source_ids_str = source.linked_project_ids or ""
    source_ids = [int(x.strip()) for x in source_ids_str.split(",") if x.strip()]
    if new_project.id not in source_ids:
        source_ids.append(new_project.id)
        source.linked_project_ids = ",".join(str(i) for i in source_ids)

    db.commit()

    # Init stages, docs, tasks from template
    try:
        from backend.services.product_management_service import _init_project_stages
        _init_project_stages(db, new_project.id, body.project_type)
    except Exception:
        pass
    try:
        from backend.services.document_service import _sync_from_templates, _sync_tasks_from_templates
        _sync_from_templates(db, new_project.id, body.project_type)
        _sync_tasks_from_templates(db, new_project.id, body.project_type)
    except Exception:
        pass

    log_audit(db, user, "lsj_convert",
              f"{source.code} → {new_code} ({body.project_type}), name={body.name}",
              AUDIT_CAT_PROJECT, "high")

    return {
        "code": 0,
        "data": {"id": new_project.id, "code": new_code, "name": body.name},
        "message": "ok",
    }


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
    product_ids: Optional[list] = None  # List[ProductLinkItem] for edit mode
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
    old_type = project.project_type

    # Handle customer_name → customer_project_links sync
    new_cust = data.get("customer_name")
    if new_cust is not None:
        from backend.models.zentao import CustomerProjectLink, PmaCustomer
        db.query(CustomerProjectLink).filter(CustomerProjectLink.project_id == project.id).delete()
        new_cust = new_cust.strip()
        if new_cust:
            cust = db.query(PmaCustomer).filter(PmaCustomer.name == new_cust).first()
            if not cust:
                cust = PmaCustomer(name=new_cust)
                db.add(cust)
                db.flush()
            db.add(CustomerProjectLink(project_id=project.id, customer_id=cust.id))

    # Handle product_ids → product_project_links sync (with quantity)
    new_product_ids = data.pop("product_ids", None)
    if new_product_ids is not None:
        from backend.models.zentao import ProductProjectLink
        from backend.models.zentao import PmaProduct
        # Capture old state for change tracking
        old_links = db.query(ProductProjectLink).filter(
            ProductProjectLink.project_id == project.id
        ).all()
        old_qty_map = {l.product_id: l.quantity for l in old_links}
        # Clear existing links
        db.query(ProductProjectLink).filter(ProductProjectLink.project_id == project.id).delete()
        # Create new links with quantities
        new_qty_map = {}
        for item in (new_product_ids or []):
            if isinstance(item, dict):
                pid = item.get("product_id")
                qty = item.get("quantity", 1)
            else:
                pid = getattr(item, 'product_id', item)
                qty = getattr(item, 'quantity', 1)
            new_qty_map[pid] = qty
            prod = db.query(PmaProduct).filter(PmaProduct.id == pid).first()
            if prod:
                db.add(ProductProjectLink(product_id=pid, project_id=project.id, quantity=qty))
        # Track changes in product quantity
        all_pids = set(list(old_qty_map.keys()) + list(new_qty_map.keys()))
        if old_qty_map != new_qty_map:
            for pid in sorted(all_pids):
                old_qty = old_qty_map.get(pid, 0)
                new_qty = new_qty_map.get(pid, 0)
                if old_qty != new_qty:
                    prod = db.query(PmaProduct).filter(PmaProduct.id == pid).first()
                    prod_name = (prod.code + ' ' + prod.name) if prod else f'产品#{pid}'
                    changes.append(f"{prod_name}: {old_qty}台 -> {new_qty}台")

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
                field_label = FIELD_LABEL.get(field, field)
                changes.append(f"{field_label}: '{old_val}' -> '{value}'")
            setattr(project, field, value)

    # If project_type changed, resync stages/docs/tasks from new type's templates
    if data.get("project_type") and data["project_type"] != old_type:
        from backend.services.product_management_service import _resync_on_type_change
        _resync_on_type_change(db, project.id, data["project_type"])
        changes.append(f"项目类型: '{old_type}' -> '{data['project_type']}' (已重同步模板)")

    db.commit()
    log_project_activity(db, project.id, user.username, "编辑项目",
                         "; ".join(changes) if changes else "no changes")
    log_audit(db, user, "project_update",
              f"项目={project.code} 变更={'; '.join(changes) if changes else '无变更'}",
              AUDIT_CAT_PROJECT, "medium")

    # Return updated project detail with changes count
    detail = project_service.get_project_detail(db, project.id)
    detail["_updated_fields"] = changes
    detail["_updated_count"] = len(changes)
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
    # PMA tasks + worklogs + comments + stages
    from backend.models.task import Task as PmaTask, WorkLog, TaskComment
    from backend.models.project_stage import ProjectStage
    pma_task_ids = [r[0] for r in db.query(PmaTask.id).filter(PmaTask.project_id == project.id).all()]
    if pma_task_ids:
        db.query(WorkLog).filter(WorkLog.task_id.in_(pma_task_ids)).delete()
        db.query(TaskComment).filter(TaskComment.task_id.in_(pma_task_ids)).delete()
        db.query(PmaTask).filter(PmaTask.project_id == project.id).delete()
    db.query(ProjectStage).filter(ProjectStage.project_id == project.id).delete()
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
