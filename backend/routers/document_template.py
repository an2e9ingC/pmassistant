from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.middleware.auth import get_current_user, require_admin, require_perm
from backend.audit_categories import AUDIT_CAT_TEMPLATE
from backend.routers.logs import log_audit
from backend.services import document_service

router = APIRouter(prefix="/api/doc-templates", tags=["doc-templates"])


class TemplateCreate(BaseModel):
    project_type: str = "RD"
    stage_type: str
    doc_name: str
    sort_order: int = 0
    doc_path: str = ""
    base_path: Optional[str] = None
    file_pattern: Optional[str] = None
    doc_type: Optional[str] = None
    responsible_role: Optional[str] = None
    description: Optional[str] = None
    is_optional: int = 0
    is_unnecessary: int = 0


class TemplateUpdate(BaseModel):
    stage_type: Optional[str] = None
    doc_name: Optional[str] = None
    sort_order: Optional[int] = None
    description: Optional[str] = None
    responsible_role: Optional[str] = None
    doc_path: Optional[str] = None
    base_path: Optional[str] = None
    file_pattern: Optional[str] = None
    doc_type: Optional[str] = None
    is_optional: Optional[int] = None
    is_unnecessary: Optional[int] = None


@router.get("/project-types", response_model=dict)
def list_project_types(db: Session = Depends(get_db), _=Depends(get_current_user)):
    types = document_service.get_project_types(db)
    return {"code": 0, "data": types, "message": "ok"}


@router.post("/project-types", response_model=dict)
def create_project_type(
    project_type: str = Query(..., description="Project type ID, e.g. SW"),
    label: str = Query(..., description="Display name, e.g. 软件迭代项目"),
    code_prefix: str = Query("", description="Project code prefix, e.g. PE, SW, PT, LSJ"),
    db: Session = Depends(get_db),
    user=Depends(require_perm("doc_template")),
):
    from backend.services.document_service import _DEFAULT_RD_STAGES, _DEFAULT_SC_STAGES, PROJECT_TYPE_DEFS, _get_custom_project_types, _save_custom_project_types
    if project_type in PROJECT_TYPE_DEFS:
        raise HTTPException(status_code=400, detail=f"项目类型 '{project_type}' 已存在")
    customs = _get_custom_project_types(db)
    if project_type in customs:
        raise HTTPException(status_code=400, detail=f"项目类型 '{project_type}' 已存在")
    prefix = code_prefix.strip() or "PE"
    customs[project_type] = {"label": label, "code_prefix": prefix}
    _save_custom_project_types(db, customs)
    log_audit(db, user, "doc_ptype_add", f"{project_type}: {label} (prefix={prefix})", AUDIT_CAT_TEMPLATE, "medium")
    return {"code": 0, "data": {"id": project_type, "label": label, "code_prefix": prefix, "stages": [], "builtin": False}, "message": "ok"}


@router.put("/project-types/{project_type}", response_model=dict)
def update_project_type(
    project_type: str,
    label: str = Query(..., description="New display label"),
    code_prefix: str = Query("", description="New code prefix (optional)"),
    db: Session = Depends(get_db),
    user=Depends(require_perm("doc_template")),
):
    """Update a project type's display label and optionally code prefix."""
    from backend.services.document_service import (
        _DEFAULT_RD_STAGES, _DEFAULT_SC_STAGES, PROJECT_TYPE_DEFS,
        _get_custom_project_types, _save_custom_project_types,
        _get_project_type_labels, _save_project_type_labels,
    )
    old_label = None

    if project_type in PROJECT_TYPE_DEFS:
        old_label = PROJECT_TYPE_DEFS[project_type]["label"]
        # Store as label override
        overrides = _get_project_type_labels(db)
        overrides[project_type] = label
        _save_project_type_labels(db, overrides)
        # Also update in-memory for this session
        PROJECT_TYPE_DEFS[project_type]["label"] = label
        if code_prefix.strip():
            PROJECT_TYPE_DEFS[project_type]["code_prefix"] = code_prefix.strip()
    else:
        customs = _get_custom_project_types(db)
        if project_type not in customs:
            raise HTTPException(status_code=404, detail=f"项目类型 '{project_type}' 不存在")
        existing = customs[project_type]
        if isinstance(existing, dict):
            old_label = existing.get("label", "")
            existing["label"] = label
            if code_prefix.strip():
                existing["code_prefix"] = code_prefix.strip()
        else:
            old_label = existing
            customs[project_type] = {"label": label, "code_prefix": code_prefix.strip() or "PE"}
        _save_custom_project_types(db, customs)

    log_audit(db, user, "doc_ptype_edit", f"{project_type}: {old_label} -> {label}", AUDIT_CAT_TEMPLATE, "medium")
    return {"code": 0, "data": {"id": project_type, "label": label}, "message": "ok"}


