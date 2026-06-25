import os as _os

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db, to_local_str, _db_path
from backend.middleware.auth import get_current_user, require_admin, require_perm
from backend.models.local import ProductNote, ProductBlockDiagram
from backend.services import product_service
from backend.services.product_service import log_product_activity

router = APIRouter(prefix="/api/products", tags=["products"])


class ProductUpdate(BaseModel):
    category: Optional[str] = None
    nas_path: Optional[str] = None
    git_url: Optional[str] = None
    pma_customer: Optional[str] = None
    alias_name: Optional[str] = None
    name: Optional[str] = None
    code: Optional[str] = None
    status: Optional[str] = None
    description: Optional[str] = None
    tags: Optional[str] = None


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
    user=Depends(require_admin),
):
    from backend.models.zentao import CachedProduct as _CP
    old_prod = db.query(_CP).filter(_CP.id == product_id).first()
    if not old_prod:
        raise HTTPException(status_code=404, detail="Product not found")
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    if not data:
        raise HTTPException(status_code=400, detail="No fields to update")
    changes = []
    for k, v in data.items():
        old_val = getattr(old_prod, k, None)
        if str(old_val) != str(v):
            changes.append(f"{k}:'{old_val}'->'{v}'")
    result = product_service.update_product(db, product_id, data)
    if not result:
        raise HTTPException(status_code=404, detail="Product not found")
    log_product_activity(db, product_id, user.username, "编辑产品", "; ".join(changes) if changes else "无变更")
    return {"code": 0, "data": result, "message": "ok"}


