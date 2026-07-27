from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session
from sqlalchemy import or_

from backend.database import to_local_str
from backend.models.document import DocumentTemplate, ProjectDocument, ProductDocTemplate, ProductLine, PmaTag, TaskTemplate
from backend.models.zentao import CachedExecution, CachedProject
from backend.models.task import Task

# Standard stage names from requirements spec (Section 4.1 Project Lifecycle).
# These are the authoritative stage definitions; Zentao execution names must
# match one of these exactly (or have stage_name set to one of these).
#
# R&D project stages (10 stages):
# Default stage types — used only as seed data when initializing a project type's custom stages.
# After initialization, all stage types are read from PmaSetting (custom_stage_types_{type}).
_DEFAULT_RD_STAGES = [
    "售前", "项目立项", "需求分解", "硬件开发", "结构设计",
    "BSP开发", "软件开发", "测试", "产品发货", "项目总结",
]
_DEFAULT_SC_STAGES = [
    "售前", "项目立项", "需求分解", "硬件开发", "结构设计",
    "测试", "产品发货", "项目总结",
]

# Legacy alias for template config page
STAGE_TYPES = _DEFAULT_RD_STAGES


def _ensure_stage_types_seeded(db: Session, project_type: str):
    """Seed default stage types for a project type if none exist yet in PmaSetting."""
    saved = _get_custom_stage_types(db, project_type)
    if saved:
        return
    defaults = _DEFAULT_SC_STAGES if project_type == "SC" else _DEFAULT_RD_STAGES
    _save_custom_stage_types(db, project_type, defaults)


def get_stage_types_for_project(project_type: str, db=None) -> list[str]:
    """Return the stage list for a project type from PmaSetting. Falls back to defaults if no db."""
    if db:
        _ensure_stage_types_seeded(db, project_type)
        return get_stage_types_for_project_type(db, project_type)
    return _DEFAULT_SC_STAGES if project_type == "SC" else _DEFAULT_RD_STAGES

# Seed data: default document templates per stage type.
# These are inserted on first startup if the document_templates table is empty.
# Users can then modify them via the admin config UI.
SEED_TEMPLATES: list[dict] = [
    # ==================== RD (研发项目) ====================
    # 售前 — 导入需求、组织评估、立项决议
    {"project_type": "RD", "stage_type": "售前", "doc_name": "技术需求书", "sort_order": 1, "responsible_role": "销售及售前", "description": "导入用户需求，整理技术需求文档，作为后续评估的基础输入"},
    {"project_type": "RD", "stage_type": "售前", "doc_name": "技术可行性报告", "sort_order": 2, "responsible_role": "CTO", "description": "评估技术能否实现，包括技术方案、开发周期、技术风险等"},
    {"project_type": "RD", "stage_type": "售前", "doc_name": "商务可行性报告", "sort_order": 3, "responsible_role": "CEO", "description": "评估项目投入产出比，判断是否具备商业可行性"},
    {"project_type": "RD", "stage_type": "售前", "doc_name": "立项决议书", "sort_order": 4, "responsible_role": "销售及售前", "description": "综合结论及原因，明确是否立项，确定项目交付节点和项目类型（研发/生产）"},
    {"project_type": "RD", "stage_type": "售前", "doc_name": "项目交付节点", "sort_order": 5, "responsible_role": "项目经理", "description": "明确各阶段交付时间节点，转研发项目或转生产项目的决策依据"},
    # 项目立项 — 创建项目、实施方案、启动会
    {"project_type": "RD", "stage_type": "项目立项", "doc_name": "实施方案草案", "sort_order": 1, "responsible_role": "CTO", "description": "项目实施方案草案，包含技术路线、资源需求、风险评估"},
    {"project_type": "RD", "stage_type": "项目立项", "doc_name": "项目启动会纪要", "sort_order": 2, "responsible_role": "项目经理", "description": "项目启动会决议，确认人力资源排布、项目周期计划"},
    # 需求分解 — 需求分解任务跟踪
    {"project_type": "RD", "stage_type": "需求分解", "doc_name": "需求分解结果", "sort_order": 1, "responsible_role": "项目经理", "description": "各方向需求分解结果，对应禅道开发任务，用于跟踪执行进度"},
    # 硬件开发
    {"project_type": "RD", "stage_type": "硬件开发", "doc_name": "硬件方案设计", "sort_order": 1, "responsible_role": "硬件开发", "description": "硬件整体方案设计文档，包含架构框图、关键器件选型说明"},
    {"project_type": "RD", "stage_type": "硬件开发", "doc_name": "原理图", "sort_order": 2, "responsible_role": "硬件开发", "description": "电路原理图设计文件，需通过评审"},
    {"project_type": "RD", "stage_type": "硬件开发", "doc_name": "PCB Layout", "sort_order": 3, "responsible_role": "硬件开发", "description": "PCB版图设计文件，包含叠层、阻抗、布线等设计说明"},
    {"project_type": "RD", "stage_type": "硬件开发", "doc_name": "BOM清单", "sort_order": 4, "responsible_role": "硬件开发", "description": "物料清单，包含元器件型号、封装、数量、供应商等信息"},
    {"project_type": "RD", "stage_type": "硬件开发", "doc_name": "硬件测试报告", "sort_order": 5, "responsible_role": "硬件测试", "description": "硬件调试和测试结果报告，包含功能测试、性能测试、可靠性测试"},
    # 软件开发
    {"project_type": "RD", "stage_type": "软件开发", "doc_name": "软件需求规格说明书", "sort_order": 1, "responsible_role": "业务软件开发", "description": "软件需求规格文档，定义功能需求、性能需求、接口需求等"},
    {"project_type": "RD", "stage_type": "软件开发", "doc_name": "概要设计说明书", "sort_order": 2, "responsible_role": "业务软件开发", "description": "软件架构设计文档，包含模块划分、接口定义、技术选型"},
    {"project_type": "RD", "stage_type": "软件开发", "doc_name": "详细设计说明书", "sort_order": 3, "responsible_role": "业务软件开发", "description": "模块级详细设计文档，包含算法描述、数据结构、流程图"},
    {"project_type": "RD", "stage_type": "软件开发", "doc_name": "测试用例", "sort_order": 4, "responsible_role": "测试交付", "description": "测试用例文档，覆盖功能测试、性能测试、异常测试等场景"},
    {"project_type": "RD", "stage_type": "软件开发", "doc_name": "测试报告", "sort_order": 5, "responsible_role": "测试交付", "description": "测试执行结果报告，包含缺陷统计、测试覆盖率、结论"},
    # 结构设计
    {"project_type": "RD", "stage_type": "结构设计", "doc_name": "结构设计报告", "sort_order": 1, "responsible_role": "结构设计及装配", "description": "结构设计方案文档，包含外观设计、散热方案、装配工艺等"},
    {"project_type": "RD", "stage_type": "结构设计", "doc_name": "热设计报告", "sort_order": 2, "responsible_role": "结构设计及装配", "description": "热仿真分析和散热设计报告，确保设备在目标温度范围内正常工作"},
    # BSP开发
    {"project_type": "RD", "stage_type": "BSP开发", "doc_name": "BSP移植说明", "sort_order": 1, "responsible_role": "BSP开发", "description": "BSP移植方案、驱动适配说明、内核配置等文档"},
    {"project_type": "RD", "stage_type": "BSP开发", "doc_name": "BSP测试报告", "sort_order": 2, "responsible_role": "BSP开发", "description": "BSP功能测试、驱动验证、稳定性测试结果"},
    # 测试
    {"project_type": "RD", "stage_type": "测试", "doc_name": "测试计划", "sort_order": 1, "responsible_role": "测试交付", "description": "测试计划文档，包含测试策略、测试范围、资源安排、进度计划"},
    {"project_type": "RD", "stage_type": "测试", "doc_name": "测试报告", "sort_order": 2, "responsible_role": "测试交付", "description": "系统测试结果汇总，包含测试结论、遗留问题、交付建议"},
    # 产品发货
    {"project_type": "RD", "stage_type": "产品发货", "doc_name": "发货清单", "sort_order": 1, "responsible_role": "项目经理", "description": "产品发货明细清单，包含产品编号、数量、收货方信息、发货日期"},
    # 项目总结
    {"project_type": "RD", "stage_type": "项目总结", "doc_name": "项目总结报告", "sort_order": 1, "responsible_role": "项目经理", "description": "项目总结报告，包含目标达成情况、经验教训、改进建议"},
]


