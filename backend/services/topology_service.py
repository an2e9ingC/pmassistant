"""Topology search — unified project-product-customer query with AND filtering."""

from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from backend.models.zentao import CachedProject, CachedProduct, ProductProjectLink


def search_topology(
    db: Session,
    project: Optional[str] = None,
    product: Optional[str] = None,
    customer: Optional[str] = None,
) -> List[Dict]:
    """Return project-product-customer associations filtered by 3 dimensions (AND logic).

    Each dimension filter is optional; all provided filters are combined with AND.
    """
    q = db.query(CachedProject)

    # Project dimension filter
    if project:
        pattern = f"%{project}%"
        q = q.filter(
            (CachedProject.code.ilike(pattern)) |
            (CachedProject.name.ilike(pattern))
        )

    # Product dimension filter — subquery via ProductProjectLink
    if product:
        pattern = f"%{product}%"
        sub_ids = (
            db.query(ProductProjectLink.project_id)
            .join(CachedProduct, CachedProduct.id == ProductProjectLink.product_id)
            .filter(
                (CachedProduct.name.ilike(pattern)) |
                (CachedProduct.code.ilike(pattern))
            )
            .subquery()
        )
        q = q.filter(CachedProject.id.in_(sub_ids))

    # Customer dimension filter
    if customer:
        pattern = f"%{customer}%"
        q = q.filter(CachedProject.customer_name.ilike(pattern))

    projects = q.order_by(CachedProject.id).all()

    if not projects:
        return []

    # Batch-load linked products for all matching projects
    project_ids = [p.id for p in projects]
    links = (
        db.query(ProductProjectLink)
        .filter(ProductProjectLink.project_id.in_(project_ids))
        .all()
    )
    products_map: Dict[int, List[str]] = {}
    product_ids = set(link.product_id for link in links)
    prods = {
        p.id: p.name
        for p in db.query(CachedProduct).filter(CachedProduct.id.in_(product_ids)).all()
    }
    for link in links:
        name = prods.get(link.product_id)
        if name:
            products_map.setdefault(link.project_id, []).append(name)

    results = []
    for p in projects:
        results.append({
            "project_id": p.id,
            "project_code": p.code or (p.name.split("-")[0] if p.name and "-" in p.name else ""),
            "project_name": p.name or "",
            "customer_name": p.customer_name or "",
            "product_names": products_map.get(p.id, []),
            "project_type": p.project_type or "RD",
            "project_status": p.status or "",
            "progress": p.progress or 0,
            "end": str(p.end) if p.end else None,
        })
    return results
