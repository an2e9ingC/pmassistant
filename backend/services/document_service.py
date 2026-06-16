from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from backend.database import to_local_str
from backend.models.document import DocumentTemplate, ProjectDocument, ProductDocTemplate, ProductLine, PmaTag
from backend.models.zentao import CachedExecution, CachedProject

# Standard stage names from requirements spec (Section 4.1 Project Lifecycle).
# These are the authoritative stage definitions; Zentao execution names must
# match one of these exactly (or have stage_name set to one of these).
#
# R&D project stages (10 stages):
RD_STAGE_TYPES = [
    "售前",
    "项目立项",
    "需求分解",
    "硬件开发",
    "结构设计",
    "BSP开发",
    "软件开发",
    "测试",
    "产品发货",
    "项目总结",
]

# Production project stages (8 stages) — no BSP开发 or 软件开发:
SC_STAGE_TYPES = [
    "售前",
    "项目立项",
    "需求分解",
    "硬件开发",
    "结构设计",
    "测试",
    "产品发货",
    "项目总结",
]

# Legacy — kept for template config page (ordered list of all unique stage types)
STAGE_TYPES = [
    "售前",
    "项目立项",
    "需求分解",
    "硬件开发",
    "结构设计",
    "BSP开发",
    "软件开发",
    "测试",
    "产品发货",
    "项目总结",
]


def get_stage_types_for_project(project_type: str) -> list[str]:
    """Return the standard stage list for a given project type."""
    if project_type == "SC":
        return SC_STAGE_TYPES
    return RD_STAGE_TYPES  # default: R&D

