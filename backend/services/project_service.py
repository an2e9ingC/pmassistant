from __future__ import annotations
from typing import Optional

from sqlalchemy.orm import Session

import re

from backend.config import settings, zentao_project_url, zentao_product_url
from backend.models.zentao import (
    CachedProject, CachedExecution, CachedTask, CachedProduct, ProductProjectLink,
    CustomerProjectLink, CachedCustomer,
)
from backend.models.document import ProjectDocument
from backend.models.local import ProjectActivity
from backend.services.document_service import _match_stage_type, get_stage_types_for_project


def log_project_activity(db: Session, project_id: int, username: str, action: str, detail: str = ""):
    """Log a project activity (non-deletable audit trail)."""
    try:
        db.add(ProjectActivity(project_id=project_id, username=username, action=action, detail=detail or ""))
        db.commit()
    except Exception:
        pass  # never fail the main operation


def _get_pending_doc_counts(db: Session, project_ids: list[int]) -> dict:
    """Return {project_id: bool} — True if project has pending docs for done/closed stages."""
    if not project_ids:
        return {}
    from backend.models.document import ProjectDocument
    rows = (
        db.query(ProjectDocument.project_id)
        .join(CachedExecution, ProjectDocument.execution_id == CachedExecution.id)
        .filter(
            ProjectDocument.project_id.in_(project_ids),
            ProjectDocument.execution_id > 0,
            ProjectDocument.status == "pending",
            CachedExecution.status.in_(["done", "closed"]),
        )
        .distinct()
        .all()
    )
    return {row[0]: True for row in rows}


def _get_incomplete_task_counts(db: Session, project_ids: list[int]) -> dict:
    """Return {project_id: bool} — True if project has tasks not done/closed (not 100%)."""
    if not project_ids:
        return {}
    rows = (
        db.query(CachedTask.project_id)
        .filter(
            CachedTask.project_id.in_(project_ids),
            CachedTask.status.notin_(["done", "closed"]),
        )
        .distinct()
        .all()
    )
    return {row[0]: True for row in rows}


def _get_stage_anomaly_counts(db: Session, project_ids: list[int]) -> dict:
    """Return {project_id: bool} — True if any execution has stage-level anomalies.

    A stage is anomalous if ANY of:
    1. Name match is fuzzy or unmatched (not exact)
    2. Stage is overdue (end < today, not done/closed)
    """
    if not project_ids:
        return {}
    from datetime import date
    from backend.services.document_service import _match_stage_type, get_stage_types_for_project

    anomalous: set[int] = set()
    today = date.today()

    # Check each project's executions for non-exact matches and overdue
    projects = db.query(CachedProject).filter(CachedProject.id.in_(project_ids)).all()
    for p in projects:
        standard_stages = get_stage_types_for_project(p.project_type or "RD", db)
        executions = db.query(CachedExecution).filter(
            CachedExecution.project_id == p.id
        ).all()
        for e in executions:
            # Check 1: non-exact stage name match
            name = (e.name or "").strip()
            if name:
                result = _match_stage_type(name, standard_stages)
                if result is None or result[1] != "exact":
                    anomalous.add(p.id)
                    break  # one anomaly is enough for this project

            # Check 2: overdue (end date passed, not done/closed)
            if e.end and e.status not in ("done", "closed"):
                e_end = e.end if isinstance(e.end, date) else date.fromisoformat(str(e.end))
                if e_end < today:
                    anomalous.add(p.id)
                    break

    return {pid: True for pid in anomalous}


def get_projects(db: Session) -> list[dict]:
    projects = db.query(CachedProject).order_by(CachedProject.id).all()
    pids = [p.id for p in projects]
    pending_map = _get_pending_doc_counts(db, pids)
    incomplete_task_map = _get_incomplete_task_counts(db, pids)
    stage_anomaly_map = _get_stage_anomaly_counts(db, pids)
    # Batch-load linked customers
    cust_map = _batch_cust_map(db, pids)
    return [
        _project_brief(p,
            pending_map.get(p.id, False),
            incomplete_task_map.get(p.id, False),
            stage_anomaly_map.get(p.id, False),
            cust_map.get(p.id, []))
        for p in projects
    ]


