from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.middleware.auth import get_current_user, require_admin
from backend.services import product_service

router = APIRouter(prefix="/api/products", tags=["products"])


class ProductUpdate(BaseModel):
    category: Optional[str] = None
    nas_path: Optional[str] = None
    git_url: Optional[str] = None
    pma_customer: Optional[str] = None
    alias_name: Optional[str] = None


class ProductProjectLinkRequest(BaseModel):
    product_id: int
    project_id: int


@router.get("", response_model=dict)
def list_products(
    search: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    tags: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    items, total = product_service.get_products(db, search, category, tags, page, limit)
    return {"code": 0, "data": {"page": page, "limit": limit, "total": total, "items": items}, "message": "ok"}


@router.get("/overview", response_model=dict)
def mapping_overview(db: Session = Depends(get_db), _=Depends(get_current_user)):
    data = product_service.get_mapping_overview(db)
    return {"code": 0, "data": data, "message": "ok"}


@router.get("/categories", response_model=dict)
def list_categories(db: Session = Depends(get_db), _=Depends(get_current_user)):
    from backend.models.zentao import CachedProduct
    # Collect distinct categories from both PMA-local category and Zentao program_name
    cats = set()
    for row in db.query(CachedProduct.program_name, CachedProduct.category).all():
        for val in row:
            if val:
                cats.add(val)
    return {"code": 0, "data": sorted(list(cats)), "message": "ok"}


@router.get("/{product_id}", response_model=dict)
def get_product(product_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    detail = product_service.get_product(db, product_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Product not found")
    return {"code": 0, "data": detail, "message": "ok"}


@router.put("/{product_id}", response_model=dict)
def update_product(
    product_id: int,
    body: ProductUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    if not data:
        raise HTTPException(status_code=400, detail="No fields to update")
    result = product_service.update_product(db, product_id, data)
    if not result:
        raise HTTPException(status_code=404, detail="Product not found")
    return {"code": 0, "data": result, "message": "ok"}


@router.get("/{product_id}/projects", response_model=dict)
def get_product_projects(product_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    projects = product_service.get_product_projects(db, product_id)
    return {"code": 0, "data": projects, "message": "ok"}


@router.post("/link", response_model=dict)
def link_product_project(
    body: ProductProjectLinkRequest,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    result = product_service.add_product_project_link(db, body.product_id, body.project_id)
    return {"code": 0, "data": result, "message": "ok"}


@router.delete("/link", response_model=dict)
def unlink_product_project(
    product_id: int = Query(...),
    project_id: int = Query(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    result = product_service.remove_product_project_link(db, product_id, project_id)
    return {"code": 0, "data": result, "message": "ok"}