# ---------------------------------------------------------------------------
# Template seeding
# ---------------------------------------------------------------------------

def seed_document_templates(db: Session) -> int:
    """Insert default templates if the table is empty. Returns count inserted."""
    existing = db.query(DocumentTemplate).count()
    if existing > 0:
        return 0
    count = 0
    for item in SEED_TEMPLATES:
        tpl = DocumentTemplate(
            project_type=item.get("project_type", "RD"),
            stage_type=item["stage_type"],
            doc_name=item["doc_name"],
            sort_order=item.get("sort_order", 0),
            description=item.get("description"),
            responsible_role=item.get("responsible_role"),
        )
        db.add(tpl)
        count += 1
    db.commit()
    return count


# Project type definitions (display name only — stages come from PmaSetting)
PROJECT_TYPE_DEFS: dict[str, dict] = {
    "RD": {"label": "研发项目", "code_prefix": "PE"},
    "SC": {"label": "生产项目", "code_prefix": "PE"},
}

# Default start numbers for known code prefixes
_DEFAULT_START = {"PE": 456, "LSJ": 538, "SW": 1, "PT": 1}


def _get_project_code_prefix(db: Session, project_type: str) -> tuple[str, int]:
    """Return (code_prefix, start_number) for a project type.

    Looks up the prefix from PROJECT_TYPE_DEFS and custom project types,
    with fallback to "PE".
    """
    # Check built-in types
    info = PROJECT_TYPE_DEFS.get(project_type)
    if info:
        prefix = info.get("code_prefix", "PE")
        return prefix, _DEFAULT_START.get(prefix, 1)
    # Check custom types
    customs = _get_custom_project_types(db)
    if project_type in customs:
        custom_info = customs[project_type]
        if isinstance(custom_info, dict):
            prefix = custom_info.get("code_prefix", "PE")
        else:
            prefix = "PE"
        return prefix, _DEFAULT_START.get(prefix, 1)
    # Fallback
    return "PE", 456


CUSTOM_PROJECT_TYPES_KEY = "custom_project_types"  # PmaSetting key, JSON: {"SW": "软件迭代项目", ...}
PROJECT_TYPE_LABELS_KEY = "project_type_labels"  # PmaSetting key, JSON: {"RD": "研发项目v2", ...} — label overrides


def _get_custom_project_types(db: Session) -> dict:
    """Read persisted custom project types from PmaSetting."""
    from backend.models.local import PmaSetting
    import json as _json
    val = PmaSetting.get(db, CUSTOM_PROJECT_TYPES_KEY, "")
    if val:
        try:
            return _json.loads(val)
        except Exception:
            pass
    return {}


def _save_custom_project_types(db: Session, types: dict):
    """Persist custom project types to PmaSetting as JSON."""
    from backend.models.local import PmaSetting
    import json as _json
    PmaSetting.set(db, CUSTOM_PROJECT_TYPES_KEY, _json.dumps(types, ensure_ascii=False))


def _get_project_type_labels(db: Session) -> dict:
    """Read persisted label overrides for project types from PmaSetting."""
    from backend.models.local import PmaSetting
    import json as _json
    val = PmaSetting.get(db, PROJECT_TYPE_LABELS_KEY, "")
    if val:
        try:
            return _json.loads(val)
        except Exception:
            pass
    return {}


def _save_project_type_labels(db: Session, labels: dict):
    """Persist label overrides for project types to PmaSetting as JSON."""
    from backend.models.local import PmaSetting
    import json as _json
    PmaSetting.set(db, PROJECT_TYPE_LABELS_KEY, _json.dumps(labels, ensure_ascii=False))


def get_project_types(db: Session) -> list[dict]:
    """Return all known project types (predefined + persisted custom)."""
    label_overrides = _get_project_type_labels(db)
    result = []
    for ptype, info in PROJECT_TYPE_DEFS.items():
        label = label_overrides.get(ptype, info["label"])
        _ensure_stage_types_seeded(db, ptype)
        stages = get_stage_types_for_project_type(db, ptype)
        result.append({"id": ptype, "label": label, "code_prefix": info.get("code_prefix", "PE"), "stages": stages, "builtin": True})
    # Include persisted custom project types
    customs = _get_custom_project_types(db)
    for ptype, entry in customs.items():
        if isinstance(entry, dict):
            label = label_overrides.get(ptype, entry.get("label", ptype))
            code_prefix = entry.get("code_prefix", "PE")
        else:
            label = label_overrides.get(ptype, entry)
            code_prefix = "PE"
        stages = _get_custom_stage_types(db, ptype)
        result.append({"id": ptype, "label": label, "code_prefix": code_prefix, "stages": stages, "builtin": False})
    return result


def delete_project_type_and_cleanup(db: Session, project_type: str) -> dict:
    """Delete a custom project type and all its associated data.

    Returns counts of deleted items: {doc_templates, task_templates}."""
    from backend.models.local import PmaSetting

    # Delete DocumentTemplates for this project type
    doc_count = db.query(DocumentTemplate).filter(
        DocumentTemplate.project_type == project_type
    ).delete()

    # Delete TaskTemplates for this project type
    task_count = db.query(TaskTemplate).filter(
        TaskTemplate.project_type == project_type
    ).delete()

    # Clean up PmaSetting keys for this project type
    PmaSetting.set(db, f"{CUSTOM_STAGE_TYPES_PREFIX}_{project_type}", "")
    PmaSetting.set(db, f"{EXCLUDED_STAGES_PREFIX}_{project_type}", "")

    db.commit()

    return {"doc_templates": doc_count, "task_templates": task_count}


