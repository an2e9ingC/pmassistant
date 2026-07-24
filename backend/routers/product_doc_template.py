from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.middleware.auth import get_current_user, require_perm, require_any_perm
from backend.models.document import ProductLine, ProductDocTemplate
from backend.audit_categories import AUDIT_CAT_TEMPLATE
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
    doc_path: str = ""  # legacy, auto-computed from base_path + file_pattern
    stage_type: str = "通用"
    doc_type: Optional[str] = None
    responsible_role: Optional[str] = None
    description: Optional[str] = None
    base_path: Optional[str] = None  # 路径模板, * = 产品代号
    file_pattern: Optional[str] = None  # 文件名模板, * = 产品代号
    is_optional: int = 0  # 0=必选 1=可选


class TemplateUpdate(BaseModel):
    product_id: Optional[int] = None
    doc_name: Optional[str] = None
    sort_order: Optional[int] = None
    stage_type: Optional[str] = None
    description: Optional[str] = None
    responsible_role: Optional[str] = None
    doc_path: Optional[str] = None  # legacy
    doc_type: Optional[str] = None
    base_path: Optional[str] = None
    file_pattern: Optional[str] = None
    is_optional: Optional[int] = None


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
        log_audit(db, user, "product_node_add", f"新增产品节点: {body.name}{parent_info}", AUDIT_CAT_TEMPLATE, "medium")
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
        log_audit(db, user, "product_node_update", detail, AUDIT_CAT_TEMPLATE, "medium")
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
        log_audit(db, user, "product_node_del", detail, AUDIT_CAT_TEMPLATE, "high")
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
    log_audit(db, user, "product_doc_template_add", detail, AUDIT_CAT_TEMPLATE, "medium")
    return {"code": 0, "data": tpl, "message": "ok"}


@router.get("/templates/{node_id}", response_model=dict)
def list_templates(
    node_id: int,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    templates = document_service.get_templates_for_product(db, node_id)
    return {"code": 0, "data": templates, "message": "ok"}


@router.put("/{template_id}", response_model=dict)
def update_template(
    template_id: int,
    body: TemplateUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("doc_template")),
):
    old_tpl = db.query(ProductDocTemplate).filter(ProductDocTemplate.id == template_id).first()
    if not old_tpl:
        raise HTTPException(status_code=404, detail="Template not found")
    tpl = document_service.update_product_template(
        db, template_id, body.model_dump(exclude_none=True)
    )
    # Build detailed audit log with all changed fields
    changes = []
    field_labels = {
        "doc_name": "名称", "base_path": "路径", "file_pattern": "文档名",
        "stage_type": "阶段", "doc_type": "类型", "responsible_role": "责任人",
        "sort_order": "序号", "description": "说明", "is_optional": "可选",
    }
    for fk, fl in field_labels.items():
        ov = getattr(old_tpl, fk, None) or ""
        nv = tpl.get(fk, ov) or ""
        if str(ov) != str(nv):
            changes.append(f"{fl}: {ov} → {nv}")
    detail = f"编辑模板: {old_tpl.doc_name}" + ("\n" + "\n".join(changes) if changes else "（无变更）")
    log_audit(db, user, "product_doc_template_edit", detail, AUDIT_CAT_TEMPLATE, "medium")
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
    log_audit(db, user, "product_doc_template_del", f"删除模板: {tpl_name}", AUDIT_CAT_TEMPLATE, "high")
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
            stage_type=tpl.stage_type or "通用",
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
    log_audit(db, user, "product_doc_template_import", detail, AUDIT_CAT_TEMPLATE, "medium")

    return {
        "code": 0,
        "data": {"imported": imported, "removed": removed},
        "message": f"从「{src.name}」导入 {imported} 个模板" + (f"，清除了原有 {removed} 个模板" if removed > 0 else ""),
    }


# ── Product Naming Convention Options ──

class NamingOptionCreate(BaseModel):
    field_key: str
    code: str
    description: str
    sort_order: int = 0


class NamingOptionUpdate(BaseModel):
    code: Optional[str] = None
    description: Optional[str] = None
    sort_order: Optional[int] = None


@router.get("/naming-options", response_model=dict)
def get_naming_options(db: Session = Depends(get_db), _=Depends(require_perm("doc_template"))):
    """Return all naming convention options grouped by field_key."""
    from backend.models.document import ProductNamingOption
    opts = db.query(ProductNamingOption).order_by(ProductNamingOption.field_key, ProductNamingOption.sort_order).all()
    grouped = {}
    for o in opts:
        if o.field_key not in grouped:
            grouped[o.field_key] = []
        grouped[o.field_key].append({"id": o.id, "code": o.code, "description": o.description, "sort_order": o.sort_order})
    return {"code": 0, "data": grouped, "message": "ok"}


@router.post("/naming-options", response_model=dict)
def create_naming_option(body: NamingOptionCreate, db: Session = Depends(get_db), user=Depends(require_perm("doc_template"))):
    from backend.models.document import ProductNamingOption
    # Validate code: single char 0-9 or A-Z
    code = body.code.strip().upper()
    if len(code) != 1 or not (code.isdigit() or ('A' <= code <= 'Z')):
        raise HTTPException(status_code=400, detail="编号必须是单个字符（0-9 或 A-Z）")
    # Check duplicate
    existing = db.query(ProductNamingOption).filter(
        ProductNamingOption.field_key == body.field_key,
        ProductNamingOption.code == code
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"编号 {code} 已被使用")
    opt = ProductNamingOption(field_key=body.field_key, code=code, description=body.description, sort_order=body.sort_order)
    db.add(opt); db.commit()
    log_audit(db, user, "naming_option_add", f"新增命名选项: {body.field_key}.{code}={body.description}", AUDIT_CAT_TEMPLATE, "medium")
    return {"code": 0, "data": {"id": opt.id}, "message": "ok"}


