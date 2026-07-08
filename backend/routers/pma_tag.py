from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.middleware.auth import get_current_user, require_perm
from backend.audit_categories import AUDIT_CAT_TEMPLATE
from backend.routers.logs import log_audit
from backend.services import document_service

router = APIRouter(prefix="/api/tags", tags=["tags"])


class TagCreate(BaseModel):
    name: str
    category: Optional[str] = None  # 'project' | 'product' | null(通用)


class TagUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None


# -- Read (any authenticated user) --

@router.get("", response_model=dict)
def list_tags(db: Session = Depends(get_db), _=Depends(get_current_user)):
    tags = document_service.get_all_tags(db)
    return {"code": 0, "data": tags, "message": "ok"}


# -- Write (require doc_template permission) --

@router.post("", response_model=dict)
def create_tag(
    body: TagCreate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("doc_template")),
):
    tag = document_service.create_tag(db, body.model_dump())
    log_audit(db, user, "pma_tag_add", f"{body.name} ({body.category or '通用'})", AUDIT_CAT_TEMPLATE, "medium")
    return {"code": 0, "data": tag, "message": "ok"}


@router.put("/{tag_id}", response_model=dict)
def update_tag(
    tag_id: int,
    body: TagUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("doc_template")),
):
    tag = document_service.update_tag(db, tag_id, body.model_dump(exclude_none=True))
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    log_audit(db, user, "pma_tag_edit", f"id={tag_id}", AUDIT_CAT_TEMPLATE, "medium")
    return {"code": 0, "data": tag, "message": "ok"}


@router.delete("/{tag_id}", response_model=dict)
def delete_tag(
    tag_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_perm("doc_template")),
):
    ok = document_service.delete_tag(db, tag_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Tag not found")
    log_audit(db, user, "pma_tag_del", f"id={tag_id}", AUDIT_CAT_TEMPLATE, "high")
    return {"code": 0, "data": None, "message": "ok"}
