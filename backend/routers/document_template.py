from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.middleware.auth import get_current_user, require_admin, require_perm
from backend.routers.logs import log_audit
from backend.services import document_service

router = APIRouter(prefix="/api/doc-templates", tags=["doc-templates"])


class TemplateCreate(BaseModel):
    project_type: str = "RD"
    stage_type: str
    doc_name: str
    sort_order: int = 0
    doc_path: str = ""
    doc_type: Optional[str] = None
    responsible_role: Optional[str] = None
    description: Optional[str] = None


class TemplateUpdate(BaseModel):
    stage_type: Optional[str] = None
    doc_name: Optional[str] = None
    sort_order: Optional[int] = None
    description: Optional[str] = None
    responsible_role: Optional[str] = None
    doc_path: Optional[str] = None
    doc_type: Optional[str] = None


@router.get("/project-types", response_model=dict)
def list_project_types(db: Session = Depends(get_db), _=Depends(get_current_user)):
    types = document_service.get_project_types(db)
    return {"code": 0, "data": types, "message": "ok"}


@router.post("/project-types", response_model=dict)
def create_project_type(
    project_type: str = Query(..., description="Project type ID, e.g. SW"),
    label: str = Query(..., description="Display name, e.g. 软件迭代项目"),
    db: Session = Depends(get_db),
    user=Depends(require_perm("doc_template")),
):
    from backend.services.document_service import PROJECT_TYPE_DEFS, _get_custom_project_types, _save_custom_project_types
    if project_type in PROJECT_TYPE_DEFS:
        raise HTTPException(status_code=400, detail=f"项目类型 '{project_type}' 已存在")
    customs = _get_custom_project_types(db)
    if project_type in customs:
        raise HTTPException(status_code=400, detail=f"项目类型 '{project_type}' 已存在")
    customs[project_type] = label
    _save_custom_project_types(db, customs)
    log_audit(db, user, "doc_ptype_add", f"{project_type}: {label}", "管理", "medium")
    return {"code": 0, "data": {"id": project_type, "label": label, "stages": [], "builtin": False}, "message": "ok"}


@router.get("/stage-types", response_model=dict)
def list_stage_types(
    project_type: str = Query("RD"),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    types = document_service.get_stage_types_for_project_type(db, project_type)
    return {"code": 0, "data": types, "message": "ok"}


@router.get("", response_model=dict)
def list_templates(
    project_type: str = Query("RD"),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    grouped = document_service.get_templates_grouped(db, project_type)
    return {"code": 0, "data": grouped, "message": "ok"}


@router.post("", response_model=dict)
def create_template(
    body: TemplateCreate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("doc_template")),
):
    data = body.model_dump()
    if "project_type" not in data or not data["project_type"]:
        data["project_type"] = "RD"
    tpl = document_service.create_template(db, data)
    log_audit(db, user, "doc_template_add", f"[{data['project_type']}] {body.stage_type}/{body.doc_name}", "管理", "medium")
    return {"code": 0, "data": tpl, "message": "ok"}


@router.put("/{template_id}", response_model=dict)
def update_template(
    template_id: int,
    body: TemplateUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("doc_template")),
):
    tpl = document_service.update_template(
        db, template_id, body.model_dump(exclude_none=True)
    )
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found")
    log_audit(db, user, "doc_template_edit", f"id={template_id} {body.doc_name or ''}", "管理", "medium")
    return {"code": 0, "data": tpl, "message": "ok"}


@router.delete("/{template_id}", response_model=dict)
def delete_template(
    template_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_perm("doc_template")),
):
    from backend.models.document import DocumentTemplate
    tpl = db.query(DocumentTemplate).filter(DocumentTemplate.id == template_id).first()
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found")
    detail = f"{tpl.stage_type}/{tpl.doc_name}"
    db.delete(tpl)
    db.commit()
    log_audit(db, user, "doc_template_del", detail, "管理", "high")
    return {"code": 0, "data": None, "message": "ok"}


class StageTypeRename(BaseModel):
    old_name: str
    new_name: str


@router.put("/stage-types/rename", response_model=dict)
def rename_stage_type(
    body: StageTypeRename,
    db: Session = Depends(get_db),
    user=Depends(require_perm("doc_template")),
):
    count = document_service.rename_stage_type(db, body.old_name, body.new_name)
    log_audit(db, user, "doc_stage_rename", f"{body.old_name} -> {body.new_name} ({count} docs)", "管理", "medium")
    return {"code": 0, "data": {"updated": count}, "message": "ok"}


