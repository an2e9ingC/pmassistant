"""Entity resolver: look up projects/products/customers by their public code/name.

All API routes use this module to resolve path parameters that are
human-readable codes (e.g. PE0456, CD-LM) rather than integer primary keys.
"""

from fastapi import HTTPException
from sqlalchemy.orm import Session

from backend.models.zentao import CachedProject, PmaProduct, PmaCustomer


def resolve_project(db: Session, code: str):
    """Look up a project by code or numeric ID — CachedProject first, fallback to PmaProduct."""
    p = db.query(CachedProject).filter(CachedProject.code == code).first()
    if not p and code.isdigit():
        p = db.query(CachedProject).filter(CachedProject.id == int(code)).first()
    if not p:
        p = db.query(PmaProduct).filter(PmaProduct.code == code).first()
    if not p and code.isdigit():
        p = db.query(PmaProduct).filter(PmaProduct.id == int(code)).first()
    if not p:
        raise HTTPException(status_code=404, detail=f"项目不存在: {code}")
    return p


def resolve_product(db: Session, code: str) -> PmaProduct:
    """Look up a PmaProduct by its code field. Falls back to integer ID lookup."""
    p = db.query(PmaProduct).filter(PmaProduct.code == code).first()
    if not p and code.isdigit():
        p = db.query(PmaProduct).filter(PmaProduct.id == int(code)).first()
    if not p:
        raise HTTPException(status_code=404, detail=f"产品不存在: {code}")
    return p


def resolve_customer(db: Session, name: str) -> PmaCustomer:
    """Look up a PmaCustomer by its name field (which serves as the public code)."""
    c = db.query(PmaCustomer).filter(PmaCustomer.name == name).first()
    if not c:
        raise HTTPException(status_code=404, detail=f"客户不存在: {name}")
    return c
