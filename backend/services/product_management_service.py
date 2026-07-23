"""
Product Management Service — combines product hierarchy tree with
ZenTao/local products and project associations.
"""

from __future__ import annotations

from datetime import date, datetime


def _parse_date(val) -> Optional[date]:
    """Parse ISO date string YYYY-MM-DD to date object."""
    if not val:
        return None
    try:
        return date.fromisoformat(val)
    except (ValueError, TypeError):
        return None
from typing import Optional

from sqlalchemy import func as sqlfunc
from sqlalchemy.orm import Session

from backend.database import to_local_str
from backend.models.document import ProductLine
from backend.models.zentao import (
    PmaProduct,
    CachedProject,
    ProductNodeLink,
    ProductProjectLink,
)


# ---------------------------------------------------------------------------
# Enhanced Product Tree (with product/project counts per node)
# ---------------------------------------------------------------------------

def get_product_management_tree(db: Session) -> list[dict]:
    """Return the product hierarchy tree enriched with product and project counts per node."""

    all_nodes = db.query(ProductLine).order_by(
        ProductLine.sort_order, ProductLine.name
    ).all()

    # Build parent -> children map
    nodes_by_parent: dict = {}
    for node in all_nodes:
        nodes_by_parent.setdefault(node.parent_id, []).append(node)

    # Count products linked per node (via ProductNodeLink)
    product_counts: dict[int, int] = {}
    for row in db.query(
        ProductNodeLink.product_node_id,
        sqlfunc.count(ProductNodeLink.id),
    ).group_by(ProductNodeLink.product_node_id).all():
        product_counts[row[0]] = row[1]

    # Count projects linked to products under each node
    project_counts: dict[int, int] = {}
    # Get all node->product mappings
    node_products: dict[int, list[int]] = {}
    for link in db.query(ProductNodeLink).all():
        node_products.setdefault(link.product_node_id, []).append(link.product_id)

    for node_id, product_ids in node_products.items():
        if product_ids:
            count = db.query(sqlfunc.count(sqlfunc.distinct(ProductProjectLink.project_id))).filter(
                ProductProjectLink.product_id.in_(product_ids)
            ).scalar() or 0
            project_counts[node_id] = count

    def build_tree(parent_id=None, level=1):
        children = nodes_by_parent.get(parent_id, [])
        result = []
        for node in children:
            child_list = build_tree(node.id, level + 1) if level < 3 else []
            result.append({
                "id": node.id,
                "name": node.name,
                "parent_id": node.parent_id,
                "sort_order": node.sort_order,
                "level": level,
                "product_count": product_counts.get(node.id, 0),
                "project_count": project_counts.get(node.id, 0),
                "children": child_list,
            })
        return result

    return build_tree()


# ---------------------------------------------------------------------------
# Products under a tree node
# ---------------------------------------------------------------------------

def get_node_products(db: Session, node_id: int) -> list[dict]:
    """Return all products linked to a tree node (via ProductNodeLink)."""
    links = db.query(ProductNodeLink).filter(
        ProductNodeLink.product_node_id == node_id
    ).all()
    product_ids = [link.product_id for link in links]

    if not product_ids:
        return []

    products = db.query(PmaProduct).filter(
        PmaProduct.id.in_(product_ids)
    ).order_by(PmaProduct.name).all()

    return [_product_item(p, db) for p in products]


def get_node_projects(db: Session, node_id: int) -> list[dict]:
    """Return all projects linked to products under a tree node."""
    links = db.query(ProductNodeLink).filter(
        ProductNodeLink.product_node_id == node_id
    ).all()
    product_ids = [link.product_id for link in links]

    if not product_ids:
        return []

    project_links = db.query(ProductProjectLink).filter(
        ProductProjectLink.product_id.in_(product_ids)
    ).all()
    project_ids = list(set(link.project_id for link in project_links))

    if not project_ids:
        return []

    projects = db.query(CachedProject).filter(
        CachedProject.id.in_(project_ids)
    ).order_by(CachedProject.name).all()

    return [_project_item(p, db) for p in projects]


# ---------------------------------------------------------------------------
# Product-Node linking
# ---------------------------------------------------------------------------

