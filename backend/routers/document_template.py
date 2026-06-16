from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.middleware.auth import get_current_user, require_admin, require_perm
from backend.routers.logs import log_audit
from backend.services import document_service

router = APIRouter(prefix="/api/doc-templates", tags=["doc-templates"])


class TemplateCreate(BaseModel):
    stage_type: str
    doc_name: str
    sort_order: int = 0
    doc_path: str
    doc_type: Optional[str] = None
    responsible_role: Optional[str] = None
    description: Optional[str] = None


class TemplateUpdate(BaseModel):
    stage_type: Optional[str] = None
    doc_name: Optional[str] = None
    sort_order: Optional[int] = None
    description: Optional[str] = None
    responsible_role: Optional[str] = None
    doc_path: Optional[str] = None
    doc_type: Optional[str] = None


@router.get("/stage-types", response_model=dict)
def list_stage_types(db: Session = Depends(get_db), _=Depends(get_current_user)):
    types = document_service.get_stage_types(db)
    return {"code": 0, "data": types, "message": "ok"}


@router.get("", response_model=dict)
def list_templates(db: Session = Depends(get_db), _=Depends(get_current_user)):
    grouped = document_service.get_templates_grouped(db)
    return {"code": 0, "data": grouped, "message": "ok"}


@router.post("", response_model=dict)
def create_template(
    body: TemplateCreate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("doc_template")),
):
    tpl = document_service.create_template(db, body.model_dump())
    log_audit(db, user, "doc_template_add", f"{body.stage_type}/{body.doc_name}", "管理", "medium")
    return {"code": 0, "data": tpl, "message": "ok"}


@router.put("/{template_id}", response_model=dict)
def update_template(
    template_id: int,
    body: TemplateUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("doc_template")),
):
    tpl = document_service.update_template(
        db, template_id, body.model_dump(exclude_none=True)
    )
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found")
    log_audit(db, user, "doc_template_edit", f"id={template_id} {body.doc_name or ''}", "管理", "medium")
    return {"code": 0, "data": tpl, "message": "ok"}


@router.delete("/{template_id}", response_model=dict)
def delete_template(
    template_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_perm("doc_template")),
):
    from backend.models.document import DocumentTemplate
    tpl = db.query(DocumentTemplate).filter(DocumentTemplate.id == template_id).first()
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found")
    detail = f"{tpl.stage_type}/{tpl.doc_name}"
    db.delete(tpl)
    db.commit()
    log_audit(db, user, "doc_template_del", detail, "管理", "high")
    return {"code": 0, "data": None, "message": "ok"}


class StageTypeRename(BaseModel):
    old_name: str
    new_name: str


@router.put("/stage-types/rename", response_model=dict)
def rename_stage_type(
    body: StageTypeRename,
    db: Session = Depends(get_db),
    user=Depends(require_perm("doc_template")),
):
    count = document_service.rename_stage_type(db, body.old_name, body.new_name)
    log_audit(db, user, "doc_stage_rename", f"{body.old_name} -> {body.new_name} ({count} docs)", "管理", "medium")
    return {"code": 0, "data": {"updated": count}, "message": "ok"}


@router.post("/sync-all", response_model=dict)
def sync_all_projects(
    db: Session = Depends(get_db),
    user=Depends(require_perm("doc_template")),
):
    """Apply current templates to all projects — add/update/remove/cleanup docs."""
    result = document_service.sync_all_projects(db)
    log_audit(
        db, user, "doc_template_sync_all",
        f"{result['synced']}/{result['total']} projects synced"
        + (f", {result['failed']} failed" if result['failed'] else ""),
        "管理", "medium",
    )
    return {"code": 0, "data": result, "message": "ok"}

@router.delete("/stage-types/{stage_type}", response_model=dict)
def delete_stage_type(
    stage_type: str,
    db: Session = Depends(get_db),
    user=Depends(require_perm("doc_template")),
):
    count = document_service.delete_stage_type(db, stage_type)
    # Also remove from persisted custom stage types
    from backend.services.document_service import _get_custom_stage_types, _save_custom_stage_types
    customs = _get_custom_stage_types(db)
    if stage_type in customs:
        customs.remove(stage_type)
        _save_custom_stage_types(db, customs)
    log_audit(db, user, "doc_stage_del", f"{stage_type} ({count} docs)", "管理", "high")
    return {"code": 0, "data": {"deleted": count}, "message": "ok"}


@router.post("/stage-types", response_model=dict)
def add_stage_type(
    stage_type: str = Query(...),
    db: Session = Depends(get_db),
    user=Depends(require_perm("doc_template")),
):
    """Persist a new custom stage type (independent of document templates)."""
    from backend.services.document_service import _get_custom_stage_types, _save_custom_stage_types, RD_STAGE_TYPES, SC_STAGE_TYPES
    predefined = set(RD_STAGE_TYPES + SC_STAGE_TYPES)
    if stage_type in predefined:
        return {"code": 1, "message": f"'{stage_type}' 是预定义阶段，无需添加"}

    customs = _get_custom_stage_types(db)
    if stage_type in customs:
        return {"code": 1, "message": f"阶段类型 '{stage_type}' 已存在"}

    customs.append(stage_type)
    _save_custom_stage_types(db, customs)
    log_audit(db, user, "doc_stage_add", stage_type, "管理", "medium")
    return {"code": 0, "data": {"stage_type": stage_type}, "message": "ok"}


class ResetProjectDocsRequest(BaseModel):
    stage_types: List[str] = []


@router.post("/reset-project-docs", response_model=dict)
def reset_project_documents(
    body: ResetProjectDocsRequest,
    db: Session = Depends(get_db),
    user=Depends(require_perm("doc_template")),
):
    """Clear project_documents for given stage types so they re-init from updated templates."""
    from backend.models.document import ProjectDocument
    stage_types = body.stage_types
    if stage_types:
        count = db.query(ProjectDocument).filter(ProjectDocument.stage_type.in_(stage_types)).delete()
    else:
        count = 0
    db.commit()
    log_audit(db, user, "doc_reset", f"Cleared {count} project documents for {stage_types}", "管理", "medium")
    return {"code": 0, "data": {"deleted": count}, "message": f"已清除 {count} 条，涉及阶段: {', '.join(stage_types)}"}
