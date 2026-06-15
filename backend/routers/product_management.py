from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.middleware.auth import get_current_user, require_admin
from backend.routers.logs import log_audit
from backend.services import product_management_service as pm_service
from backend.services import product_service as prod_service

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
    user=Depends(require_admin),
):
    """Link a product to a tree node."""
    try:
        result = pm_service.link_product_to_node(db, body.product_id, body.node_id)
        log_audit(db, user, "product_node_link",
                  f"product_id={body.product_id}, node_id={body.node_id}",
                  "管理", "medium")
        return {"code": 0, "data": result, "message": "ok"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/link-product-node", response_model=dict)
def unlink_product_from_node(
    product_id: int = Query(...),
    node_id: int = Query(...),
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    """Remove a product-node link."""
    try:
        result = pm_service.unlink_product_from_node(db, product_id, node_id)
        log_audit(db, user, "product_node_unlink",
                  f"product_id={product_id}, node_id={node_id}",
                  "管理", "medium")
        return {"code": 0, "data": result, "message": "ok"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── PMA-local Product CRUD ──

@router.post("/products", response_model=dict)
def create_local_product(
    body: LocalProductCreate,
    db: Session = Depends(get_db),
    user=Depends(require_admin),
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
        log_audit(db, user, "local_product_create",
                  f"name={body.name}, code={body.code}, node_id={body.node_id}",
                  "管理", "medium")
        return {"code": 0, "data": product, "message": "ok"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/products/{product_id}", response_model=dict)
def update_local_product(
    product_id: int,
    body: LocalProductUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    """Update a PMA-local product."""
    try:
        product = pm_service.update_local_product(
            db, product_id, body.model_dump(exclude_none=True)
        )
        log_audit(db, user, "local_product_update",
                  f"product_id={product_id}",
                  "管理", "medium")
        return {"code": 0, "data": product, "message": "ok"}
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
    user=Depends(require_admin),
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
                  "管理", "medium")
        return {"code": 0, "data": project, "message": "ok"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/projects/{project_id}", response_model=dict)
def update_local_project(
    project_id: int,
    body: LocalProjectUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    """Update a PMA-local project."""
    try:
        project = pm_service.update_local_project(
            db, project_id, body.model_dump(exclude_none=True)
        )
        log_audit(db, user, "local_project_update",
                  f"project_id={project_id}",
                  "管理", "medium")
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
    user=Depends(require_admin),
):
    """Replace all project associations for a product."""
    try:
        result = pm_service.update_product_projects(db, product_id, body.project_ids)
        log_audit(db, user, "product_projects_update",
                  f"product_id={product_id}, projects={len(body.project_ids)}",
                  "管理", "medium")
        return {"code": 0, "data": result, "message": "ok"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