def link_product_to_node(db: Session, product_id: int, node_id: int) -> dict:
    """Link a PmaProduct to a tree node."""
    # Verify product exists
    product = db.query(PmaProduct).filter(PmaProduct.id == product_id).first()
    if not product:
        raise ValueError(f"产品不存在: {product_id}")

    # Verify node exists
    node = db.query(ProductLine).filter(ProductLine.id == node_id).first()
    if not node:
        raise ValueError(f"节点不存在: {node_id}")

    # Check if link already exists
    existing = db.query(ProductNodeLink).filter(
        ProductNodeLink.product_id == product_id,
        ProductNodeLink.product_node_id == node_id,
    ).first()
    if existing:
        raise ValueError("该产品已关联到此节点")

    link = ProductNodeLink(product_id=product_id, product_node_id=node_id)
    db.add(link)
    db.commit()
    return {"product_id": product_id, "product_node_id": node_id}


def unlink_product_from_node(db: Session, product_id: int, node_id: int) -> dict:
    """Remove a product-node link."""
    link = db.query(ProductNodeLink).filter(
        ProductNodeLink.product_id == product_id,
        ProductNodeLink.product_node_id == node_id,
    ).first()
    if not link:
        raise ValueError("未找到该关联")

    db.delete(link)
    db.commit()
    return {"product_id": product_id, "product_node_id": node_id}


# ---------------------------------------------------------------------------
# PMA-local Products
# ---------------------------------------------------------------------------

def create_local_product(
    db: Session,
    name: str,
    code: str,
    node_id: int,
    status: str = "normal",
    description: str = "",
    project_ids: Optional[list[int]] = None,
    reporter_id: Optional[int] = None,
) -> dict:
    """Create a PMA-local product and optionally link to projects."""
    # Verify node exists
    node = db.query(ProductLine).filter(ProductLine.id == node_id).first()
    if not node:
        raise ValueError(f"节点不存在: {node_id}")

    # Validate name: no spaces, no Chinese punctuation
    if not _is_valid_product_name(name):
        raise ValueError("产品名称不能包含空格和中文符号")

    # Check name uniqueness
    existing = db.query(PmaProduct).filter(
        PmaProduct.name == name, PmaProduct.is_local == True
    ).first()
    if existing:
        raise ValueError(f"已存在同名本地产品: {name}")

    product = PmaProduct(
        name=name,
        code=code,
        status=status,
        type="normal",
        is_local=True,
        description=description,
        tags=description or "",
        reporter_id=reporter_id,
        synced_at=None,  # mark as not synced
    )
    db.add(product)
    db.flush()  # get the auto-generated ID

    # Link to tree node
    node_link = ProductNodeLink(
        product_id=product.id,
        product_node_id=node_id,
    )
    db.add(node_link)

    # Optionally link to projects
    if project_ids:
        for pid in project_ids:
            proj = db.query(CachedProject).filter(CachedProject.id == pid).first()
            if proj:
                existing_link = db.query(ProductProjectLink).filter(
                    ProductProjectLink.product_id == product.id,
                    ProductProjectLink.project_id == pid,
                ).first()
                if not existing_link:
                    db.add(ProductProjectLink(product_id=product.id, project_id=pid))

    db.commit()
    return _product_item(product, db)


def get_local_product(db: Session, product_id: int) -> Optional[dict]:
    """Get a product (any source) as dict for comparison."""
    product = db.query(PmaProduct).filter(PmaProduct.id == product_id).first()
    if not product:
        return None
    return {"id": product.id, "name": product.name, "code": product.code, "status": product.status, "description": product.description or ""}


def update_local_product(db: Session, product_id: int, data: dict) -> dict:
    """Update a PMA-local product."""
    product = db.query(PmaProduct).filter(
        PmaProduct.id == product_id, PmaProduct.is_local == True
    ).first()
    if not product:
        raise ValueError(f"本地产品不存在: {product_id}")

    # Validate name if provided
    if "name" in data and data["name"] is not None:
        if not _is_valid_product_name(data["name"]):
            raise ValueError("产品名称不能包含空格和中文符号")

    for k, v in data.items():
        if hasattr(product, k) and v is not None:
            setattr(product, k, v)
    # Sync description to tags for tag-based display
    if "description" in data and data["description"] is not None:
        product.tags = data["description"]
    db.commit()
    return _product_item(product, db)