def get_stage_types_for_project_type(db: Session, project_type: str) -> list[str]:
    """Return stage types for a project_type from PmaSetting (user's custom order).
    Excluded stages are filtered out. Template-discovered stages are appended."""
    excluded = _get_excluded_stages(db, project_type)
    saved = _get_custom_stage_types(db, project_type)
    stages = [s for s in saved if s not in excluded] if saved else []
    # For types with no saved stages, also derive from existing templates in the DB
    if not stages:
        from sqlalchemy import distinct
        for (st,) in db.query(distinct(DocumentTemplate.stage_type)).filter(
            DocumentTemplate.project_type == project_type
        ).all():
            if st and st not in excluded:
                stages.append(st)
    return stages


# ---------------------------------------------------------------------------
# Template CRUD (for config UI)
# ---------------------------------------------------------------------------

def get_templates_grouped(db: Session, project_type: str = "RD") -> dict:
    """Return all templates for a project_type, grouped by stage_type."""
    templates = db.query(DocumentTemplate).filter(
        DocumentTemplate.project_type == project_type
    ).order_by(
        DocumentTemplate.stage_type, DocumentTemplate.sort_order
    ).all()
    grouped: dict[str, list[dict]] = {}

    # Ensure all known stage types for this project_type appear
    for st in get_stage_types_for_project_type(db, project_type):
        grouped[st] = []

    for t in templates:
        grouped.setdefault(t.stage_type, []).append(_template_dict(t))
    return grouped


CUSTOM_STAGE_TYPES_PREFIX = "custom_stage_types"  # PmaSetting key prefix, per-type: custom_stage_types_RD, etc.
EXCLUDED_STAGES_PREFIX = "excluded_stages"  # PmaSetting key prefix for deleted predefined stages


def _get_custom_stage_types(db: Session, project_type: str = "") -> list[str]:
    """Read persisted custom stage types for a project_type from PmaSetting."""
    from backend.models.local import PmaSetting
    key = f"{CUSTOM_STAGE_TYPES_PREFIX}_{project_type}" if project_type else CUSTOM_STAGE_TYPES_PREFIX
    val = PmaSetting.get(db, key, "")
    return [s.strip() for s in val.split(",") if s.strip()]


def _save_custom_stage_types(db: Session, project_type: str, stage_types: list[str]):
    """Persist custom stage types for a project_type to PmaSetting."""
    from backend.models.local import PmaSetting
    key = f"{CUSTOM_STAGE_TYPES_PREFIX}_{project_type}"
    val = ",".join(stage_types)
    PmaSetting.set(db, key, val)


def _get_excluded_stages(db: Session, project_type: str) -> list[str]:
    """Read persisted excluded (deleted) predefined stages for a project_type."""
    from backend.models.local import PmaSetting
    key = f"{EXCLUDED_STAGES_PREFIX}_{project_type}"
    val = PmaSetting.get(db, key, "")
    return [s.strip() for s in val.split(",") if s.strip()]


def _save_excluded_stages(db: Session, project_type: str, stage_types: list[str]):
    """Persist excluded predefined stages for a project_type to PmaSetting."""
    from backend.models.local import PmaSetting
    key = f"{EXCLUDED_STAGES_PREFIX}_{project_type}"
    val = ",".join(stage_types)
    PmaSetting.set(db, key, val)


def get_stage_types(db: Session) -> list[str]:
    """Return all known stage types: default stages + persisted custom ones from all project types."""
    all_stages = list(dict.fromkeys(_DEFAULT_RD_STAGES + _DEFAULT_SC_STAGES))  # dedup preserving order

    # Include persisted custom stage types (all project types)
    for pt in list(PROJECT_TYPE_DEFS.keys()) + list(_get_custom_project_types(db).keys()):
        for st in _get_custom_stage_types(db, pt):
            if st not in all_stages:
                all_stages.append(st)

    return all_stages


def create_template(db: Session, data: dict) -> dict:
    """Create a new document template."""
    # Check duplicate name within same project_type + stage_type
    dup = db.query(DocumentTemplate).filter(
        DocumentTemplate.project_type == data.get("project_type", "RD"),
        DocumentTemplate.stage_type == data["stage_type"],
        DocumentTemplate.doc_name == data["doc_name"],
    ).first()
    if dup:
        raise ValueError(f"文档模板「{data['doc_name']}」在该阶段下已存在")
    tpl = DocumentTemplate(
        project_type=data.get("project_type", "RD"),
        stage_type=data["stage_type"],
        doc_name=data["doc_name"],
        sort_order=data.get("sort_order", 0),
        description=data.get("description"),
        responsible_role=data.get("responsible_role"),
        doc_path=data.get("doc_path"),
        base_path=data.get("base_path"),
        file_pattern=data.get("file_pattern"),
        doc_type=data.get("doc_type"),
        is_unnecessary=1 if data.get("is_unnecessary") else 0,
        is_optional=1 if data.get("is_optional") else 0,
    )
    db.add(tpl)
    db.commit()
    db.refresh(tpl)
    return _template_dict(tpl)


def update_template(db: Session, template_id: int, data: dict) -> Optional[dict]:
    """Update an existing document template."""
    tpl = db.query(DocumentTemplate).filter(DocumentTemplate.id == template_id).first()
    if not tpl:
        return None
    # Check duplicate name (exclude self)
    new_name = data.get("doc_name", tpl.doc_name)
    if new_name != tpl.doc_name or "stage_type" in data:
        dup = db.query(DocumentTemplate).filter(
            DocumentTemplate.project_type == tpl.project_type,
            DocumentTemplate.stage_type == data.get("stage_type", tpl.stage_type),
            DocumentTemplate.doc_name == new_name,
            DocumentTemplate.id != template_id,
        ).first()
        if dup:
            raise ValueError(f"文档模板「{new_name}」在该阶段下已存在")
    for field in ("stage_type", "doc_name", "sort_order", "description", "responsible_role", "doc_path", "base_path", "file_pattern", "doc_type", "is_unnecessary", "is_optional"):
        if field in data:
            setattr(tpl, field, data[field])
    db.commit()
    db.refresh(tpl)
    return _template_dict(tpl)


def delete_template(db: Session, template_id: int) -> bool:
    """Delete a document template."""
    tpl = db.query(DocumentTemplate).filter(DocumentTemplate.id == template_id).first()
    if not tpl:
        return False
    db.delete(tpl)
    db.commit()
    return True


