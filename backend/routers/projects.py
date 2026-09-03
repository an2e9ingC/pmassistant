from typing import Optional, List
from datetime import date as DateType

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db, to_local_str
from backend.middleware.auth import get_current_user, require_perm
from backend.models.local import ProjectNote, ProjectActivity
from backend.models.zentao import CachedProject
from backend.services.entity_resolver import resolve_project
from backend.services.project_service import (
    log_project_activity,
    _validate_status_transition,
    _handle_transition_to_abolished,
    _handle_transition_from_abolished,
    _handle_transition_to_doing,
)
from backend.routers.logs import log_audit
from backend.audit_categories import AUDIT_CAT_PROJECT, AUDIT_CAT_TASK, FIELD_LABEL
from backend.services import project_service
import re as _re, os as _os


def _delete_note_images(content: str):
    """Delete image files referenced in note content from disk."""
    if not content:
        return
    for m in _re.finditer(r'/api/note-images/([a-f0-9]+\.\w+)', content or ""):
        fpath = _os.path.join("data", "uploads", "note_images", m.group(1))
        if _os.path.exists(fpath):
            try:
                _os.remove(fpath)
            except OSError:
                pass

router = APIRouter(prefix="/api/projects", tags=["projects"])


# Separate router for user names (used by delivery form dropdown)
user_router = APIRouter(prefix="/api/users", tags=["users"])


@user_router.get("/names", response_model=dict)
def list_user_names(db: Session = Depends(get_db), _=Depends(get_current_user)):
    """Return PMA local user names for delivery form dropdown."""
    from backend.models.local import LocalUser
    users = db.query(LocalUser.username).filter(LocalUser.is_active == True).order_by(LocalUser.username).all()
    return {"code": 0, "data": [u[0] for u in users if u[0]], "message": "ok"}


@user_router.get("/options", response_model=dict)
def list_user_options(db: Session = Depends(get_db), _=Depends(get_current_user)):
    """Return PMA local users as {id, name} for dropdowns (task assignee etc.)."""
    from backend.models.local import LocalUser
    users = db.query(LocalUser.id, LocalUser.username, LocalUser.display_name).filter(
        LocalUser.is_active == True
    ).order_by(LocalUser.username).all()
    return {"code": 0, "data": [
        {"id": u[0], "name": (u[2] or u[1]), "code": u[1]} for u in users
    ], "message": "ok"}


@user_router.get("/customers/names", response_model=dict)
def list_customer_names(
    search: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """Return cached customer names for project form dropdown. Supports Chinese search."""
    from backend.models.zentao import PmaCustomer
    q = db.query(PmaCustomer).order_by(PmaCustomer.name)
    if search:
        q = q.filter(
            PmaCustomer.name.ilike(f"%{search}%") |
            PmaCustomer.full_name.ilike(f"%{search}%")
        )
    customers = q.all()
    return {"code": 0, "data": [
        {"name": c.name, "full_name": c.full_name or ""} for c in customers if c.name
    ], "message": "ok"}


@user_router.get("/pm-names", response_model=dict)
def list_pm_names(db: Session = Depends(get_db), _=Depends(get_current_user)):
    """Return distinct PM names from cached projects for dropdown."""
    from backend.models.zentao import CachedProject
    names = db.query(CachedProject.pm_name).filter(CachedProject.pm_name != "", CachedProject.pm_name.isnot(None)).distinct().order_by(CachedProject.pm_name).all()
    return {"code": 0, "data": [n[0] for n in names if n[0]], "message": "ok"}


@user_router.get("/program-names", response_model=dict)
def list_program_names(db: Session = Depends(get_db), _=Depends(get_current_user)):
    """Return distinct program names from cached projects for dropdown."""
    from backend.models.zentao import CachedProject
    names = db.query(CachedProject.program_name).filter(CachedProject.program_name != "", CachedProject.program_name.isnot(None)).distinct().order_by(CachedProject.program_name).all()
    return {"code": 0, "data": [n[0] for n in names if n[0]], "message": "ok"}


@user_router.get("/project-options", response_model=dict)
def list_project_options(db: Session = Depends(get_db), _=Depends(get_current_user)):
    """Return all projects (id+code+name) for linked-projects dropdown."""
    from backend.models.zentao import CachedProject
    projects = db.query(CachedProject.id, CachedProject.code, CachedProject.name).order_by(CachedProject.id).all()
    return {"code": 0, "data": [{"id": p[0], "code": p[1], "name": p[2]} for p in projects], "message": "ok"}


@router.get("", response_model=dict)
def list_projects(db: Session = Depends(get_db), _=Depends(get_current_user)):
    items = project_service.get_projects(db)
    return {"code": 0, "data": items, "message": "ok"}


@router.get("/{identifier}", response_model=dict)
def get_project(identifier: str, db: Session = Depends(get_db), _=Depends(get_current_user)):
    project = resolve_project(db, identifier)
    detail = project_service.get_project_detail(db, project.id)
    if not detail:
        raise HTTPException(status_code=404, detail="Project not found")
    products = project_service.get_project_products(db, project.id)
    detail["products"] = products
    return {"code": 0, "data": detail, "message": "ok"}


@router.get("/{identifier}/stages", response_model=dict)
def get_stages(identifier: str, db: Session = Depends(get_db), _=Depends(get_current_user)):
    project = resolve_project(db, identifier)
    result = project_service.get_project_stages(db, project.id)
    return {"code": 0, "data": result, "message": "ok"}


@router.get("/{identifier}/products", response_model=dict)
def get_project_products(identifier: str, db: Session = Depends(get_db), _=Depends(get_current_user)):
    """Get products linked to a project (for task product selection in multi-product projects)."""
    project = resolve_project(db, identifier)
    from backend.models.zentao import ProductProjectLink, PmaProduct
    links = db.query(ProductProjectLink).filter(ProductProjectLink.project_id == project.id).all()
    product_ids = [l.product_id for l in links]
    products = db.query(PmaProduct).filter(PmaProduct.id.in_(product_ids)).all() if product_ids else []
    return {"code": 0, "data": [{"id": p.id, "name": p.name, "code": p.code} for p in products], "message": "ok"}


class StageInfoUpdate(BaseModel):
    name: Optional[str] = None
    sort_order: Optional[int] = None
    status: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    owner_id: Optional[int] = None
    description: Optional[str] = None


@router.put("/{identifier}/stages/{stage_id}", response_model=dict)
def update_stage(
    identifier: str,
    stage_id: int,
    body: StageInfoUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("stage_mapping")),
):
    """Update a project stage's metadata (dates, owner, status, etc.)."""
    project = resolve_project(db, identifier)
    from backend.models.project_stage import ProjectStage
    s = db.query(ProjectStage).filter(
        ProjectStage.id == stage_id,
        ProjectStage.project_id == project.id,
    ).first()
    if not s:
        raise HTTPException(status_code=404, detail="Stage not found")
    data = body.model_dump(exclude_none=True)
    changes = []
    date_fields = {"start_date", "end_date"}
    # Resolve user names for owner_id changes
    from backend.models.local import LocalUser
    def _user_name(uid):
        if not uid: return "无"
        u = db.query(LocalUser).filter(LocalUser.id == uid).first()
        return (u.display_name or u.username) if u else str(uid)
    for k, v in data.items():
        old = getattr(s, k, None)
        if k in date_fields and v is not None:
            from datetime import date as dt_date
            try:
                v = dt_date.fromisoformat(v)
            except (ValueError, TypeError):
                pass
        old_str = _user_name(old) if k == "owner_id" else str(old)
        new_str = _user_name(v) if k == "owner_id" else str(v)
        if old_str != new_str:
            changes.append(f"{k}:{old_str}->{new_str}")
        setattr(s, k, v)
    db.commit()
    log_project_activity(db, project.id, user.username, "编辑阶段",
        f"stage:{s.name}; {'; '.join(changes) if changes else '无变更'}")
    return {"code": 0, "data": {"id": s.id, "name": s.name}, "message": "ok"}


class StageCreate(BaseModel):
    name: str
    sort_order: Optional[int] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    owner_id: Optional[int] = None
    description: Optional[str] = None


