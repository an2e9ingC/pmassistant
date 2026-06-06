from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.middleware.auth import get_current_user, require_admin
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
    _=Depends(require_admin),
):
    tpl = document_service.create_template(db, body.model_dump())
    return {"code": 0, "data": tpl, "message": "ok"}


@router.put("/{template_id}", response_model=dict)
def update_template(
    template_id: int,
    body: TemplateUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    tpl = document_service.update_template(
        db, template_id, body.model_dump(exclude_none=True)
    )
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found")
    return {"code": 0, "data": tpl, "message": "ok"}


@router.delete("/{template_id}", response_model=dict)
def delete_template(
    template_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    ok = document_service.delete_template(db, template_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Template not found")
    return {"code": 0, "data": None, "message": "ok"}


class StageTypeRename(BaseModel):
    old_name: str
    new_name: str


@router.put("/stage-types/rename", response_model=dict)
def rename_stage_type(
    body: StageTypeRename,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    count = document_service.rename_stage_type(db, body.old_name, body.new_name)
    return {"code": 0, "data": {"updated": count}, "message": "ok"}


@router.delete("/stage-types/{stage_type}", response_model=dict)
def delete_stage_type(
    stage_type: str,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    count = document_service.delete_stage_type(db, stage_type)
    return {"code": 0, "data": {"deleted": count}, "message": "ok"}
