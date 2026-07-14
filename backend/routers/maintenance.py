"""Project/Product maintenance — link/unlink products & customers (requires project_edit / product_link)."""

from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.middleware.auth import get_current_user, require_perm
from backend.models.zentao import ProductProjectLink, CustomerProjectLink, CustomerProductLink, PmaProduct, CachedProject, PmaCustomer
from backend.services.project_service import log_project_activity
from backend.services.entity_resolver import resolve_project, resolve_product

router = APIRouter(prefix="/api/maintenance", tags=["maintenance"])


class LinkIds(BaseModel):
    ids: List[int]


# ── Customer List ──

@router.get("/customers", response_model=dict)
def list_customers(db: Session = Depends(get_db), _=Depends(get_current_user)):
    """List all cached customers for dropdown selection."""
    customers = db.query(PmaCustomer).order_by(PmaCustomer.name).all()
    return {"code": 0, "data": [{"id": c.id, "name": c.name} for c in customers], "message": "ok"}


# ── Project/Product Linking ──

@router.get("/projects/{identifier}/products", response_model=dict)
def get_project_products(identifier: str, db: Session = Depends(get_db), _=Depends(require_perm("project_edit"))):
    project = resolve_project(db, identifier)
    links = db.query(ProductProjectLink).filter(ProductProjectLink.project_id == project.id).all()
    product_ids = [l.product_id for l in links]
    products = db.query(PmaProduct).filter(PmaProduct.id.in_(product_ids)).all() if product_ids else []
    return {"code": 0, "data": [{"id": p.id, "name": p.name, "code": p.code} for p in products], "message": "ok"}


@router.put("/projects/{identifier}/products", response_model=dict)
def set_project_products(identifier: str, payload: LinkIds, db: Session = Depends(get_db), user=Depends(require_perm("project_edit"))):
    project = resolve_project(db, identifier)
    # Get old names before deleting links
    old_links = db.query(ProductProjectLink).filter(ProductProjectLink.project_id == project.id).all()
    old_pids = [l.product_id for l in old_links]
    old_names = [p.name for p in db.query(PmaProduct).filter(PmaProduct.id.in_(old_pids)).all()] if old_pids else []
    db.query(ProductProjectLink).filter(ProductProjectLink.project_id == project.id).delete()
    for pid in payload.ids:
        db.add(ProductProjectLink(product_id=pid, project_id=project.id))
    db.commit()
    names = [p.name for p in db.query(PmaProduct).filter(PmaProduct.id.in_(payload.ids)).all()]
    old_str = ", ".join(old_names) if old_names else "无"
    new_str = ", ".join(names) if names else "无"
    log_project_activity(db, project.id, user.username, "关联产品", f"product:'{old_str}'->'{new_str}'")
    return {"code": 0, "data": payload.ids, "message": "ok"}


# ── Project/Customer Linking ──

@router.get("/projects/{identifier}/customers", response_model=dict)
def get_project_customers(identifier: str, db: Session = Depends(get_db), _=Depends(require_perm("project_edit"))):
    project = resolve_project(db, identifier)
    links = db.query(CustomerProjectLink).filter(CustomerProjectLink.project_id == project.id).all()
    customer_ids = [l.customer_id for l in links]
    customers = db.query(PmaCustomer).filter(PmaCustomer.id.in_(customer_ids)).all() if customer_ids else []
    return {"code": 0, "data": [{"id": c.id, "name": c.name} for c in customers], "message": "ok"}


@router.put("/projects/{identifier}/customers", response_model=dict)
def set_project_customers(identifier: str, payload: LinkIds, db: Session = Depends(get_db), user=Depends(require_perm("project_edit"))):
    project = resolve_project(db, identifier)
    old_links = db.query(CustomerProjectLink).filter(CustomerProjectLink.project_id == project.id).all()
    old_cids = [l.customer_id for l in old_links]
    old_names = [c.name for c in db.query(PmaCustomer).filter(PmaCustomer.id.in_(old_cids)).all()] if old_cids else []
    db.query(CustomerProjectLink).filter(CustomerProjectLink.project_id == project.id).delete()
    for cid in payload.ids:
        db.add(CustomerProjectLink(customer_id=cid, project_id=project.id))
    db.commit()
    names = [c.name for c in db.query(PmaCustomer).filter(PmaCustomer.id.in_(payload.ids)).all()]
    old_str = ", ".join(old_names) if old_names else "无"
    new_str = ", ".join(names) if names else "无"
    log_project_activity(db, project.id, user.username, "关联客户", f"customer:'{old_str}'->'{new_str}'")
    return {"code": 0, "data": payload.ids, "message": "ok"}


