from __future__ import annotations
from typing import Optional

from sqlalchemy.orm import Session

import re

from backend.config import settings, zentao_project_url, zentao_product_url
from backend.models.zentao import (
    CachedProject, CachedExecution, CachedTask, CachedProduct, ProductProjectLink,
)
from backend.models.document import ProjectDocument
from backend.services.document_service import _match_stage_type, get_stage_types_for_project


def get_projects(db: Session) -> list[dict]:
    projects = db.query(CachedProject).order_by(CachedProject.id).all()
    return [_project_brief(p) for p in projects]


def get_project_detail(db: Session, project_id: int) -> Optional[dict]:
    p = db.query(CachedProject).filter(CachedProject.id == project_id).first()
    if not p:
        return None
    return _project_detail(p)


def get_project_stages(db: Session, project_id: int) -> dict:
    """Return all standard stages as a template, with matched execution data.

    Each standard stage is rendered as a row. If a matching Zentao execution
    exists (fuzzy match), its data is filled in. Otherwise a placeholder with
    "阶段缺失" is shown.  Unmatched Zentao executions are appended at the end
    with a warning marker.
    """
    project = db.query(CachedProject).filter(CachedProject.id == project_id).first()
    standard_stages = get_stage_types_for_project(project.project_type or "RD")

    executions = (
        db.query(CachedExecution)
        .filter(CachedExecution.project_id == project_id)
        .order_by(CachedExecution.id)
        .all()
    )

    # Phase 1: map each execution to a standard stage (fuzzy match)
    # An execution can match at most one standard stage (best match).
    matched_execs: dict[str, list] = {}  # standard_stage -> [executions]
    unmatched_execs = []

    for e in executions:
        actual_name = (e.name or "").strip()
        result = _match_stage_type(actual_name, standard_stages) if actual_name else None
        if result:
            st = result[0]
            matched_execs.setdefault(st, []).append((e, result[1]))
        else:
            unmatched_execs.append(e)

    from backend.config import get_zentao_web_base
    web_base = get_zentao_web_base()
    stages = []

    # Phase 2: render standard stages in order
    for st in standard_stages:
        group = matched_execs.get(st, [])
        if group:
            for e, match_kind in group:
                tasks = (
                    db.query(CachedTask)
                    .filter(CachedTask.execution_id == e.id)
                    .order_by(CachedTask.id)
                    .all()
                )
                deliverables = _build_deliverables(db, e)
                who = _get_who(tasks, e, project) or "未指派"
                stages.append({
                    "id": e.id,
                    "name": e.name,
                    "execution_url": f"{web_base}/index.php?m=execution&f=task&executionID={e.id}&status=all&param=0&orderBy=status,id_desc&recTotal=10&recPerPage=100",
                    "status": _map_status(e.status),
                    "who": who,
                    "start": str(e.begin) if e.begin else None,
                    "end": str(e.end) if e.end else None,
                    "completed_date": str(e.end) if e.status in ("done", "closed") else None,
                    "progress": e.progress,
                    "blocker": _find_blocker(tasks),
                    "match_status": "matched",
                    "match_kind": match_kind,  # "exact" or "fuzzy"
                    "standard_stage": st,
                    "deliverables": deliverables,
                })
        else:
            # Standard stage with no matching execution
            stages.append({
                "id": None,
                "name": st,
                "execution_url": None,
                "status": "missing",
                "who": None,
                "start": None,
                "end": None,
                "completed_date": None,
                "progress": None,
                "blocker": None,
                "match_status": "missing",
                "match_kind": None,
                "standard_stage": st,
                "deliverables": [],
            })

    # Phase 3: append unmatched Zentao executions at the end
    for e in unmatched_execs:
        tasks = (
            db.query(CachedTask)
            .filter(CachedTask.execution_id == e.id)
            .order_by(CachedTask.id)
            .all()
        )
        who = _get_who(tasks, e, project) or "未指派"
        stages.append({
            "id": e.id,
            "name": e.name,
            "execution_url": f"{web_base}/index.php?m=execution&f=task&executionID={e.id}&status=all&param=0&orderBy=status,id_desc&recTotal=10&recPerPage=100",
            "status": _map_status(e.status),
            "who": who,
            "start": str(e.begin) if e.begin else None,
            "end": str(e.end) if e.end else None,
            "completed_date": str(e.end) if e.status in ("done", "closed") else None,
            "progress": e.progress,
            "blocker": _find_blocker(tasks),
            "match_status": "unmatched",
            "match_kind": None,
            "standard_stage": None,
            "deliverables": [],
        })

    return {"stages": stages, "standard_stages": standard_stages}