def rename_stage_type(db: Session, old_name: str, new_name: str) -> int:
    """Rename a stage type — update all templates with the old name."""
    if not new_name.strip():
        return 0
    count = db.query(DocumentTemplate).filter(
        DocumentTemplate.stage_type == old_name
    ).update({"stage_type": new_name.strip()})
    db.commit()
    return count


def delete_stage_type(db: Session, stage_type: str, project_type: str = "") -> int:
    """Delete all templates for a stage type, optionally scoped to a project type."""
    q = db.query(DocumentTemplate).filter(DocumentTemplate.stage_type == stage_type)
    if project_type:
        q = q.filter(DocumentTemplate.project_type == project_type)
    count = q.delete()
    db.commit()
    return count


def _template_dict(t: DocumentTemplate) -> dict:
    return {
        "id": t.id,
        "stage_type": t.stage_type,
        "doc_name": t.doc_name,
        "sort_order": t.sort_order,
        "description": t.description,
        "responsible_role": t.responsible_role,
        "doc_path": t.doc_path or "",
        "base_path": t.base_path or "",
        "file_pattern": t.file_pattern or "",
        "doc_type": t.doc_type or "",
        "is_unnecessary": bool(t.is_unnecessary),
        "is_optional": bool(t.is_optional),
    }


# ---------------------------------------------------------------------------
# Project document lifecycle
# ---------------------------------------------------------------------------

def get_or_init_project_documents(db: Session, project_id: int, project_type: str = "RD", include_removed: bool = False) -> list[dict]:
    """Get project documents, initializing from templates on first access."""
    _sync_from_templates(db, project_id, project_type)
    return _query_project_documents(db, project_id, include_removed=include_removed)


def _sync_from_templates(db: Session, project_id: int, project_type: str = "RD") -> None:
    """Sync project documents from templates for all standard stages.

    Directly iterates standard stages — no longer depends on Zentao executions.
    All documents use execution_id=0 since we no longer track Zentao executions.
    """
    standard_stages = get_stage_types_for_project_type(db, project_type)
    changed = False

    # Resolve project code for {code} placeholder substitution
    project = db.query(CachedProject).filter(CachedProject.id == project_id).first()
    project_code = (project.code or "") if project else ""

    # Load stage-level unnecessary flags (stages where all docs are optional)
    from backend.models.local import PmaSetting
    unnec_key = f"stage_docs_unnecessary_{project_type}"
    unnec_val = PmaSetting.get(db, unnec_key, "")
    unnec_stages = set(s.strip() for s in unnec_val.split(",") if s.strip())

    for st in standard_stages:
        # Skip stages marked as "无需文档" at the stage level
        if st in unnec_stages:
            # Also remove any existing docs for this stage (cleanup after marking unnecessary)
            existing_in_stage = db.query(ProjectDocument).filter(
                ProjectDocument.project_id == project_id,
                ProjectDocument.stage_type == st
            ).all()
            for pd in existing_in_stage:
                db.delete(pd)
                changed = True
            continue
        templates = (
            db.query(DocumentTemplate)
            .filter(DocumentTemplate.stage_type == st,
                    DocumentTemplate.project_type == project_type,
                    or_(DocumentTemplate.is_unnecessary == 0, DocumentTemplate.is_unnecessary == None))
            .order_by(DocumentTemplate.sort_order)
            .all()
        )
        template_names = {t.doc_name: t for t in templates}

        existing_docs = (
            db.query(ProjectDocument)
            .filter(ProjectDocument.project_id == project_id,
                    ProjectDocument.stage_type == st)
            .all()
        )

        # Deduplicate
        seen = {}
        duplicates = []
        for pd in existing_docs:
            if pd.doc_name in seen:
                duplicates.append(pd)
            else:
                seen[pd.doc_name] = pd
        for pd in duplicates:
            db.delete(pd)
            changed = True
        existing_names = seen

        # Add new docs from template
        for doc_name, tpl in template_names.items():
            if doc_name not in existing_names:
                # Build doc_path from base_path + file_pattern with {code} substitution
                if tpl.base_path and tpl.file_pattern:
                    base = tpl.base_path.replace("{code}", project_code) if project_code else tpl.base_path
                    pattern = tpl.file_pattern.replace("{code}", project_code) if project_code else tpl.file_pattern
                    doc_path = base.rstrip("/") + "/" + pattern.lstrip("/")
                else:
                    doc_path = tpl.doc_path.replace("{code}", project_code) if (tpl.doc_path and project_code) else (tpl.doc_path or "")
                # Normalize common URL typo: http:/ → http:// (but not http:// → http:///)
                if doc_path:
                    import re
                    doc_path = re.sub(r'^(https?:)/(?!/)', r'\1//', doc_path)
                pd = ProjectDocument(
                    project_id=project_id, execution_id=0,
                    stage_type=st, doc_name=tpl.doc_name,
                    sort_order=tpl.sort_order, status="pending",
                    responsible_role=tpl.responsible_role, description=tpl.description,
                    doc_type=tpl.doc_type, doc_path=doc_path,
                    base_path=tpl.base_path, file_pattern=tpl.file_pattern,
                    is_optional=bool(tpl.is_optional),
                )
                db.add(pd)
                changed = True

        # NOTE: Don't delete docs not in template — may be custom-added.
        # (No template_id column to distinguish custom vs template origin.)

        # Update existing docs
        for doc_name, pd in existing_names.items():
            tpl = template_names.get(doc_name)
            if not tpl:
                continue
            # Compute expected doc_path from template
            if tpl.base_path and tpl.file_pattern:
                base = tpl.base_path.replace("{code}", project_code) if project_code else tpl.base_path
                pattern = tpl.file_pattern.replace("{code}", project_code) if project_code else tpl.file_pattern
                expected_path = base.rstrip("/") + "/" + pattern.lstrip("/")
            else:
                expected_path = tpl.doc_path.replace("{code}", project_code) if (tpl.doc_path and project_code) else (tpl.doc_path or "")
            # Normalize common URL typo: http:/ → http:// (but not http:// → http:///)
            if expected_path:
                import re as _re
                expected_path = _re.sub(r'^(https?:)/(?!/)', r'\1//', expected_path)
            if (pd.sort_order != tpl.sort_order or
                    pd.responsible_role != tpl.responsible_role or
                    pd.description != tpl.description or
                    pd.doc_path != expected_path or
                    pd.base_path != tpl.base_path or
                    pd.file_pattern != tpl.file_pattern or
                    pd.doc_type != tpl.doc_type or
                    pd.is_optional != bool(tpl.is_optional)):
                pd.sort_order = tpl.sort_order
                pd.responsible_role = tpl.responsible_role
                pd.description = tpl.description
                pd.doc_path = expected_path
                pd.base_path = tpl.base_path
                pd.file_pattern = tpl.file_pattern
                pd.doc_type = tpl.doc_type
                pd.is_optional = bool(tpl.is_optional)
                changed = True

    if changed:
        db.commit()