@router.delete("/project-types/{project_type}", response_model=dict)
def delete_project_type(
    project_type: str,
    db: Session = Depends(get_db),
    user=Depends(require_perm("doc_template")),
):
    """Delete a custom project type and all its associated templates."""
    from backend.services.document_service import _DEFAULT_RD_STAGES, _DEFAULT_SC_STAGES, PROJECT_TYPE_DEFS, _get_custom_project_types, _save_custom_project_types, _get_project_type_labels, _save_project_type_labels, delete_project_type_and_cleanup

    # Builtin types cannot be deleted
    if project_type in PROJECT_TYPE_DEFS:
        raise HTTPException(status_code=400, detail="不能删除内置项目类型")

    customs = _get_custom_project_types(db)
    if project_type not in customs:
        raise HTTPException(status_code=404, detail=f"项目类型 '{project_type}' 不存在")

    label = customs.pop(project_type)
    _save_custom_project_types(db, customs)

    # Remove label override if exists
    overrides = _get_project_type_labels(db)
    if project_type in overrides:
        del overrides[project_type]
        _save_project_type_labels(db, overrides)

    # Clean up all associated data
    counts = delete_project_type_and_cleanup(db, project_type)

    log_audit(
        db, user, "doc_ptype_del",
        f"{project_type}: {label} ({counts['doc_templates']} docs, {counts['task_templates']} tasks)",
        AUDIT_CAT_TEMPLATE, "high",
    )
    return {"code": 0, "data": {"project_type": project_type, **counts}, "message": "ok"}


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
    log_audit(db, user, "doc_template_add", f"[{data['project_type']}] {body.stage_type}/{body.doc_name}", AUDIT_CAT_TEMPLATE, "medium")
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
    log_audit(db, user, "doc_template_edit", f"id={template_id} {body.doc_name or ''}", AUDIT_CAT_TEMPLATE, "medium")
    return {"code": 0, "data": tpl, "message": "ok"}


@router.delete("/{template_id}", response_model=dict)
def delete_template(
    template_id: int,
    delete_docs: bool = Query(False, description="If true, hard-delete all project docs created from this template"),
    db: Session = Depends(get_db),
    user=Depends(require_perm("doc_template")),
):
    from backend.models.document import DocumentTemplate, ProjectDocument
    from backend.services.project_service import log_project_activity
    tpl = db.query(DocumentTemplate).filter(DocumentTemplate.id == template_id).first()
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found")
    detail = f"{tpl.stage_type}/{tpl.doc_name}"

    deleted_docs = 0
    if delete_docs:
        # Hard-delete all project documents created from this template
        deleted_docs = db.query(ProjectDocument).filter(
            ProjectDocument.template_id == template_id
        ).delete()
    else:
        # Unlink: clear template_id so docs become manual
        db.query(ProjectDocument).filter(
            ProjectDocument.template_id == template_id
        ).update({"template_id": None}, synchronize_session=False)

    db.delete(tpl)
    db.commit()

    log_audit(db, user, "doc_template_del",
              f"{detail}" + (f" (hard: {deleted_docs} docs deleted)" if delete_docs else " (docs unlinked)"),
              AUDIT_CAT_TEMPLATE, "high")
    return {"code": 0, "data": {"deleted_docs": deleted_docs}, "message": "ok"}


class StageTypeRename(BaseModel):
    old_name: str
    new_name: str