@router.get("/{product_id}/projects", response_model=dict)
def get_product_projects(product_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    projects = product_service.get_product_projects(db, product_id)
    return {"code": 0, "data": projects, "message": "ok"}


@router.post("/link", response_model=dict)
def link_product_project(
    body: ProductProjectLinkRequest,
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    result = product_service.add_product_project_link(db, body.product_id, body.project_id)
    log_product_activity(db, body.product_id, user.username, "关联项目", f"project_id:{body.project_id}")
    return {"code": 0, "data": result, "message": "ok"}


@router.delete("/link", response_model=dict)
def unlink_product_project(
    product_id: int = Query(...),
    project_id: int = Query(...),
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    result = product_service.remove_product_project_link(db, product_id, project_id)
    log_product_activity(db, product_id, user.username, "取消关联项目", f"project_id:{project_id}")
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
    log_product_activity(db, product_id, user.username, "添加笔记", f"content:{payload.content[:100]}")
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
    user=Depends(require_admin),
):
    note = db.query(ProductNote).filter(
        ProductNote.id == note_id,
        ProductNote.product_id == product_id,
    ).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    db.delete(note)
    db.commit()
    log_product_activity(db, product_id, user.username, "删除笔记", f"note_id:{note_id}")
    return {"code": 0, "message": "已删除"}


# ── Product Documents (based on doc templates) ──

@router.get("/{product_id}/documents", response_model=dict)
def get_product_documents(product_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    """Return product document instances (synced from templates) with status and actual paths."""
    from backend.services.document_service import get_or_init_product_documents
    docs = get_or_init_product_documents(db, product_id)
    return {"code": 0, "data": docs, "message": "ok"}


class DocUpdate(BaseModel):
    status: Optional[str] = None  # "pending" | "submitted"
    location: Optional[str] = None
    doc_type: Optional[str] = None  # gitlab/svn/nas/solidworks/pma
    uploaded_by: Optional[str] = None
    uploaded_at: Optional[str] = None


@router.put("/{product_id}/documents/{doc_id}", response_model=dict)
def update_product_document(
    product_id: int,
    doc_id: int,
    body: DocUpdate,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Update a product document's status/location."""
    from backend.models.document import ProductDocument
    from datetime import datetime as _dt

    doc = db.query(ProductDocument).filter(
        ProductDocument.id == doc_id,
        ProductDocument.product_id == product_id,
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    doc_changes = []
    if body.status is not None:
        old_status = doc.status
        if old_status != body.status:
            doc_changes.append(f"status:'{old_status}'->'{body.status}'")
        doc.status = body.status
        if body.status == "submitted" and not doc.completed_at:
            doc.completed_at = _dt.now()
        elif body.status == "pending":
            doc.completed_at = None
    if body.location is not None:
        old_loc = doc.location or ""
        if old_loc != body.location:
            doc_changes.append(f"location:'{old_loc}'->'{body.location}'")
        doc.location = body.location
    if body.doc_type is not None:
        doc.doc_type = body.doc_type
    if body.uploaded_by is not None:
        old_ub = doc.uploaded_by or ""
        if old_ub != body.uploaded_by:
            doc_changes.append(f"uploaded_by:'{old_ub}'->'{body.uploaded_by}'")
        doc.uploaded_by = body.uploaded_by
    if body.uploaded_at is not None:
        try:
            doc.uploaded_at = _dt.fromisoformat(body.uploaded_at)
        except ValueError:
            pass
    doc.updated_by = user.username
    db.commit()
    detail = "; ".join(doc_changes) if doc_changes else "无变更"
    log_product_activity(db, product_id, user.username, "更新文档", f"doc_name:'{doc.doc_name}'; {detail}")
    return {"code": 0, "data": {"id": doc.id, "status": doc.status}, "message": "ok"}


# ── Product Block Diagrams ──

_UPLOAD_DIR = _os.path.join(_os.path.dirname(_db_path), "uploads", "block_diagrams")


def _ensure_upload_dir():
    _os.makedirs(_UPLOAD_DIR, exist_ok=True)


@router.get("/{product_id}/block-diagrams", response_model=dict)
def list_block_diagrams(product_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    """List all block diagram images for a product."""
    items = (
        db.query(ProductBlockDiagram)
        .filter(ProductBlockDiagram.product_id == product_id)
        .order_by(ProductBlockDiagram.created_at.desc())
        .all()
    )
    return {
        "code": 0,
        "data": [
            {
                "id": bd.id,
                "product_id": bd.product_id,
                "filename": bd.filename,
                "uploaded_by": bd.uploaded_by,
                "created_at": to_local_str(bd.created_at),
            }
            for bd in items
        ],
        "message": "ok",
    }


@router.post("/{product_id}/block-diagrams", response_model=dict)
def upload_block_diagram(
    product_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user=Depends(require_perm("product_link")),
):
    """Upload a block diagram image for a product."""
    _ensure_upload_dir()

    # Validate file type
    content_type = file.content_type or ""
    if not content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="只支持图片文件")

    # Validate extension
    ext = _os.path.splitext(file.filename or "")[1].lower()
    allowed = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"}
    if ext not in allowed:
        raise HTTPException(status_code=400, detail=f"不支持的图片格式: {ext}")

    # Generate unique filename to avoid collisions
    import uuid
    unique_name = f"{uuid.uuid4().hex}{ext}"
    save_path = _os.path.join(_UPLOAD_DIR, unique_name)

    # Write file
    content = file.file.read()
    with open(save_path, "wb") as f:
        f.write(content)

    # Create DB record
    bd = ProductBlockDiagram(
        product_id=product_id,
        filename=file.filename or unique_name,
        file_path=unique_name,
        uploaded_by=user.username,
    )
    db.add(bd)
    db.commit()
    db.refresh(bd)
    log_product_activity(db, product_id, user.username, "上传框图", f"filename:{bd.filename}")

    return {
        "code": 0,
        "data": {
            "id": bd.id,
            "product_id": bd.product_id,
            "filename": bd.filename,
            "uploaded_by": bd.uploaded_by,
            "created_at": to_local_str(bd.created_at),
        },
        "message": "上传成功",
    }


@router.delete("/{product_id}/block-diagrams/{bd_id}", response_model=dict)
def delete_block_diagram(
    product_id: int,
    bd_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_perm("product_link")),
):
    """Delete a block diagram image."""
    bd = db.query(ProductBlockDiagram).filter(
        ProductBlockDiagram.id == bd_id,
        ProductBlockDiagram.product_id == product_id,
    ).first()
    if not bd:
        raise HTTPException(status_code=404, detail="Block diagram not found")

    # Delete the file from disk
    file_path = _os.path.join(_UPLOAD_DIR, bd.file_path)
    if _os.path.exists(file_path):
        _os.remove(file_path)

    db.delete(bd)
    db.commit()
    log_product_activity(db, product_id, user.username, "删除框图", f"filename:{bd.filename}")
    return {"code": 0, "message": "已删除"}


@router.get("/block-diagrams/{bd_id}/image", response_model=None)
def serve_block_diagram_image(bd_id: int, db: Session = Depends(get_db)):
    """Serve the block diagram image file."""
    bd = db.query(ProductBlockDiagram).filter(ProductBlockDiagram.id == bd_id).first()
    if not bd:
        raise HTTPException(status_code=404, detail="Block diagram not found")

    file_path = _os.path.join(_UPLOAD_DIR, bd.file_path)
    if not _os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Image file not found")

    # Determine media type
    ext = _os.path.splitext(bd.file_path)[1].lower()
    media_types = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".bmp": "image/bmp",
        ".svg": "image/svg+xml",
    }
    media_type = media_types.get(ext, "application/octet-stream")

    return FileResponse(file_path, media_type=media_type, filename=bd.filename)


# ── Product Activities ──

@router.get("/{product_id}/activities", response_model=dict)
def get_product_activities(
    product_id: int,
    sort: str = Query("desc"),
    limit: int = Query(200, ge=1, le=500),
    username: str = Query("", description="Filter by username"),
    action: str = Query("", description="Filter by action type"),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """Return activity log for a product (non-deletable audit trail)."""
    from backend.models.local import ProductActivity

    order = ProductActivity.id.desc() if sort == "desc" else ProductActivity.id.asc()
    q = (
        db.query(ProductActivity)
        .filter(ProductActivity.product_id == product_id)
    )
    if username:
        q = q.filter(ProductActivity.username == username)
    if action:
        q = q.filter(ProductActivity.action == action)
    rows = q.order_by(order).limit(limit).all()

    # Distinct filter options
    usernames = sorted(set(
        r[0] for r in db.query(ProductActivity.username).filter(
            ProductActivity.product_id == product_id
        ).distinct().all() if r[0]
    ))
    actions = sorted(set(
        r[0] for r in db.query(ProductActivity.action).filter(
            ProductActivity.product_id == product_id
        ).distinct().all() if r[0]
    ))

    return {
        "code": 0,
        "data": {
            "items": [
                {
                    "id": r.id,
                    "username": r.username,
                    "action": r.action,
                    "detail": r.detail or "",
                    "created_at": to_local_str(r.created_at),
                }
                for r in rows
            ],
            "options": {"usernames": usernames, "actions": actions},
        },
        "message": "ok",
    }
