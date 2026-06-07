from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from backend.models.document import DocumentTemplate, ProjectDocument
from backend.models.zentao import CachedExecution

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
    """Return all templates grouped by stage_type, sorted by sort_order."""
    templates = db.query(DocumentTemplate).order_by(
        DocumentTemplate.stage_type, DocumentTemplate.sort_order
    ).all()
    grouped: dict[str, list[dict]] = {}
    for t in templates:
        grouped.setdefault(t.stage_type, []).append(_template_dict(t))
    return grouped


def get_stage_types(db: Session) -> list[str]:
    """Return distinct stage types that have templates configured."""
    rows = db.query(DocumentTemplate.stage_type).distinct().order_by(
        DocumentTemplate.stage_type
    ).all()
    return [r[0] for r in rows]


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
    _init_from_templates(db, project_id, project_type)
    return _query_project_documents(db, project_id)


def _init_from_templates(db: Session, project_id: int, project_type: str = "RD") -> None:
    """Create ProjectDocument rows from templates for matched executions.

    Incremental: skips executions that already have documents.
    """
    standard_stages = get_stage_types_for_project(project_type)

    executions = (
        db.query(CachedExecution)
        .filter(CachedExecution.project_id == project_id)
        .order_by(CachedExecution.id)
        .all()
    )

    new_count = 0
    for e in executions:
        # Priority: PMA-local stage_name > Zentao name
        stage_name = (e.name or "").strip()
        if not stage_name:
            continue
        result = _match_stage_type(stage_name, standard_stages)
        if not result:
            continue
        matched_type = result[0]  # stage type name

        # Skip if this execution already has documents
        already = db.query(ProjectDocument).filter(
            ProjectDocument.execution_id == e.id
        ).count()
        if already > 0:
            continue

        # Copy templates for this stage type
        templates = (
            db.query(DocumentTemplate)
            .filter(DocumentTemplate.stage_type == matched_type)
            .order_by(DocumentTemplate.sort_order)
            .all()
        )
        for tpl in templates:
            pd = ProjectDocument(
                project_id=project_id,
                execution_id=e.id,
                stage_type=matched_type,
                doc_name=tpl.doc_name,
                sort_order=tpl.sort_order,
                status="pending",
                responsible_role=tpl.responsible_role,
                description=tpl.description,
            )
            db.add(pd)
            new_count += 1
    if new_count > 0:
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
    """Return all ProjectDocument rows for a project with computed warn flag."""
    rows = (
        db.query(ProjectDocument, CachedExecution.status.label("exec_status"))
        .join(CachedExecution, CachedExecution.id == ProjectDocument.execution_id)
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