@router.put("/stage-types/rename", response_model=dict)
def rename_stage_type(
    body: StageTypeRename,
    db: Session = Depends(get_db),
    user=Depends(require_perm("doc_template")),
):
    from backend.services.project_service import log_project_activity
    result = document_service.rename_stage_type(db, body.old_name, body.new_name)

    # Log project activity for affected projects (tasks whose stage_name changed)
    if result.get("tasks", 0) > 0:
        from backend.models.task import Task as TaskModel
        affected_tasks = db.query(TaskModel).filter(
            TaskModel.stage_name == body.new_name
        ).all()
        affected_projects = set(t.project_id for t in affected_tasks)
        for pid in affected_projects:
            task_count = sum(1 for t in affected_tasks if t.project_id == pid)
            log_project_activity(
                db, pid, user.username,
                "阶段重命名",
                f"阶段「{body.old_name}」→「{body.new_name}」，{task_count} 个任务已同步更新"
            )

    # Also update custom stage types if the old name is a custom stage
    from backend.services.document_service import _DEFAULT_RD_STAGES, _DEFAULT_SC_STAGES, _get_custom_stage_types, _save_custom_stage_types, _get_custom_project_types, PROJECT_TYPE_DEFS
    all_types = list(PROJECT_TYPE_DEFS.keys()) + list(_get_custom_project_types(db).keys())
    for pt in all_types:
        customs = _get_custom_stage_types(db, pt)
        if body.old_name in customs:
            customs[customs.index(body.old_name)] = body.new_name
            _save_custom_stage_types(db, pt, customs)
    total = sum(result.values())
    log_audit(db, user, "doc_stage_rename",
              f"{body.old_name} -> {body.new_name} ({total} total: "
              + ", ".join(f"{k}={v}" for k, v in result.items() if v) + ")",
              AUDIT_CAT_TEMPLATE, "medium")
    return {"code": 0, "data": result, "message": "ok"}


@router.post("/sync-all", response_model=dict)
def sync_all_projects(
    project_ids: Optional[str] = Query(None, description="Comma-separated project IDs to sync (default: all)"),
    db: Session = Depends(get_db),
    user=Depends(require_perm("doc_template")),
):
    """Apply current templates to all projects — add/update/remove/cleanup docs."""
    ids = [int(x.strip()) for x in project_ids.split(",") if x.strip()] if project_ids else None
    result = document_service.sync_all_projects(db, project_ids=ids)
    log_audit(
        db, user, "doc_template_sync_all",
        f"{result['synced']}/{result['total']} 个项目已同步"
        + (f", {result['failed']} 个失败" if result['failed'] else ""),
        AUDIT_CAT_TEMPLATE, "medium",
    )
    return {"code": 0, "data": result, "message": "ok"}