# ── Product/Project Linking ──

@router.get("/products/{identifier}/projects", response_model=dict)
def get_product_projects(identifier: str, db: Session = Depends(get_db), _=Depends(require_perm("product_link"))):
    product = resolve_product(db, identifier)
    links = db.query(ProductProjectLink).filter(ProductProjectLink.product_id == product.id).all()
    project_ids = [l.project_id for l in links]
    projects = db.query(CachedProject).filter(CachedProject.id.in_(project_ids)).all() if project_ids else []
    return {"code": 0, "data": [{"id": p.id, "name": p.name, "code": p.code} for p in projects], "message": "ok"}


@router.put("/products/{identifier}/projects", response_model=dict)
def set_product_projects(identifier: str, payload: LinkIds, db: Session = Depends(get_db), _=Depends(require_perm("product_link"))):
    product = resolve_product(db, identifier)
    db.query(ProductProjectLink).filter(ProductProjectLink.product_id == product.id).delete()
    for pid in payload.ids:
        db.add(ProductProjectLink(product_id=product.id, project_id=pid))
    db.commit()
    return {"code": 0, "data": payload.ids, "message": "ok"}


# ── Project Tag Linking ──

class TagList(BaseModel):
    tags: List[str]


@router.get("/projects/{identifier}/tags", response_model=dict)
def get_project_tags(identifier: str, db: Session = Depends(get_db), _=Depends(require_perm("project_edit"))):
    project = resolve_project(db, identifier)
    """Get current tags for a project (comma-separated string parsed to list)."""
    project = db.query(CachedProject).filter(CachedProject.id == project.id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    tags_str = project.tags or ""
    tags_list = [t.strip() for t in tags_str.split(",") if t.strip()]
    return {"code": 0, "data": tags_list, "message": "ok"}


@router.put("/projects/{identifier}/tags", response_model=dict)
def set_project_tags(identifier: str, payload: TagList, db: Session = Depends(get_db), user=Depends(require_perm("project_edit"))):
    project = resolve_project(db, identifier)
    """Set tags for a project from the tag template library."""
    project = db.query(CachedProject).filter(CachedProject.id == project.id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    old_tags_str = project.tags or ""
    old_tags = [t.strip() for t in old_tags_str.split(",") if t.strip()]
    project.tags = ",".join(payload.tags) if payload.tags else ""
    db.commit()
    old_str = ", ".join(old_tags) if old_tags else "无"
    new_str = ", ".join(payload.tags) if payload.tags else "无"
    log_project_activity(db, project.id, user.username, "项目标签", f"tags:'{old_str}'->'{new_str}'")
    return {"code": 0, "data": payload.tags, "message": "ok"}


# ── Product/Customer Linking ──

@router.get("/products/{identifier}/customers", response_model=dict)
def get_product_customers(identifier: str, db: Session = Depends(get_db), _=Depends(require_perm("product_link"))):
    product = resolve_product(db, identifier)
    links = db.query(CustomerProductLink).filter(CustomerProductLink.product_id == product.id).all()
    customer_ids = [l.customer_id for l in links]
    customers = db.query(PmaCustomer).filter(PmaCustomer.id.in_(customer_ids)).all() if customer_ids else []
    return {"code": 0, "data": [{"id": c.id, "name": c.name} for c in customers], "message": "ok"}


@router.put("/products/{identifier}/customers", response_model=dict)
def set_product_customers(identifier: str, payload: LinkIds, db: Session = Depends(get_db), _=Depends(require_perm("product_link"))):
    product = resolve_product(db, identifier)
    db.query(CustomerProductLink).filter(CustomerProductLink.product_id == product.id).delete()
    for cid in payload.ids:
        db.add(CustomerProductLink(customer_id=cid, product_id=product.id))
    db.commit()
    return {"code": 0, "data": payload.ids, "message": "ok"}
