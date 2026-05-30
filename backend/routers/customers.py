from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.middleware.auth import get_current_user
from backend.models.zentao import CachedCustomer, CustomerProjectLink, CachedProject

router = APIRouter(prefix="/api/customers", tags=["customers"])


@router.get("", response_model=dict)
def list_customers(
    search: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    q = db.query(CachedCustomer)
    if search:
        pattern = f"%{search}%"
        q = q.filter(CachedCustomer.name.ilike(pattern))
    customers = q.order_by(CachedCustomer.name).all()
    items = []
    for c in customers:
        link_count = db.query(CustomerProjectLink).filter(
            CustomerProjectLink.customer_id == c.id
        ).count()
        items.append({
            "id": c.id, "name": c.name, "full_name": c.full_name,
            "project_count": link_count,
        })
    return {"code": 0, "data": {"items": items, "total": len(items)}, "message": "ok"}


@router.get("/{customer_id}", response_model=dict)
def get_customer(
    customer_id: int,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    c = db.query(CachedCustomer).filter(CachedCustomer.id == customer_id).first()
    if not c:
        return {"code": 1, "data": None, "message": "Customer not found"}
    links = db.query(CustomerProjectLink).filter(
        CustomerProjectLink.customer_id == c.id
    ).all()
    project_ids = [l.project_id for l in links]
    projects = []
    if project_ids:
        projects = db.query(CachedProject).filter(
            CachedProject.id.in_(project_ids)
        ).all()
    return {
        "code": 0,
        "data": {
            "id": c.id, "name": c.name, "full_name": c.full_name,
            "projects": [{
                "id": p.id, "code": p.code, "name": p.name,
                "project_type": p.project_type, "status": p.status,
                "customer_name": p.customer_name,
            } for p in projects],
            "project_count": len(projects),
        },
        "message": "ok",
    }