@router.delete("/stage-types/{stage_type}", response_model=dict)
def delete_stage_type(
    stage_type: str,
    project_type: str = Query("RD"),
    delete_tasks: bool = Query(False, description="If true, hard-delete all project tasks/docs for this stage"),
    db: Session = Depends(get_db),
    user=Depends(require_perm("doc_template")),
):
    from backend.services.document_service import _DEFAULT_RD_STAGES, _DEFAULT_SC_STAGES, _get_custom_stage_types, _save_custom_stage_types, _get_excluded_stages, _save_excluded_stages, PROJECT_TYPE_DEFS, UNKNOWN_STAGE_NAME
    from backend.services.project_service import log_project_activity
    from backend.models.task import Task as TaskModel
    from backend.models.project_stage import ProjectStage

    if stage_type == UNKNOWN_STAGE_NAME:
        raise HTTPException(status_code=400, detail=f"「{UNKNOWN_STAGE_NAME}」是系统保留阶段，不能删除。")

    if delete_tasks:
        # Hard-delete: remove all project data for this stage
        result = document_service._hard_delete_stage_data(db, stage_type, project_type)
        for pid in result.get("affected_projects", []):
            log_project_activity(
                db, pid, user.username,
                "删除阶段类型（含项目数据）",
                f"阶段「{stage_type}」[{project_type}]已删除，级联删除了项目中的任务和文档"
            )
        log_audit(db, user, "doc_stage_hard_del",
                  f"[{project_type}] {stage_type} (hard: tasks={result['deleted_tasks']}, docs={result['deleted_docs']}, stages={result['deleted_stages']})",
                  AUDIT_CAT_TEMPLATE, "high")
    else:
        # Soft-unlink: move tasks and docs to 未知, unlink from template, delete templates
        from backend.models.document import ProjectDocument as PDoc

        # Collect affected tasks and docs, grouped by project
        affected_tasks = db.query(TaskModel).filter(
            TaskModel.stage_name == stage_type
        ).all()
        affected_docs = db.query(PDoc).filter(
            PDoc.stage_type == stage_type
        ).all()

        # Build per-project counts for tasks and docs
        project_stats: dict[int, dict] = {}  # pid -> {task_count, doc_count}
        for t in affected_tasks:
            project_stats.setdefault(t.project_id, {"task_count": 0, "doc_count": 0})["task_count"] += 1
        for d in affected_docs:
            project_stats.setdefault(d.project_id, {"task_count": 0, "doc_count": 0})["doc_count"] += 1

        # Process each affected project
        affected_task_count = len(affected_tasks)
        affected_doc_count = len(affected_docs)
        affected_projects = []

        task_ids_by_project: dict[int, list] = {}
        for t in affected_tasks:
            task_ids_by_project.setdefault(t.project_id, []).append(t.id)

        for pid, stats in project_stats.items():
            unknown_id = document_service._ensure_unknown_stage(db, pid)

            # Move tasks
            if stats["task_count"] > 0:
                db.query(TaskModel).filter(TaskModel.id.in_(task_ids_by_project[pid])).update(
                    {"stage_name": UNKNOWN_STAGE_NAME, "stage_id": unknown_id, "template_id": None},
                    synchronize_session=False
                )

            # Move docs for this project
            if stats["doc_count"] > 0:
                db.query(PDoc).filter(
                    PDoc.project_id == pid,
                    PDoc.stage_type == stage_type
                ).update({"stage_type": UNKNOWN_STAGE_NAME, "template_id": None}, synchronize_session=False)

            # Delete the ProjectStage row (tasks/docs already moved to 未知)
            db.query(ProjectStage).filter(
                ProjectStage.project_id == pid,
                ProjectStage.name == stage_type
            ).delete()

            affected_projects.append({"project_id": pid, "task_count": stats["task_count"], "doc_count": stats["doc_count"]})

            # Build activity detail
            parts = []
            if stats["task_count"] > 0:
                parts.append(f"{stats['task_count']} 个任务")
            if stats["doc_count"] > 0:
                parts.append(f"{stats['doc_count']} 个文档")
            detail = f"阶段「{stage_type}」[{project_type}]已删除，{'、'.join(parts)}移至「{UNKNOWN_STAGE_NAME}」阶段"

            log_project_activity(db, pid, user.username, "删除阶段类型", detail)

        # Delete templates
        tpl_result = document_service.delete_stage_type(db, stage_type, project_type)

        db.commit()

        result = {
            "doc_templates": tpl_result["doc_templates"],
            "task_templates": tpl_result["task_templates"],
            "affected_tasks": affected_task_count,
            "affected_docs": affected_doc_count,
            "affected_projects": affected_projects,
        }
        log_audit(db, user, "doc_stage_del",
                  f"[{project_type}] {stage_type} (unlink: tasks={affected_task_count}, docs={affected_doc_count})",
                  AUDIT_CAT_TEMPLATE, "high")

    # Update PmaSetting stage lists
    if project_type in PROJECT_TYPE_DEFS and stage_type in (_DEFAULT_SC_STAGES if project_type == "SC" else _DEFAULT_RD_STAGES):
        excluded = _get_excluded_stages(db, project_type)
        if stage_type not in excluded:
            excluded.append(stage_type)
            _save_excluded_stages(db, project_type, excluded)
    else:
        customs = _get_custom_stage_types(db, project_type)
        if stage_type in customs:
            customs.remove(stage_type)
            _save_custom_stage_types(db, project_type, customs)

    return {"code": 0, "data": result, "message": "ok"}


