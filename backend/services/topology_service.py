"""Topology search — unified project-product-customer query with AND filtering."""

from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from backend.models.zentao import CachedProject, PmaProduct, PmaCustomer, ProductProjectLink, CustomerProjectLink


def search_topology(
    db: Session,
    project: Optional[str] = None,
    product: Optional[str] = None,
    customer: Optional[str] = None,
    query: Optional[str] = None,
) -> List[Dict]:
    """Return project-product-customer associations filtered by dimensions.

    - query: fuzzy search across ALL dimensions with OR logic
    - project/product/customer: AND logic (existing 3D search)
    """
    q = db.query(CachedProject)

    # Fuzzy search: OR across all three dimensions
    if query:
        pattern = f"%{query}%"
        sub_prod = (
            db.query(ProductProjectLink.project_id)
            .join(PmaProduct, PmaProduct.id == ProductProjectLink.product_id)
            .filter(
                (PmaProduct.name.ilike(pattern)) |
                (PmaProduct.code.ilike(pattern))
            )
        )
        sub_cust = (
            db.query(CustomerProjectLink.project_id)
            .join(PmaCustomer, PmaCustomer.id == CustomerProjectLink.customer_id)
            .filter(PmaCustomer.name.ilike(pattern))
        )
        q = q.filter(
            (CachedProject.code.ilike(pattern)) |
            (CachedProject.name.ilike(pattern)) |
            CachedProject.customer_name.ilike(pattern) |
            CachedProject.id.in_(sub_prod) |
            CachedProject.id.in_(sub_cust)
        )
    else:
        # 3D AND search
        if project:
            pattern = f"%{project}%"
            q = q.filter(
                (CachedProject.code.ilike(pattern)) |
                (CachedProject.name.ilike(pattern))
            )
        if product:
            pattern = f"%{product}%"
            sub_ids = (
                db.query(ProductProjectLink.project_id)
                .join(PmaProduct, PmaProduct.id == ProductProjectLink.product_id)
                .filter(
                    (PmaProduct.name.ilike(pattern)) |
                    (PmaProduct.code.ilike(pattern))
                )
                .subquery()
            )
            q = q.filter(CachedProject.id.in_(sub_ids))
        if customer:
            pattern = f"%{customer}%"
            linked_ids = (
                db.query(CustomerProjectLink.project_id)
                .join(PmaCustomer, PmaCustomer.id == CustomerProjectLink.customer_id)
                .filter(PmaCustomer.name.ilike(pattern))
            )
            q = q.filter(
                CachedProject.customer_name.ilike(pattern) |
                CachedProject.id.in_(linked_ids)
            )

    projects = q.order_by(CachedProject.id).all()

    if not projects:
        return []

    # Batch-load linked products and customers for all matching projects
    project_ids = [p.id for p in projects]
    links = (
        db.query(ProductProjectLink)
        .filter(ProductProjectLink.project_id.in_(project_ids))
        .all()
    )
    products_map: Dict[int, List[dict]] = {}
    product_ids = set(link.product_id for link in links)
    prods = {
        p.id: {"name": p.name, "code": p.code}
        for p in db.query(PmaProduct).filter(PmaProduct.id.in_(product_ids)).all()
    }
    for link in links:
        pinfo = prods.get(link.product_id)
        if pinfo:
            name = pinfo["name"]
            prod_code = pinfo["code"] or ""
            products_map.setdefault(link.project_id, []).append({"id": link.product_id, "name": name, "code": prod_code})

    # Batch-load linked customers
    cust_links = (
        db.query(CustomerProjectLink)
        .filter(CustomerProjectLink.project_id.in_(project_ids))
        .all()
    )
    cust_ids = set(l.customer_id for l in cust_links)
    custs = {
        c.id: c.name
        for c in db.query(PmaCustomer).filter(PmaCustomer.id.in_(cust_ids)).all()
    }
    cust_map: Dict[int, List[str]] = {}
    for link in cust_links:
        name = custs.get(link.customer_id)
        if name:
            cust_map.setdefault(link.project_id, []).append(name)

    results = []
    for p in projects:
        # Customer: from linked customers only (p.customer_name is deprecated)
        cust_names = cust_map.get(p.id, [])
        results.append({
            "project_id": p.id,
            "project_code": p.code or (p.name.split("-")[0] if p.name and "-" in p.name else ""),
            "project_name": p.name or "",
            "customer_name": "、".join(cust_names),
            "products": products_map.get(p.id, []),
            "project_type": p.project_type or "RD",
            "project_status": p.status or "",
            "progress": p.progress or 0,
            "end": str(p.end) if p.end else None,
        })
    return results