# ── Removed: _STAGE_KEYWORD_MAP and _match_stage_type (Zentao fuzzy matching) ──


def _query_project_documents(db: Session, project_id: int, include_removed: bool = False) -> list[dict]:
    """Return all ProjectDocument rows for a project with computed warn flag.
    Uses outer join to include execution_id=0 placeholder docs (unmatched stages)."""
    q = (
        db.query(ProjectDocument, CachedExecution.status.label("exec_status"))
        .outerjoin(CachedExecution, CachedExecution.id == ProjectDocument.execution_id)
        .filter(ProjectDocument.project_id == project_id)
    )
    if not include_removed:
        q = q.filter(or_(ProjectDocument.is_removed == 0, ProjectDocument.is_removed == None))
    rows = q.order_by(ProjectDocument.execution_id, ProjectDocument.sort_order).all()

    # Also get execution names + task output status for display
    exec_names: dict[int, str] = {}
    exec_end_dates: dict[int, Optional[str]] = {}
    exec_statuses: dict[int, str] = {}
    exec_has_output: dict[int, bool] = {}  # execution has done tasks with files
    for pd_doc, exec_status in rows:
        if pd_doc.execution_id not in exec_names:
            e = db.query(CachedExecution).filter(
                CachedExecution.id == pd_doc.execution_id
            ).first()
            if e:
                exec_names[pd_doc.execution_id] = e.name or ""
                exec_end_dates[pd_doc.execution_id] = (
                    to_local_str(e.end) if e.end else None
                )
                exec_statuses[pd_doc.execution_id] = e.status or ""
                # Check if any task in this execution is done with files
                from backend.models.zentao import CachedTask
                tasks_with_files = db.query(CachedTask).filter(
                    CachedTask.execution_id == pd_doc.execution_id,
                    CachedTask.status.in_(["done", "closed"]),
                    CachedTask.has_files == True,
                ).count()
                exec_has_output[pd_doc.execution_id] = tasks_with_files > 0

    docs: list[dict] = []
    auto_updated = False
    for pd_doc, _ in rows:
        exec_status = exec_statuses.get(pd_doc.execution_id, "")
        is_done = exec_status in ("done", "closed")
        is_pending = pd_doc.status == "pending"
        has_task_output = exec_has_output.get(pd_doc.execution_id, False)
        if is_pending and has_task_output and is_done:
            pd_doc.status = "submitted"
        warn = is_done and pd_doc.status == "pending"

        docs.append({
            "id": pd_doc.id,
            "project_id": pd_doc.project_id,
            "execution_id": pd_doc.execution_id,
            "stage_name": exec_names.get(pd_doc.execution_id, ""),
            "stage_status": exec_status,
            "stage_completed_date": (
                to_local_str(exec_end_dates.get(pd_doc.execution_id) or pd_doc.completed_at)[:10]
                if (pd_doc.completed_at or exec_end_dates.get(pd_doc.execution_id))
                else None
            ) if pd_doc.status == "submitted" or is_done else None,
            "doc_name": pd_doc.doc_name,
            "stage_type": pd_doc.stage_type,
            "sort_order": pd_doc.sort_order,
            "status": pd_doc.status,
            "done": pd_doc.status == "submitted",
            "warn": warn,
            "responsible_role": pd_doc.responsible_role,
            "description": pd_doc.description,
            "completed_at": to_local_str(pd_doc.completed_at)[:10] if pd_doc.completed_at else None,
            "location": pd_doc.location,
            "doc_path": pd_doc.doc_path or "",
            "doc_type": pd_doc.doc_type or "",
            "updated_by": pd_doc.updated_by,
            "updated_at": to_local_str(pd_doc.updated_at) if pd_doc.updated_at else None,
            "is_optional": bool(pd_doc.is_optional),
            "is_removed": bool(pd_doc.is_removed),
        })
    return docs


def update_project_document(
    db: Session, doc_id: int, data: dict, username: str
) -> Optional[dict]:
    """Update a project document's status/location."""
    pd = db.query(ProjectDocument).filter(ProjectDocument.id == doc_id).first()
    if not pd:
        return None

    if "status" in data:
        pd.status = data["status"]
        if data["status"] == "submitted" and not pd.completed_at:
            pd.completed_at = datetime.now(timezone.utc)
        if data["status"] == "pending":
            pd.completed_at = None
    if "location" in data:
        pd.location = data["location"]
    if "completed_at" in data and data["completed_at"]:
        pd.completed_at = data["completed_at"]
    if "is_removed" in data and data["is_removed"] is not None:
        pd.is_removed = data["is_removed"]

    pd.updated_by = username
    db.commit()
    db.refresh(pd)

    # Re-query to get computed fields
    return _doc_dict(pd)


def _doc_dict(pd: ProjectDocument) -> dict:
    return {
        "id": pd.id,
        "project_id": pd.project_id,
        "execution_id": pd.execution_id,
        "stage_type": pd.stage_type,
        "doc_name": pd.doc_name,
        "sort_order": pd.sort_order,
        "status": pd.status,
        "done": pd.status == "submitted",
        "responsible_role": pd.responsible_role,
        "description": pd.description,
        "completed_at": to_local_str(pd.completed_at)[:10] if pd.completed_at else None,
        "location": pd.location,
        "doc_path": pd.doc_path or "",
        "doc_type": pd.doc_type or "",
        "updated_by": pd.updated_by,
        "updated_at": to_local_str(pd.updated_at) if pd.updated_at else None,
    }


def sync_all_projects(db: Session) -> dict:
    """Sync all projects' documents with current templates.

    Iterates every project in zenta_projects, calls _sync_from_templates
    for each, and returns success/fail counts with per-project details.
    """
    projects = db.query(CachedProject).order_by(CachedProject.id).all()
    synced: list[str] = []
    failed: list[str] = []

    for p in projects:
        ptype = (p.project_type or "RD").strip()
        try:
            _sync_from_templates(db, p.id, ptype)
            synced.append(f"{p.id}:{p.name}")
        except Exception as exc:
            failed.append(f"{p.id}:{p.name} ({exc})")

    return {
        "total": len(projects),
        "synced": len(synced),
        "failed": len(failed),
        "synced_list": synced,
        "failed_list": failed,
    }


# ---------------------------------------------------------------------------
# Task Template CRUD + Sync
# ---------------------------------------------------------------------------


def _task_template_dict(t: TaskTemplate) -> dict:
    return {
        "id": t.id,
        "project_type": t.project_type,
        "stage_type": t.stage_type,
        "task_name": t.task_name,
        "sort_order": t.sort_order,
        "description": t.description or "",
        "responsible_role": t.responsible_role or "",
        "is_unnecessary": bool(t.is_unnecessary),
        "is_optional": bool(t.is_optional),
    }