@router.put("/naming-options/{option_id}", response_model=dict)
def update_naming_option(option_id: int, body: NamingOptionUpdate, db: Session = Depends(get_db), user=Depends(require_perm("doc_template"))):
    from backend.models.document import ProductNamingOption
    opt = db.query(ProductNamingOption).filter(ProductNamingOption.id == option_id).first()
    if not opt: raise HTTPException(status_code=404, detail="Option not found")
    if body.code is not None:
        code = body.code.strip().upper()
        if len(code) != 1 or not (code.isdigit() or ('A' <= code <= 'Z')):
            raise HTTPException(status_code=400, detail="编号必须是单个字符（0-9 或 A-Z）")
        # Check duplicate (exclude self)
        dup = db.query(ProductNamingOption).filter(
            ProductNamingOption.field_key == opt.field_key,
            ProductNamingOption.code == code,
            ProductNamingOption.id != option_id
        ).first()
        if dup: raise HTTPException(status_code=400, detail=f"编号 {code} 已被使用")
        opt.code = code
    if body.description is not None: opt.description = body.description
    if body.sort_order is not None: opt.sort_order = body.sort_order
    db.commit()
    log_audit(db, user, "naming_option_edit", f"编辑命名选项: {opt.field_key}.{opt.code}={opt.description}", AUDIT_CAT_TEMPLATE, "medium")
    return {"code": 0, "data": {"id": opt.id}, "message": "ok"}


@router.delete("/naming-options/{option_id}", response_model=dict)
def delete_naming_option(option_id: int, db: Session = Depends(get_db), user=Depends(require_perm("doc_template"))):
    from backend.models.document import ProductNamingOption
    opt = db.query(ProductNamingOption).filter(ProductNamingOption.id == option_id).first()
    if not opt: raise HTTPException(status_code=404, detail="Option not found")
    info = f"{opt.field_key}.{opt.code}={opt.description}"
    db.delete(opt); db.commit()
    log_audit(db, user, "naming_option_delete", f"删除命名选项: {info}", AUDIT_CAT_TEMPLATE, "medium")
    return {"code": 0, "message": "ok"}


# ── Bug Templates ──

class BugTemplateCreate(BaseModel):
    name: str
    content: str = ""
    sort_order: int = 0


class BugTemplateUpdate(BaseModel):
    name: Optional[str] = None
    content: Optional[str] = None
    sort_order: Optional[int] = None
    is_default: Optional[int] = None


@router.get("/bug-templates", response_model=dict)
def get_bug_templates(db: Session = Depends(get_db), _=Depends(get_current_user)):
    from backend.models.document import BugTemplate
    tpls = db.query(BugTemplate).order_by(BugTemplate.sort_order).all()
    return {"code": 0, "data": [{"id": t.id, "name": t.name, "content": t.content, "sort_order": t.sort_order, "is_default": t.is_default or 0} for t in tpls], "message": "ok"}


@router.post("/bug-templates", response_model=dict)
def create_bug_template(body: BugTemplateCreate, db: Session = Depends(get_db), user=Depends(require_perm("doc_template"))):
    from backend.models.document import BugTemplate
    t = BugTemplate(name=body.name, content=body.content, sort_order=body.sort_order)
    db.add(t); db.commit()
    log_audit(db, user, "bug_template_add", f"新增Bug模板: {body.name}", AUDIT_CAT_TEMPLATE, "medium")
    return {"code": 0, "data": {"id": t.id}, "message": "ok"}


@router.put("/bug-templates/{tid}", response_model=dict)
def update_bug_template(tid: int, body: BugTemplateUpdate, db: Session = Depends(get_db), user=Depends(require_perm("doc_template"))):
    from backend.models.document import BugTemplate
    t = db.query(BugTemplate).filter(BugTemplate.id == tid).first()
    if not t: raise HTTPException(status_code=404, detail="Not found")
    if body.is_default == 1:
        db.query(BugTemplate).update({BugTemplate.is_default: 0})
    if body.name is not None: t.name = body.name
    if body.content is not None: t.content = body.content
    if body.sort_order is not None: t.sort_order = body.sort_order
    if body.is_default is not None: t.is_default = body.is_default
    db.commit()
    log_audit(db, user, "bug_template_edit", f"编辑Bug模板: {t.name}", AUDIT_CAT_TEMPLATE, "medium")
    return {"code": 0, "data": {"id": t.id}, "message": "ok"}


@router.delete("/bug-templates/{tid}", response_model=dict)
def delete_bug_template(tid: int, db: Session = Depends(get_db), user=Depends(require_perm("doc_template"))):
    from backend.models.document import BugTemplate
    t = db.query(BugTemplate).filter(BugTemplate.id == tid).first()
    if not t: raise HTTPException(status_code=404, detail="Not found")
    name = t.name
    db.delete(t); db.commit()
    log_audit(db, user, "bug_template_delete", f"删除Bug模板: {name}", AUDIT_CAT_TEMPLATE, "high")
    return {"code": 0, "message": "ok"}