# Seed data: default document templates per stage type.
# These are inserted on first startup if the document_templates table is empty.
# Users can then modify them via the admin config UI.
SEED_TEMPLATES: list[dict] = [
    # 售前 — 导入需求、组织评估、立项决议
    {"stage_type": "售前", "doc_name": "技术需求书", "sort_order": 1, "responsible_role": "销售及售前", "description": "导入用户需求，整理技术需求文档，作为后续评估的基础输入"},
    {"stage_type": "售前", "doc_name": "技术可行性报告", "sort_order": 2, "responsible_role": "CTO", "description": "评估技术能否实现，包括技术方案、开发周期、技术风险等"},
    {"stage_type": "售前", "doc_name": "商务可行性报告", "sort_order": 3, "responsible_role": "CEO", "description": "评估项目投入产出比，判断是否具备商业可行性"},
    {"stage_type": "售前", "doc_name": "立项决议书", "sort_order": 4, "responsible_role": "销售及售前", "description": "综合结论及原因，明确是否立项，确定项目交付节点和项目类型（研发/生产）"},
    {"stage_type": "售前", "doc_name": "项目交付节点", "sort_order": 5, "responsible_role": "项目经理", "description": "明确各阶段交付时间节点，转研发项目或转生产项目的决策依据"},
    # 项目立项 — 创建项目、实施方案、启动会
    {"stage_type": "项目立项", "doc_name": "实施方案草案", "sort_order": 1, "responsible_role": "CTO", "description": "项目实施方案草案，包含技术路线、资源需求、风险评估"},
    {"stage_type": "项目立项", "doc_name": "项目启动会纪要", "sort_order": 2, "responsible_role": "项目经理", "description": "项目启动会决议，确认人力资源排布、项目周期计划"},
    # 需求分解 — 需求分解任务跟踪
    {"stage_type": "需求分解", "doc_name": "需求分解结果", "sort_order": 1, "responsible_role": "项目经理", "description": "各方向需求分解结果，对应禅道开发任务，用于跟踪执行进度"},
    # 硬件开发
    {"stage_type": "硬件开发", "doc_name": "硬件方案设计", "sort_order": 1, "responsible_role": "硬件开发", "description": "硬件整体方案设计文档，包含架构框图、关键器件选型说明"},
    {"stage_type": "硬件开发", "doc_name": "原理图", "sort_order": 2, "responsible_role": "硬件开发", "description": "电路原理图设计文件，需通过评审"},
    {"stage_type": "硬件开发", "doc_name": "PCB Layout", "sort_order": 3, "responsible_role": "硬件开发", "description": "PCB版图设计文件，包含叠层、阻抗、布线等设计说明"},
    {"stage_type": "硬件开发", "doc_name": "BOM清单", "sort_order": 4, "responsible_role": "硬件开发", "description": "物料清单，包含元器件型号、封装、数量、供应商等信息"},
    {"stage_type": "硬件开发", "doc_name": "硬件测试报告", "sort_order": 5, "responsible_role": "硬件测试", "description": "硬件调试和测试结果报告，包含功能测试、性能测试、可靠性测试"},
    # 软件开发
    {"stage_type": "软件开发", "doc_name": "软件需求规格说明书", "sort_order": 1, "responsible_role": "业务软件开发", "description": "软件需求规格文档，定义功能需求、性能需求、接口需求等"},
    {"stage_type": "软件开发", "doc_name": "概要设计说明书", "sort_order": 2, "responsible_role": "业务软件开发", "description": "软件架构设计文档，包含模块划分、接口定义、技术选型"},
    {"stage_type": "软件开发", "doc_name": "详细设计说明书", "sort_order": 3, "responsible_role": "业务软件开发", "description": "模块级详细设计文档，包含算法描述、数据结构、流程图"},
    {"stage_type": "软件开发", "doc_name": "测试用例", "sort_order": 4, "responsible_role": "测试交付", "description": "测试用例文档，覆盖功能测试、性能测试、异常测试等场景"},
    {"stage_type": "软件开发", "doc_name": "测试报告", "sort_order": 5, "responsible_role": "测试交付", "description": "测试执行结果报告，包含缺陷统计、测试覆盖率、结论"},
    # 结构设计
    {"stage_type": "结构设计", "doc_name": "结构设计报告", "sort_order": 1, "responsible_role": "结构设计及装配", "description": "结构设计方案文档，包含外观设计、散热方案、装配工艺等"},
    {"stage_type": "结构设计", "doc_name": "热设计报告", "sort_order": 2, "responsible_role": "结构设计及装配", "description": "热仿真分析和散热设计报告，确保设备在目标温度范围内正常工作"},
    # BSP开发
    {"stage_type": "BSP开发", "doc_name": "BSP移植说明", "sort_order": 1, "responsible_role": "BSP开发", "description": "BSP移植方案、驱动适配说明、内核配置等文档"},
    {"stage_type": "BSP开发", "doc_name": "BSP测试报告", "sort_order": 2, "responsible_role": "BSP开发", "description": "BSP功能测试、驱动验证、稳定性测试结果"},
    # 测试
    {"stage_type": "测试", "doc_name": "测试计划", "sort_order": 1, "responsible_role": "测试交付", "description": "测试计划文档，包含测试策略、测试范围、资源安排、进度计划"},
    {"stage_type": "测试", "doc_name": "测试报告", "sort_order": 2, "responsible_role": "测试交付", "description": "系统测试结果汇总，包含测试结论、遗留问题、交付建议"},
    # 产品发货
    {"stage_type": "产品发货", "doc_name": "发货清单", "sort_order": 1, "responsible_role": "项目经理", "description": "产品发货明细清单，包含产品编号、数量、收货方信息、发货日期"},
    # 项目总结
    {"stage_type": "项目总结", "doc_name": "项目总结报告", "sort_order": 1, "responsible_role": "项目经理", "description": "项目总结报告，包含目标达成情况、经验教训、改进建议"},
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


# ---------------------------------------------------------------------------
# Template CRUD (for config UI)
# ---------------------------------------------------------------------------

def get_templates_grouped(db: Session) -> dict:
    """Return all templates grouped by stage_type, sorted by sort_order.
    Includes all known stage types even if they have 0 templates."""
    templates = db.query(DocumentTemplate).order_by(
        DocumentTemplate.stage_type, DocumentTemplate.sort_order
    ).all()
    grouped: dict[str, list[dict]] = {}

    # Ensure all known stage types appear (even with empty list)
    for st in get_stage_types(db):
        grouped[st] = []

    for t in templates:
        grouped.setdefault(t.stage_type, []).append(_template_dict(t))
    return grouped


CUSTOM_STAGE_TYPES_KEY = "custom_stage_types"  # PmaSetting key, comma-separated


def _get_custom_stage_types(db: Session) -> list[str]:
    """Read persisted custom stage types from PmaSetting."""
    from backend.models.local import PmaSetting
    val = PmaSetting.get(db, CUSTOM_STAGE_TYPES_KEY, "")
    return [s.strip() for s in val.split(",") if s.strip()]


def _save_custom_stage_types(db: Session, stage_types: list[str]):
    """Persist custom stage types to PmaSetting."""
    from backend.models.local import PmaSetting
    val = ",".join(stage_types)
    PmaSetting.set(db, CUSTOM_STAGE_TYPES_KEY, val)


def get_stage_types(db: Session) -> list[str]:
    """Return all known stage types: predefined lifecycle stages + persisted custom ones.
    Stage types are the authoritative definition of project phases — they exist
    independently of whether any document templates are configured for them."""
    all_stages = list(dict.fromkeys(RD_STAGE_TYPES + SC_STAGE_TYPES))  # dedup preserving order

    # Include persisted custom stage types
    for st in _get_custom_stage_types(db):
        if st not in all_stages:
            all_stages.append(st)

    return all_stages


def create_template(db: Session, data: dict) -> dict:
    """Create a new document template."""
    tpl = DocumentTemplate(
        stage_type=data["stage_type"],
        doc_name=data["doc_name"],
        sort_order=data.get("sort_order", 0),
        description=data.get("description"),
        responsible_role=data.get("responsible_role"),
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
    for field in ("stage_type", "doc_name", "sort_order", "description", "responsible_role"):
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


def delete_stage_type(db: Session, stage_type: str) -> int:
    """Delete all templates for a stage type."""
    count = db.query(DocumentTemplate).filter(
        DocumentTemplate.stage_type == stage_type
    ).delete()
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
    }


# ---------------------------------------------------------------------------
# Project document lifecycle
# ---------------------------------------------------------------------------

def get_or_init_project_documents(db: Session, project_id: int, project_type: str = "RD") -> list[dict]:
    """Get project documents, initializing from templates on first access.

    Uses strict exact matching against standard stage names (per project type).
    Executions that don't match any standard stage are left without documents
    — they will be flagged as "阶段信息缺失" in the dashboard.

    Initialization is incremental: each execution is checked individually,
    so fixing a stage_name for a previously unmatched execution will
    immediately generate documents for it.
    """
    _sync_from_templates(db, project_id, project_type)
    return _query_project_documents(db, project_id)


def _sync_from_templates(db: Session, project_id: int, project_type: str = "RD") -> None:
    """Sync project documents with current templates: add new, remove obsolete.

    Two-phase sync:
    1. Matched executions: create/update/remove docs per template
    2. Unmatched standard stages: create docs with execution_id=0 so they
       appear in the doc-completeness tab even without a matching execution.

    Called on every document query so template changes propagate immediately.
    Preserves user-set status for documents that still exist in the template.
    """
    standard_stages = get_stage_types_for_project(project_type)

    executions = (
        db.query(CachedExecution)
        .filter(CachedExecution.project_id == project_id)
        .order_by(CachedExecution.id)
        .all()
    )

    changed = False
    matched_stages = set()
    matched_exec_ids = set()

    # Phase 1: sync per execution (matched stages only)
    for e in executions:
        stage_name = (e.name or "").strip()
        if not stage_name:
            continue
        result = _match_stage_type(stage_name, standard_stages)
        if not result:
            continue
        matched_type = result[0]
        matched_stages.add(matched_type)
        matched_exec_ids.add(e.id)

        templates = (
            db.query(DocumentTemplate)
            .filter(DocumentTemplate.stage_type == matched_type)
            .order_by(DocumentTemplate.sort_order)
            .all()
        )
        template_names = {t.doc_name: t for t in templates}

        existing_docs = (
            db.query(ProjectDocument)
            .filter(ProjectDocument.execution_id == e.id)
            .all()
        )

        # Deduplicate: keep only the first row per doc_name, delete extras
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

        for doc_name, tpl in template_names.items():
            if doc_name not in existing_names:
                pd = ProjectDocument(
                    project_id=project_id, execution_id=e.id,
                    stage_type=matched_type, doc_name=tpl.doc_name,
                    sort_order=tpl.sort_order, status="pending",
                    responsible_role=tpl.responsible_role, description=tpl.description,
                )
                db.add(pd)
                changed = True

        for doc_name, pd in existing_names.items():
            if doc_name not in template_names:
                db.delete(pd)
                changed = True

        for doc_name, pd in existing_names.items():
            tpl = template_names.get(doc_name)
            if tpl and (pd.sort_order != tpl.sort_order or
                        pd.responsible_role != tpl.responsible_role or
                        pd.description != tpl.description or
                        pd.stage_type != matched_type):
                pd.sort_order = tpl.sort_order
                pd.responsible_role = tpl.responsible_role
                pd.description = tpl.description
                pd.stage_type = matched_type
                changed = True

    # Phase 1 cleanup: remove orphaned docs from unmatched executions
    # (executions that previously matched a stage but no longer do)
    for e in executions:
        if e.id not in matched_exec_ids:
            orphaned = (
                db.query(ProjectDocument)
                .filter(ProjectDocument.execution_id == e.id)
                .all()
            )
            for pd in orphaned:
                db.delete(pd)
                changed = True

    # Phase 2: unmatched standard stages — init docs with execution_id=0
    for st in standard_stages:
        if st in matched_stages:
            # Stage is now matched — remove any leftover execution_id=0 placeholder
            # docs from a previous sync when this stage was unmatched.
            stale = (
                db.query(ProjectDocument)
                .filter(ProjectDocument.project_id == project_id,
                        ProjectDocument.stage_type == st,
                        ProjectDocument.execution_id == 0)
                .all()
            )
            for pd in stale:
                db.delete(pd)
                changed = True
            continue
        templates = (
            db.query(DocumentTemplate)
            .filter(DocumentTemplate.stage_type == st)
            .order_by(DocumentTemplate.sort_order)
            .all()
        )
        if not templates:
            continue
        template_names = {t.doc_name: t for t in templates}

        existing_docs = (
            db.query(ProjectDocument)
            .filter(ProjectDocument.project_id == project_id,
                    ProjectDocument.stage_type == st,
                    ProjectDocument.execution_id == 0)
            .all()
        )

        # Deduplicate: keep only the first row per doc_name, delete extras
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

        for doc_name, tpl in template_names.items():
            if doc_name not in existing_names:
                pd = ProjectDocument(
                    project_id=project_id, execution_id=0,
                    stage_type=st, doc_name=tpl.doc_name,
                    sort_order=tpl.sort_order, status="pending",
                    responsible_role=tpl.responsible_role, description=tpl.description,
                )
                db.add(pd)
                changed = True

        for doc_name, pd in existing_names.items():
            if doc_name not in template_names:
                db.delete(pd)
                changed = True

        for doc_name, pd in existing_names.items():
            tpl = template_names.get(doc_name)
            if tpl and (pd.sort_order != tpl.sort_order or
                        pd.responsible_role != tpl.responsible_role or
                        pd.description != tpl.description):
                pd.sort_order = tpl.sort_order
                pd.responsible_role = tpl.responsible_role
                pd.description = tpl.description
                changed = True

    if changed:
        db.commit()


# Keyword-based fallback mapping for common Zentao names that don't
# substring-match standard stage names directly.
_STAGE_KEYWORD_MAP = {
    "需求": "需求分解",
    "立项": "项目立项",
    "硬件": "硬件开发",
    "结构": "结构设计",
    "bsp": "BSP开发",
    "软件": "软件开发",
    "业务": "软件开发",
    "测试": "测试",
    "发货": "产品发货",
    "总结": "项目总结",
    "归档": "项目总结",
    "交付": "测试",  # last resort — will match "测试" if no other match
    "售前": "售前",
}


def _match_stage_type(stage_name: str, standard_stages: list[str]) -> Optional[tuple[str, str]]:
    """Match an execution stage_name against standard stages.

    Returns (matched_stage_type, match_kind) where match_kind is:
      - "exact": exact match
      - "fuzzy": substring or keyword match
    Returns None if no match at all.
    """
    if not stage_name:
        return None
    name = stage_name.strip()

    # 1. Exact match
    for st in standard_stages:
        if name == st:
            return (st, "exact")

    # 2. Substring match: standard stage contained in execution name
    for st in standard_stages:
        if st in name:
            return (st, "fuzzy")

    # 3. Substring match: execution name contained in standard stage
    for st in standard_stages:
        if name in st:
            return (st, "fuzzy")

    # 4. Keyword-based fallback
    name_lower = name.lower()
    for kw, st in _STAGE_KEYWORD_MAP.items():
        if kw in name_lower and st in standard_stages:
            return (st, "fuzzy")

    return None


def _query_project_documents(db: Session, project_id: int) -> list[dict]:
    """Return all ProjectDocument rows for a project with computed warn flag.
    Uses outer join to include execution_id=0 placeholder docs (unmatched stages)."""
    rows = (
        db.query(ProjectDocument, CachedExecution.status.label("exec_status"))
        .outerjoin(CachedExecution, CachedExecution.id == ProjectDocument.execution_id)
        .filter(ProjectDocument.project_id == project_id)
        .order_by(ProjectDocument.execution_id, ProjectDocument.sort_order)
        .all()
    )

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
                    str(e.end) if e.end else None
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
                str(exec_end_dates.get(pd_doc.execution_id) or pd_doc.completed_at)[:10]
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
            "completed_at": str(pd_doc.completed_at)[:10] if pd_doc.completed_at else None,
            "location": pd_doc.location,
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
        "completed_at": str(pd.completed_at)[:10] if pd.completed_at else None,
        "location": pd.location,
        "updated_by": pd.updated_by,
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


def create_product_template(db: Session, data: dict) -> dict:
    tpl = ProductDocTemplate(**data)
    db.add(tpl)
    db.commit()
    return _product_template_dict(tpl)


def update_product_template(db: Session, template_id: int, data: dict) -> Optional[dict]:
    tpl = db.query(ProductDocTemplate).filter(ProductDocTemplate.id == template_id).first()
    if not tpl:
        return None
    for k, v in data.items():
        if hasattr(tpl, k) and v is not None:
            setattr(tpl, k, v)
    db.commit()
    return _product_template_dict(tpl)


def delete_product_template(db: Session, template_id: int) -> bool:
    tpl = db.query(ProductDocTemplate).filter(ProductDocTemplate.id == template_id).first()
    if not tpl:
        return False
    db.delete(tpl)
    db.commit()
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
    }


