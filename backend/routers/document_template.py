from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
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
    description: Optional[str] = None
    responsible_role: Optional[str] = None


class TemplateUpdate(BaseModel):
    stage_type: Optional[str] = None
    doc_name: Optional[str] = None
    sort_order: Optional[int] = None
    description: Optional[str] = None
    responsible_role: Optional[str] = None


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


@router.delete("/stage-types/{stage_type}", response_model=dict)
def delete_stage_type(
    stage_type: str,
    db: Session = Depends(get_db),
    user=Depends(require_perm("doc_template")),
):
    count = document_service.delete_stage_type(db, stage_type)
    log_audit(db, user, "doc_stage_del", f"{stage_type} ({count} docs)", "管理", "high")
    return {"code": 0, "data": {"deleted": count}, "message": "ok"}


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