def _remove_product_from_favorites(db: Session, product_id: int) -> int:
    """Remove a deleted product ID from all users' favorites JSON. Returns # of users cleaned."""
    import json
    from backend.models.local import LocalUser
    cleaned = 0
    users = db.query(LocalUser).all()
    for u in users:
        try:
            favs = json.loads(u.favorites or '{"products":[],"projects":[]}')
            if isinstance(favs, list):
                favs = {"products": favs, "projects": []}
            if product_id in favs.get("products", []):
                favs["products"].remove(product_id)
                u.favorites = json.dumps(favs)
                cleaned += 1
        except (json.JSONDecodeError, TypeError):
            pass
    return cleaned


def delete_local_product(db: Session, product_id: int) -> dict:
    """Delete a PMA-local product and its related data."""
    from backend.models.document import ProductDocument
    from backend.models.zentao import CustomerProductLink
    product = db.query(PmaProduct).filter(
        PmaProduct.id == product_id, PmaProduct.is_local == True
    ).first()
    if not product:
        raise ValueError(f"本地产品不存在: {product_id}")

    name = product.name or str(product_id)

    # Delete related data
    db.query(CustomerProductLink).filter(CustomerProductLink.product_id == product_id).delete()
    db.query(ProductProjectLink).filter(ProductProjectLink.product_id == product_id).delete()
    db.query(ProductNodeLink).filter(ProductNodeLink.product_id == product_id).delete()
    db.query(ProductDocument).filter(ProductDocument.product_id == product_id).delete()

    # Clean up favorites: remove deleted product ID from all users' favorites
    _remove_product_from_favorites(db, product_id)

    db.delete(product)
    db.commit()
    return {"id": product_id, "name": name}


# ---------------------------------------------------------------------------
# PMA-local Projects
# ---------------------------------------------------------------------------

def create_local_project(
    db: Session,
    name: str,
    code: str,
    project_type: str = "RD",
    status: str = "wait",
    description: str = "",
    product_ids: Optional[list[int]] = None,
    begin: Optional[str] = None,
    end: Optional[str] = None,
    customer_name: Optional[str] = None,
    estimate: Optional[float] = None,
    tags: Optional[str] = None,
    planned_delivery_qty: Optional[int] = None,
    consumed: Optional[float] = None,
    reporter_id: Optional[int] = None,
) -> dict:
    """Create a PMA-local project."""
    if product_ids is None:
        product_ids = []

    # Check code uniqueness
    existing = db.query(CachedProject).filter(CachedProject.code == code).first()
    if existing:
        raise ValueError(f"已存在相同编号的项目: {code}")

    project = CachedProject(
        name=name,
        code=code,
        project_type=project_type,
        status=status,
        model="scrum",
        is_local=True,
        description=description,
        begin=_parse_date(begin) if begin else None,
        end=_parse_date(end) if end else None,
        customer_name=customer_name,
        estimate=estimate or 0,
        tags=tags,
        planned_delivery_qty=planned_delivery_qty,
        consumed=consumed or 0,
        reporter_id=reporter_id,
        synced_at=None,
    )
    db.add(project)
    db.flush()

    # Link customer via customer_project_links
    if customer_name and customer_name.strip():
        from backend.models.zentao import CustomerProjectLink, PmaCustomer
        cust = db.query(PmaCustomer).filter(PmaCustomer.name == customer_name.strip()).first()
        if not cust:
            cust = PmaCustomer(name=customer_name.strip())
            db.add(cust)
            db.flush()
        db.add(CustomerProjectLink(project_id=project.id, customer_id=cust.id))

    # Link to products
    for pid in product_ids:
        prod = db.query(PmaProduct).filter(PmaProduct.id == pid).first()
        if prod:
            existing_link = db.query(ProductProjectLink).filter(
                ProductProjectLink.product_id == pid,
                ProductProjectLink.project_id == project.id,
            ).first()
            if not existing_link:
                db.add(ProductProjectLink(product_id=pid, project_id=project.id))

    db.commit()

    # Initialize project stages from template
    try:
        _init_project_stages(db, project.id, project_type)
    except Exception:
        pass  # non-critical

    # Initialize documents and tasks from templates
    try:
        from backend.services.document_service import _sync_from_templates, _sync_tasks_from_templates
        _sync_from_templates(db, project.id, project_type)
        _sync_tasks_from_templates(db, project.id, project_type)
    except Exception:
        pass  # non-critical: templates will sync on first page view

    return _project_item(project, db)