@router.get("/stage-types/{stage_type}/usage", response_model=dict)
def get_stage_type_usage(
    stage_type: str,
    project_type: str = Query("RD"),
    db: Session = Depends(get_db),
    user=Depends(require_perm("doc_template")),
):
    """Get impact stats before deleting a stage type."""
    result = document_service.get_stage_usage(db, stage_type, project_type)
    return {"code": 0, "data": result, "message": "ok"}


@router.post("/stage-types", response_model=dict)
def add_stage_type(
    stage_type: str = Query(...),
    project_type: str = Query("RD"),
    db: Session = Depends(get_db),
    user=Depends(require_perm("doc_template")),
):
    """Persist a new custom stage type for a project type.
    If the stage_type is a previously deleted predefined stage, it will be restored."""
    import logging
    logger = logging.getLogger(__name__)
    from backend.services.document_service import _DEFAULT_RD_STAGES, _DEFAULT_SC_STAGES, _get_custom_stage_types, _save_custom_stage_types, _get_excluded_stages, _save_excluded_stages, PROJECT_TYPE_DEFS
    # If this is a previously deleted predefined stage, restore it (remove from excluded)
    if project_type in PROJECT_TYPE_DEFS:
        predefined = set((_DEFAULT_SC_STAGES if project_type == "SC" else _DEFAULT_RD_STAGES))
        if stage_type in predefined:
            excluded = _get_excluded_stages(db, project_type)
            if stage_type in excluded:
                excluded.remove(stage_type)
                _save_excluded_stages(db, project_type, excluded)
                detail = f"[{project_type}] {stage_type} (恢复预定义阶段)"
                log_audit(db, user, "doc_stage_add", detail, AUDIT_CAT_TEMPLATE, "medium")
                logger.info("doc_stage_add restore: %s by %s", detail, user.username)
                return {"code": 0, "data": {"stage_type": stage_type}, "message": "预定义阶段已恢复"}
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
    log_audit(db, user, "doc_stage_add", detail, AUDIT_CAT_TEMPLATE, "medium")
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
    """Persist the new order of stage types for a project type.

    Cascades to ProjectStage.sort_order for all projects of this type,
    so Gantt charts and task views show stages in the updated order.
    """
    from backend.services.document_service import _DEFAULT_RD_STAGES, _DEFAULT_SC_STAGES, _save_custom_stage_types, PROJECT_TYPE_DEFS
    from backend.models.project_stage import ProjectStage
    from backend.models.zentao import CachedProject
    import logging
    logger = logging.getLogger(__name__)

    # Save ALL stages' order (not just custom), so predefined stages can be reordered too
    _save_custom_stage_types(db, body.project_type, body.stages)

    # Cascade to ProjectStage.sort_order for all projects of this type
    stage_rank = {name: idx for idx, name in enumerate(body.stages, start=1)}
    project_ids = db.query(CachedProject.id).filter(
        CachedProject.project_type == body.project_type
    ).all()
    updated_stages = 0
    for (pid,) in project_ids:
        pstages = db.query(ProjectStage).filter(
            ProjectStage.project_id == pid,
            ProjectStage.name.in_(body.stages)
        ).all()
        for ps in pstages:
            new_order = stage_rank.get(ps.name)
            if new_order is not None and ps.sort_order != new_order:
                ps.sort_order = new_order
                updated_stages += 1
    if updated_stages > 0:
        db.commit()

    log_audit(db, user, "doc_stage_reorder",
              f"[{body.project_type}] {' → '.join(body.stages)}"
              + (f" (cascaded to {updated_stages} project stages)" if updated_stages else ""),
              AUDIT_CAT_TEMPLATE, "medium")
    logger.info("doc_stage_reorder: [%s] %s stages by %s (cascaded to %s project stages)",
                body.project_type, len(body.stages), user.username, updated_stages)
    return {"code": 0, "data": {"stages": body.stages, "project_stages_updated": updated_stages}, "message": "ok"}


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
    log_audit(db, user, "doc_reset", f"Cleared {count} project documents for {stage_types}", AUDIT_CAT_TEMPLATE, "medium")
    return {"code": 0, "data": {"deleted": count}, "message": f"已清除 {count} 条，涉及阶段: {', '.join(stage_types)}"}


# ── Stage-level unnecessary flags ──