def _build_deliverables(db: Session, e: CachedExecution) -> list[dict]:
    """Build deliverables list for an execution from ProjectDocument table."""
    pd_rows = (
        db.query(ProjectDocument)
        .filter(ProjectDocument.execution_id == e.id)
        .order_by(ProjectDocument.sort_order)
        .all()
    )
    deliverables = []
    for pd in pd_rows:
        is_done = e.status in ("done", "closed")
        is_pending = pd.status == "pending"
        deliverables.append({
            "id": pd.id,
            "name": pd.doc_name,
            "done": pd.status == "submitted",
            "warn": is_done and is_pending,
            "completed_at": str(pd.completed_at)[:10] if pd.completed_at else None,
            "location": pd.location,
            "responsible_role": pd.responsible_role,
        })
    return deliverables


def get_project_documents(db: Session, project_id: int) -> dict:
    """Return documents grouped by standard stage, showing all standard stages.

    Standard stages with no documents are shown as empty placeholders
    so the frontend can render the complete template.
    """
    from backend.services.document_service import get_or_init_project_documents, get_stage_types_for_project

    project = db.query(CachedProject).filter(CachedProject.id == project_id).first()
    project_type = project.project_type if project else "RD"
    standard_stages = get_stage_types_for_project(project_type)

    # Init documents for matched stages (incremental)
    docs_list = get_or_init_project_documents(db, project_id, project_type)

    # Group existing docs by stage_name
    grouped: dict[str, list[dict]] = {}
    for d in docs_list:
        st = d.get("stage_name") or "未分类"
        grouped.setdefault(st, []).append(d)

    # Build result: one entry per standard stage (in order)
    from backend.config import get_zentao_web_base
    web_base = get_zentao_web_base()

    # Also collect match status from executions (for display consistency with stages tab)
    executions = db.query(CachedExecution).filter(
        CachedExecution.project_id == project_id
    ).all()
    exec_match: dict[str, dict] = {}
    for e in executions:
        actual_name = (e.name or "").strip()
        result2 = _match_stage_type(actual_name, standard_stages) if actual_name else None
        if result2:
            st2 = result2[0]
            if st2 not in exec_match:
                exec_match[st2] = {"match_kind": result2[1], "exec_id": e.id}

    result = []
    for st in standard_stages:
        items = grouped.get(st, [])
        em = exec_match.get(st, {})
        exec_id = items[0].get("execution_id") if items else em.get("exec_id")
        scd = items[0].get("stage_completed_date") if items else None
        exec_url = f"{web_base}/index.php?m=execution&f=task&executionID={exec_id}&status=all&param=0&orderBy=status,id_desc&recTotal=10&recPerPage=100" if exec_id else None
        has_exec = st in exec_match
        result.append({
            "stage_name": st,
            "stage_completed_date": scd,
            "has_documents": len(items) > 0,
            "has_execution": has_exec,
            "match_kind": em.get("match_kind") if has_exec else None,  # "exact" | "fuzzy" | None
            "execution_id": exec_id,
            "execution_url": exec_url,
            "documents": items,
        })

    return {"documents": result, "standard_stages": standard_stages}


