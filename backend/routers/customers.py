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
from backend.services.entity_resolver import resolve_customer

router = APIRouter(prefix="/api/customers", tags=["customers"])


def _customer_product_count(db: Session, customer_id: int) -> int:
    """Count products linked to a customer: direct + indirect via projects."""
    # Direct: CustomerProductLink
    direct = set(
        r[0] for r in db.query(CustomerProductLink.product_id)
        .filter(CustomerProductLink.customer_id == customer_id).all()
    )
    # Indirect: product → project → customer
    project_ids = [r[0] for r in db.query(CustomerProjectLink.project_id)
                   .filter(CustomerProjectLink.customer_id == customer_id).all()]
    indirect = set()
    if project_ids:
        indirect = set(r[0] for r in db.query(ProductProjectLink.product_id)
                       .filter(ProductProjectLink.project_id.in_(project_ids)).all())
    return len(direct | indirect)


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
                "product_count": _customer_product_count(db, c.id),
            }
            for c in customers
        ],
        "message": "ok",
    }


@router.post("", response_model=dict)
def create_customer(payload: CustomerCreate, db: Session = Depends(get_db), user=Depends(require_perm("customer_link")), cu = Depends(get_current_user)):
    existing = db.query(PmaCustomer).filter(PmaCustomer.name == payload.name).first()
    if existing:
        raise HTTPException(status_code=400, detail="客户名称已存在")
    c = PmaCustomer(name=payload.name, full_name=payload.full_name or "")
    db.add(c)
    db.commit()
    db.refresh(c)
    log_audit(db, cu, "create_customer", f"name={payload.name!r} full_name={payload.full_name!r}", AUDIT_CAT_CUSTOMER, "medium")
    return {"code": 0, "data": {"id": c.id, "name": c.name}, "message": "客户已创建"}


@router.put("/{identifier}", response_model=dict)
def update_customer(identifier: str, payload: CustomerUpdate, db: Session = Depends(get_db), user=Depends(require_perm("customer_link")), cu = Depends(get_current_user)):
    customer = resolve_customer(db, identifier)
    changes = []
    if payload.name is not None and payload.name != customer.name:
        changes.append(f"name:'{customer.name}'->'{payload.name}'")
        customer.name = payload.name
    if payload.full_name is not None and payload.full_name != customer.full_name:
        changes.append(f"full_name:'{customer.full_name}'->'{payload.full_name}'")
        customer.full_name = payload.full_name
    db.commit()
    if changes:
        log_audit(db, cu, "update_customer", f"name={customer.name!r} " + "; ".join(changes), AUDIT_CAT_CUSTOMER, "medium")
    return {"code": 0, "message": "客户已更新"}


@router.delete("/{identifier}", response_model=dict)
def delete_customer(identifier: str, db: Session = Depends(get_db), _=Depends(require_perm("customer_link")), cu = Depends(get_current_user)):
    customer = resolve_customer(db, identifier)
    cname = customer.name
    db.query(CustomerProjectLink).filter(CustomerProjectLink.customer_id == customer.id).delete()
    db.query(CustomerProductLink).filter(CustomerProductLink.customer_id == customer.id).delete()
    db.delete(customer)
    db.commit()
    log_audit(db, cu, "delete_customer", f"name={cname!r}", AUDIT_CAT_CUSTOMER, "high")
    return {"code": 0, "message": "客户已删除"}


@router.get("/{identifier}", response_model=dict)
def get_customer_detail(identifier: str, db: Session = Depends(get_db), _=Depends(get_current_user)):
    customer = resolve_customer(db, identifier)
    # Associated projects (direct)
    proj_links = db.query(CustomerProjectLink).filter(CustomerProjectLink.customer_id == customer.id).all()
    project_ids = [l.project_id for l in proj_links]
    projects = db.query(CachedProject).filter(CachedProject.id.in_(project_ids)).all() if project_ids else []
    # Product info for each project (from ProductProjectLink)
    proj_product_map = {}
    if project_ids:
        ppl = db.query(ProductProjectLink).filter(ProductProjectLink.project_id.in_(project_ids)).all()
        prod_ids = list(set(l.product_id for l in ppl))
        all_prods = {p.id: p for p in db.query(PmaProduct).filter(PmaProduct.id.in_(prod_ids)).all()} if prod_ids else {}
        for l in ppl:
            proj_product_map.setdefault(l.project_id, []).append(
                {"id": l.product_id, "code": all_prods[l.product_id].code if l.product_id in all_prods else "",
                 "name": all_prods[l.product_id].name if l.product_id in all_prods else ""})

    # Associated products: direct links + indirect via projects (product → project → customer)
    direct_prod_links = db.query(CustomerProductLink).filter(CustomerProductLink.customer_id == customer.id).all()
    direct_product_ids = set(l.product_id for l in direct_prod_links)
    indirect_product_ids = set()
    if project_ids:
        indirect_ppl = db.query(ProductProjectLink).filter(ProductProjectLink.project_id.in_(project_ids)).all()
        indirect_product_ids = set(l.product_id for l in indirect_ppl)
    all_product_ids = direct_product_ids | indirect_product_ids
    products = db.query(PmaProduct).filter(PmaProduct.id.in_(all_product_ids)).all() if all_product_ids else []
    # Project info for each product (all historically linked projects)
    prod_project_map = {}
    if all_product_ids:
        all_ppl = db.query(ProductProjectLink).filter(ProductProjectLink.product_id.in_(all_product_ids)).all()
        proj_ids = list(set(l.project_id for l in all_ppl))
        all_projs = {p.id: p for p in db.query(CachedProject).filter(CachedProject.id.in_(proj_ids)).all()} if proj_ids else {}
        for l in all_ppl:
            if l.project_id in all_projs:
                prod_project_map.setdefault(l.product_id, []).append(
                    {"id": l.project_id, "code": all_projs[l.project_id].code or ""})

    return {
        "code": 0,
        "data": {
            "id": customer.id, "name": customer.name, "full_name": customer.full_name or "",
            "projects": [{"id": p.id, "name": p.name, "code": p.code, "status": p.status,
                          "products": proj_product_map.get(p.id, [])} for p in projects],
            "products": [{"id": p.id, "name": p.name, "code": p.code, "status": p.status,
                          "projects": prod_project_map.get(p.id, [])} for p in products],
        },
        "message": "ok",
    }