@router.post("/{identifier}/stages", response_model=dict)
def create_stage(
    identifier: str,
    body: StageCreate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("stage_mapping")),
):
    """Add a custom stage to a project."""
    project = resolve_project(db, identifier)
    from backend.models.project_stage import ProjectStage
    from datetime import date as dt_date
    # Determine sort_order: place after the last existing stage
    max_order = db.query(ProjectStage).filter(
        ProjectStage.project_id == project.id
    ).order_by(ProjectStage.sort_order.desc()).first()
    sort_order = body.sort_order if body.sort_order is not None else ((max_order.sort_order + 1) if max_order else 0)
    start_date = None
    end_date = None
    if body.start_date:
        try: start_date = dt_date.fromisoformat(body.start_date)
        except (ValueError, TypeError): pass
    if body.end_date:
        try: end_date = dt_date.fromisoformat(body.end_date)
        except (ValueError, TypeError): pass
    s = ProjectStage(
        project_id=project.id,
        name=body.name,
        sort_order=sort_order,
        status="active",
        start_date=start_date,
        end_date=end_date,
        owner_id=body.owner_id,
        description=body.description or "",
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    log_project_activity(db, project.id, user.username, "添加阶段",
        f"stage:{s.name} sort_order={sort_order}")
    return {"code": 0, "data": {"id": s.id, "name": s.name}, "message": "ok"}


@router.delete("/{identifier}/stages/{stage_id}", response_model=dict)
def delete_stage(
    identifier: str,
    stage_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_perm("stage_mapping")),
):
    """Delete a project stage. Tasks in this stage are NOT deleted (stage_id is set to NULL)."""
    project = resolve_project(db, identifier)
    from backend.models.project_stage import ProjectStage
    from backend.models.task import Task
    s = db.query(ProjectStage).filter(
        ProjectStage.id == stage_id,
        ProjectStage.project_id == project.id,
    ).first()
    if not s:
        raise HTTPException(status_code=404, detail="Stage not found")
    name = s.name
    # Unlink tasks from this stage (don't delete them)
    db.query(Task).filter(Task.stage_id == stage_id).update({Task.stage_id: None}, synchronize_session=False)
    db.delete(s)
    db.commit()
    log_project_activity(db, project.id, user.username, "删除阶段",
        f"stage:{name} (id={stage_id})")
    return {"code": 0, "data": {"id": stage_id, "name": name}, "message": f"阶段「{name}」已删除"}


@router.get("/{identifier}/documents", response_model=dict)
async def get_documents(
    identifier: str,
    include_removed: bool = Query(False),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    project = resolve_project(db, identifier)
    docs = await project_service.get_project_documents(db, project.id, include_removed=include_removed)
    return {"code": 0, "data": docs, "message": "ok"}


class DocSyncBody(BaseModel):
    doc_ids: list = []  # specific doc IDs to force re-import (for deleted docs)


@router.post("/{identifier}/documents/sync", response_model=dict)
async def sync_documents(
    identifier: str,
    body: DocSyncBody,
    db: Session = Depends(get_db),
    user=Depends(require_perm("project_edit")),
):
    """Manually trigger document sync from templates, with optional force re-import."""
    project = resolve_project(db, identifier)
    # Block template sync for wait/abolished projects (#231)
    if project.status in ("wait", "abolished"):
        raise HTTPException(status_code=400, detail="待启动或已废止的项目不允许同步模板文档，请先将项目状态切换为进行中")
    from backend.services.document_service import _sync_from_templates
    from backend.models.document import ProjectDocument

    # Force re-import specified docs (e.g., previously deleted)
    force_count = 0
    restored_names = []
    if body.doc_ids:
        for did in body.doc_ids:
            pd = db.query(ProjectDocument).filter(ProjectDocument.id == did).first()
            if pd and pd.is_removed:
                # Re-create from template: find the template and recreate
                from backend.models.document import DocumentTemplate
                tpl = db.query(DocumentTemplate).filter(
                    DocumentTemplate.stage_type == pd.stage_type,
                    DocumentTemplate.doc_name == pd.doc_name,
                ).first()
                if tpl:
                    pd.is_removed = 0
                    pd.status = "pending"
                    pd.location = None
                    force_count += 1
                    restored_names.append(pd.doc_name)

    # Run normal sync
    _sync_from_templates(db, project.id, project.project_type or "RD")
    db.commit()

    if restored_names:
        log_audit(db, user, "project_doc_restore",
                  f"project={project.code} 强制恢复 {len(restored_names)} 个文档: {', '.join(restored_names)}",
                  AUDIT_CAT_PROJECT, "medium")

    docs = await project_service.get_project_documents(db, project.id)
    return {"code": 0, "data": docs, "message": f"同步完成，强制恢复 {force_count} 个文档"}


class CustomDocCreate(BaseModel):
    doc_name: str
    stage_type: str
    doc_type: str = ""
    location: str = ""
    description: str = ""
    responsible_role: str = ""
    is_optional: bool = False


@router.post("/{identifier}/documents/add", response_model=dict)
def add_custom_document(
    identifier: str,
    body: CustomDocCreate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("project_edit")),
):
    """Add a custom project document (not from a template)."""
    project = resolve_project(db, identifier)
    from backend.models.document import ProjectDocument

    # Check for duplicate active doc with same name
    from sqlalchemy import or_
    existing = db.query(ProjectDocument).filter(
        ProjectDocument.project_id == project.id,
        ProjectDocument.doc_name == body.doc_name,
        or_(ProjectDocument.is_removed == 0, ProjectDocument.is_removed == None),
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"文档「{body.doc_name}」已存在")

    pd = ProjectDocument(
        project_id=project.id,
        stage_type=body.stage_type,
        doc_name=body.doc_name,
        sort_order=99,
        status="pending",
        doc_type=body.doc_type or "",
        doc_path=body.location or "",
        location=body.location or "",
        description=body.description or "",
        responsible_role=body.responsible_role or "",
        is_optional=body.is_optional,
    )
    db.add(pd)
    db.commit()
    log_audit(db, user, "doc_add", f"项目={project.code} 新增自定义文档「{body.doc_name}」", AUDIT_CAT_PROJECT, "medium")
    return {"code": 0, "data": {"id": pd.id}, "message": f"文档「{body.doc_name}」已添加"}


class DocumentUpdate(BaseModel):
    status: Optional[str] = None  # "pending" | "submitted"
    location: Optional[str] = None
    completed_at: Optional[str] = None
    is_removed: Optional[int] = None  # 0=正常 1=已删除（可选项）
    # Custom document fields (editable for manually added docs, template_id is None)
    doc_name: Optional[str] = None
    stage_type: Optional[str] = None
    doc_type: Optional[str] = None
    doc_path: Optional[str] = None
    description: Optional[str] = None
    responsible_role: Optional[str] = None


@router.put("/{identifier}/documents/{doc_id}", response_model=dict)
def update_document(
    identifier: str,
    doc_id: int,
    body: DocumentUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("project_edit")),
):
    from backend.services import document_service
    from backend.models.document import ProjectDocument
    project = resolve_project(db, identifier)
    # Get old values before update (must capture BEFORE update_project_document
    # because it shares the same SQLAlchemy session object — old and pd are the
    # same Python object, so the update mutates old in-place)
    old = db.query(ProjectDocument).filter(ProjectDocument.id == doc_id).first()
    old_status = old.status if old else '?'
    old_location = (old.location or '') if old else '?'
    old_removed = old.is_removed if old else 0
    try:
        result = document_service.update_project_document(
            db, doc_id, body.model_dump(exclude_none=True), user.username
        )
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    if not result:
        raise HTTPException(status_code=404, detail="Document not found")

    # Build human-readable change description
    STATUS_TXT = {'pending': '未提交', 'submitted': '已提交'}
    doc_name = result.get('doc_name', '?')
    parts = []

    new_status = result.get('status', '?')
    if old_status != new_status:
        parts.append(f"状态: {STATUS_TXT.get(old_status, old_status)} → {STATUS_TXT.get(new_status, new_status)}")

    new_location = result.get('location') or ''
    if old_location != new_location:
        parts.append("路径已更新")

    new_removed = result.get('is_removed')
    if old_removed != new_removed:
        if new_removed:
            parts.append("已标记删除")
        else:
            parts.append("已恢复")

    detail = f"「{doc_name}」{'; '.join(parts)}" if parts else f"「{doc_name}」无变更"
    log_project_activity(db, project.id, user.username, "文档状态", detail)
    log_audit(db, user, "project_doc_update", f"project={project.code} {detail}", AUDIT_CAT_PROJECT, "low")

    return {"code": 0, "data": result, "message": "ok"}


