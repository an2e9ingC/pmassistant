"""Customer management CRUD API."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.middleware.auth import get_current_user, require_perm
from backend.audit_categories import AUDIT_CAT_CUSTOMER
from backend.routers.logs import log_audit
from backend.models.zentao import PmaCustomer, CachedProject, PmaProduct, CustomerProjectLink, CustomerProductLink, ProductProjectLink

router = APIRouter(prefix="/api/customers", tags=["customers"])


class CustomerCreate(BaseModel):
    name: str
    full_name: Optional[str] = None


class CustomerUpdate(BaseModel):
    name: Optional[str] = None
    full_name: Optional[str] = None


@router.get("", response_model=dict)
def list_customers(
    search: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    q = db.query(PmaCustomer)
    if search:
        q = q.filter(PmaCustomer.name.ilike(f"%{search}%"))
    customers = q.order_by(PmaCustomer.name).all()
    return {
        "code": 0,
        "data": [
            {
                "id": c.id, "name": c.name, "full_name": c.full_name or "",
                "project_count": db.query(CustomerProjectLink).filter(
                    CustomerProjectLink.customer_id == c.id
                ).count(),
                "product_count": db.query(CustomerProductLink).filter(
                    CustomerProductLink.customer_id == c.id
                ).count(),
            }
            for c in customers
        ],
        "message": "ok",
    }


@router.post("", response_model=dict)
def create_customer(payload: CustomerCreate, db: Session = Depends(get_db), user=Depends(require_perm("customer_link"))):
    existing = db.query(PmaCustomer).filter(PmaCustomer.name == payload.name).first()
    if existing:
        raise HTTPException(status_code=400, detail="客户名称已存在")
    c = PmaCustomer(name=payload.name, full_name=payload.full_name or "")
    db.add(c)
    db.commit()
    db.refresh(c)
    return {"code": 0, "data": {"id": c.id, "name": c.name}, "message": "客户已创建"}


@router.put("/{customer_id}", response_model=dict)
def update_customer(customer_id: int, payload: CustomerUpdate, db: Session = Depends(get_db), user=Depends(require_perm("customer_link"))):
    c = db.query(PmaCustomer).filter(PmaCustomer.id == customer_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="客户不存在")
    if payload.name is not None:
        c.name = payload.name
    if payload.full_name is not None:
        c.full_name = payload.full_name
    db.commit()
    return {"code": 0, "message": "客户已更新"}


@router.delete("/{customer_id}", response_model=dict)
def delete_customer(customer_id: int, db: Session = Depends(get_db), _=Depends(require_perm("customer_link")), cu = Depends(get_current_user)):
    c = db.query(PmaCustomer).filter(PmaCustomer.id == customer_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="客户不存在")
    cname = c.name
    db.query(CustomerProjectLink).filter(CustomerProjectLink.customer_id == customer_id).delete()
    db.query(CustomerProductLink).filter(CustomerProductLink.customer_id == customer_id).delete()
    db.delete(c)
    db.commit()
    log_audit(db, cu, "delete_customer", f"name={cname!r}", AUDIT_CAT_CUSTOMER, "high")
    return {"code": 0, "message": "客户已删除"}


@router.get("/{customer_id}", response_model=dict)
def get_customer_detail(customer_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    c = db.query(PmaCustomer).filter(PmaCustomer.id == customer_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="客户不存在")
    # Associated projects
    proj_links = db.query(CustomerProjectLink).filter(CustomerProjectLink.customer_id == customer_id).all()
    project_ids = [l.project_id for l in proj_links]
    projects = db.query(CachedProject).filter(CachedProject.id.in_(project_ids)).all() if project_ids else []
    # Associated products
    prod_links = db.query(CustomerProductLink).filter(CustomerProductLink.customer_id == customer_id).all()
    product_ids = [l.product_id for l in prod_links]
    products = db.query(PmaProduct).filter(PmaProduct.id.in_(product_ids)).all() if product_ids else []
    return {
        "code": 0,
        "data": {
            "id": c.id, "name": c.name, "full_name": c.full_name or "",
            "projects": [{"id": p.id, "name": p.name, "code": p.code, "status": p.status} for p in projects],
            "products": [{"id": p.id, "name": p.name, "code": p.code, "status": p.status} for p in products],
        },
        "message": "ok",
    }
