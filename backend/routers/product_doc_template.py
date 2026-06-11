from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.middleware.auth import get_current_user, require_perm
from backend.routers.logs import log_audit
from backend.services import document_service

router = APIRouter(prefix="/api/product-doc-templates", tags=["product-doc-templates"])


# ── Pydantic Models ──

class ProductNodeCreate(BaseModel):
    name: str
    parent_id: Optional[int] = None
    sort_order: int = 0


class ProductNodeUpdate(BaseModel):
    name: Optional[str] = None
    parent_id: Optional[int] = None
    sort_order: Optional[int] = None


class TemplateCreate(BaseModel):
    product_id: int
    doc_name: str
    sort_order: int = 0
    description: Optional[str] = None
    responsible_role: Optional[str] = None


class TemplateUpdate(BaseModel):
    product_id: Optional[int] = None
    doc_name: Optional[str] = None
    sort_order: Optional[int] = None
    description: Optional[str] = None
    responsible_role: Optional[str] = None


# ── Product Tree (read) ──

@router.get("/product-tree", response_model=dict)
def get_product_tree(
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    tree = document_service.get_product_tree(db)
    return {"code": 0, "data": tree, "message": "ok"}


@router.get("/breadcrumb/{node_id}", response_model=dict)
def get_node_breadcrumb(
    node_id: int,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    path = document_service.get_node_breadcrumb(db, node_id)
    return {"code": 0, "data": path, "message": "ok"}


# ── Product Tree CRUD (write) ──

@router.post("/product-nodes", response_model=dict)
def add_product_node(
    body: ProductNodeCreate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("doc_template")),
):
    try:
        node = document_service.add_product_node(
            db, body.name, body.parent_id, body.sort_order
        )
        log_audit(db, user, "product_node_add", body.name, "管理", "medium")
        return {"code": 0, "data": node, "message": "ok"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/product-nodes/{node_id}", response_model=dict)
def update_product_node(
    node_id: int,
    body: ProductNodeUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("doc_template")),
):
    try:
        node = document_service.update_product_node(
            db, node_id, body.model_dump(exclude_none=True)
        )
        log_audit(db, user, "product_node_update", f"id={node_id}", "管理", "medium")
        return {"code": 0, "data": node, "message": "ok"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/product-nodes/{node_id}", response_model=dict)
def delete_product_node(
    node_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_perm("doc_template")),
):
    try:
        result = document_service.delete_product_node(db, node_id)
        log_audit(
            db, user, "product_node_del",
            f"id={node_id}, nodes={result['node_count']}, templates={result['template_count']}",
            "管理", "high",
        )
        return {"code": 0, "data": result, "message": "ok"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── Template CRUD (write) ──

@router.post("", response_model=dict)
def create_template(
    body: TemplateCreate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("doc_template")),
):
    tpl = document_service.create_product_template(db, body.model_dump())
    log_audit(db, user, "product_doc_template_add", f"product_id={body.product_id}/{body.doc_name}", "管理", "medium")
    return {"code": 0, "data": tpl, "message": "ok"}


@router.get("/templates/{product_id}", response_model=dict)
def list_templates(
    product_id: int,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    templates = document_service.get_templates_for_product(db, product_id)
    return {"code": 0, "data": templates, "message": "ok"}


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