def get_project_detail(db: Session, project_id: int) -> Optional[dict]:
    p = db.query(CachedProject).filter(CachedProject.id == project_id).first()
    if not p:
        return None
    pids = [p.id]
    pending_map = _get_pending_doc_counts(db, pids)
    incomplete_task_map = _get_incomplete_task_counts(db, pids)
    stage_anomaly_map = _get_stage_anomaly_counts(db, pids)
    cust_map = _batch_cust_map(db, pids)
    result = _project_detail(p, db,
        pending_map.get(p.id, False),
        incomplete_task_map.get(p.id, False),
        stage_anomaly_map.get(p.id, False),
        cust_map.get(p.id, []))
    result["linked_products"] = get_project_products(db, project_id)
    return result


def get_project_stages(db: Session, project_id: int) -> dict:
    """Return all standard stages as a template, with matched execution data.

    Each standard stage is rendered as a row. If a matching Zentao execution
    exists (fuzzy match), its data is filled in. Otherwise a placeholder with
    "阶段缺失" is shown.  Unmatched Zentao executions are appended at the end
    with a warning marker.
    """
    project = db.query(CachedProject).filter(CachedProject.id == project_id).first()
    # Sync project documents with latest templates (add/remove/update)
    from backend.services.document_service import _sync_from_templates
    _sync_from_templates(db, project_id, project.project_type or "RD")
    standard_stages = get_stage_types_for_project(project.project_type or "RD", db)

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
    """Build deliverables list for an execution from ProjectDocument table.
    Only includes docs with execution_id > 0 (excludes placeholder docs for unmatched stages)."""
    pd_rows = (
        db.query(ProjectDocument)
        .filter(ProjectDocument.execution_id == e.id,
                ProjectDocument.execution_id > 0)
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
    standard_stages = get_stage_types_for_project(project_type, db)

    # Init documents for matched stages (incremental)
    docs_list = get_or_init_project_documents(db, project_id, project_type)

    # Group existing docs by stage_type (standard stage name)
    grouped: dict[str, list[dict]] = {}
    for d in docs_list:
        st = d.get("stage_type") or "未分类"
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
    standard_stages = get_stage_types_for_project(project.project_type or "RD", db)

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

    # Add GitLab release links from associated products' cached releases
    from backend.models.zentao import CachedRelease
    product_ids = [lr.product_id for lr in link_records]
    if product_ids:
        releases = db.query(CachedRelease).filter(
            CachedRelease.product_id.in_(product_ids),
            CachedRelease.gitlab_url.isnot(None),
            CachedRelease.gitlab_url != "",
        ).order_by(CachedRelease.date.desc()).all()
        for r in releases:
            prod = db.query(CachedProduct).filter(CachedProduct.id == r.product_id).first()
            prod_name = prod.name if prod else f"产品#{r.product_id}"
            valid_suffix = " ✓" if r.gitlab_url_valid else (" ✗" if r.gitlab_url_valid is False else "")
            links.append({
                "label": f"Release - {prod_name} {r.name}{valid_suffix}",
                "url": r.gitlab_url,
                "description": f"{prod_name} 版本 {r.name} GitLab 发布链接",
            })

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

def _project_brief(p: CachedProject, has_pending_docs: bool = False, has_incomplete_tasks: bool = False, has_stage_anomalies: bool = False, linked_customers: list = None) -> dict:
    return {
        "id": p.id,
        "code": p.code,
        "name": p.name,
        "project_type": p.project_type,
        "customer_name": _resolve_customer(p, linked_customers or []),
        "status": _map_status(p.status, has_pending_docs, has_incomplete_tasks, has_stage_anomalies),
        "progress": p.progress,
        "begin": str(p.begin) if p.begin else None,
        "end": str(p.end) if p.end else None,
        "risk_level": _calc_risk_level(p, has_pending_docs, has_incomplete_tasks, has_stage_anomalies),
    }


def _calc_risk_level(p: CachedProject, has_pending_docs: bool = False, has_incomplete_tasks: bool = False, has_stage_anomalies: bool = False) -> str:
    """Calculate project risk level based on progress vs remaining time."""
    from datetime import date
    if p.status in ("done", "closed"):
        return "incomplete" if (has_pending_docs or has_incomplete_tasks or has_stage_anomalies) else "normal"
    if not p.begin or not p.end:
        return "normal"
    try:
        progress = float(p.progress or 0)
    except (ValueError, TypeError):
        progress = 0
    today = date.today()
    begin = p.begin if isinstance(p.begin, date) else date.fromisoformat(str(p.begin))
    end = p.end if isinstance(p.end, date) else date.fromisoformat(str(p.end))
    total_days = (end - begin).days
    if total_days <= 0:
        return "normal"
    elapsed_days = (today - begin).days
    elapsed_pct = max(0, min(100, elapsed_days / total_days * 100))
    gap = elapsed_pct - progress
    if today > end and progress < 100:
        return "overdue"
    if gap <= 0:
        return "normal"
    if gap <= 15:
        return "low"
    if gap <= 30:
        return "medium"
    return "high"


def _resolve_customer(p: CachedProject, linked_customers: list = None) -> str:
    """Return customer from linked customers only (p.customer_name is deprecated)."""
    return "、".join(linked_customers or []) if linked_customers else ""


def _batch_cust_map(db: Session, project_ids: list[int]) -> dict:
    """Batch-load linked customer names for multiple projects.
    Returns {project_id: [customer_name, ...]}."""
    cust_map = {}
    if not project_ids:
        return cust_map
    links = db.query(CustomerProjectLink).filter(CustomerProjectLink.project_id.in_(project_ids)).all()
    if links:
        cids = set(l.customer_id for l in links)
        cnames = {c.id: c.name for c in db.query(CachedCustomer).filter(CachedCustomer.id.in_(cids)).all()}
        for l in links:
            name = cnames.get(l.customer_id)
            if name:
                cust_map.setdefault(l.project_id, []).append(name)
    return cust_map


def _project_detail(p: CachedProject, db: Session, has_pending_docs: bool = False, has_incomplete_tasks: bool = False, has_stage_anomalies: bool = False, linked_customers: list = None) -> dict:
    # Use PMA local tags instead of Zentao description
    tags_str = p.tags or ""
    tags_list = [t.strip() for t in tags_str.split(",") if t.strip()]

    # Resolve linked project IDs to basic info
    linked_projects = []
    if p.linked_project_ids:
        try:
            linked_ids = [int(x.strip()) for x in p.linked_project_ids.split(",") if x.strip()]
            if linked_ids:
                linked_rows = db.query(CachedProject).filter(CachedProject.id.in_(linked_ids)).all()
                linked_map = {r.id: r for r in linked_rows}
                linked_projects = [
                    {"id": pid, "name": linked_map[pid].name, "code": linked_map[pid].code or ""}
                    for pid in linked_ids if pid in linked_map
                ]
        except Exception:
            pass

    return {
        "id": p.id,
        "code": p.code,
        "name": p.name,
        "model": p.model,
        "project_type": p.project_type,
        "status": _map_status(p.status, has_pending_docs, has_incomplete_tasks, has_stage_anomalies),
        "raw_status": p.status or "",
        "begin": str(p.begin) if p.begin else None,
        "end": str(p.end) if p.end else None,
        "real_began": str(p.real_began) if p.real_began else None,
        "real_end": str(p.real_end) if p.real_end else None,
        "progress": p.progress,
        "estimate": p.estimate,
        "consumed": p.consumed,
        "pm_name": p.pm_name,
        "customer_name": _resolve_customer(p, linked_customers or []),
        "program_name": p.program_name or "",
        "background": p.background or "",
        "description": p.description or "",
        "tags": tags_str,
        "tags_list": tags_list,
        "linked_project_ids": p.linked_project_ids or "",
        "linked_projects": linked_projects,
        "planned_delivery_qty": p.planned_delivery_qty or 0,
        "delivery_note": p.delivery_note or "",
        "is_local": bool(p.is_local),
        "zentao_url": _zentao_url("project", p.id) if not p.is_local else None,
    }


def _map_status(status: str, has_pending_docs: bool = False, has_incomplete_tasks: bool = False, has_stage_anomalies: bool = False) -> str:
    """Map Zentao raw status to PMA display status.

    PMA-level project completion requires ALL four conditions:
    1. Zentao project status is done/closed
    2. All documents for done/closed stages are submitted
    3. All tasks are done/closed (100% completion)
    4. All stages are normal (exact name match, no overdue stages)
    If ANY condition fails → 'incomplete' (待完善)."""
    if status in ("done", "closed"):
        if has_pending_docs or has_incomplete_tasks or has_stage_anomalies:
            return "incomplete"
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