@router.post("/sync-all", response_model=dict)
def sync_all_projects(
    db: Session = Depends(get_db),
    user=Depends(require_perm("doc_template")),
):
    """Apply current templates to all projects — add/update/remove/cleanup docs."""
    result = document_service.sync_all_projects(db)
    log_audit(
        db, user, "doc_template_sync_all",
        f"{result['synced']}/{result['total']} projects synced"
        + (f", {result['failed']} failed" if result['failed'] else ""),
        "管理", "medium",
    )
    return {"code": 0, "data": result, "message": "ok"}

@router.delete("/stage-types/{stage_type}", response_model=dict)
def delete_stage_type(
    stage_type: str,
    project_type: str = Query("RD"),
    db: Session = Depends(get_db),
    user=Depends(require_perm("doc_template")),
):
    count = document_service.delete_stage_type(db, stage_type)
    # Also remove from persisted custom stage types (per project_type)
    from backend.services.document_service import _get_custom_stage_types, _save_custom_stage_types
    customs = _get_custom_stage_types(db, project_type)
    if stage_type in customs:
        customs.remove(stage_type)
        _save_custom_stage_types(db, project_type, customs)
    log_audit(db, user, "doc_stage_del", f"[{project_type}] {stage_type} ({count} docs)", "管理", "high")
    return {"code": 0, "data": {"deleted": count}, "message": "ok"}


@router.post("/stage-types", response_model=dict)
def add_stage_type(
    stage_type: str = Query(...),
    project_type: str = Query("RD"),
    db: Session = Depends(get_db),
    user=Depends(require_perm("doc_template")),
):
    """Persist a new custom stage type for a project type."""
    import logging
    logger = logging.getLogger(__name__)
    from backend.services.document_service import _get_custom_stage_types, _save_custom_stage_types, PROJECT_TYPE_DEFS
    # Only check predefined for this specific project_type
    if project_type in PROJECT_TYPE_DEFS:
        predefined = set(PROJECT_TYPE_DEFS[project_type]["stages"])
        if stage_type in predefined:
            msg = f"'{stage_type}' 是 {PROJECT_TYPE_DEFS[project_type]['label']} 预定义阶段，无需添加"
            logger.warning("doc_stage_add blocked: %s", msg)
            return {"code": 1, "message": msg}

    customs = _get_custom_stage_types(db, project_type)
    if stage_type in customs:
        msg = f"阶段类型 '{stage_type}' 在 {project_type} 中已存在"
        logger.warning("doc_stage_add blocked: %s", msg)
        return {"code": 1, "message": msg}

    customs.append(stage_type)
    _save_custom_stage_types(db, project_type, customs)
    detail = f"[{project_type}] {stage_type}"
    log_audit(db, user, "doc_stage_add", detail, "管理", "medium")
    logger.info("doc_stage_add: %s by %s", detail, user.username)
    return {"code": 0, "data": {"stage_type": stage_type}, "message": "ok"}


class StageReorderRequest(BaseModel):
    project_type: str = "RD"
    stages: List[str] = []


@router.put("/stage-types/reorder", response_model=dict)
def reorder_stage_types(
    body: StageReorderRequest,
    db: Session = Depends(get_db),
    user=Depends(require_perm("doc_template")),
):
    """Persist the new order of stage types for a project type."""
    from backend.services.document_service import _save_custom_stage_types, PROJECT_TYPE_DEFS
    import logging
    logger = logging.getLogger(__name__)
    # For predefined types, filter out predefined stages (their order is fixed)
    if body.project_type in PROJECT_TYPE_DEFS:
        predefined = set(PROJECT_TYPE_DEFS[body.project_type]["stages"])
        custom_stages = [s for s in body.stages if s not in predefined]
    else:
        custom_stages = body.stages
    _save_custom_stage_types(db, body.project_type, custom_stages)
    log_audit(db, user, "doc_stage_reorder", f"[{body.project_type}] {' → '.join(custom_stages)}", "管理", "medium")
    logger.info("doc_stage_reorder: [%s] %s stages by %s", body.project_type, len(custom_stages), user.username)
    return {"code": 0, "data": {"stages": custom_stages}, "message": "ok"}


class ResetProjectDocsRequest(BaseModel):
    stage_types: List[str] = []


@router.post("/reset-project-docs", response_model=dict)
def reset_project_documents(
    body: ResetProjectDocsRequest,
    db: Session = Depends(get_db),
    user=Depends(require_perm("doc_template")),
):
    """Clear project_documents for given stage types so they re-init from updated templates."""
    from backend.models.document import ProjectDocument
    stage_types = body.stage_types
    if stage_types:
        count = db.query(ProjectDocument).filter(ProjectDocument.stage_type.in_(stage_types)).delete()
    else:
        count = 0
    db.commit()
    log_audit(db, user, "doc_reset", f"Cleared {count} project documents for {stage_types}", "管理", "medium")
    return {"code": 0, "data": {"deleted": count}, "message": f"已清除 {count} 条，涉及阶段: {', '.join(stage_types)}"}
