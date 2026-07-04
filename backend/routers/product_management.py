from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.middleware.auth import get_current_user, require_perm
from backend.routers.logs import log_audit
from backend.services import product_management_service as pm_service
from backend.services import product_service as prod_service
from backend.services.product_service import log_product_activity

router = APIRouter(prefix="/api/product-management", tags=["product-management"])


# ── Pydantic Models ──

class LocalProductCreate(BaseModel):
    name: str
    code: str
    node_id: int
    status: str = "normal"
    description: Optional[str] = None
    project_ids: Optional[List[int]] = None


class LocalProductUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    status: Optional[str] = None
    description: Optional[str] = None


class LocalProjectCreate(BaseModel):
    name: str
    code: str
    project_type: str = "RD"
    status: str = "wait"
    description: Optional[str] = None
    product_ids: List[int]  # required: at least 1 product


class LocalProjectUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    project_type: Optional[str] = None
    status: Optional[str] = None
    description: Optional[str] = None


class ProductNodeLinkRequest(BaseModel):
    product_id: int
    node_id: int


class ProductProjectsUpdate(BaseModel):
    project_ids: List[int]


# ── Tree ──

@router.get("/tree", response_model=dict)
def get_tree(
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """Return product hierarchy tree enriched with product/project counts."""
    tree = pm_service.get_product_management_tree(db)
    return {"code": 0, "data": tree, "message": "ok"}


# ── Node Content ──

@router.get("/products/{product_id}/node", response_model=dict)
def get_product_node(product_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    """Return the tree node ID that this product is linked to."""
    from backend.models.zentao import ProductNodeLink
    link = db.query(ProductNodeLink).filter(ProductNodeLink.product_id == product_id).first()
    return {"code": 0, "data": {"node_id": link.product_node_id if link else None}, "message": "ok"}


@router.get("/nodes/{node_id}/products", response_model=dict)
def get_node_products(
    node_id: int,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """Return all products linked to a tree node."""
    products = pm_service.get_node_products(db, node_id)
    return {"code": 0, "data": products, "message": "ok"}


@router.get("/nodes/{node_id}/projects", response_model=dict)
def get_node_projects(
    node_id: int,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """Return all projects linked to products under a tree node."""
    projects = pm_service.get_node_projects(db, node_id)
    return {"code": 0, "data": projects, "message": "ok"}


# ── Product-Node Linking ──

@router.post("/link-product-node", response_model=dict)
def link_product_to_node(
    body: ProductNodeLinkRequest,
    db: Session = Depends(get_db),
    user=Depends(require_perm("product_link")),
):
    """Link a product to a tree node."""
    try:
        result = pm_service.link_product_to_node(db, body.product_id, body.node_id)
        from backend.models.document import ProductLine
        from backend.models.zentao import PmaProduct
        prod = db.query(PmaProduct).filter(PmaProduct.id == body.product_id).first()
        node = db.query(ProductLine).filter(ProductLine.id == body.node_id).first()
        log_audit(db, user, "product_node_link",
                  f"关联产品「{prod.name if prod else body.product_id}」到节点「{node.name if node else body.node_id}」",
                  "产品", "medium")
        log_product_activity(db, body.product_id, user.username, "关联节点", f"node:{node.name if node else body.node_id}")
        return {"code": 0, "data": result, "message": "ok"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/link-product-node", response_model=dict)
def unlink_product_from_node(
    product_id: int = Query(...),
    node_id: int = Query(...),
    db: Session = Depends(get_db),
    user=Depends(require_perm("product_link")),
):
    """Remove a product-node link."""
    try:
        result = pm_service.unlink_product_from_node(db, product_id, node_id)
        from backend.models.document import ProductLine
        from backend.models.zentao import PmaProduct
        prod = db.query(PmaProduct).filter(PmaProduct.id == product_id).first()
        node = db.query(ProductLine).filter(ProductLine.id == node_id).first()
        log_audit(db, user, "product_node_unlink",
                  f"取消关联「{prod.name if prod else product_id}」从节点「{node.name if node else node_id}」",
                  "产品", "medium")
        log_product_activity(db, product_id, user.username, "取消关联节点", f"node:{node.name if node else node_id}")
        return {"code": 0, "data": result, "message": "ok"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── PMA-local Product CRUD ──

@router.post("/products", response_model=dict)
def create_local_product(
    body: LocalProductCreate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("product_link")),
):
    """Create a PMA-local product and optionally link to projects."""
    try:
        product = pm_service.create_local_product(
            db,
            name=body.name,
            code=body.code,
            node_id=body.node_id,
            status=body.status,
            description=body.description or "",
            project_ids=body.project_ids,
        )
        from backend.models.document import ProductLine
        node = db.query(ProductLine).filter(ProductLine.id == body.node_id).first()
        log_audit(db, user, "local_product_create",
                  f"创建PMA本地产品「{body.name}」（编号: {body.code}, 节点: {node.name if node else body.node_id}）",
                  "产品", "medium")
        log_product_activity(db, product["id"], user.username, "创建产品", f"name:{body.name} code:{body.code}")
        return {"code": 0, "data": product, "message": "ok"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/products/{product_id}", response_model=dict)
def update_local_product(
    product_id: int,
    body: LocalProductUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("product_link")),
):
    """Update a PMA-local product."""
    try:
        old = pm_service.get_local_product(db, product_id)
        product = pm_service.update_local_product(
            db, product_id, body.model_dump(exclude_none=True)
        )
        changes = []
        if body.name and old and old.get("name") != body.name:
            changes.append(f"name:'{old['name']}'->'{body.name}'")
        if body.code and old and old.get("code") != body.code:
            changes.append(f"code:'{old['code']}'->'{body.code}'")
        if body.status and old and old.get("status") != body.status:
            changes.append(f"status:'{old['status']}'->'{body.status}'")
        if body.description is not None and old and old.get("description") != body.description:
            changes.append(f"description:'{old.get('description','')}'->'{body.description}'")
        detail = "; ".join(changes) if changes else "无变更"
        log_audit(db, user, "local_product_update", detail, "产品", "medium")
        log_product_activity(db, product_id, user.username, "编辑产品", detail)
        return {"code": 0, "data": product, "message": "ok"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/products/{product_id}", response_model=dict)
def delete_local_product(
    product_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_perm("product_link")),
):
    """Delete a PMA-local product and its related links."""
    try:
        result = pm_service.delete_local_product(db, product_id)
        log_audit(db, user, "local_product_delete",
                  f"删除产品「{result.get('name', '?')}」（ID: {product_id}）",
                  "产品", "high")
        log_product_activity(db, product_id, user.username, "删除产品", result.get('name', '?'))
        return {"code": 0, "data": result, "message": "ok"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── All Products (for search/selection) ──

@router.get("/all-products", response_model=dict)
def get_all_products(
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """Return all products (both Zentao-synced and PMA-local) for selection dropdowns."""
    products = prod_service.get_products(db, search=None, category=None, tags=None, page=1, limit=500)
    items = products[0]  # (items, total)
    return {"code": 0, "data": items, "message": "ok"}


# ── PMA-local Project CRUD ──

@router.post("/projects", response_model=dict)
def create_local_project(
    body: LocalProjectCreate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("product_link")),
):
    """Create a PMA-local project (must link at least 1 product)."""
    try:
        project = pm_service.create_local_project(
            db,
            name=body.name,
            code=body.code,
            project_type=body.project_type,
            status=body.status,
            description=body.description or "",
            product_ids=body.product_ids,
        )
        log_audit(db, user, "local_project_create",
                  f"name={body.name}, code={body.code}, products={len(body.product_ids)}",
                  "项目", "medium")
        return {"code": 0, "data": project, "message": "ok"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/projects/{project_id}", response_model=dict)
def update_local_project(
    project_id: int,
    body: LocalProjectUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("product_link")),
):
    """Update a PMA-local project."""
    try:
        project = pm_service.update_local_project(
            db, project_id, body.model_dump(exclude_none=True)
        )
        log_audit(db, user, "local_project_update",
                  f"project_id={project_id}",
                  "项目", "medium")
        return {"code": 0, "data": project, "message": "ok"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── All Projects (for search/selection) ──

@router.get("/all-projects", response_model=dict)
def get_all_projects(
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """Return all projects for selection dropdowns."""
    from backend.services import project_service
    projects = project_service.get_projects(db)
    return {"code": 0, "data": projects, "message": "ok"}


# ── Product-Project Association Management ──

@router.get("/products/{product_id}/projects", response_model=dict)
def get_product_projects(
    product_id: int,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """Get all projects linked to a product."""
    projects = pm_service.get_product_project_links(db, product_id)
    return {"code": 0, "data": projects, "message": "ok"}


@router.put("/products/{product_id}/projects", response_model=dict)
def update_product_projects(
    product_id: int,
    body: ProductProjectsUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("product_link")),
):
    """Replace all project associations for a product."""
    try:
        from backend.models.zentao import PmaProduct, CachedProject
        prod = db.query(PmaProduct).filter(PmaProduct.id == product_id).first()
        # Get old linked project IDs for change tracking
        from backend.models.local import ProductProjectLink as _PPL
        old_links = db.query(_PPL).filter(_PPL.product_id == product_id).all()
        old_ids = sorted([l.project_id for l in old_links])
        result = pm_service.update_product_projects(db, product_id, body.project_ids)
        new_ids = sorted(body.project_ids)
        old_str = str(old_ids) if old_ids else "无"
        new_str = str(new_ids) if new_ids else "无"
        if old_str != new_str:
            log_product_activity(db, product_id, user.username, "更新关联项目", f"project_ids:'{old_str}'->'{new_str}'")
        proj_names = []
        if body.project_ids:
            projs = db.query(CachedProject).filter(CachedProject.id.in_(body.project_ids)).all()
            proj_names = [p.name for p in projs]
        log_audit(db, user, "product_projects_update",
                  f"更新产品「{prod.name if prod else product_id}」关联项目: {', '.join(proj_names) if proj_names else '清空'}（共{len(body.project_ids)}个）",
                  "产品", "medium")
        return {"code": 0, "data": result, "message": "ok"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