def get_project_gantt(db: Session, project_id: int) -> dict:
    """Return gantt data with standard stages as the template.

    Matched executions fill in real data; missing stages show placeholders.
    """
    project = db.query(CachedProject).filter(CachedProject.id == project_id).first()
    standard_stages = get_stage_types_for_project(project.project_type or "RD")

    executions = (
        db.query(CachedExecution)
        .filter(CachedExecution.project_id == project_id)
        .order_by(CachedExecution.id)
        .all()
    )

    # Map executions to standard stages (fuzzy match)
    matched_execs: dict[str, list] = {}
    unmatched_execs = []
    for e in executions:
        actual_name = (e.name or "").strip()
        result = _match_stage_type(actual_name, standard_stages) if actual_name else None
        if result:
            matched_execs.setdefault(result[0], []).append((e, result[1]))
        else:
            unmatched_execs.append(e)

    gantt_stages = []
    # Standard stages in order
    for st in standard_stages:
        group = matched_execs.get(st, [])
        if group:
            for e, match_kind in group:
                tasks = (
                    db.query(CachedTask)
                    .filter(CachedTask.execution_id == e.id)
                    .all()
                )
                who = _get_who(tasks, e, project) or "未指派"
                tasks_done = sum(1 for t in tasks if t.status in ("done", "closed"))
                gantt_stages.append({
                    "name": e.name,
                    "standard_stage": st,
                    "who": who,
                    "start": str(e.begin) if e.begin else None,
                    "end": str(e.end) if e.end else None,
                    "status": _map_status(e.status),
                    "progress": e.progress,
                    "completed_date": str(e.end) if e.status in ("done", "closed") else None,
                    "blocker": _find_blocker(tasks),
                    "tasks_done": tasks_done,
                    "tasks_total": len(tasks),
                    "match_status": "matched",
                    "match_kind": match_kind,
                })
        else:
            gantt_stages.append({
                "name": st,
                "standard_stage": st,
                "who": None,
                "start": None,
                "end": None,
                "status": "missing",
                "progress": "0",
                "completed_date": None,
                "blocker": None,
                "tasks_done": 0,
                "tasks_total": 0,
                "match_status": "missing",
                "match_kind": None,
            })

    # Append unmatched executions
    for e in unmatched_execs:
        tasks = (
            db.query(CachedTask)
            .filter(CachedTask.execution_id == e.id)
            .all()
        )
        who = _get_who(tasks, e, project) or "未指派"
        tasks_done = sum(1 for t in tasks if t.status in ("done", "closed"))
        gantt_stages.append({
            "name": e.name,
            "standard_stage": None,
            "who": who,
            "start": str(e.begin) if e.begin else None,
            "end": str(e.end) if e.end else None,
            "status": _map_status(e.status),
            "progress": e.progress,
            "completed_date": str(e.end) if e.status in ("done", "closed") else None,
            "blocker": _find_blocker(tasks),
            "tasks_done": tasks_done,
            "tasks_total": len(tasks),
            "match_status": "unmatched",
            "match_kind": None,
        })

    return {
        "project_begin": str(project.begin) if project and project.begin else None,
        "project_end": str(project.end) if project and project.end else None,
        "stages": gantt_stages,
    }


def get_project_delivery(db: Session, project_id: int) -> dict:
    from backend.services.delivery_service import get_delivery_summary
    return get_delivery_summary(db, project_id)


def get_project_resources(db: Session, project_id: int) -> list[dict]:
    # Build web UI base URL from API base URL (strip /api.php/v1 suffix)
    zentao_web_base = re.sub(r"/api\.php/v1$", "", settings.ZENTAO_BASE_URL)
    links = [
        {"label": "禅道项目页面", "url": f"{zentao_web_base}/project-index-{project_id}.html", "description": "查看禅道项目详情"},
        {"label": "GitLab 仓库", "url": "http://192.168.0.128/", "description": "代码仓库和发布管理"},
    ]
    # Add product NAS/Git links
    link_records = (
        db.query(ProductProjectLink)
        .filter(ProductProjectLink.project_id == project_id)
        .all()
    )
    for lr in link_records:
        prod = db.query(CachedProduct).filter(CachedProduct.id == lr.product_id).first()
        if prod:
            if prod.nas_path:
                links.append({"label": f"NAS - {prod.name}", "url": prod.nas_path, "description": f"{prod.name} 硬件资料"})
            if prod.git_url:
                links.append({"label": f"Git - {prod.name}", "url": prod.git_url, "description": f"{prod.name} 代码仓库"})
    return links


def get_project_products(db: Session, project_id: int) -> list[dict]:
    link_records = (
        db.query(ProductProjectLink)
        .filter(ProductProjectLink.project_id == project_id)
        .all()
    )
    products = []
    for lr in link_records:
        prod = db.query(CachedProduct).filter(CachedProduct.id == lr.product_id).first()
        if prod:
            products.append({
                "id": prod.id,
                "name": prod.name,
                "code": prod.code,
                "category": prod.program_name or prod.category,
                "program_name": prod.program_name,
                "nas_path": prod.nas_path,
                "git_url": prod.git_url,
            })
    return products


