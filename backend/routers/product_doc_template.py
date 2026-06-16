from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.middleware.auth import get_current_user, require_perm, require_any_perm
from backend.models.document import ProductLine, ProductDocTemplate
from backend.routers.logs import log_audit
from backend.services import document_service

router = APIRouter(prefix="/api/product-doc-templates", tags=["product-doc-templates"])


# ── Pydantic Models ──

class ProductNodeCreate(BaseModel):
    name: str
    parent_id: Optional[int] = None
    sort_order: int = 0


class ProductNodeUpdate(BaseModel):
    name: Optional[str] = None
    parent_id: Optional[int] = None
    sort_order: Optional[int] = None


class TemplateCreate(BaseModel):
    product_id: int
    doc_name: str
    sort_order: int = 0
    doc_path: str
    responsible_role: Optional[str] = None
    description: Optional[str] = None


class TemplateUpdate(BaseModel):
    product_id: Optional[int] = None
    doc_name: Optional[str] = None
    sort_order: Optional[int] = None
    description: Optional[str] = None
    responsible_role: Optional[str] = None
    doc_path: Optional[str] = None


# ── Product Tree (read) ──

@router.get("/product-tree", response_model=dict)
def get_product_tree(
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    tree = document_service.get_product_tree(db)
    return {"code": 0, "data": tree, "message": "ok"}


@router.get("/breadcrumb/{node_id}", response_model=dict)
def get_node_breadcrumb(
    node_id: int,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    path = document_service.get_node_breadcrumb(db, node_id)
    return {"code": 0, "data": path, "message": "ok"}


# ── Product Tree CRUD (write) ──

@router.post("/product-nodes", response_model=dict)
def add_product_node(
    body: ProductNodeCreate,
    db: Session = Depends(get_db),
    user=Depends(require_any_perm("doc_template", "product_link")),
):
    try:
        node = document_service.add_product_node(
            db, body.name, body.parent_id, body.sort_order
        )
        parent_info = ""
        if body.parent_id:
            parent = db.query(ProductLine).filter(ProductLine.id == body.parent_id).first()
            parent_info = f"（上级: {parent.name}）" if parent else ""
        log_audit(db, user, "product_node_add", f"新增产品节点: {body.name}{parent_info}", "产品", "medium")
        return {"code": 0, "data": node, "message": "ok"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/product-nodes/{node_id}", response_model=dict)
def update_product_node(
    node_id: int,
    body: ProductNodeUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_any_perm("doc_template", "product_link")),
):
    try:
        old_node = db.query(ProductLine).filter(ProductLine.id == node_id).first()
        old_name = old_node.name if old_node else "?"
        old_parent_id = old_node.parent_id if old_node else None
        data = body.model_dump(exclude_none=True)
        node = document_service.update_product_node(db, node_id, data)
        # Build human-readable change description
        changes = []
        if "name" in data:
            changes.append(f"名称 {old_name} → {data['name']}")
        if "parent_id" in data:
            new_parent = db.query(ProductLine).filter(ProductLine.id == data["parent_id"]).first()
            changes.append(f"移动到 {new_parent.name}" if new_parent else "移到根节点")
        if "sort_order" in data:
            changes.append(f"排序→{data['sort_order']}")
        detail = "; ".join(changes) if changes else f"节点: {node.get('name', '?')}"
        log_audit(db, user, "product_node_update", detail, "产品", "medium")
        return {"code": 0, "data": node, "message": "ok"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/product-nodes/{node_id}", response_model=dict)
def delete_product_node(
    node_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_any_perm("doc_template", "product_link")),
):
    try:
        node_info = db.query(ProductLine).filter(ProductLine.id == node_id).first()
        node_name = node_info.name if node_info else f"id={node_id}"
        result = document_service.delete_product_node(db, node_id)
        detail = f"删除产品节点: {node_name}"
        if result['node_count'] > 1:
            detail += f"（含子节点共{result['node_count']}个）"
        if result['template_count'] > 0:
            detail += f"，关联模板{result['template_count']}个"
        log_audit(db, user, "product_node_del", detail, "产品", "high")
        return {"code": 0, "data": result, "message": "ok"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── Template CRUD (write) ──

@router.post("", response_model=dict)
def create_template(
    body: TemplateCreate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("doc_template")),
):
    tpl = document_service.create_product_template(db, body.model_dump())
    product_name = db.query(ProductLine).filter(ProductLine.id == body.product_id).first()
    detail = f"新增模板: {body.doc_name}"
    if product_name:
        detail += f" → {product_name.name}"
    log_audit(db, user, "product_doc_template_add", detail, "产品", "medium")
    return {"code": 0, "data": tpl, "message": "ok"}


@router.get("/templates/{product_id}", response_model=dict)
def list_templates(
    product_id: int,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    templates = document_service.get_templates_for_product(db, product_id)
    return {"code": 0, "data": templates, "message": "ok"}


@router.put("/{template_id}", response_model=dict)
def update_template(
    template_id: int,
    body: TemplateUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("doc_template")),
):
    old_tpl = db.query(ProductDocTemplate).filter(ProductDocTemplate.id == template_id).first()
    old_doc_name = old_tpl.doc_name if old_tpl else "?"
    tpl = document_service.update_product_template(
        db, template_id, body.model_dump(exclude_none=True)
    )
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found")
    new_name = tpl.get("doc_name", old_doc_name)
    detail = f"编辑模板: {new_name}"
    if old_doc_name != new_name:
        detail = f"编辑模板: {old_doc_name} → {new_name}"
    log_audit(db, user, "product_doc_template_edit", detail, "产品", "medium")
    return {"code": 0, "data": tpl, "message": "ok"}


@router.delete("/{template_id}", response_model=dict)
def delete_template(
    template_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_perm("doc_template")),
):
    old_tpl = db.query(ProductDocTemplate).filter(ProductDocTemplate.id == template_id).first()
    tpl_name = old_tpl.doc_name if old_tpl else f"id={template_id}"
    ok = document_service.delete_product_template(db, template_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Template not found")
    log_audit(db, user, "product_doc_template_del", f"删除模板: {tpl_name}", "产品", "high")
    return {"code": 0, "data": None, "message": "ok"}


# ── Import Templates from Another Node ──

class ImportTemplatesRequest(BaseModel):
    source_node_id: int


@router.post("/import/{target_node_id}", response_model=dict)
def import_templates(
    target_node_id: int,
    body: ImportTemplatesRequest,
    db: Session = Depends(get_db),
    user=Depends(require_any_perm("doc_template", "product_link")),
):
    """Import all document templates from another node to the target node.
    Existing templates on the target are fully replaced (cover mode)."""
    if target_node_id == body.source_node_id:
        raise HTTPException(status_code=400, detail="源节点和目标节点不能相同")

    # Verify both nodes exist
    src = db.query(ProductLine).filter(ProductLine.id == body.source_node_id).first()
    tgt = db.query(ProductLine).filter(ProductLine.id == target_node_id).first()
    if not src:
        raise HTTPException(status_code=404, detail=f"源节点 {body.source_node_id} 不存在")
    if not tgt:
        raise HTTPException(status_code=404, detail=f"目标节点 {target_node_id} 不存在")

    # Get source templates
    src_templates = db.query(ProductDocTemplate).filter(
        ProductDocTemplate.product_id == body.source_node_id
    ).order_by(ProductDocTemplate.sort_order).all()

    if not src_templates:
        return {"code": 0, "data": {"imported": 0, "removed": 0}, "message": "源节点没有模板可导入"}

    # Delete all existing templates on target
    removed = db.query(ProductDocTemplate).filter(
        ProductDocTemplate.product_id == target_node_id
    ).delete()

    # Import all source templates to target
    imported = 0
    for tpl in src_templates:
        new_tpl = ProductDocTemplate(
            product_id=target_node_id,
            doc_name=tpl.doc_name,
            sort_order=tpl.sort_order,
            description=tpl.description,
            responsible_role=tpl.responsible_role,
            doc_path=tpl.doc_path,
        )
        db.add(new_tpl)
        imported += 1

    db.commit()

    detail = f"从「{src.name}」导入 {imported} 个模板覆盖到「{tgt.name}」"
    if removed > 0:
        detail += f"（清除原有 {removed} 个）"
    log_audit(db, user, "product_doc_template_import", detail, "产品", "medium")

    return {
        "code": 0,
        "data": {"imported": imported, "removed": removed},
        "message": f"从「{src.name}」导入 {imported} 个模板" + (f"，清除了原有 {removed} 个模板" if removed > 0 else ""),
    }