def get_task_templates_grouped(db: Session, project_type: str = "RD") -> dict:
    """Return all task templates for a project_type, grouped by stage_type."""
    templates = db.query(TaskTemplate).filter(
        TaskTemplate.project_type == project_type
    ).order_by(
        TaskTemplate.stage_type, TaskTemplate.sort_order
    ).all()
    grouped: dict[str, list[dict]] = {}

    # Ensure all known stage types for this project_type appear
    for st in get_stage_types_for_project_type(db, project_type):
        grouped[st] = []

    for t in templates:
        grouped.setdefault(t.stage_type, []).append(_task_template_dict(t))
    return grouped


def create_task_template(db: Session, data: dict) -> dict:
    """Create a new task template."""
    dup = db.query(TaskTemplate).filter(
        TaskTemplate.project_type == data.get("project_type", "RD"),
        TaskTemplate.stage_type == data["stage_type"],
        TaskTemplate.task_name == data["task_name"],
    ).first()
    if dup:
        raise ValueError(f"任务模板「{data['task_name']}」在该阶段下已存在")
    tpl = TaskTemplate(
        project_type=data.get("project_type", "RD"),
        stage_type=data["stage_type"],
        task_name=data["task_name"],
        sort_order=data.get("sort_order", 0),
        description=data.get("description"),
        responsible_role=data.get("responsible_role"),
        is_unnecessary=1 if data.get("is_unnecessary") else 0,
        is_optional=1 if data.get("is_optional") else 0,
    )
    db.add(tpl)
    db.commit()
    db.refresh(tpl)
    return _task_template_dict(tpl)


def update_task_template(db: Session, template_id: int, data: dict) -> Optional[dict]:
    """Update an existing task template."""
    tpl = db.query(TaskTemplate).filter(TaskTemplate.id == template_id).first()
    if not tpl:
        return None
    new_name = data.get("task_name", tpl.task_name)
    if new_name != tpl.task_name or "stage_type" in data:
        dup = db.query(TaskTemplate).filter(
            TaskTemplate.project_type == tpl.project_type,
            TaskTemplate.stage_type == data.get("stage_type", tpl.stage_type),
            TaskTemplate.task_name == new_name,
            TaskTemplate.id != template_id,
        ).first()
        if dup:
            raise ValueError(f"任务模板「{new_name}」在该阶段下已存在")
    for field in ("stage_type", "task_name", "sort_order", "description", "responsible_role", "is_unnecessary", "is_optional"):
        if field in data:
            setattr(tpl, field, data[field])
    db.commit()
    db.refresh(tpl)
    return _task_template_dict(tpl)


def delete_task_template(db: Session, template_id: int) -> bool:
    """Delete a task template."""
    tpl = db.query(TaskTemplate).filter(TaskTemplate.id == template_id).first()
    if not tpl:
        return False
    db.delete(tpl)
    db.commit()
    return True


def _sync_tasks_from_templates(db: Session, project_id: int, project_type: str = "RD") -> int:
    """Sync project tasks from task templates for all standard stages.

    No longer depends on Zentao executions. All tasks use execution_id=0.
    Deduplication key: (template_id, project_id, stage_name).

    Returns count of newly created tasks.
    """
    import logging
    _log = logging.getLogger(__name__)
    from backend.models.project_stage import ProjectStage
    from backend.services.project_service import _resolve_user_for_role

    standard_stages = get_stage_types_for_project_type(db, project_type)
    _log.info(f"[task-sync] project_id={project_id} type={project_type} stages={standard_stages}")
    created_count = 0

    for st in standard_stages:
        templates = (
            db.query(TaskTemplate)
            .filter(TaskTemplate.stage_type == st,
                    TaskTemplate.project_type == project_type,
                    or_(TaskTemplate.is_unnecessary == 0, TaskTemplate.is_unnecessary == None))
            .order_by(TaskTemplate.sort_order)
            .all()
        )
        _log.info(f"[task-sync] stage={st} templates={len(templates)}")

        for tpl in templates:
            # Already imported from this template — skip entirely
            existing = db.query(Task).filter(
                Task.template_id == tpl.id,
                Task.project_id == project_id,
                Task.stage_name == st,
            ).first()
            if existing:
                continue

            assignee_id = None
            if tpl.responsible_role:
                assignee_id = _resolve_user_for_role(db, tpl.responsible_role)

            # Reviewer: stage owner for template-imported tasks
            reviewer_id = None
            stage = db.query(ProjectStage).filter(
                ProjectStage.project_id == project_id,
                ProjectStage.name == st
            ).first()
            if stage and stage.owner_id:
                reviewer_id = stage.owner_id

            task = Task(
                project_id=project_id,
                execution_id=0,
                stage_name=st,
                title=tpl.task_name,
                description=tpl.description or None,
                status="todo",
                priority="medium",
                type="development",
                assignee_id=assignee_id,
                reviewer_id=reviewer_id,
                reporter_id=1,
                template_id=tpl.id,
                sort_order=tpl.sort_order,
            )
            db.add(task)
            created_count += 1

    if created_count > 0:
        db.commit()
    return created_count


def sync_all_projects_tasks(db: Session) -> dict:
    """Sync all projects' tasks with current task templates."""
    projects = db.query(CachedProject).order_by(CachedProject.id).all()
    synced: list[str] = []
    failed: list[str] = []

    for p in projects:
        ptype = (p.project_type or "RD").strip()
        try:
            count = _sync_tasks_from_templates(db, p.id, ptype)
            synced.append(f"{p.id}:{p.name} (+{count})")
        except Exception as exc:
            failed.append(f"{p.id}:{p.name} ({exc})")

    return {
        "total": len(projects),
        "synced": len(synced),
        "failed": len(failed),
        "synced_list": synced,
        "failed_list": failed,
    }


# ---------------------------------------------------------------------------
# Product Document Templates — 3-level tree (产品线 → 产品系列 → 产品型号)
# ---------------------------------------------------------------------------

def get_product_tree(db: Session) -> list[dict]:
    """Return the full 3-level product tree with template counts per node."""
    all_nodes = db.query(ProductLine).order_by(
        ProductLine.sort_order, ProductLine.name
    ).all()

    # Build parent → children map
    nodes_by_parent: dict = {}
    for node in all_nodes:
        nodes_by_parent.setdefault(node.parent_id, []).append(node)

    # Count templates per product (leaf nodes)
    template_counts: dict[int, int] = {}
    from sqlalchemy import func as sqlfunc
    for row in db.query(
        ProductDocTemplate.product_id,
        sqlfunc.count(ProductDocTemplate.id),
    ).filter(ProductDocTemplate.product_id.isnot(None)).group_by(
        ProductDocTemplate.product_id
    ).all():
        template_counts[row[0]] = row[1]

    def build_tree(parent_id=None, level=1):
        children = nodes_by_parent.get(parent_id, [])
        result = []
        for node in children:
            child_list = build_tree(node.id, level + 1) if level < 3 else []
            result.append({
                "id": node.id,
                "name": node.name,
                "parent_id": node.parent_id,
                "sort_order": node.sort_order,
                "level": level,
                "template_count": template_counts.get(node.id, 0),
                "children": child_list,
            })
        return result

    return build_tree()


