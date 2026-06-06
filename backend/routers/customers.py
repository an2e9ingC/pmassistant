"""Customer management CRUD API."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.middleware.auth import get_current_user, require_perm
from backend.models.zentao import CachedCustomer, CustomerProjectLink, CustomerProductLink

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
    q = db.query(CachedCustomer)
    if search:
        q = q.filter(CachedCustomer.name.ilike(f"%{search}%"))
    customers = q.order_by(CachedCustomer.name).all()
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
def create_customer(payload: CustomerCreate, db: Session = Depends(get_db), _=Depends(require_perm("customer_link"))):
    existing = db.query(CachedCustomer).filter(CachedCustomer.name == payload.name).first()
    if existing:
        raise HTTPException(status_code=400, detail="客户名称已存在")
    c = CachedCustomer(name=payload.name, full_name=payload.full_name or "")
    db.add(c)
    db.commit()
    db.refresh(c)
    return {"code": 0, "data": {"id": c.id, "name": c.name}, "message": "客户已创建"}


@router.put("/{customer_id}", response_model=dict)
def update_customer(customer_id: int, payload: CustomerUpdate, db: Session = Depends(get_db), _=Depends(require_perm("customer_link"))):
    c = db.query(CachedCustomer).filter(CachedCustomer.id == customer_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="客户不存在")
    if payload.name is not None:
        c.name = payload.name
    if payload.full_name is not None:
        c.full_name = payload.full_name
    db.commit()
    return {"code": 0, "message": "客户已更新"}


@router.delete("/{customer_id}", response_model=dict)
def delete_customer(customer_id: int, db: Session = Depends(get_db), _=Depends(require_perm("customer_link"))):
    c = db.query(CachedCustomer).filter(CachedCustomer.id == customer_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="客户不存在")
    db.query(CustomerProjectLink).filter(CustomerProjectLink.customer_id == customer_id).delete()
    db.query(CustomerProductLink).filter(CustomerProductLink.customer_id == customer_id).delete()
    db.delete(c)
    db.commit()
    return {"code": 0, "message": "客户已删除"}