@router.get("/stage-unnecessary", response_model=dict)
def get_stage_unnecessary(
    project_type: str = Query(...),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """Get stage-level unnecessary flags for a project type."""
    from backend.models.local import PmaSetting
    docs_key = f"stage_docs_unnecessary_{project_type}"
    tasks_key = f"stage_tasks_unnecessary_{project_type}"
    docs_val = PmaSetting.get(db, docs_key, "")
    tasks_val = PmaSetting.get(db, tasks_key, "")
    docs_list = [s for s in docs_val.split(",") if s]
    tasks_list = [s for s in tasks_val.split(",") if s]
    return {"code": 0, "data": {"docs": docs_list, "tasks": tasks_list}, "message": "ok"}


class StageUnnecessaryBody(BaseModel):
    stage_name: str
    unnecessary: bool  # True = mark unnecessary, False = restore

@router.put("/stage-unnecessary/docs", response_model=dict)
def set_stage_docs_unnecessary(
    project_type: str = Query(...),
    body: StageUnnecessaryBody = None,
    db: Session = Depends(get_db),
    user=Depends(require_perm("doc_template")),
):
    from backend.models.local import PmaSetting
    key = f"stage_docs_unnecessary_{project_type}"
    current = PmaSetting.get(db, key, "")
    stages = [s for s in current.split(",") if s]
    if body.unnecessary and body.stage_name not in stages:
        stages.append(body.stage_name)
    elif not body.unnecessary and body.stage_name in stages:
        stages.remove(body.stage_name)
    PmaSetting.set(db, key, ",".join(stages))
    log_audit(db, user, "stage_unnecessary_docs",
        f"project_type={project_type} stage={body.stage_name} unnecessary={body.unnecessary}",
        AUDIT_CAT_TEMPLATE, "low")
    return {"code": 0, "data": stages, "message": "ok"}


@router.put("/stage-unnecessary/tasks", response_model=dict)
def set_stage_tasks_unnecessary(
    project_type: str = Query(...),
    body: StageUnnecessaryBody = None,
    db: Session = Depends(get_db),
    user=Depends(require_perm("doc_template")),
):
    from backend.models.local import PmaSetting
    key = f"stage_tasks_unnecessary_{project_type}"
    current = PmaSetting.get(db, key, "")
    stages = [s for s in current.split(",") if s]
    if body.unnecessary and body.stage_name not in stages:
        stages.append(body.stage_name)
    elif not body.unnecessary and body.stage_name in stages:
        stages.remove(body.stage_name)
    PmaSetting.set(db, key, ",".join(stages))
    log_audit(db, user, "stage_unnecessary_tasks",
        f"project_type={project_type} stage={body.stage_name} unnecessary={body.unnecessary}",
        AUDIT_CAT_TEMPLATE, "low")
    return {"code": 0, "data": stages, "message": "ok"}


# ═══════════════════════════════════════════════════════════
# Task Template Routes
# ═══════════════════════════════════════════════════════════

task_router = APIRouter(prefix="/api/task-templates", tags=["task-templates"])


class TaskTemplateCreate(BaseModel):
    project_type: str = "RD"
    stage_type: str
    task_name: str
    sort_order: int = 0
    responsible_role: Optional[str] = None
    description: Optional[str] = None
    is_optional: int = 0
    is_unnecessary: int = 0


class TaskTemplateUpdate(BaseModel):
    stage_type: Optional[str] = None
    task_name: Optional[str] = None
    sort_order: Optional[int] = None
    description: Optional[str] = None
    responsible_role: Optional[str] = None
    is_optional: Optional[int] = None
    is_unnecessary: Optional[int] = None


@task_router.get("", response_model=dict)
def list_task_templates(
    project_type: str = Query("RD"),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    grouped = document_service.get_task_templates_grouped(db, project_type)
    return {"code": 0, "data": grouped, "message": "ok"}


@task_router.post("", response_model=dict)
def create_task_template(
    body: TaskTemplateCreate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("doc_template")),
):
    data = body.model_dump()
    if "project_type" not in data or not data["project_type"]:
        data["project_type"] = "RD"
    tpl = document_service.create_task_template(db, data)
    log_audit(db, user, "task_template_add", f"[{data['project_type']}] {body.stage_type}/{body.task_name}", AUDIT_CAT_TEMPLATE, "medium")
    return {"code": 0, "data": tpl, "message": "ok"}


@task_router.put("/{template_id}", response_model=dict)
def update_task_template(
    template_id: int,
    body: TaskTemplateUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("doc_template")),
):
    tpl = document_service.update_task_template(
        db, template_id, body.model_dump(exclude_none=True)
    )
    if not tpl:
        raise HTTPException(status_code=404, detail="Task template not found")
    log_audit(db, user, "task_template_edit", f"id={template_id} {body.task_name or ''}", AUDIT_CAT_TEMPLATE, "medium")
    return {"code": 0, "data": tpl, "message": "ok"}