# ---------------------------------------------------------------------------
# Product Documents — per-product doc instances from templates
# ---------------------------------------------------------------------------

def get_or_init_product_documents(db: Session, product_id: int) -> list[dict]:
    """Sync product document instances from templates, return with status.
    Each template generates one ProductDocument row for this product.
    Existing rows preserve their status/location/upload info on re-sync."""
    from backend.models.document import ProductDocTemplate, ProductDocument
    from backend.models.zentao import CachedProduct, ProductNodeLink

    # Find which L2 nodes this product is linked to
    links = db.query(ProductNodeLink).filter(ProductNodeLink.product_id == product_id).all()
    if not links:
        return []

    product = db.query(CachedProduct).filter(CachedProduct.id == product_id).first()
    product_code = (product.code or "") if product else ""

    results = []
    for link in links:
        templates = db.query(ProductDocTemplate).filter(
            ProductDocTemplate.product_id == link.product_node_id
        ).order_by(ProductDocTemplate.sort_order).all()

        for tpl in templates:
            # Derive actual product path: replace {code} placeholder if present
            template_path = tpl.doc_path or ""
            actual_path = template_path.replace("{code}", product_code) if product_code else template_path

            # Find existing doc instance
            existing = db.query(ProductDocument).filter(
                ProductDocument.product_id == product_id,
                ProductDocument.template_id == tpl.id,
            ).first()

            if not existing:
                existing = ProductDocument(
                    product_id=product_id,
                    template_id=tpl.id,
                    stage_type=tpl.stage_type or "通用",
                    doc_name=tpl.doc_name,
                    sort_order=tpl.sort_order,
                    responsible_role=tpl.responsible_role,
                    description=tpl.description,
                    doc_path=actual_path,
                    status="pending",
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
                existing.doc_path = actual_path

            done = existing.status == "submitted"
            warn = existing.status == "pending"
            results.append({
                "id": existing.id,
                "template_id": tpl.id,
                "doc_name": existing.doc_name,
                "sort_order": existing.sort_order,
                "stage_type": existing.stage_type or "通用",
                "description": existing.description or "",
                "responsible_role": existing.responsible_role or "",
                "doc_path": actual_path,
                "status": existing.status,
                "done": done,
                "warn": warn,
                "location": existing.location or "",
                "uploaded_by": existing.uploaded_by or "",
                "uploaded_at": to_local_str(existing.uploaded_at) if existing.uploaded_at else "",
                "completed_at": to_local_str(existing.completed_at) if existing.completed_at else "",
                "updated_by": existing.updated_by or "",
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