@router.delete("/{identifier}/documents/{doc_id}", response_model=dict)
def delete_document(
    identifier: str,
    doc_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_perm("project_edit")),
):
    """Hard-delete a project document (only for manual/orphaned docs with template_id=NULL)."""
    from backend.models.document import ProjectDocument
    project = resolve_project(db, identifier)
    doc = db.query(ProjectDocument).filter(ProjectDocument.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if doc.template_id is not None:
        raise HTTPException(status_code=403, detail="模板文档不允许直接删除，请通过模板管理删除。")
    doc_name = doc.doc_name
    db.delete(doc)
    db.commit()
    log_project_activity(db, project.id, user.username, "文档删除", f"「{doc_name}」已删除")
    log_audit(db, user, "project_doc_delete", f"project={project.code} doc={doc_name}", AUDIT_CAT_PROJECT, "high")
    return {"code": 0, "data": None, "message": "ok"}


# ── 软件版本：聚合 / 锁定 ────────────────────────────────────────────────────
# source_type: 'project_doc' 项目文档（软件发布 / FPGA版本开发 等）| 'product_doc' 产品 BSP 文档
# current 语义：锁定版本覆盖 → 否则为 DocReleaseMatch.is_current（自动最新）
# 锁定为展示层覆盖：底层文档 location 仍自动跟踪最新，仅聚合页展示所选版本。


def _doc_version_options(db, pid: int, source_type: str, doc_id: int) -> set:
    """该文档当前可选的版本集合（校验 lock 请求用）。

    可选项遵循子项下拉选择的版本来源：
    - project_doc 且「使用产品基础版本」（doc_auto=1）→ 关联产品同阶段基础版本合集
      （每产品自动 FPGA 子文档除外，其自身 matches 即该产品 FPGA 基础版本；
      通用 96 文档在 per-product 模式是控制行，不提供锁定）；
    - 其余（使用项目侧发布版本 / 每产品子文档 / 通用 96 项目侧）→ 该文档自身 GitLab matches。
    - product_doc → 该产品文档自身 matches。
    """
    from backend.models.document import ProjectDocument, ProductDocument, DocReleaseMatch
    from backend.services.project_service import get_project_products
    versions: set = set()
    if source_type == "project_doc":
        pd = db.query(ProjectDocument).filter(
            ProjectDocument.id == doc_id, ProjectDocument.project_id == pid).first()
        if not pd:
            return versions
        from backend.services.document_service import (get_doc_auto_enabled,
                                                       _is_auto_fpga_doc,
                                                       _product_base_matches,
                                                       FPGA_GENERIC_TEMPLATE_ID,
                                                       get_fpga_generic_doc)
        if _is_auto_fpga_doc(pd):
            # 板卡子文档：来源决定可锁定版本——产品基础版本 → 自身 product fpga matches；
            # 项目侧 → 通用 template-96 文档（项目 fpga 仓库）的 matches。
            if get_doc_auto_enabled(db, pid, "project_doc", doc_id):
                for m in db.query(DocReleaseMatch).filter(
                        DocReleaseMatch.project_doc_id == doc_id).all():
                    versions.add(m.version_name)
                return versions
            generic = get_fpga_generic_doc(db, pid)
            if generic:
                for m in db.query(DocReleaseMatch).filter(
                        DocReleaseMatch.project_doc_id == generic.id).all():
                    versions.add(m.version_name)
            return versions
        if (get_doc_auto_enabled(db, pid, "project_doc", doc_id)
                and pd.template_id != FPGA_GENERIC_TEMPLATE_ID):
            for m in _product_base_matches(db, pid, pd):
                versions.add(m.version_name)
            return versions
        for m in db.query(DocReleaseMatch).filter(DocReleaseMatch.project_doc_id == doc_id).all():
            versions.add(m.version_name)
    elif source_type == "product_doc":
        linked = {p["id"] for p in get_project_products(db, pid)}
        pd = db.query(ProductDocument).filter(ProductDocument.id == doc_id).first()
        if not pd or pd.product_id not in linked:
            return versions
        for m in db.query(DocReleaseMatch).filter(DocReleaseMatch.product_doc_id == doc_id).all():
            versions.add(m.version_name)
    return versions


@router.get("/{identifier}/software-versions", response_model=dict)
async def get_software_versions(
    identifier: str,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """聚合项目全部软件/FPGA 发布版本（项目文档 + 关联产品基础版本）。

    只读（get_current_user）。groups 按来源分组（项目发布 / 产品基础版本）；
    versions 为去重后的全量版本合集。
    """
    from backend.models.document import (ProjectDocument, ProductDocument,
                                         DocReleaseMatch, ProjectReleaseLock)
    from backend.services.document_service import (get_or_init_project_documents,
                                                   get_bsp_auto_effective,
                                                   get_doc_auto_enabled,
                                                   _is_auto_fpga_doc,
                                                   _product_base_matches,
                                                   FPGA_AUTO_DOC_PREFIX)
    from backend.services.project_service import get_project_products
    from sqlalchemy import or_
    from datetime import datetime as _dt

    project = resolve_project(db, identifier)
    pid = project.id
    get_or_init_project_documents(db, pid)  # 确保自动创建/清理已执行

    # 通用 FPGA 文档（template_id=96）：有相关单板时它是「容器行」（is_removed=1 由 sync
    # 隐藏），每块板卡子文档各自带来源下拉；无单板时退化为普通项目侧版本行。
    # 独立查询（含 is_removed=1），保证容器行不被项目组循环按 is_removed==0 过滤。
    generic = db.query(ProjectDocument).filter(
        ProjectDocument.project_id == pid,
        ProjectDocument.template_id == 96,
    ).first()
    # 卡片「全部使用最新版本」主开关显示有效状态（默认开启口径下，无显式关闭行的
    # product_doc 视为开启，见 get_bsp_auto_effective / get_doc_auto_enabled）
    bsp_on = get_bsp_auto_effective(db, pid)
    # 关联产品（产品基础版本来源）：提前取出，供溯源项目发布子项「当前版本」实际来自哪个产品
    products = get_project_products(db, pid)
    prod_code_map = {p["id"]: p["code"] for p in products}

    lock_rows = db.query(ProjectReleaseLock).filter(
        ProjectReleaseLock.project_id == pid).all()
    lock_map = {(f.source_type, f.doc_id): f for f in lock_rows}

    def _doc_info(source_type, doc_id, doc_name, stage, matches, auto_managed=False,
                  doc_auto=False, doc_auto_capable=False, latest_hint=None,
                  covered=False, covered_by=None, fpga_parent=False, fpga_child=False,
                  product_code=None):
        """序列化单个文档的版本信息 + 锁定状态。

        标签页仅收录 GitLab 文档；无发布匹配 → unsubmitted（未提交），前端标记显示。
        auto_managed=True：文档处于「自动锁定最新版本」管理下，前端禁用手动选择。
        doc_auto / doc_auto_capable：子项来源下拉当前处于「使用产品基础版本」（doc_auto=1）
        与是否可配置。项目发布子项均可配；每产品自动 FPGA 子文档（fpga_child）来源固定。
        latest_hint：聚合产品基础版本时显式指定「最新」（= 全部关联产品对应阶段中最新的发布）。
        covered / covered_by：阶段级来源互斥 —— 当存在同阶段且已启用「使用产品基础版本」的
        项目发布文档时，产品基础版本文档被覆盖（covered）：灰显、不单独锁定、不参与版本汇总，
        covered_by 为覆盖它的项目发布文档名。
        fpga_parent：通用 FPGA 文档（template_id=96）处于 per-product 模式时的父控制行——
        提供来源下拉与拆分说明，不渲染版本列表/锁定（版本由下方 fpga_child 子文档承载）。
        fpga_child：`FPGA版本开发-<code>` 自动子文档，来源固定为对应产品的 FPGA 基础版本。
        """
        lock = lock_map.get((source_type, doc_id))
        own_matches = list(matches)
        if latest_hint is not None:
            latest = latest_hint
        elif own_matches:
            # 当前 = 该文档 location 对应版本（is_current），否则最新
            latest = next((m for m in own_matches if m.is_current), own_matches[0])
        else:
            latest = None
        locked_version = lock.version_name if lock else None
        current = locked_version or (latest.version_name if latest else None)
        has_newer = bool(locked_version and latest and locked_version != latest.version_name)

        versions = [{
            "version": m.version_name,
            "url": m.gitlab_url,
            "date": to_local_str(m.released_at) if m.released_at else None,
            "is_current": current is not None and m.version_name == current,
        } for m in own_matches]
        return {
            "doc_id": doc_id,
            "source_type": source_type,
            "doc_name": doc_name,
            "stage": stage,
            "current": current,
            "locked": bool(lock),
            "locked_by": lock.locked_by if lock else None,
            "locked_version": locked_version,
            "has_newer": has_newer,
            "auto_managed": bool(auto_managed),
            "doc_auto": bool(doc_auto),
            "doc_auto_capable": bool(doc_auto_capable),
            "covered": bool(covered),
            "covered_by": covered_by,
            "unsubmitted": bool(not own_matches),
            "version_count": len(own_matches),
            "fpga_parent": bool(fpga_parent),
            "fpga_child": bool(fpga_child),
            "product_code": product_code,
            "versions": versions,
        }

    groups = []
    flat = {}  # version -> {version,url,date,sources:set,is_current,locked}

    def _add_flat(m, source_label, is_current, locked):
        entry = flat.get(m.version_name)
        if entry is None:
            entry = flat[m.version_name] = {
                "version": m.version_name,
                "url": m.gitlab_url,
                "date": to_local_str(m.released_at) if m.released_at else None,
                "sources": set(),
                "is_current": False,
                "locked": False,
            }
        entry["sources"].add(source_label)
        if is_current:
            entry["is_current"] = True
        if locked:
            entry["locked"] = True

    # ── 项目自身发布文档（软件发布 / FPGA版本开发 等 GitLab 文档）──
    project_docs = []
    # 阶段级来源互斥：已启用「使用产品基础版本」的项目发布子项 → 该阶段被项目侧覆盖，
    # 产品卡上同阶段的产品基础版本文档灰显、不单独锁定、不参与汇总。
    covered_by_stage = {}  # stage -> 覆盖它的项目发布文档名
    pdoc_rows = db.query(ProjectDocument).filter(
        ProjectDocument.project_id == pid,
        ProjectDocument.is_removed == 0,
    ).all()
    from backend.services.doc_scanner import _is_gitlab_doc

    # 通用 FPGA 文档（template_id=96）：有单板产品时它是板卡拆分视图的「容器行」
    # （is_removed=1 由 sync 隐藏；无来源选择，版本由下方 fpga_child 子文档各自承载，
    # 每块板卡独立选择 项目侧 / 产品基础版本）。迭代顺序显式包含它并按 sort_order 定序，
    # 使容器行与其 `FPGA版本开发-<code>` 子文档在 软件发布 等其它文档之后紧邻呈现。
    def _rowkey(x): return (x.sort_order if x.sort_order is not None else 10 ** 9, x.id)
    all_rows = {r.id: r for r in pdoc_rows}
    if generic is not None:
        all_rows[generic.id] = generic
    all_rows = sorted(all_rows.values(), key=_rowkey)
    fpga_children = sorted((r for r in all_rows if _is_auto_fpga_doc(r)), key=_rowkey)

    for pd in all_rows:
        # 每产品子文档只在通用 96 父行处统一渲染，避免行与父控制行分离
        if _is_auto_fpga_doc(pd):
            continue
        if pd.template_id != 96 and pd.is_removed == 1:
            continue
        # 仅 GitLab 版本文档进入软件版本页（svn/nas/pdm 等无 release 版本概念）
        if not _is_gitlab_doc(pd.doc_type, pd.location or pd.doc_path or ""):
            continue
        # 通用 FPGA 文档（template_id=96）
        if pd.template_id == 96:
            if not fpga_children:
                # 无相关单板产品：普通行，展示项目仓库自身 FPGA 发布版本（仅项目侧可用）
                matches = db.query(DocReleaseMatch).filter(
                    DocReleaseMatch.project_doc_id == pd.id).all()
                info = _doc_info("project_doc", pd.id, pd.doc_name, pd.stage_type or "", matches,
                                 auto_managed=False, doc_auto=False, doc_auto_capable=False)
                project_docs.append(info)
                for m in matches:
                    _add_flat(m, pd.doc_name, m.version_name == info["current"],
                              info["locked"] and m.version_name == info["current"])
                continue
            # 容器行（无来源下拉；每块板卡子文档各自带来源下拉）
            project_docs.append(_doc_info(
                "project_doc", pd.id, pd.doc_name, pd.stage_type or "", [],
                auto_managed=False, doc_auto=False, doc_auto_capable=False, fpga_parent=True))
            for child in fpga_children:
                code = child.doc_name[len(FPGA_AUTO_DOC_PREFIX):]
                child_auto = get_doc_auto_enabled(db, pid, "project_doc", child.id)
                if child_auto:
                    # 产品基础版本 → 该板卡自身（产品 FPGA 仓库）的发布匹配
                    c_matches = db.query(DocReleaseMatch).filter(
                        DocReleaseMatch.project_doc_id == child.id).all()
                else:
                    # 项目侧 → 通用 96（项目 FPGA 仓库，模板无板卡维度）的发布匹配
                    c_matches = db.query(DocReleaseMatch).filter(
                        DocReleaseMatch.project_doc_id == pd.id).all()
                cinfo = _doc_info("project_doc", child.id, child.doc_name,
                                  child.stage_type or "", c_matches,
                                  auto_managed=False, doc_auto=child_auto,
                                  doc_auto_capable=True, fpga_child=True,
                                  product_code=code)
                project_docs.append(cinfo)
                for m in c_matches:
                    _add_flat(m, child.doc_name, m.version_name == cinfo["current"],
                              cinfo["locked"] and m.version_name == cinfo["current"])
            continue
        # 其余项目发布文档：无匹配仍展示标记「未提交」；每个子项都有来源下拉（可切产品侧）。
        matches = db.query(DocReleaseMatch).filter(
            DocReleaseMatch.project_doc_id == pd.id).all()
        per_doc = get_doc_auto_enabled(db, pid, "project_doc", pd.id)
        latest_hint = None
        if per_doc:
            # 该阶段已切换到产品基础版本 → 产品卡同阶段文档被覆盖；版本来源 = 关联产品合集
            covered_by_stage[pd.stage_type or ""] = pd.doc_name
            matches = _product_base_matches(db, pid, pd)
            if matches:
                latest_hint = max(matches,
                                  key=lambda m: (m.released_at is not None, m.released_at or _dt.min))
        info = _doc_info("project_doc", pd.id, pd.doc_name, pd.stage_type or "", matches,
                         auto_managed=False, doc_auto=per_doc, doc_auto_capable=True,
                         latest_hint=latest_hint)
        # 产品基础版本模式：溯源「当前版本」实际来自哪个产品，供版本汇总「产品编号」列展示
        if per_doc and info["current"]:
            for m in matches:
                if m.version_name != info["current"] or not m.product_doc_id:
                    continue
                pdoc = db.query(ProductDocument).filter(
                    ProductDocument.id == m.product_doc_id).first()
                if pdoc and pdoc.product_id in prod_code_map:
                    info["product_code"] = prod_code_map[pdoc.product_id]
                    break
        project_docs.append(info)
        for m in matches:
            _add_flat(m, pd.doc_name, m.version_name == info["current"],
                      info["locked"] and m.version_name == info["current"])
    if project_docs:
        groups.append({"key": "project", "type": "project", "label": "项目",
                       "docs": project_docs})

    # ── 关联产品基础版本（BSP开发 / 业务软件开发 / FPGA开发 的产品 GitLab 文档）──
    # FPGA 板卡子文档按产品 code 索引：某板卡处于「使用产品基础版本」（子文档 doc_auto=1）时，
    # 其产品卡 FPGA 基础版本文档被项目经子文档承载 → covered；「使用项目侧发布版本」时该产品
    # 基础版本不被项目跟踪 → 不 covered（保持独立可见/可锁）。
    fpga_child_by_code = {ch.doc_name[len(FPGA_AUTO_DOC_PREFIX):]: ch for ch in fpga_children}
    for prod in products:
        prod_id = prod["id"]
        prod_docs = []
        prod_pdoc_ids = [r[0] for r in db.query(ProductDocument.id).filter(
            ProductDocument.product_id == prod_id,
            ProductDocument.doc_type == "gitlab",
            or_(ProductDocument.is_removed == 0, ProductDocument.is_removed.is_(None)),  # 仅保留的项
        ).all()]
        for pdoc_id in prod_pdoc_ids:
            matches = db.query(DocReleaseMatch).filter(
                DocReleaseMatch.product_doc_id == pdoc_id).all()
            pdoc = db.query(ProductDocument).filter(ProductDocument.id == pdoc_id).first()
            # 无匹配的产品 GitLab 文档仍展示，标记 未提交（见 frontend _svRenderDoc）
            # 每个产品版本文档可单独配置「使用最新版本」开关：开启 → 自动锁定最新、禁止手动
            doc_auto = get_doc_auto_enabled(db, pid, "product_doc", pdoc_id)
            pdoc_stage = ((pdoc.stage_type or "").strip() if pdoc else "")
            if pdoc_stage == "FPGA开发":
                # 逐板卡覆盖：仅当该板卡子文档自身「使用产品基础版本」时，其产品卡 FPGA 文档才被覆盖
                child = fpga_child_by_code.get(prod["code"])
                child_auto = child and get_doc_auto_enabled(db, pid, "project_doc", child.id)
                covered = bool(child_auto)
                covered_by = child.doc_name if covered else None
            else:
                # 阶段级来源互斥：同阶段已启用「使用产品基础版本」→ 该产品文档被覆盖（灰显、不单独锁定/汇总）
                covered = pdoc_stage in covered_by_stage
                covered_by = covered_by_stage.get(pdoc_stage)
            info = _doc_info("product_doc", pdoc_id, pdoc.doc_name if pdoc else "基础版本",
                             pdoc_stage, matches,
                             auto_managed=doc_auto, doc_auto=doc_auto, doc_auto_capable=True,
                             covered=covered, covered_by=covered_by)
            prod_docs.append(info)
            if covered:
                # 该产品基础版本的版本已通过项目侧「使用产品基础版本」聚合进入汇总，跳过避免重复
                continue
            for m in matches:
                _add_flat(m, (pdoc.doc_name if pdoc else "基础版本"),
                          m.version_name == info["current"],
                          info["locked"] and m.version_name == info["current"])
        if prod_docs:
            groups.append({"key": str(prod_id), "type": "product",
                           "label": f"{prod['name']}（{prod['code']}）",
                           "code": prod["code"], "name": prod["name"], "docs": prod_docs})

    versions = [{
        "version": v["version"],
        "url": v["url"],
        "date": v["date"],
        "sources": sorted(v["sources"]),
        "is_current": v["is_current"],
        "locked": v["locked"],
    } for v in flat.values()]
    versions.sort(key=lambda x: x["date"] or "", reverse=True)

    mode = {
        "bsp_auto_latest": bsp_on,
    }

    return {"code": 0, "data": {"groups": groups, "versions": versions, "mode": mode}, "message": "ok"}


class LockBody(BaseModel):
    source_type: str  # 'project_doc' | 'product_doc'
    doc_id: int
    version: Optional[str] = None  # unlock 时可不传


@router.post("/{identifier}/software-versions/lock", response_model=dict)
async def lock_version(
    identifier: str,
    body: LockBody,
    db: Session = Depends(get_db),
    user=Depends(require_perm("project_edit")),
):
    """锁定某文档的当前版本（展示层覆盖，编辑权限）。"""
    from datetime import datetime as _dt, timezone as _tz
    from backend.models.document import ProjectReleaseLock, ProjectDocument, ProductDocument
    project = resolve_project(db, identifier)
    pid = project.id

    if body.source_type not in ("project_doc", "product_doc"):
        raise HTTPException(status_code=400, detail="source_type 仅支持 project_doc / product_doc")
    # 自动管理模式下的文档（使用产品基础版本 / 全部使用最新版本）禁止手动选择其他版本
    from backend.services.document_service import is_doc_auto_managed
    if is_doc_auto_managed(db, pid, body.source_type, body.doc_id):
        raise HTTPException(status_code=400, detail="该文档处于自动锁定最新版本模式，不可手动选择其他版本")
    if body.version not in _doc_version_options(db, pid, body.source_type, body.doc_id):
        raise HTTPException(status_code=400, detail="版本不属于该文档的有效选项")

    lock = db.query(ProjectReleaseLock).filter(
        ProjectReleaseLock.project_id == pid,
        ProjectReleaseLock.source_type == body.source_type,
        ProjectReleaseLock.doc_id == body.doc_id,
    ).first()
    if not lock:
        lock = ProjectReleaseLock(project_id=pid, source_type=body.source_type, doc_id=body.doc_id)
        db.add(lock)
    lock.version_name = body.version
    lock.locked_by = user.username
    lock.locked_at = _dt.now(_tz.utc)
    db.commit()

    doc_name = "文档"
    if body.source_type == "project_doc":
        pd = db.query(ProjectDocument).filter(ProjectDocument.id == body.doc_id).first()
        if pd:
            doc_name = pd.doc_name
    else:
        pd = db.query(ProductDocument).filter(ProductDocument.id == body.doc_id).first()
        if pd:
            doc_name = pd.doc_name
    log_project_activity(db, project.id, user.username, "版本锁定", f"「{doc_name}」当前版本设为 {body.version}")
    log_audit(db, user, "lock_release",
              f"project={project.code} source={body.source_type} doc_id={body.doc_id} version={body.version}",
              AUDIT_CAT_PROJECT, "medium")
    return {"code": 0, "data": {"source_type": body.source_type, "doc_id": body.doc_id,
                                "version": body.version}, "message": "ok"}


@router.post("/{identifier}/software-versions/unlock", response_model=dict)
async def unlock_version(
    identifier: str,
    body: LockBody,
    db: Session = Depends(get_db),
    user=Depends(require_perm("project_edit")),
):
    """解除锁定（恢复为自动最新，编辑权限）。"""
    from backend.models.document import ProjectReleaseLock
    project = resolve_project(db, identifier)
    pid = project.id
    lock = db.query(ProjectReleaseLock).filter(
        ProjectReleaseLock.project_id == pid,
        ProjectReleaseLock.source_type == body.source_type,
        ProjectReleaseLock.doc_id == body.doc_id,
    ).first()
    if lock:
        db.delete(lock)
        db.commit()
        log_audit(db, user, "unlock_release",
                  f"project={project.code} source={body.source_type} doc_id={body.doc_id}",
                  AUDIT_CAT_PROJECT, "medium")
    if body.source_type == "project_doc":
        # 解除手动选择后：若该子项仍处于「使用产品基础版本」，恢复自动跟随最新产品基础版本；
        # 若来源已切回项目侧（doc_auto=0）则无事发生。
        from backend.services.document_service import auto_lock_project_doc
        auto_lock_project_doc(db, pid, body.doc_id)
    return {"code": 0, "data": None, "message": "ok"}


class BspAutoLatestBody(BaseModel):
    enabled: bool


@router.post("/{identifier}/software-versions/bsp-auto-latest", response_model=dict)
async def set_bsp_auto_latest(
    identifier: str,
    body: BspAutoLatestBody,
    db: Session = Depends(get_db),
    user=Depends(require_perm("project_edit")),
):
    """产品基础版本「全部使用最新版本」批量开关（编辑权限）。

    开启 → 所有产品 BSP 文档的单独开关统一置 1 并自动锁定最新版本（随产品迭代推进）；
    关闭 → 全部置 0（删除自动锁恢复手动）。之后可在单个文档上用 doc-auto 精细调整。

    开关比较口径为**有效状态**（get_bsp_auto_effective）：产品基础版本默认开启后，即使
    bsp_auto_latest 本地列仍为 0，只要没有任何显式关闭的产品文档，有效状态即为开启，
    此时点「关闭」会落库 enabled=0 行再解除自动锁，避免界面显示开启、点击却无效果。
    """
    from backend.services.document_service import (set_bsp_auto_for_project,
                                                   auto_lock_bsp_for_project,
                                                   get_bsp_auto_effective)
    project = resolve_project(db, identifier)
    pid = project.id
    if get_bsp_auto_effective(db, pid) != body.enabled:
        project.bsp_auto_latest = 1 if body.enabled else 0
        db.commit()
        set_bsp_auto_for_project(db, pid, body.enabled)
        auto_lock_bsp_for_project(db, pid)
        log_audit(db, user, "set_bsp_auto_latest",
                  f"project={project.code} enabled={'1' if body.enabled else '0'}",
                  AUDIT_CAT_PROJECT, "medium")
    return {"code": 0, "data": {"enabled": body.enabled}, "message": "ok"}


class DocAutoBody(BaseModel):
    source_type: str  # 'project_doc' | 'product_doc'
    doc_id: int
    enabled: bool


@router.post("/{identifier}/software-versions/doc-auto", response_model=dict)
async def set_doc_auto(
    identifier: str,
    body: DocAutoBody,
    db: Session = Depends(get_db),
    user=Depends(require_perm("project_edit")),
):
    """单个项目发布子项的「来源选择」切换（子项级控制，编辑权限）。

    对应前端每个子项的下拉：使用项目侧发布版本（enabled=false）/ 使用产品基础版本（enabled=true）。
    - project_doc：项目发布 GitLab 文档（软件发布 / FPGA版本开发 等）。开启「使用产品基础版本」→
      版本来源切换为关联产品对应阶段合集，自动跟随最新（可再手动锁定其一）。
      每产品 FPGA 板卡子文档（`FPGA版本开发-<code>`）走同一普通路径：开启 → 该板卡改用自身产品
      FPGA 基础版本并自动跟随最新；关闭 → 切回项目仓库（通用 template-96）发布的版本。
      通用 template-96 文档本身在板卡视图下是纯容器，不通过此端点切换（前端无下拉）。
    - product_doc：产品基础版本 GitLab 文档。开启 → 自动锁定最新（禁用手动）；关闭 → 恢复手动。
    """
    from backend.models.document import ProjectDocument, ProductDocument, ProjectReleaseLock
    from backend.services.document_service import set_doc_auto as _sv_set_doc_auto
    from backend.services.project_service import get_project_products

    project = resolve_project(db, identifier)
    pid = project.id

    doc_name = "文档"
    if body.source_type == "project_doc":
        pd = db.query(ProjectDocument).filter(
            ProjectDocument.id == body.doc_id, ProjectDocument.project_id == pid).first()
        if not pd:
            raise HTTPException(status_code=404, detail="项目文档不存在")
        from backend.services.doc_scanner import _is_gitlab_doc
        if not _is_gitlab_doc(pd.doc_type, pd.location or pd.doc_path or ""):
            raise HTTPException(status_code=400, detail="仅支持 GitLab 版本文档")
        doc_name = pd.doc_name
        # 来源切换：该文档旧来源下的锁定版本全部作废，先清空再按新来源自动跟随最新
        db.query(ProjectReleaseLock).filter(
            ProjectReleaseLock.project_id == pid,
            ProjectReleaseLock.source_type == "project_doc",
            ProjectReleaseLock.doc_id == body.doc_id,
        ).delete(synchronize_session=False)
        db.commit()
        _sv_set_doc_auto(db, pid, body.source_type, body.doc_id, bool(body.enabled))
    elif body.source_type == "product_doc":
        linked = {p["id"] for p in get_project_products(db, pid)}
        pdoc = db.query(ProductDocument).filter(ProductDocument.id == body.doc_id).first()
        if not pdoc or pdoc.product_id not in linked:
            raise HTTPException(status_code=404, detail="产品文档不存在或未关联本项目")
        if pdoc.doc_type != "gitlab":
            raise HTTPException(status_code=400, detail="仅支持 GitLab 版本文档")
        doc_name = pdoc.doc_name or "基础版本"
        _sv_set_doc_auto(db, pid, body.source_type, body.doc_id, bool(body.enabled))
    else:
        raise HTTPException(status_code=400, detail="source_type 仅支持 project_doc / product_doc")

    log_project_activity(db, project.id, user.username, "版本来源切换",
                         f"「{doc_name}」" + ("改用产品基础版本" if body.enabled else "恢复使用项目侧发布版本"))
    log_audit(db, user, "set_doc_auto",
              f"project={project.code} source={body.source_type} doc_id={body.doc_id} enabled={'1' if body.enabled else '0'}",
              AUDIT_CAT_PROJECT, "medium")
    return {"code": 0, "data": {"source_type": body.source_type, "doc_id": body.doc_id,
                                "enabled": bool(body.enabled)}, "message": "ok"}


@router.get("/{identifier}/gantt", response_model=dict)
def get_gantt(identifier: str, db: Session = Depends(get_db), _=Depends(get_current_user)):
    project = resolve_project(db, identifier)
    result = project_service.get_project_gantt(db, project.id)
    return {"code": 0, "data": result, "message": "ok"}


@router.get("/{identifier}/delivery", response_model=dict)
def get_delivery(identifier: str, db: Session = Depends(get_db), _=Depends(get_current_user)):
    project = resolve_project(db, identifier)
    delivery = project_service.get_project_delivery(db, project.id)
    return {"code": 0, "data": delivery, "message": "ok"}


class DeliveryPlanUpdate(BaseModel):
    planned_delivery_qty: Optional[int] = None
    delivered_sets_qty: Optional[int] = None
    delivery_note: Optional[str] = None
    product_delivery_plans: Optional[str] = None  # JSON string from frontend


@router.put("/{identifier}/delivery-plan", response_model=dict)
def update_delivery_plan(
    identifier: str,
    body: DeliveryPlanUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("project_edit")),
):
    project = resolve_project(db, identifier)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    plan_changes = []
    if body.planned_delivery_qty is not None:
        old_qty = project.planned_delivery_qty
        if old_qty != body.planned_delivery_qty:
            plan_changes.append(f"planned_delivery_qty:'{old_qty}'->'{body.planned_delivery_qty}'")
        project.planned_delivery_qty = body.planned_delivery_qty
    if body.delivered_sets_qty is not None:
        old_qty = project.delivered_sets_qty or 0
        if old_qty != body.delivered_sets_qty:
            plan_changes.append(f"delivered_sets_qty:'{old_qty}'->'{body.delivered_sets_qty}'")
        project.delivered_sets_qty = body.delivered_sets_qty
    if body.delivery_note is not None:
        old_note = project.delivery_note or ""
        if old_note != body.delivery_note:
            plan_changes.append(f"delivery_note:'{old_note}'->'{body.delivery_note}'")
        project.delivery_note = body.delivery_note
    if body.product_delivery_plans is not None:
        old_plans = project.product_delivery_plans or ""
        if old_plans != body.product_delivery_plans:
            plan_changes.append("product_delivery_plans:更新")
        project.product_delivery_plans = body.product_delivery_plans
    # Build audit-friendly change description with Chinese field labels
    audit_changes = []
    if plan_changes:
        for c in plan_changes:
            # plan_changes format: "field_name:'old'->'new'"
            if ':' in c:
                field_name, vals = c.split(':', 1)
                label = FIELD_LABEL.get(field_name, field_name)
                audit_changes.append(f"{label}: {vals}")
    log_audit(db, user, "project_delivery_plan_update",
              f"项目={project.code} {'; '.join(audit_changes) if audit_changes else '无变更'}",
              AUDIT_CAT_PROJECT, "medium")
    db.commit()
    log_project_activity(db, project.id, user.username, "交付计划",
        "; ".join(plan_changes) if plan_changes else "无变更")
    return {
        "code": 0,
        "data": {
            "planned_delivery_qty": project.planned_delivery_qty,
            "delivered_sets_qty": project.delivered_sets_qty,
            "delivery_note": project.delivery_note,
            "product_delivery_plans": project.product_delivery_plans,
        },
        "message": "ok",
    }


@router.get("/{identifier}/resources", response_model=dict)
def get_resources(identifier: str, db: Session = Depends(get_db), _=Depends(get_current_user)):
    project = resolve_project(db, identifier)
    resources = project_service.get_project_resources(db, project.id)
    return {"code": 0, "data": resources, "message": "ok"}


class NoteCreate(BaseModel):
    content: str
    stage_name: str = ""
    parent_id: Optional[int] = None


class NoteUpdate(BaseModel):
    content: Optional[str] = None
    stage_name: Optional[str] = None


@router.get("/{identifier}/notes", response_model=dict)
def get_notes(identifier: str, db: Session = Depends(get_db), _=Depends(get_current_user)):
    project = resolve_project(db, identifier)
    notes = (
        db.query(ProjectNote)
        .filter(ProjectNote.project_id == project.id)
        .order_by(ProjectNote.created_at.desc())
        .limit(100)
        .all()
    )
    # Build parent -> children mapping
    children = {}
    for n in notes:
        if n.parent_id:
            children.setdefault(n.parent_id, []).append(n)
    # Sort: top-level notes first, each followed by its children
    result = []
    for n in notes:
        if not n.parent_id:
            result.append(n)
            for child in children.get(n.id, []):
                result.append(child)
    return {
        "code": 0,
        "data": [
            {
                "id": n.id,
                "content": n.content,
                "stage_name": n.stage_name or "",
                "parent_id": n.parent_id,
                "recorded_by": n.recorded_by,
                "created_at": to_local_str(n.created_at),
                "updated_at": to_local_str(n.updated_at) if n.updated_at else None,
            }
            for n in result
        ],
        "message": "ok",
    }


@router.post("/{identifier}/notes", response_model=dict)
def add_note(
    identifier: str,
    payload: NoteCreate,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    project = resolve_project(db, identifier)
    # Comment on someone else's note: check parent ownership
    if payload.parent_id:
        parent = db.query(ProjectNote).filter(ProjectNote.id == payload.parent_id).first()
        if not parent:
            raise HTTPException(status_code=404, detail="父笔记不存在")
        if parent.recorded_by == user.username:
            raise HTTPException(status_code=400, detail="不能评论自己的笔记，请直接编辑")
    note = ProjectNote(
        project_id=project.id,
        content=payload.content,
        stage_name=payload.stage_name,
        parent_id=payload.parent_id,
        recorded_by=user.username,
    )
    db.add(note)
    db.commit()
    db.refresh(note)
    log_project_activity(db, project.id, user.username, "项目笔记",
        f"{payload.stage_name or '项目整体'}: {payload.content[:80]}")
    log_audit(db, user, "project_note_add",
        f"project={project.code} stage={payload.stage_name or '项目整体'} content={payload.content[:60]}",
        AUDIT_CAT_PROJECT, "low")
    return {
        "code": 0,
        "data": {
            "id": note.id,
            "content": note.content,
            "stage_name": note.stage_name or "",
            "parent_id": note.parent_id,
            "recorded_by": note.recorded_by,
            "created_at": to_local_str(note.created_at),
        },
        "message": "ok",
    }


@router.put("/{identifier}/notes/{note_id}", response_model=dict)
def update_note(
    identifier: str,
    note_id: int,
    body: NoteUpdate,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    project = resolve_project(db, identifier)
    note = db.query(ProjectNote).filter(
        ProjectNote.id == note_id,
        ProjectNote.project_id == project.id,
    ).first()
    if not note:
        raise HTTPException(status_code=404, detail="笔记不存在")
    if note.recorded_by != user.username:
        raise HTTPException(status_code=403, detail="只能编辑自己的笔记")
    from datetime import datetime as _dt
    if body.content is not None:
        note.content = body.content
    if body.stage_name is not None:
        note.stage_name = body.stage_name
    note.updated_at = _dt.utcnow()
    db.commit()
    log_project_activity(db, project.id, user.username, "编辑笔记",
        f"note_id={note_id} stage={note.stage_name or '项目整体'}: {note.content[:60]}")
    log_audit(db, user, "project_note_edit",
        f"project={project.code} note_id={note_id}", AUDIT_CAT_PROJECT, "low")
    return {"code": 0, "data": {"id": note.id, "content": note.content, "stage_name": note.stage_name or ""}, "message": "ok"}


@router.delete("/{identifier}/notes/{note_id}", response_model=dict)
def delete_note(
    identifier: str,
    note_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    project = resolve_project(db, identifier)
    note = db.query(ProjectNote).filter(
        ProjectNote.id == note_id,
        ProjectNote.project_id == project.id,
    ).first()
    if not note:
        raise HTTPException(status_code=404, detail="笔记不存在")
    if note.recorded_by != user.username:
        raise HTTPException(status_code=403, detail="只能删除自己的笔记")
    # Prevent deletion if note has replies
    has_replies = db.query(ProjectNote).filter(ProjectNote.parent_id == note_id).first()
    if has_replies:
        raise HTTPException(status_code=400, detail="该笔记有回复，不能删除")
    _delete_note_images(note.content)
    db.delete(note)
    db.commit()
    log_project_activity(db, project.id, user.username, "删除笔记",
        f"note_id={note_id} stage={note.stage_name or '项目整体'}: {(note.content or '')[:60]}")
    log_audit(db, user, "project_note_delete",
        f"project={project.code} note_id={note_id}", AUDIT_CAT_PROJECT, "medium")
    return {"code": 0, "message": "已删除"}


@router.get("/{identifier}/activities", response_model=dict)
def get_activities(
    identifier: str,
    sort: str = "desc",  # "asc" or "desc"
    limit: int = 200,
    username: str = Query("", description="Filter by username"),
    action: str = Query("", description="Filter by action type"),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """Get project activity log (non-deletable audit trail)."""
    project = resolve_project(db, identifier)
    order = ProjectActivity.id.desc() if sort == "desc" else ProjectActivity.id.asc()
    q = db.query(ProjectActivity).filter(
        ProjectActivity.project_id == project.id
    )
    if username:
        q = q.filter(ProjectActivity.username == username)
    if action:
        q = q.filter(ProjectActivity.action == action)
    rows = q.order_by(order).limit(limit).all()

    # Distinct filter options (always all values for this project, ignoring current filter)
    opts_q = db.query(ProjectActivity).filter(ProjectActivity.project_id == project.id)
    usernames = sorted(set(
        r[0] for r in db.query(ProjectActivity.username).filter(
            ProjectActivity.project_id == project.id
        ).distinct().all() if r[0]
    ))
    actions = sorted(set(
        r[0] for r in db.query(ProjectActivity.action).filter(
            ProjectActivity.project_id == project.id
        ).distinct().all() if r[0]
    ))

    # Resolve display_name for all usernames at once
    usernames_set = {r.username for r in rows if r.username}
    display_map = {}
    if usernames_set:
        from backend.models.local import LocalUser as _LU
        lu_rows = db.query(_LU.username, _LU.display_name).filter(_LU.username.in_(usernames_set)).all()
        for uname, dname in lu_rows:
            if dname:
                display_map[uname] = dname

    return {
        "code": 0,
        "data": {
            "items": [
                {
                    "id": r.id,
                    "username": r.username,
                    "display_name": display_map.get(r.username, "") or "",
                    "action": r.action,
                    "detail": r.detail or "",
                    "task_id": r.task_id,
                    "task_name": r.task_name or "",
                    "task_assignee": r.task_assignee or "",
                    "created_at": to_local_str(r.created_at),
                }
                for r in rows
            ],
            "options": {"usernames": usernames, "actions": actions},
        },
        "message": "ok",
    }


class BackgroundUpdate(BaseModel):
    background: str


@router.put("/{identifier}/background", response_model=dict)
def update_project_background(
    identifier: str,
    payload: BackgroundUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("project_edit")),
):
    """Update the PMA-local project background description."""
    project = resolve_project(db, identifier)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    old_bg = project.background or ""
    project.background = payload.background
    db.commit()
    log_audit(db, user, "project_background_update",
              f"项目={project.code} 项目背景已更新", AUDIT_CAT_PROJECT, "medium")
    return {"code": 0, "data": {"background": payload.background}, "message": "ok"}


class LinkedProjectsUpdate(BaseModel):
    ids: list = []  # list of int project IDs


@router.get("/{identifier}/linked-projects", response_model=dict)
def get_linked_projects(identifier: str, db: Session = Depends(get_db), _=Depends(get_current_user)):
    project = resolve_project(db, identifier)
    """Get linked/sibling projects for a project."""
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    ids_str = project.linked_project_ids or ""
    ids = [int(x.strip()) for x in ids_str.split(",") if x.strip()]
    if not ids:
        return {"code": 0, "data": [], "message": "ok"}
    rows = db.query(CachedProject).filter(CachedProject.id.in_(ids)).all()
    return {
        "code": 0,
        "data": [{"id": r.id, "name": r.name, "code": r.code or ""} for r in rows],
        "message": "ok",
    }


@router.put("/{identifier}/linked-projects", response_model=dict)
def set_linked_projects(
    identifier: str,
    payload: LinkedProjectsUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("project_edit")),
):
    """Set linked/sibling projects with bidirectional sync."""
    project = resolve_project(db, identifier)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Parse old IDs
    old_str = project.linked_project_ids or ""
    old_ids = [int(x.strip()) for x in old_str.split(",") if x.strip()]
    new_ids = list(dict.fromkeys(payload.ids or []))  # deduplicate, preserve order

    # Update target project
    project.linked_project_ids = ",".join(str(i) for i in new_ids) if new_ids else ""

    # Bidirectional sync
    added = [i for i in new_ids if i not in old_ids]
    removed = [i for i in old_ids if i not in new_ids]
    my_id = project.id

    for peer_id in added:
        peer = db.query(CachedProject).filter(CachedProject.id == peer_id).first()
        if peer:
            peer_ids_str = peer.linked_project_ids or ""
            peer_ids = [int(x.strip()) for x in peer_ids_str.split(",") if x.strip()]
            if my_id not in peer_ids:
                peer_ids.append(my_id)
                peer.linked_project_ids = ",".join(str(i) for i in peer_ids)

    for peer_id in removed:
        peer = db.query(CachedProject).filter(CachedProject.id == peer_id).first()
        if peer:
            peer_ids_str = peer.linked_project_ids or ""
            peer_ids = [int(x.strip()) for x in peer_ids_str.split(",") if x.strip()]
            if my_id in peer_ids:
                peer_ids.remove(my_id)
                peer.linked_project_ids = ",".join(str(i) for i in peer_ids) if peer_ids else ""

    db.commit()
    log_audit(db, user, "project_linked_projects_update",
              f"项目={project.code} 关联项目已更新 ({len(new_ids)}个)", AUDIT_CAT_PROJECT, "medium")
    return {"code": 0, "data": new_ids, "message": "ok"}


# ── Convert LSJ opportunity to RD/SC project ──

class LsjConvertRequest(BaseModel):
    project_type: str  # "RD" or "SC"
    name: str          # user-entered project name


@router.post("/{identifier}/convert", response_model=dict)
def convert_lsj_project(
    identifier: str,
    body: LsjConvertRequest,
    db: Session = Depends(get_db),
    user=Depends(require_perm("project_edit")),
):
    """Convert an LSJ (opportunity) project to an RD or SC project."""
    source = resolve_project(db, identifier)
    if not source:
        raise HTTPException(status_code=404, detail="Project not found")
    if source.project_type in ("RD", "SC"):
        raise HTTPException(status_code=400, detail="Only non-RD/SC projects can be converted")

    if body.project_type not in ("RD", "SC"):
        raise HTTPException(status_code=400, detail="Target type must be RD or SC")

    from backend.services.document_service import _get_project_code_prefix
    prefix, start = _get_project_code_prefix(db, body.project_type)

    # Auto-generate code
    from sqlalchemy import func
    result = db.query(func.max(CachedProject.code)).filter(
        CachedProject.code.like(f"{prefix}%")
    ).scalar()
    if result:
        try:
            num = int(result[len(prefix):])
            next_num = max(start, num + 1)
        except (ValueError, TypeError):
            next_num = start
    else:
        next_num = start
    new_code = f"{prefix}{next_num:04d}"

    # Create new project with auto-filled data from source
    new_project = CachedProject(
        name=body.name,
        code=new_code,
        project_type=body.project_type,
        status="wait",
        model="scrum",
        is_local=True,
        description=source.description or "",
        begin=source.begin,
        end=source.end,
        customer_name=source.customer_name,
        estimate=source.estimate or 0,
        tags=source.tags,
        planned_delivery_qty=source.planned_delivery_qty or 0,
        reporter_id=user.id,
        synced_at=None,
        linked_project_ids=str(source.id),
    )
    db.add(new_project)
    db.flush()

    # Copy product links from source
    try:
        from backend.models.zentao import ProductProjectLink
        source_links = db.query(ProductProjectLink).filter(
            ProductProjectLink.project_id == source.id
        ).all()
        for link in source_links:
            db.add(ProductProjectLink(
                product_id=link.product_id,
                project_id=new_project.id,
                quantity=link.quantity,
            ))
    except Exception:
        pass

    # Copy customer links
    try:
        from backend.models.zentao import CustomerProjectLink
        source_cust_links = db.query(CustomerProjectLink).filter(
            CustomerProjectLink.project_id == source.id
        ).all()
        for link in source_cust_links:
            db.add(CustomerProjectLink(
                project_id=new_project.id,
                customer_id=link.customer_id,
            ))
    except Exception:
        pass

    # Bidirectional: add new project to source's linked_project_ids
    source_ids_str = source.linked_project_ids or ""
    source_ids = [int(x.strip()) for x in source_ids_str.split(",") if x.strip()]
    if new_project.id not in source_ids:
        source_ids.append(new_project.id)
        source.linked_project_ids = ",".join(str(i) for i in source_ids)

    db.commit()

    # Init stages, docs, tasks from template
    try:
        from backend.services.product_management_service import _init_project_stages
        _init_project_stages(db, new_project.id, body.project_type)
    except Exception:
        pass
    try:
        from backend.services.document_service import _sync_from_templates, _sync_tasks_from_templates
        _sync_from_templates(db, new_project.id, body.project_type)
        _sync_tasks_from_templates(db, new_project.id, body.project_type)
    except Exception:
        pass

    log_audit(db, user, "lsj_convert",
              f"{source.code} → {new_code} ({body.project_type}), name={body.name}",
              AUDIT_CAT_PROJECT, "high")

    return {
        "code": 0,
        "data": {"id": new_project.id, "code": new_code, "name": body.name},
        "message": "ok",
    }


# ── Edit project (all PMA-managed fields) ──

class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    project_type: Optional[str] = None
    customer_name: Optional[str] = None
    pm_name: Optional[str] = None
    status: Optional[str] = None
    begin: Optional[str] = None
    end: Optional[str] = None
    real_began: Optional[str] = None
    real_end: Optional[str] = None
    progress: Optional[str] = None
    estimate: Optional[float] = None
    consumed: Optional[float] = None
    program_name: Optional[str] = None
    planned_delivery_qty: Optional[int] = None
    delivery_note: Optional[str] = None
    background: Optional[str] = None
    tags: Optional[str] = None
    linked_project_ids: Optional[str] = None
    product_ids: Optional[list] = None  # List[ProductLinkItem] for edit mode
    description: Optional[str] = None
    is_local: Optional[bool] = None
    tracking_only: Optional[bool] = None  # 老项目跟踪标记


@router.put("/{identifier}", response_model=dict)
def update_project(
    identifier: str,
    payload: ProjectUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("project_edit")),
):
    """Update PMA-managed project fields."""
    project = resolve_project(db, identifier)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    changes = []
    data = payload.model_dump(exclude_unset=True)
    old_type = project.project_type

    # Handle customer_name → customer_project_links sync
    new_cust = data.get("customer_name")
    if new_cust is not None:
        from backend.models.zentao import CustomerProjectLink, PmaCustomer
        db.query(CustomerProjectLink).filter(CustomerProjectLink.project_id == project.id).delete()
        new_cust = new_cust.strip()
        if new_cust:
            cust = db.query(PmaCustomer).filter(PmaCustomer.name == new_cust).first()
            if not cust:
                cust = PmaCustomer(name=new_cust)
                db.add(cust)
                db.flush()
            db.add(CustomerProjectLink(project_id=project.id, customer_id=cust.id))

    # Handle product_ids → product_project_links sync (with quantity)
    new_product_ids = data.pop("product_ids", None)
    if new_product_ids is not None:
        from backend.models.zentao import ProductProjectLink
        from backend.models.zentao import PmaProduct
        # Capture old state for change tracking
        old_links = db.query(ProductProjectLink).filter(
            ProductProjectLink.project_id == project.id
        ).all()
        old_qty_map = {l.product_id: l.quantity for l in old_links}
        # Clear existing links
        db.query(ProductProjectLink).filter(ProductProjectLink.project_id == project.id).delete()
        # Create new links with quantities
        new_qty_map = {}
        for item in (new_product_ids or []):
            if isinstance(item, dict):
                pid = item.get("product_id")
                qty = item.get("quantity", 1)
            else:
                pid = getattr(item, 'product_id', item)
                qty = getattr(item, 'quantity', 1)
            new_qty_map[pid] = qty
            prod = db.query(PmaProduct).filter(PmaProduct.id == pid).first()
            if prod:
                db.add(ProductProjectLink(product_id=pid, project_id=project.id, quantity=qty))
        # Track changes in product quantity
        all_pids = set(list(old_qty_map.keys()) + list(new_qty_map.keys()))
        if old_qty_map != new_qty_map:
            for pid in sorted(all_pids):
                old_qty = old_qty_map.get(pid, 0)
                new_qty = new_qty_map.get(pid, 0)
                if old_qty != new_qty:
                    prod = db.query(PmaProduct).filter(PmaProduct.id == pid).first()
                    prod_name = (prod.code + ' ' + prod.name) if prod else f'产品#{pid}'
                    changes.append(f"{prod_name}: {old_qty}台 -> {new_qty}台")

    # --- Status transition handling (issue #231) ---
    new_status = data.pop("status", None)
    old_status = project.status
    transition_result = None

    if new_status is not None and new_status != old_status:
        # Validate transition
        allowed, reason = _validate_status_transition(db, project.id, old_status, new_status)
        if not allowed:
            raise HTTPException(status_code=400, detail=reason)

        changes.append(f"状态: '{old_status}' -> '{new_status}'")

        # Handle transition to abolished: auto-close all tasks, save snapshot
        if new_status == "abolished":
            closed_count = _handle_transition_to_abolished(db, project)
            log_audit(db, user, "project_abolish",
                      f"项目={project.code} 关闭任务数={closed_count}",
                      AUDIT_CAT_PROJECT, "high")

        # Handle transition from abolished: restore task states
        if old_status == "abolished" and new_status == "doing":
            restored_count = _handle_transition_from_abolished(db, project)
            changes.append(f"恢复任务: {restored_count} 个")

        # Handle first-time transition to doing: trigger template sync
        transition_result = None
        if new_status == "doing" and old_status == "wait":
            transition_result = _handle_transition_to_doing(db, project)

        project.status = new_status
        db.commit()
    # --- End status handling ---

    # Handle tracking_only marker explicitly: bool-coerce to avoid str(None)!=str(False) false changes,
    # and apply BEFORE type-change resync so _resync_on_type_change sees the updated flag.
    new_tracking = data.pop("tracking_only", None)
    if new_tracking is not None:
        new_tracking = bool(new_tracking)
        old_tracking = bool(getattr(project, "tracking_only", False))
        if old_tracking != new_tracking:
            project.tracking_only = new_tracking
            changes.append(f"{FIELD_LABEL.get('tracking_only', '老项目跟踪')}: '{old_tracking}' -> '{new_tracking}'")

    for field, value in data.items():
        if field in ("begin", "end", "real_began", "real_end"):
            if value is not None:
                if isinstance(value, str) and not value.strip():
                    value = None
                else:
                    try:
                        value = DateType.fromisoformat(str(value))
                    except (ValueError, TypeError):
                        value = None
        if hasattr(project, field):
            old_val = getattr(project, field)
            if str(old_val) != str(value):
                field_label = FIELD_LABEL.get(field, field)
                changes.append(f"{field_label}: '{old_val}' -> '{value}'")
            setattr(project, field, value)

    # If project_type changed, resync stages/docs/tasks from new type's templates
    if data.get("project_type") and data["project_type"] != old_type:
        from backend.services.product_management_service import _resync_on_type_change
        _resync_on_type_change(db, project.id, data["project_type"])
        changes.append(f"项目类型: '{old_type}' -> '{data['project_type']}' (已重同步模板)")

    db.commit()
    log_project_activity(db, project.id, user.username, "编辑项目",
                         "; ".join(changes) if changes else "no changes")
    log_audit(db, user, "project_update",
              f"项目={project.code} 变更={'; '.join(changes) if changes else '无变更'}",
              AUDIT_CAT_PROJECT, "medium")

    # Return updated project detail with changes count
    detail = project_service.get_project_detail(db, project.id)
    detail["_updated_fields"] = changes
    detail["_updated_count"] = len(changes)
    if transition_result:
        detail["_transition_result"] = transition_result
    return {"code": 0, "data": detail, "message": f"已更新 {len(changes)} 个字段"}


# ── Delete project ──

@router.delete("/{identifier}", response_model=dict)
def delete_project(
    identifier: str,
    db: Session = Depends(get_db),
    user=Depends(require_perm("project_edit")),
):
    """Delete a project and all related data (tasks, documents, notes, links, activities, delivery records)."""
    project = resolve_project(db, identifier)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    proj_name = project.name or str(project.id)

    # Delete related records (cascade)
    from backend.models.zentao import ProductProjectLink, CustomerProjectLink
    from backend.models.document import ProjectDocument
    from backend.models.local import ProjectNote, ProjectActivity
    from backend.models.delivery import DeliveryRecord
    from backend.models.bug import CachedBug

    # Product-project links
    db.query(ProductProjectLink).filter(ProductProjectLink.project_id == project.id).delete()
    # Customer-project links
    db.query(CustomerProjectLink).filter(CustomerProjectLink.project_id == project.id).delete()
    # Bugs
    db.query(CachedBug).filter(CachedBug.project_id == project.id).delete()
    # Documents
    db.query(ProjectDocument).filter(ProjectDocument.project_id == project.id).delete()
    # Notes
    db.query(ProjectNote).filter(ProjectNote.project_id == project.id).delete()
    # Activities
    db.query(ProjectActivity).filter(ProjectActivity.project_id == project.id).delete()
    # Delivery records
    db.query(DeliveryRecord).filter(DeliveryRecord.project_id == project.id).delete()
    # PMA tasks + worklogs + comments + stages
    from backend.models.task import Task as PmaTask, WorkLog, TaskComment
    from backend.models.project_stage import ProjectStage
    pma_task_ids = [r[0] for r in db.query(PmaTask.id).filter(PmaTask.project_id == project.id).all()]
    if pma_task_ids:
        db.query(WorkLog).filter(WorkLog.task_id.in_(pma_task_ids)).delete()
        db.query(TaskComment).filter(TaskComment.task_id.in_(pma_task_ids)).delete()
        db.query(PmaTask).filter(PmaTask.project_id == project.id).delete()
    db.query(ProjectStage).filter(ProjectStage.project_id == project.id).delete()
    # Finally delete the project itself
    db.delete(project)
    db.commit()

    # Clean orphaned favorites
    from backend.database import clean_orphan_favorites
    clean_orphan_favorites(db)

    # Log to audit
    from backend.audit_categories import AUDIT_CAT_PROJECT
    from backend.routers.logs import log_audit
    log_audit(db, user, "project_delete", f"删除项目「{proj_name}」（ID: {project.id}）", AUDIT_CAT_PROJECT, "high")

    return {"code": 0, "data": {"id": project.id, "name": proj_name}, "message": f"项目「{proj_name}」已删除"}