@task_router.delete("/{template_id}", response_model=dict)
def delete_task_template(
    template_id: int,
    delete_tasks: bool = Query(False, description="If true, hard-delete all tasks created from this template"),
    db: Session = Depends(get_db),
    user=Depends(require_perm("doc_template")),
):
    from backend.models.document import TaskTemplate
    from backend.models.task import Task as TaskModel, WorkLog, TaskComment
    from backend.services.project_service import log_project_activity
    tpl = db.query(TaskTemplate).filter(TaskTemplate.id == template_id).first()
    if not tpl:
        raise HTTPException(status_code=404, detail="Task template not found")
    detail = f"{tpl.stage_type}/{tpl.task_name}"

    if delete_tasks:
        # Hard-delete: remove all tasks created from this template
        affected_tasks = db.query(TaskModel).filter(
            TaskModel.template_id == template_id
        ).all()
        task_ids = [t.id for t in affected_tasks]
        project_ids = set(t.project_id for t in affected_tasks)

        if task_ids:
            db.query(WorkLog).filter(WorkLog.task_id.in_(task_ids)).delete(synchronize_session=False)
            db.query(TaskComment).filter(TaskComment.task_id.in_(task_ids)).delete(synchronize_session=False)
            db.query(TaskModel).filter(TaskModel.id.in_(task_ids)).delete(synchronize_session=False)

        # Delete the template
        db.delete(tpl)
        db.commit()

        for pid in project_ids:
            log_project_activity(
                db, pid, user.username,
                "删除任务模板（含项目任务）",
                f"模板「{tpl.task_name}」已删除，级联删除了 {sum(1 for t in affected_tasks if t.project_id == pid)} 个项目任务"
            )

        result = {"deleted": True, "deleted_tasks": len(task_ids), "affected_projects": list(project_ids)}
        log_audit(db, user, "task_template_hard_del",
                  f"{detail} (hard: {len(task_ids)} tasks deleted)",
                  AUDIT_CAT_TEMPLATE, "high")
    else:
        # Soft-unlink: tasks become manual
        result = document_service.delete_task_template(db, template_id)

        for p in result["affected_projects"]:
            log_project_activity(
                db, p["project_id"], user.username,
                "删除任务模板",
                f"阶段「{tpl.stage_type}」模板「{tpl.task_name}」已删除，{p['task_count']} 个任务转为手动任务"
            )

        log_audit(db, user, "task_template_del",
                  f"{detail} (affected_tasks={result['affected_tasks']}, projects={len(result['affected_projects'])})",
                  AUDIT_CAT_TEMPLATE, "high")

    return {"code": 0, "data": result, "message": "ok"}


@task_router.post("/sync-all", response_model=dict)
def sync_all_projects_tasks(
    project_ids: Optional[str] = Query(None, description="Comma-separated project IDs to sync (default: all)"),
    db: Session = Depends(get_db),
    user=Depends(require_perm("doc_template")),
):
    """Apply current task templates to all projects — create tasks from templates."""
    ids = [int(x.strip()) for x in project_ids.split(",") if x.strip()] if project_ids else None
    result = document_service.sync_all_projects_tasks(db, project_ids=ids)
    log_audit(
        db, user, "task_template_sync_all",
        f"{result['synced']}/{result['total']} 个项目已同步"
        + (f", {result['failed']} 个失败" if result['failed'] else ""),
        AUDIT_CAT_TEMPLATE, "medium",
    )
    return {"code": 0, "data": result, "message": "ok"}
