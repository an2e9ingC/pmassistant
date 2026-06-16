from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db, to_local_str
from backend.middleware.auth import get_current_user, require_admin
from backend.models.local import ProductNote
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


class NoteCreate(BaseModel):
    content: str


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


# ── Product Notes ──

@router.get("/{product_id}/notes", response_model=dict)
def get_product_notes(product_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    notes = (
        db.query(ProductNote)
        .filter(ProductNote.product_id == product_id)
        .order_by(ProductNote.created_at.desc())
        .limit(50)
        .all()
    )
    return {
        "code": 0,
        "data": [
            {
                "id": n.id,
                "content": n.content,
                "recorded_by": n.recorded_by,
                "created_at": to_local_str(n.created_at),
            }
            for n in notes
        ],
        "message": "ok",
    }


@router.post("/{product_id}/notes", response_model=dict)
def add_product_note(
    product_id: int,
    payload: NoteCreate,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    note = ProductNote(
        product_id=product_id,
        content=payload.content,
        recorded_by=user.username,
    )
    db.add(note)
    db.commit()
    db.refresh(note)
    return {
        "code": 0,
        "data": {
            "id": note.id,
            "content": note.content,
            "recorded_by": note.recorded_by,
            "created_at": to_local_str(note.created_at),
        },
        "message": "ok",
    }


@router.delete("/{product_id}/notes/{note_id}", response_model=dict)
def delete_product_note(
    product_id: int,
    note_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    note = db.query(ProductNote).filter(
        ProductNote.id == note_id,
        ProductNote.product_id == product_id,
    ).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    db.delete(note)
    db.commit()
    return {"code": 0, "message": "已删除"}


# ── Product Documents (based on doc templates) ──

@router.get("/{product_id}/documents", response_model=dict)
def get_product_documents(product_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    """Return doc templates for the product's L2 node, with status."""
    from backend.models.document import ProductDocTemplate, ProductLine
    from backend.models.zentao import ProductNodeLink

    # Find which L2 node(s) this product is linked to
    links = db.query(ProductNodeLink).filter(ProductNodeLink.product_id == product_id).all()
    if not links:
        return {"code": 0, "data": [], "message": "ok"}

    # Get templates from all linked L2 nodes
    docs = []
    for link in links:
        node = db.query(ProductLine).filter(ProductLine.id == link.product_node_id).first()
        if not node:
            continue
        templates = db.query(ProductDocTemplate).filter(
            ProductDocTemplate.product_id == link.product_node_id
        ).order_by(ProductDocTemplate.sort_order).all()
        for t in templates:
            docs.append({
                "id": t.id,
                "doc_name": t.doc_name,
                "sort_order": t.sort_order,
                "description": t.description or "",
                "responsible_role": t.responsible_role or "",
                "node_name": node.name,
                "node_id": node.id,
            })

    return {"code": 0, "data": docs, "message": "ok"}