def get_templates_for_product(db: Session, product_id: int) -> list[dict]:
    """Return all doc templates for a specific product (leaf node)."""
    templates = db.query(ProductDocTemplate).filter(
        ProductDocTemplate.product_id == product_id
    ).order_by(ProductDocTemplate.sort_order).all()
    return [_product_template_dict(t) for t in templates]


def get_node_breadcrumb(db: Session, node_id: int) -> list[str]:
    """Return breadcrumb path from root to node, e.g. ['嵌入式', 'VPX系列', 'VPX-6206']."""
    path = []
    current = db.query(ProductLine).filter(ProductLine.id == node_id).first()
    while current:
        path.insert(0, current.name)
        if current.parent_id:
            current = db.query(ProductLine).filter(ProductLine.id == current.parent_id).first()
        else:
            break
    return path


def _sync_affected_product_docs(db: Session, node_id: int):
    """After template changes, sync documents for all products linked to this node."""
    from backend.models.zentao import ProductNodeLink
    pids = db.query(ProductNodeLink.product_id).filter(
        ProductNodeLink.product_node_id == node_id
    ).all()
    for (pid,) in pids:
        get_or_init_product_documents(db, pid)


def create_product_template(db: Session, data: dict) -> dict:
    tpl = ProductDocTemplate(**data)
    db.add(tpl)
    db.commit()
    _sync_affected_product_docs(db, tpl.product_id)
    return _product_template_dict(tpl)


def update_product_template(db: Session, template_id: int, data: dict) -> Optional[dict]:
    tpl = db.query(ProductDocTemplate).filter(ProductDocTemplate.id == template_id).first()
    if not tpl:
        return None
    for k, v in data.items():
        if hasattr(tpl, k) and v is not None:
            setattr(tpl, k, v)
    db.commit()
    _sync_affected_product_docs(db, tpl.product_id)
    return _product_template_dict(tpl)


def delete_product_template(db: Session, template_id: int) -> bool:
    tpl = db.query(ProductDocTemplate).filter(ProductDocTemplate.id == template_id).first()
    if not tpl:
        return False
    node_id = tpl.product_id
    db.delete(tpl)
    db.commit()
    _sync_affected_product_docs(db, node_id)
    return True


# ── Product Node CRUD (tree nodes) ──

def add_product_node(db: Session, name: str, parent_id: int | None = None,
                     sort_order: int = 0) -> dict:
    """Add a new product tree node at any level."""
    # Check name uniqueness within same parent
    existing = db.query(ProductLine).filter(
        ProductLine.name == name,
        ProductLine.parent_id == parent_id,
    ).first()
    if existing:
        raise ValueError(f"同级下已存在同名节点: {name}")
    node = ProductLine(name=name, parent_id=parent_id, sort_order=sort_order)
    db.add(node)
    db.commit()
    return _product_line_dict(node)


def rename_product_node(db: Session, node_id: int, new_name: str) -> dict:
    """Rename a node and cascade to product_doc_templates for leaf nodes."""
    node = db.query(ProductLine).filter(ProductLine.id == node_id).first()
    if not node:
        raise ValueError(f"节点不存在: {node_id}")
    old_name = node.name
    node.name = new_name

    # Also update legacy product_line field on templates referencing this node
    db.query(ProductDocTemplate).filter(
        ProductDocTemplate.product_id == node_id,
    ).update({"product_line": new_name})
    db.commit()
    return _product_line_dict(node)


def update_product_node(db: Session, node_id: int, data: dict) -> dict:
    """Update a node's parent_id or sort_order (move/reorder)."""
    node = db.query(ProductLine).filter(ProductLine.id == node_id).first()
    if not node:
        raise ValueError(f"节点不存在: {node_id}")
    if "parent_id" in data:
        node.parent_id = data["parent_id"]
    if "sort_order" in data:
        node.sort_order = data["sort_order"]
    if "name" in data:
        node.name = data["name"]
    db.commit()
    return _product_line_dict(node)


def delete_product_node(db: Session, node_id: int) -> dict:
    """Delete a node, its descendants, and their templates. Returns stats."""
    node = db.query(ProductLine).filter(ProductLine.id == node_id).first()
    if not node:
        raise ValueError(f"节点不存在: {node_id}")

    # Find all descendant IDs recursively
    def get_descendant_ids(pid):
        children = db.query(ProductLine).filter(ProductLine.parent_id == pid).all()
        ids = []
        for c in children:
            ids.append(c.id)
            ids.extend(get_descendant_ids(c.id))
        return ids

    all_ids = [node_id] + get_descendant_ids(node_id)

    # Delete templates for all affected products
    template_count = db.query(ProductDocTemplate).filter(
        ProductDocTemplate.product_id.in_(all_ids)
    ).delete(synchronize_session=False)

    # Delete all affected nodes (children first to avoid FK issues)
    for pid in reversed(all_ids):
        db.query(ProductLine).filter(ProductLine.id == pid).delete(synchronize_session=False)

    db.commit()
    return {"node_count": len(all_ids), "template_count": template_count}


def _product_line_dict(node: ProductLine) -> dict:
    return {
        "id": node.id,
        "name": node.name,
        "parent_id": node.parent_id,
        "sort_order": node.sort_order,
        "created_at": to_local_str(node.created_at) or None,
    }


def _product_template_dict(t: ProductDocTemplate) -> dict:
    return {
        "id": t.id,
        "product_line": t.product_line,
        "product_id": t.product_id,
        "stage_type": t.stage_type or "通用",
        "doc_name": t.doc_name,
        "sort_order": t.sort_order,
        "description": t.description,
        "responsible_role": t.responsible_role,
        "doc_path": t.doc_path or "",
        "base_path": t.base_path or "",
        "file_pattern": t.file_pattern or "",
        "doc_type": t.doc_type or "",
        "is_optional": bool(t.is_optional),
    }


# ---------------------------------------------------------------------------
# Product Documents — per-product doc instances from templates
# ---------------------------------------------------------------------------

