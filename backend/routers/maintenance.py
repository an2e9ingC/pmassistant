"""Project/Product maintenance — link/unlink products & customers (requires project_edit / product_link)."""

from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.middleware.auth import require_perm
from backend.models.zentao import ProductProjectLink, CustomerProjectLink, CustomerProductLink, CachedProduct, CachedProject, CachedCustomer
from backend.services.project_service import log_project_activity

router = APIRouter(prefix="/api/maintenance", tags=["maintenance"])


class LinkIds(BaseModel):
    ids: List[int]


# ── Customer List ──

@router.get("/customers", response_model=dict)
def list_customers(db: Session = Depends(get_db)):
    """List all cached customers for dropdown selection."""
    customers = db.query(CachedCustomer).order_by(CachedCustomer.name).all()
    return {"code": 0, "data": [{"id": c.id, "name": c.name} for c in customers], "message": "ok"}


# ── Project/Product Linking ──

@router.get("/projects/{project_id}/products", response_model=dict)
def get_project_products(project_id: int, db: Session = Depends(get_db), _=Depends(require_perm("project_edit"))):
    links = db.query(ProductProjectLink).filter(ProductProjectLink.project_id == project_id).all()
    product_ids = [l.product_id for l in links]
    products = db.query(CachedProduct).filter(CachedProduct.id.in_(product_ids)).all() if product_ids else []
    return {"code": 0, "data": [{"id": p.id, "name": p.name, "code": p.code} for p in products], "message": "ok"}


@router.put("/projects/{project_id}/products", response_model=dict)
def set_project_products(project_id: int, payload: LinkIds, db: Session = Depends(get_db), user=Depends(require_perm("project_edit"))):
    db.query(ProductProjectLink).filter(ProductProjectLink.project_id == project_id).delete()
    for pid in payload.ids:
        db.add(ProductProjectLink(product_id=pid, project_id=project_id))
    db.commit()
    names = [p.name for p in db.query(CachedProduct).filter(CachedProduct.id.in_(payload.ids)).all()]
    log_project_activity(db, project_id, user.username, "关联产品", f"设置关联产品: {', '.join(names) if names else '清空'}")
    return {"code": 0, "data": payload.ids, "message": "ok"}


# ── Project/Customer Linking ──

@router.get("/projects/{project_id}/customers", response_model=dict)
def get_project_customers(project_id: int, db: Session = Depends(get_db), _=Depends(require_perm("project_edit"))):
    links = db.query(CustomerProjectLink).filter(CustomerProjectLink.project_id == project_id).all()
    customer_ids = [l.customer_id for l in links]
    customers = db.query(CachedCustomer).filter(CachedCustomer.id.in_(customer_ids)).all() if customer_ids else []
    return {"code": 0, "data": [{"id": c.id, "name": c.name} for c in customers], "message": "ok"}


@router.put("/projects/{project_id}/customers", response_model=dict)
def set_project_customers(project_id: int, payload: LinkIds, db: Session = Depends(get_db), user=Depends(require_perm("project_edit"))):
    db.query(CustomerProjectLink).filter(CustomerProjectLink.project_id == project_id).delete()
    for cid in payload.ids:
        db.add(CustomerProjectLink(customer_id=cid, project_id=project_id))
    db.commit()
    names = [c.name for c in db.query(CachedCustomer).filter(CachedCustomer.id.in_(payload.ids)).all()]
    log_project_activity(db, project_id, user.username, "关联客户", f"设置关联客户: {', '.join(names) if names else '清空'}")
    return {"code": 0, "data": payload.ids, "message": "ok"}


# ── Product/Project Linking ──

@router.get("/products/{product_id}/projects", response_model=dict)
def get_product_projects(product_id: int, db: Session = Depends(get_db), _=Depends(require_perm("product_link"))):
    links = db.query(ProductProjectLink).filter(ProductProjectLink.product_id == product_id).all()
    project_ids = [l.project_id for l in links]
    projects = db.query(CachedProject).filter(CachedProject.id.in_(project_ids)).all() if project_ids else []
    return {"code": 0, "data": [{"id": p.id, "name": p.name, "code": p.code} for p in projects], "message": "ok"}


@router.put("/products/{product_id}/projects", response_model=dict)
def set_product_projects(product_id: int, payload: LinkIds, db: Session = Depends(get_db), _=Depends(require_perm("product_link"))):
    db.query(ProductProjectLink).filter(ProductProjectLink.product_id == product_id).delete()
    for pid in payload.ids:
        db.add(ProductProjectLink(product_id=product_id, project_id=pid))
    db.commit()
    return {"code": 0, "data": payload.ids, "message": "ok"}


# ── Project Tag Linking ──

class TagList(BaseModel):
    tags: List[str]


@router.get("/projects/{project_id}/tags", response_model=dict)
def get_project_tags(project_id: int, db: Session = Depends(get_db), _=Depends(require_perm("project_edit"))):
    """Get current tags for a project (comma-separated string parsed to list)."""
    project = db.query(CachedProject).filter(CachedProject.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    tags_str = project.tags or ""
    tags_list = [t.strip() for t in tags_str.split(",") if t.strip()]
    return {"code": 0, "data": tags_list, "message": "ok"}


@router.put("/projects/{project_id}/tags", response_model=dict)
def set_project_tags(project_id: int, payload: TagList, db: Session = Depends(get_db), user=Depends(require_perm("project_edit"))):
    """Set tags for a project from the tag template library."""
    project = db.query(CachedProject).filter(CachedProject.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    project.tags = ",".join(payload.tags) if payload.tags else ""
    db.commit()
    log_project_activity(db, project_id, user.username, "项目标签", f"设置标签: {', '.join(payload.tags) if payload.tags else '清空'}")
    return {"code": 0, "data": payload.tags, "message": "ok"}


# ── Product/Customer Linking ──

@router.get("/products/{product_id}/customers", response_model=dict)
def get_product_customers(product_id: int, db: Session = Depends(get_db), _=Depends(require_perm("product_link"))):
    links = db.query(CustomerProductLink).filter(CustomerProductLink.product_id == product_id).all()
    customer_ids = [l.customer_id for l in links]
    customers = db.query(CachedCustomer).filter(CachedCustomer.id.in_(customer_ids)).all() if customer_ids else []
    return {"code": 0, "data": [{"id": c.id, "name": c.name} for c in customers], "message": "ok"}


@router.put("/products/{product_id}/customers", response_model=dict)
def set_product_customers(product_id: int, payload: LinkIds, db: Session = Depends(get_db), _=Depends(require_perm("product_link"))):
    db.query(CustomerProductLink).filter(CustomerProductLink.product_id == product_id).delete()
    for cid in payload.ids:
        db.add(CustomerProductLink(customer_id=cid, product_id=product_id))
    db.commit()
    return {"code": 0, "data": payload.ids, "message": "ok"}