def update_local_project(db: Session, project_id: int, data: dict) -> dict:
    """Update a PMA-local project."""
    project = db.query(CachedProject).filter(
        CachedProject.id == project_id, CachedProject.is_local == True
    ).first()
    if not project:
        raise ValueError(f"本地项目不存在: {project_id}")

    old_type = project.project_type
    for k, v in data.items():
        if hasattr(project, k) and v is not None:
            setattr(project, k, v)

    # If project_type changed, resync stages/docs/tasks from new type's templates
    new_type = data.get("project_type")
    if new_type and new_type != old_type:
        _resync_on_type_change(db, project_id, new_type)

    db.commit()
    return _project_item(project, db)


# ---------------------------------------------------------------------------
# Product-Project association management (wrapping existing link/unlink)
# ---------------------------------------------------------------------------

def get_product_project_links(db: Session, product_id: int) -> list[dict]:
    """Get all projects linked to a product."""
    links = db.query(ProductProjectLink).filter(
        ProductProjectLink.product_id == product_id
    ).all()
    project_ids = [l.project_id for l in links]
    if not project_ids:
        return []
    projects = db.query(CachedProject).filter(
        CachedProject.id.in_(project_ids)
    ).order_by(CachedProject.name).all()
    return [_project_item(p, db) for p in projects]


def update_product_projects(
    db: Session, product_id: int, project_ids: list[int]
) -> dict:
    """Replace all project associations for a product with the given list."""
    product = db.query(PmaProduct).filter(PmaProduct.id == product_id).first()
    if not product:
        raise ValueError(f"产品不存在: {product_id}")

    # Remove existing links
    db.query(ProductProjectLink).filter(
        ProductProjectLink.product_id == product_id
    ).delete(synchronize_session=False)

    # Add new links
    for pid in project_ids:
        proj = db.query(CachedProject).filter(CachedProject.id == pid).first()
        if proj:
            db.add(ProductProjectLink(product_id=product_id, project_id=pid))

    db.commit()
    return {"product_id": product_id, "project_ids": project_ids}


# ---------------------------------------------------------------------------
# Dict helpers
# ---------------------------------------------------------------------------

def _product_item(p: PmaProduct, db: Session) -> dict:
    """Format a product for list display."""
    # Count linked projects
    project_count = db.query(sqlfunc.count(ProductProjectLink.id)).filter(
        ProductProjectLink.product_id == p.id
    ).scalar() or 0

    # Get linked node(s)
    node_links = db.query(ProductNodeLink).filter(
        ProductNodeLink.product_id == p.id
    ).all()
    node_ids = [l.product_node_id for l in node_links]

    return {
        "id": p.id,
        "code": p.code,
        "name": p.name,
        "status": p.status,
        "type": p.type,
        "program_name": p.program_name,
        "category": p.category,
        "total_stories": p.total_stories,
        "total_bugs": p.total_bugs,
        "releases": p.releases,
        "description": p.description,
        "tags": p.tags,
        "tags_list": [t.strip() for t in (p.tags or "").split(",") if t.strip()],
        "is_local": bool(p.is_local),
        "reporter_id": p.reporter_id,
        "project_count": project_count,
        "node_ids": node_ids,
        "synced_at": to_local_str(p.synced_at) if p.synced_at else None,
    }


def _project_item(p: CachedProject, db: Session) -> dict:
    """Format a project for list display."""
    # Count linked products
    product_count = db.query(sqlfunc.count(ProductProjectLink.id)).filter(
        ProductProjectLink.project_id == p.id
    ).scalar() or 0

    # Get linked product names
    product_links = db.query(ProductProjectLink).filter(
        ProductProjectLink.project_id == p.id
    ).all()
    product_ids = [l.product_id for l in product_links]
    product_names = []
    if product_ids:
        products = db.query(PmaProduct).filter(
            PmaProduct.id.in_(product_ids)
        ).all()
        product_names = [p.name for p in products]

    return {
        "id": p.id,
        "code": p.code,
        "name": p.name,
        "model": p.model,
        "status": p.status,
        "project_type": p.project_type,
        "progress": p.progress,
        "begin": str(p.begin) if p.begin else None,
        "end": str(p.end) if p.end else None,
        "pm_name": p.pm_name,
        "customer_name": p.customer_name,
        "estimate": p.estimate,
        "planned_delivery_qty": p.planned_delivery_qty,
        "consumed": p.consumed,
        "program_name": p.program_name,
        "description": p.description,
        "tags": p.tags,
        "tags_list": [t.strip() for t in (p.tags or "").split(",") if t.strip()],
        "is_local": bool(p.is_local),
        "reporter_id": p.reporter_id,
        "product_count": product_count,
        "product_names": product_names,
        "synced_at": to_local_str(p.synced_at) if p.synced_at else None,
    }


