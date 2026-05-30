from __future__ import annotations
from typing import Optional

from sqlalchemy.orm import Session

from backend.models.zentao import (
    CachedProduct, CachedProject, ProductProjectLink,
)


def get_products(
    db: Session,
    search: Optional[str] = None,
    category: Optional[str] = None,
    tags: Optional[str] = None,
    page: int = 1,
    limit: int = 50,
) -> tuple[list[dict], int]:
    q = db.query(CachedProduct)
    if search:
        pattern = f"%{search}%"
        q = q.filter(
            (CachedProduct.name.ilike(pattern)) |
            (CachedProduct.code.ilike(pattern)) |
            (CachedProduct.tags.ilike(pattern))
        )
    if category:
        q = q.filter(CachedProduct.category == category)
    if tags:
        for tag in tags.split(","):
            tag = tag.strip()
            if tag:
                q = q.filter(CachedProduct.tags.ilike(f"%{tag}%"))
    total = q.count()
    items = q.order_by(CachedProduct.id).offset((page - 1) * limit).limit(limit).all()
    return [_product_item(p, db) for p in items], total


def get_product(db: Session, product_id: int) -> Optional[dict]:
    p = db.query(CachedProduct).filter(CachedProduct.id == product_id).first()
    if not p:
        return None
    return _product_detail(p, db)


def update_product(db: Session, product_id: int, data: dict) -> Optional[dict]:
    p = db.query(CachedProduct).filter(CachedProduct.id == product_id).first()
    if not p:
        return None
    for field in ("category", "nas_path", "git_url", "pma_customer", "alias_name"):
        if field in data:
            setattr(p, field, data[field])
    db.commit()
    db.refresh(p)
    return _product_detail(p, db)


def get_product_projects(db: Session, product_id: int) -> list[dict]:
    links = db.query(ProductProjectLink).filter(
        ProductProjectLink.product_id == product_id
    ).all()
    project_ids = [l.project_id for l in links]
    if not project_ids:
        return []
    projects = db.query(CachedProject).filter(
        CachedProject.id.in_(project_ids)
    ).all()
    return [{
        "id": p.id, "code": p.code, "name": p.name,
        "project_type": p.project_type, "status": p.status,
        "customer_name": p.customer_name,
    } for p in projects]


def add_product_project_link(db: Session, product_id: int, project_id: int) -> dict:
    existing = db.query(ProductProjectLink).filter(
        ProductProjectLink.product_id == product_id,
        ProductProjectLink.project_id == project_id,
    ).first()
    if existing:
        return {"linked": False, "message": "关联已存在"}
    link = ProductProjectLink(product_id=product_id, project_id=project_id)
    db.add(link)
    db.commit()
    return {"linked": True, "message": "关联成功"}


def remove_product_project_link(db: Session, product_id: int, project_id: int) -> dict:
    link = db.query(ProductProjectLink).filter(
        ProductProjectLink.product_id == product_id,
        ProductProjectLink.project_id == project_id,
    ).first()
    if not link:
        return {"removed": False, "message": "关联不存在"}
    db.delete(link)
    db.commit()
    return {"removed": True, "message": "已取消关联"}


def get_project_products_full(db: Session, project_id: int) -> list[dict]:
    """Get products linked to a project, with full detail."""
    links = db.query(ProductProjectLink).filter(
        ProductProjectLink.project_id == project_id
    ).all()
    product_ids = [l.product_id for l in links]
    if not product_ids:
        return []
    products = db.query(CachedProduct).filter(
        CachedProduct.id.in_(product_ids)
    ).all()
    return [_product_detail(p, db) for p in products]


def get_mapping_overview(db: Session) -> dict:
    """Overview stats for the mapping view."""
    total_products = db.query(CachedProduct).count()
    total_projects = db.query(CachedProject).count()
    total_links = db.query(ProductProjectLink).count()
    unlinked_products = total_products - db.query(ProductProjectLink.product_id).distinct().count()
    unlinked_projects = total_projects - db.query(ProductProjectLink.project_id).distinct().count()
    return {
        "total_products": total_products,
        "total_projects": total_projects,
        "total_links": total_links,
        "unlinked_products": unlinked_products,
        "unlinked_projects": unlinked_projects,
    }


def _extract_customers_from_desc(p: CachedProduct) -> list[str]:
    """Extract customer names from 【...】 markers in product description."""
    import re
    if not p.raw_json:
        return []
    try:
        import json as _json
        data = _json.loads(p.raw_json)
        desc = data.get("desc", "") or ""
    except Exception:
        return []
    # Strip HTML tags, then find all 【...】 patterns
    plain = re.sub(r"<[^>]+>", "", desc)
    return re.findall(r"【(.+?)】", plain)


def _product_item(p: CachedProduct, db: Session) -> dict:
    link_count = db.query(ProductProjectLink).filter(
        ProductProjectLink.product_id == p.id
    ).count()
    # Use program_name from Zentao product line, fallback to PMA-local category
    cat = p.program_name or p.category
    tags_str = p.tags or ""
    return {
        "id": p.id, "code": p.code, "name": p.name,
        "type": p.type, "status": p.status,
        "category": cat,
        "program_name": p.program_name,
        "project_count": link_count,
        "description": p.description or "",
        "tags": tags_str,
        "tags_list": tags_str.split(",") if tags_str else [],
    }


def _product_detail(p: CachedProduct, db: Session) -> dict:
    projects = get_product_projects(db, p.id)
    cat = p.program_name or p.category
    # Derive customers from linked projects (primary) + product desc (supplementary)
    customers = list(set(
        [prj.get("customer_name", "") for prj in projects if prj.get("customer_name")] +
        _extract_customers_from_desc(p)
    ))
    customers = [c for c in customers if c]  # filter empty
    tags_str = p.tags or ""
    return {
        "id": p.id, "code": p.code, "name": p.name,
        "type": p.type, "status": p.status,
        "program_id": p.program_id,
        "program_name": p.program_name,
        "total_stories": p.total_stories,
        "total_bugs": p.total_bugs,
        "releases": p.releases,
        "category": cat,
        "nas_path": p.nas_path,
        "git_url": p.git_url,
        "pma_customer": p.pma_customer,
        "description": p.description or "",
        "tags": tags_str,
        "tags_list": tags_str.split(",") if tags_str else [],
        "customers_from_desc": customers,
        "projects": projects,
        "project_count": len(projects),
    }