def get_or_init_product_documents(db: Session, product_id: int) -> list[dict]:
    """Sync product document instances from templates, return with status.
    Each template generates one ProductDocument row for this product.
    Existing rows preserve their status/location/upload info on re-sync."""
    from backend.models.document import ProductDocTemplate, ProductDocument
    from backend.models.zentao import PmaProduct, ProductNodeLink

    # Find which L2 nodes this product is linked to
    links = db.query(ProductNodeLink).filter(ProductNodeLink.product_id == product_id).all()
    if not links:
        return []

    product = db.query(PmaProduct).filter(PmaProduct.id == product_id).first()
    product_code = (product.code or "") if product else ""

    results = []
    for link in links:
        templates = db.query(ProductDocTemplate).filter(
            ProductDocTemplate.product_id == link.product_node_id
        ).order_by(ProductDocTemplate.sort_order).all()

        for tpl in templates:
            # Derive actual product path from base_path + file_pattern with * = product_code
            if tpl.base_path and tpl.file_pattern:
                base = tpl.base_path.replace("{code}", product_code) if product_code else tpl.base_path
                pattern = tpl.file_pattern.replace("{code}", product_code) if product_code else tpl.file_pattern
                actual_path = base.rstrip("/") + "/" + pattern.lstrip("/")
            else:
                template_path = tpl.doc_path or ""
                actual_path = template_path

            # Find existing doc instance (skip soft-deleted)
            existing = db.query(ProductDocument).filter(
                ProductDocument.product_id == product_id,
                ProductDocument.template_id == tpl.id,
                or_(ProductDocument.is_removed == 0, ProductDocument.is_removed == None),
            ).first()

            if not existing:
                # Check if a removed doc exists (user explicitly removed it) — skip recreation
                removed = db.query(ProductDocument).filter(
                    ProductDocument.product_id == product_id,
                    ProductDocument.template_id == tpl.id,
                    ProductDocument.is_removed == 1,
                ).first()
                if removed:
                    continue
                existing = ProductDocument(
                    product_id=product_id,
                    template_id=tpl.id,
                    stage_type=tpl.stage_type or "通用",
                    doc_name=tpl.doc_name,
                    sort_order=tpl.sort_order,
                    responsible_role=tpl.responsible_role,
                    description=tpl.description,
                    doc_path=actual_path,
                    doc_type=tpl.doc_type or "",
                    status="pending",
                    is_optional=bool(tpl.is_optional),
                )
                db.add(existing)
                db.flush()
            else:
                # Update template-derived fields (but preserve user-set status/location)
                existing.doc_name = tpl.doc_name
                existing.stage_type = tpl.stage_type or "通用"
                existing.sort_order = tpl.sort_order
                existing.responsible_role = tpl.responsible_role
                existing.description = tpl.description
                existing.doc_type = tpl.doc_type or existing.doc_type or ""
                existing.is_optional = bool(tpl.is_optional)
                # Always sync doc_path from template (location is user-uploaded path, independent)
                existing.doc_path = actual_path

            done = existing.status == "submitted"
            warn = existing.status == "pending"
            # Check if location matches template pattern
            mismatch = ""
            if existing.location and (tpl.base_path or tpl.file_pattern):
                import re as _re
                # If doc_path already contains regex patterns (e.g. \d{4}), use it directly
                pat = existing.doc_path
                has_regex = bool(_re.search(r'\\d\{', pat))
                if not has_regex:
                    # Convert template placeholders to regex
                    pat = _re.escape(pat)
                    pat = pat.replace(r'\{code\}', _re.escape(product_code or ''))
                    pat = pat.replace(r'\{YYYY\}', r'\d{4}')
                    pat = pat.replace(r'\{MM\}', r'\d{2}')
                    pat = pat.replace(r'\{DD\}', r'\d{2}')
                    pat = pat.replace(r'\{YY\}', r'\d{2}')
                # Also handle SVN wildcards * and ?
                pat = pat.replace(r'\*', '.*')
                pat = pat.replace(r'\?', '.')
                try:
                    if not _re.match(pat, existing.location):
                        mismatch = f"路径与模板不匹配（期望: {existing.doc_path}）"
                except _re.error:
                    if existing.location != existing.doc_path:
                        mismatch = f"路径与模板不匹配（期望: {existing.doc_path}）"
            elif existing.location and existing.doc_path and ('*' in existing.doc_path or '?' in existing.doc_path):
                mismatch = f"路径包含通配符，无法校验（模板: {existing.doc_path}）"
            results.append({
                "id": existing.id,
                "template_id": tpl.id,
                "doc_name": existing.doc_name,
                "sort_order": existing.sort_order,
                "stage_type": existing.stage_type or "通用",
                "description": existing.description or "",
                "responsible_role": existing.responsible_role or "",
                "doc_path": actual_path,
                "doc_type": existing.doc_type or tpl.doc_type or "",
                "status": existing.status,
                "done": done,
                "warn": warn,
                "is_optional": bool(existing.is_optional),
                "is_removed": bool(existing.is_removed),
                "location": existing.location or "",
                "mismatch": mismatch,
                "uploaded_by": existing.uploaded_by or "",
                "uploaded_at": to_local_str(existing.uploaded_at) if existing.uploaded_at else "",
                "completed_at": to_local_str(existing.completed_at) if existing.completed_at else "",
                "updated_by": existing.updated_by or "",
                "updated_at": to_local_str(existing.updated_at) if existing.updated_at else "",
                "svn_author": existing.svn_author or "",
                "svn_last_modified": existing.svn_last_modified or "",
                "svn_rev": existing.svn_rev or "",
                "node_name": "",  # filled below if needed
            })

    # Cleanup: remove doc instances for templates that no longer exist
    if links:
        all_template_ids = set()
        for link in links:
            tpls = db.query(ProductDocTemplate).filter(
                ProductDocTemplate.product_id == link.product_node_id
            ).all()
            for t in tpls:
                all_template_ids.add(t.id)
        if all_template_ids:
            stale = db.query(ProductDocument).filter(
                ProductDocument.product_id == product_id,
                ~ProductDocument.template_id.in_(all_template_ids),
            ).delete()

    db.commit()
    return results


# ---------------------------------------------------------------------------
# PMA Tags — label library for products and projects
# ---------------------------------------------------------------------------

def get_all_tags(db: Session) -> list[dict]:
    tags = db.query(PmaTag).order_by(PmaTag.category, PmaTag.name).all()
    return [_tag_dict(t) for t in tags]


def create_tag(db: Session, data: dict) -> dict:
    tag = PmaTag(**data)
    db.add(tag)
    db.commit()
    return _tag_dict(tag)


def update_tag(db: Session, tag_id: int, data: dict) -> Optional[dict]:
    tag = db.query(PmaTag).filter(PmaTag.id == tag_id).first()
    if not tag:
        return None
    for k, v in data.items():
        if hasattr(tag, k) and v is not None:
            setattr(tag, k, v)
    db.commit()
    return _tag_dict(tag)


def delete_tag(db: Session, tag_id: int) -> bool:
    tag = db.query(PmaTag).filter(PmaTag.id == tag_id).first()
    if not tag:
        return False
    db.delete(tag)
    db.commit()
    return True


def _tag_dict(t: PmaTag) -> dict:
    return {
        "id": t.id,
        "name": t.name,
        "category": t.category,
        "created_at": to_local_str(t.created_at) or None,
    }