def _resync_on_type_change(db: Session, project_id: int, new_type: str):
    """When project_type changes: reset stages, docs, and template-originated tasks.

    Manual tasks (template_id IS NULL) are preserved.
    """
    from backend.models.project_stage import ProjectStage
    from backend.models.document import ProjectDocument
    from backend.models.task import Task
    from backend.services.document_service import _sync_from_templates, _sync_tasks_from_templates

    # 1. Reset stages
    db.query(ProjectStage).filter(ProjectStage.project_id == project_id).delete()
    _init_project_stages(db, project_id, new_type)

    # 2. Reset documents
    db.query(ProjectDocument).filter(ProjectDocument.project_id == project_id).delete()
    _sync_from_templates(db, project_id, new_type)

    # 3. Remove template-originated tasks (keep manual tasks)
    db.query(Task).filter(
        Task.project_id == project_id, Task.template_id.isnot(None)
    ).delete()
    _sync_tasks_from_templates(db, project_id, new_type)

    db.flush()


def _init_project_stages(db: Session, project_id: int, project_type: str):
    """Create ProjectStage rows for a project based on template stage list.
    Skips if the project already has stages (idempotent)."""
    from backend.models.project_stage import ProjectStage
    from backend.models.zentao import CachedProject
    from datetime import timedelta

    existing = db.query(ProjectStage).filter(ProjectStage.project_id == project_id).count()
    if existing:
        return existing

    from backend.services.document_service import get_stage_types_for_project_type
    standard_stages = get_stage_types_for_project_type(db, project_type)
    if not standard_stages:
        return 0

    project = db.query(CachedProject).filter(CachedProject.id == project_id).first()
    proj_begin = project.begin if project else None
    proj_end = project.end if project else None
    stage_count = len(standard_stages)

    for i, name in enumerate(standard_stages):
        est_start = None
        est_end = None
        if proj_begin and proj_end and stage_count > 0:
            total_days = (proj_end - proj_begin).days
            if total_days > 0:
                seg_days = total_days / stage_count
                est_start = (proj_begin + timedelta(days=round(i * seg_days)))
                est_end = (proj_begin + timedelta(days=round((i + 1) * seg_days) - 1))
                if i == stage_count - 1:
                    est_end = proj_end
        db.add(ProjectStage(
            project_id=project_id,
            name=name,
            sort_order=i,
            status="active",
            start_date=est_start,
            end_date=est_end,
        ))
    db.commit()
    return stage_count


# ── Product Name Validation ──

# Characters forbidden in product names: spaces + Chinese punctuation
_NAME_FORBIDDEN = set(
    " \t　"  # spaces + full-width space
    "，、；：。！？"  # ，、；：。！？
    "（）《》「」『』"  # （）《》「」『』
    "【】〔〕"  # 【】〔〕
)


def _is_valid_product_name(name: str) -> bool:
    """Check that product name contains no spaces or Chinese punctuation."""
    return not any(ch in _NAME_FORBIDDEN for ch in name)


def get_next_version(db: Session, base_code: str) -> str:
    """Compute the next hex version number for a given base code.

    Format: Vn where n increments as hex (1,2,...,9,A,B,...,F,10,...).
    Scans existing products whose code starts with ``base_code-V`` and
    returns the next available version string (e.g. ``V3``).
    """
    prefix = base_code + "-V"
    existing = (
        db.query(PmaProduct.code)
        .filter(PmaProduct.code.like(prefix + "%"))
        .all()
    )
    max_dec = 0
    for (code,) in existing:
        suffix = code[len(prefix):]
        try:
            dec = int(suffix, 16)
            if dec > max_dec:
                max_dec = dec
        except ValueError:
            pass
    next_dec = max_dec + 1
    # Format as uppercase hex without zero-padding
    next_hex = format(next_dec, "X")
    return "V" + next_hex