# --- helpers ---

def _project_brief(p: CachedProject) -> dict:
    return {
        "id": p.id,
        "code": p.code,
        "name": p.name,
        "project_type": p.project_type,
        "customer_name": _resolve_customer(p),
        "status": _map_status(p.status),
    }


def _resolve_customer(p: CachedProject) -> str:
    """Resolve customer from stored field, with on-the-fly fallback."""
    if p.customer_name:
        return p.customer_name
    # Fallback: parse project name PE0406-CDLY-xxx -> CDLY
    if p.name:
        parts = p.name.split("-")
        if len(parts) >= 2:
            import re
            second = parts[1].strip()
            if re.match(r"^[A-Z]{2,6}$", second):
                return second
    # Fallback: parse 【...】 from raw_json desc (strip HTML tags first)
    if p.raw_json:
        try:
            import re, json as _json
            data = _json.loads(p.raw_json)
            desc = data.get("desc", "") or ""
            plain = re.sub(r"<[^>]+>", "", desc)
            m = re.search(r"【([A-Z]{2,6})】", plain)
            if m:
                return m.group(1).strip()
        except Exception:
            pass
    return ""


def _project_detail(p: CachedProject) -> dict:
    # Extract description and customer【...】from raw_json
    desc = ""
    customer_from_desc = ""
    if p.raw_json:
        try:
            import json as _json
            import re as _re
            data = _json.loads(p.raw_json)
            desc = data.get("desc", "") or ""
            # Strip HTML tags before extracting customer
            plain = _re.sub(r"<[^>]+>", "", desc)
            m = _re.search(r"【([A-Z]{2,6})】", plain)
            if m:
                customer_from_desc = m.group(1).strip()
        except Exception:
            pass

    return {
        "id": p.id,
        "code": p.code,
        "name": p.name,
        "model": p.model,
        "project_type": p.project_type,
        "status": _map_status(p.status),
        "begin": str(p.begin) if p.begin else None,
        "end": str(p.end) if p.end else None,
        "real_began": str(p.real_began) if p.real_began else None,
        "real_end": str(p.real_end) if p.real_end else None,
        "progress": p.progress,
        "estimate": p.estimate,
        "consumed": p.consumed,
        "pm_name": p.pm_name,
        "pm_account": p.pm_account,
        "customer_name": p.customer_name,
        "alias_name": p.alias_name,
        "description": desc,
        "customer_from_desc": customer_from_desc,
        "zentao_url": _zentao_url("project", p.id),
    }


def _map_status(status: str) -> str:
    """Map Zentao raw status (wait/doing/done/closed/suspended) to PMA display status."""
    mapping = {
        "wait": "pending",
        "doing": "active",
        "done": "completed",
        "closed": "completed",
        "suspended": "blocked",
        "canceled": "canceled",
    }
    return mapping.get(status, "pending")


def _find_blocker(tasks: list[CachedTask]) -> Optional[str]:
    for t in tasks:
        if t.is_blocker and t.blocker_note:
            return t.blocker_note
        if t.is_blocker:
            return f"任务被标记为卡点: {t.name}"
    return None


def _get_who(tasks: list[CachedTask], execution: CachedExecution = None, project: CachedProject = None) -> str:
    """Get responsible persons from task assignees, deduplicated.
    Falls back: task assignees → execution openedBy → project PM → ''"""
    names = []
    seen = set()
    for t in tasks:
        name = (t.assigned_realname or "").strip()
        if name and name not in seen:
            names.append(name)
            seen.add(name)
    if names:
        return "、".join(names)
    # Fallback 1: execution's openedBy
    if execution and execution.raw_json:
        try:
            import json as _json
            data = _json.loads(execution.raw_json)
            ob = data.get("openedBy", {})
            if isinstance(ob, dict) and ob.get("realname"):
                return ob["realname"].strip()
        except Exception:
            pass
    # Fallback 2: project PM
    if project and project.pm_name:
        return project.pm_name.strip()
    return ""


def _zentao_url(entity_type: str, entity_id: int) -> str:
    if entity_type == "project":
        return zentao_project_url(entity_id)
    return zentao_product_url(entity_id)
