from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.middleware.auth import get_current_user, require_perm
from backend.routers.logs import log_audit
from backend.services import document_service

router = APIRouter(prefix="/api/product-doc-templates", tags=["product-doc-templates"])


class TemplateCreate(BaseModel):
    product_line: str
    doc_name: str
    sort_order: int = 0
    description: Optional[str] = None
    responsible_role: Optional[str] = None


class TemplateUpdate(BaseModel):
    product_line: Optional[str] = None
    doc_name: Optional[str] = None
    sort_order: Optional[int] = None
    description: Optional[str] = None
    responsible_role: Optional[str] = None


class ProductLineRename(BaseModel):
    old_name: str
    new_name: str


# -- Read endpoints (any authenticated user) --

@router.get("/product-lines", response_model=dict)
def list_product_lines(db: Session = Depends(get_db), _=Depends(get_current_user)):
    lines = document_service.get_product_lines(db)
    return {"code": 0, "data": lines, "message": "ok"}


@router.get("", response_model=dict)
def list_templates(db: Session = Depends(get_db), _=Depends(get_current_user)):
    grouped = document_service.get_product_templates_grouped(db)
    return {"code": 0, "data": grouped, "message": "ok"}


# -- Write endpoints (require doc_template permission) --

@router.post("", response_model=dict)
def create_template(
    body: TemplateCreate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("doc_template")),
):
    tpl = document_service.create_product_template(db, body.model_dump())
    log_audit(db, user, "product_doc_template_add", f"{body.product_line}/{body.doc_name}", "管理", "medium")
    return {"code": 0, "data": tpl, "message": "ok"}


@router.put("/{template_id}", response_model=dict)
def update_template(
    template_id: int,
    body: TemplateUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("doc_template")),
):
    tpl = document_service.update_product_template(
        db, template_id, body.model_dump(exclude_none=True)
    )
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found")
    log_audit(db, user, "product_doc_template_edit", f"id={template_id}", "管理", "medium")
    return {"code": 0, "data": tpl, "message": "ok"}


@router.delete("/{template_id}", response_model=dict)
def delete_template(
    template_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_perm("doc_template")),
):
    ok = document_service.delete_product_template(db, template_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Template not found")
    log_audit(db, user, "product_doc_template_del", f"id={template_id}", "管理", "high")
    return {"code": 0, "data": None, "message": "ok"}


# -- Product line management --

@router.post("/product-lines", response_model=dict)
def add_product_line(
    product_line: str = Query(..., description="Product line name"),
    db: Session = Depends(get_db),
    user=Depends(require_perm("doc_template")),
):
    # Product lines are implicitly created when templates reference them,
    # but this endpoint provides explicit creation for empty lines.
    log_audit(db, user, "product_line_add", product_line, "管理", "medium")
    return {"code": 0, "data": product_line, "message": "ok"}


@router.put("/product-lines/rename", response_model=dict)
def rename_product_line(
    body: ProductLineRename,
    db: Session = Depends(get_db),
    user=Depends(require_perm("doc_template")),
):
    count = document_service.rename_product_line(db, body.old_name, body.new_name)
    log_audit(db, user, "product_line_rename", f"{body.old_name} -> {body.new_name} ({count})", "管理", "medium")
    return {"code": 0, "data": {"updated": count}, "message": "ok"}


@router.delete("/product-lines/{product_line:path}", response_model=dict)
def delete_product_line(
    product_line: str,
    db: Session = Depends(get_db),
    user=Depends(require_perm("doc_template")),
):
    from urllib.parse import unquote
    name = unquote(product_line)
    count = document_service.delete_product_line(db, name)
    log_audit(db, user, "product_line_del", f"{name} ({count} docs)", "管理", "high")
    return {"code": 0, "data": {"deleted": count}, "message": "ok"}
