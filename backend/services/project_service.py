from __future__ import annotations
from typing import Optional
import logging

from sqlalchemy.orm import Session

import re

from backend.config import settings, zentao_project_url, zentao_product_url
from backend.database import to_local_str
from backend.models.zentao import (
    CachedProject, CachedExecution, CachedTask, PmaProduct, ProductProjectLink,
    CustomerProjectLink, PmaCustomer,
)
from backend.models.document import ProjectDocument
from backend.models.local import ProjectActivity
from backend.services.document_service import get_stage_types_for_project_type

logger = logging.getLogger(__name__)


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
    from backend.services.document_service import get_stage_types_for_project_type

    anomalous: set[int] = set()
    today = date.today()

    # Check each project's executions for non-exact matches and overdue
    projects = db.query(CachedProject).filter(CachedProject.id.in_(project_ids)).all()
    for p in projects:
        standard_stages = get_stage_types_for_project_type(db, p.project_type or "RD")
        executions = db.query(CachedExecution).filter(
            CachedExecution.project_id == p.id
        ).all()
        for e in executions:
            # Check 1: non-exact stage name match
            name = (e.name or "").strip()
            if name:
                # stage matching always exact now — no fuzzy check needed
                result = None  # all stages are standard now
                if False:  # all stages are standard, no anomalies from fuzzy matching
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
    # Calculate project progress from stage averages
    stage_prog_map = _batch_stage_avg_progress(db, pids)
    return [
        _project_brief(p,
            pending_map.get(p.id, False),
            incomplete_task_map.get(p.id, False),
            stage_anomaly_map.get(p.id, False),
            cust_map.get(p.id, []),
            stage_prog_map.get(p.id))
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
    """Return project stages with PMA task progress. Reads from ProjectStage table."""
    from backend.models.project_stage import ProjectStage
    from backend.models.task import Task
    from backend.models.local import LocalUser

    stages_rows = db.query(ProjectStage).filter(
        ProjectStage.project_id == project_id
    ).order_by(ProjectStage.sort_order).all()

    # Fallback: if no ProjectStage rows exist, use template stage list directly
    if not stages_rows:
        project = db.query(CachedProject).filter(CachedProject.id == project_id).first()
        project_type = project.project_type or "RD" if project else "RD"
        standard_stages = get_stage_types_for_project_type(db, project_type)
        stages = []
        for st in standard_stages:
            tasks = db.query(Task).filter(
                Task.project_id == project_id,
                Task.stage_name == st,
            ).all()
            progs = [t.progress or 0 for t in tasks]
            avg_progress = round(sum(progs) / len(progs)) if progs else None
            stages.append({
                "id": None, "name": st,
                "status": "active", "who": None,
                "start": None, "end": None, "completed_date": None,
                "progress": avg_progress,
                "standard_stage": st,
                "task_count": len(tasks),
                "tasks_done": sum(1 for p in progs if p >= 100),
                "owner_id": None, "owner_name": None,
                "description": None, "sort_order": 0,
            })
        return {"stages": stages, "standard_stages": standard_stages}

    stages = []
    for s in stages_rows:
        # Tasks by stage_id first, fallback to stage_name match
        tasks = db.query(Task).filter(Task.stage_id == s.id).all()
        if not tasks:
            tasks = db.query(Task).filter(
                Task.project_id == project_id,
                Task.stage_name == s.name,
            ).all()
        progs = [t.progress or 0 for t in tasks]
        avg_progress = round(sum(progs) / len(progs)) if progs else None
        # Sync calculated progress back to DB
        if avg_progress is not None and avg_progress != (s.progress or 0):
            s.progress = avg_progress
            db.commit()
        owner_name = None
        if s.owner_id:
            owner = db.query(LocalUser).filter(LocalUser.id == s.owner_id).first()
            if owner:
                owner_name = owner.display_name or owner.username
        stages.append({
            "id": s.id,
            "name": s.name,
            "status": s.status,
            "who": owner_name,
            "start": str(s.start_date) if s.start_date else None,
            "end": str(s.end_date) if s.end_date else None,
            "completed_date": str(s.completed_date) if s.completed_date else None,
            "progress": avg_progress,
            "standard_stage": s.name,
            "task_count": len(tasks),
            "tasks_done": sum(1 for p in progs if p >= 100),
            "owner_id": s.owner_id,
            "owner_name": owner_name,
            "description": s.description,
            "sort_order": s.sort_order,
        })

    return {"stages": stages, "standard_stages": [s.name for s in stages_rows]}


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
            "completed_at": to_local_str(pd.completed_at)[:10] if pd.completed_at else None,
            "location": pd.location,
            "responsible_role": pd.responsible_role,
        })
    return deliverables


def get_project_documents(db: Session, project_id: int, include_removed: bool = False) -> dict:
    """Return documents grouped by standard stage, showing all standard stages.

    Standard stages with no documents are shown as empty placeholders
    so the frontend can render the complete template.
    """
    from backend.services.document_service import get_or_init_project_documents, get_stage_types_for_project

    project = db.query(CachedProject).filter(CachedProject.id == project_id).first()
    project_type = project.project_type if project else "RD"
    standard_stages = get_stage_types_for_project_type(db, project_type)

    # Init documents for matched stages (incremental)
    docs_list = get_or_init_project_documents(db, project_id, project_type, include_removed=include_removed)

    # Auto-scan SVN docs — check if files exist at template paths
    from backend.services.doc_scanner import check_project_docs
    scan_result = check_project_docs(db, project_id)
    logger.info(f"[project-docs] project_id={project_id} scanned={scan_result.get('scanned',0)} matched={scan_result.get('total_matched',0)} submitted={scan_result.get('auto_submitted',0)}")

    # Group existing docs by stage_type (standard stage name)
    grouped: dict[str, list[dict]] = {}
    for d in docs_list:
        st = d.get("stage_type") or "未分类"
        grouped.setdefault(st, []).append(d)

    # Load stage-level unnecessary flags to hide stages with no required docs
    from backend.models.local import PmaSetting
    unnec_key = f"stage_docs_unnecessary_{project_type}"
    unnec_val = PmaSetting.get(db, unnec_key, "")
    unnec_stages = set(s.strip() for s in unnec_val.split(",") if s.strip())

    # Build result: one entry per standard stage (in order), skip unnecessary stages
    result = []
    for st in standard_stages:
        if st in unnec_stages:
            continue
        items = grouped.get(st, [])
        scd = items[0].get("stage_completed_date") if items else None
        result.append({
            "stage_name": st,
            "stage_completed_date": scd,
            "has_documents": len(items) > 0,
            "documents": items,
        })

    return {"documents": result, "standard_stages": standard_stages}


def get_project_gantt(db: Session, project_id: int) -> dict:
    """Return gantt data from ProjectStage rows with PMA task progress."""
    project = db.query(CachedProject).filter(CachedProject.id == project_id).first()
    from backend.models.project_stage import ProjectStage
    from backend.models.task import Task
    from backend.models.local import LocalUser

    stages_rows = db.query(ProjectStage).filter(
        ProjectStage.project_id == project_id
    ).order_by(ProjectStage.sort_order).all()

    # Fallback: use template stage list if no ProjectStage rows
    if not stages_rows:
        project_type = project.project_type or "RD" if project else "RD"
        standard_stages = get_stage_types_for_project_type(db, project_type)
        stages_rows = []
        for i, st in enumerate(standard_stages):
            tasks = db.query(Task).filter(
                Task.project_id == project_id,
                Task.stage_name == st,
            ).all()
            progs = [t.progress or 0 for t in tasks]
            pct = round(sum(progs) / len(progs)) if progs else 0
            stages_rows.append({
                "name": st, "start_date": None, "end_date": None,
                "status": "active", "progress_cache": pct,
                "tasks_done": sum(1 for p in progs if p >= 100),
                "tasks_total": len(progs),
            })
        gantt_stages = [
            {
                "id": None, "name": s["name"], "standard_stage": s["name"],
                "who": None, "start": None, "end": None,
                "status": "active",
                "progress": str(s["progress_cache"]),
                "tasks_done": s["tasks_done"],
                "tasks_total": s["tasks_total"],
            }
            for s in stages_rows
        ]
    else:
        gantt_stages = []
        for s in stages_rows:
            # Tasks linked by stage_id
            tasks_by_id = db.query(Task).filter(Task.stage_id == s.id).all()
            # Also include tasks with same stage_name but stage_id=NULL (imported from templates)
            id_set = {t.id for t in tasks_by_id}
            tasks_by_name = db.query(Task).filter(
                Task.project_id == project_id,
                Task.stage_name == s.name,
                Task.stage_id == None,
            ).all()
            tasks = tasks_by_id + [t for t in tasks_by_name if t.id not in id_set]
            progs = [t.progress or 0 for t in tasks]
            pct = round(sum(progs) / len(progs)) if progs else 0
            # Sync calculated progress back to DB
            if pct != (s.progress or 0):
                s.progress = pct
                db.commit()
            who = None
            who_tooltip = None
            unique_names = []
            seen_names = set()
            for t in tasks:
                if t.assignee_id:
                    u = db.query(LocalUser).filter(LocalUser.id == t.assignee_id).first()
                    if u:
                        name = (u.display_name or u.username).split("（")[0]
                        if name not in seen_names:
                            seen_names.add(name)
                            unique_names.append(name)
            if len(unique_names) == 1:
                who = unique_names[0]
            elif len(unique_names) > 1:
                who = "团队"
                who_tooltip = "、".join(unique_names)
            gantt_stages.append({
                "id": s.id, "name": s.name,
                "standard_stage": s.name,
                "who": who,
                "who_tooltip": who_tooltip,
                "start": str(s.start_date) if s.start_date else None,
                "end": str(s.end_date) if s.end_date else None,
                "status": s.status,
                "progress": str(pct),
                "tasks_done": sum(1 for p in progs if p >= 100),
                "tasks_total": len(progs),
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
        prod = db.query(PmaProduct).filter(PmaProduct.id == lr.product_id).first()
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
            prod = db.query(PmaProduct).filter(PmaProduct.id == r.product_id).first()
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
        prod = db.query(PmaProduct).filter(PmaProduct.id == lr.product_id).first()
        if prod:
            products.append({
                "id": prod.id,
                "name": prod.name,
                "code": prod.code,
                "category": prod.program_name or prod.category,
                "program_name": prod.program_name,
                "nas_path": prod.nas_path,
                "git_url": prod.git_url,
                "quantity": lr.quantity,
            })
    return products


# --- helpers ---

def _project_brief(p: CachedProject, has_pending_docs: bool = False, has_incomplete_tasks: bool = False, has_stage_anomalies: bool = False, linked_customers: list = None, stage_progress: Optional[int] = None) -> dict:
    return {
        "id": p.id,
        "code": p.code,
        "name": p.name,
        "project_type": p.project_type,
        "customer_name": _resolve_customer(p, linked_customers or []),
        "reporter_id": p.reporter_id,
        "status": _map_status(p.status, has_pending_docs, has_incomplete_tasks, has_stage_anomalies),
        "progress": stage_progress if stage_progress is not None else p.progress,
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
    """Return customer from linked customers, fallback to p.customer_name."""
    if linked_customers:
        return "、".join(linked_customers)
    return p.customer_name or ""


def _resolve_reporter_name(db: Session, reporter_id) -> str:
    """Resolve reporter_id to display_name."""
    if not reporter_id:
        return ""
    from backend.models.local import LocalUser
    u = db.query(LocalUser).filter(LocalUser.id == reporter_id).first()
    if u:
        return u.display_name or u.username
    return ""


def _resolve_user_for_role(db: Session, responsible_role: str):
    """Resolve a responsible_role label (e.g. '硬件开发') to a local_users id via local_roles.

    Returns user id if found. Falls back to CTO role if the specified role has no members.
    Returns None only if neither the role nor CTO has members.
    """
    from backend.models.local import Role, UserRole
    if not responsible_role:
        return None
    role = db.query(Role).filter(Role.label == responsible_role).first()
    if role:
        ur = db.query(UserRole).filter(UserRole.role_id == role.id).first()
        if ur:
            return ur.user_id
    # Fallback: assign to CTO if the role has no members
    cto_role = db.query(Role).filter(Role.label == "CTO").first()
    if cto_role:
        ur = db.query(UserRole).filter(UserRole.role_id == cto_role.id).first()
        if ur:
            return ur.user_id
    return None


def _calc_stage_avg_progress(db: Session, project_id: int) -> int:
    """Calculate project overall progress from task progress values, and sync to DB."""
    from backend.models.task import Task
    tasks = db.query(Task).filter(Task.project_id == project_id).all()
    if not tasks:
        return 0
    progs = [t.progress or 0 for t in tasks]
    pct = round(sum(progs) / len(progs))
    # Sync to CachedProject.progress
    project = db.query(CachedProject).filter(CachedProject.id == project_id).first()
    if project and project.progress != pct:
        project.progress = pct
        db.commit()
    return pct


def _batch_stage_avg_progress(db: Session, project_ids: list[int]) -> dict:
    """Batch-calculate progress from tasks for multiple projects, and sync to DB."""
    from backend.models.task import Task
    from sqlalchemy import func as sa_func
    result = {}
    if not project_ids:
        return result
    rows = db.query(
        Task.project_id,
        sa_func.avg(Task.progress)
    ).filter(Task.project_id.in_(project_ids)).group_by(Task.project_id).all()
    projects = {p.id: p for p in db.query(CachedProject).filter(CachedProject.id.in_(project_ids)).all()}
    for pid, avg in rows:
        pct = round(avg) if avg else 0
        result[pid] = pct
        # Sync to CachedProject.progress if changed
        p = projects.get(pid)
        if p and p.progress != pct:
            p.progress = pct
    db.commit()
    return result


def _batch_cust_map(db: Session, project_ids: list[int]) -> dict:
    """Batch-load linked customer names for multiple projects.
    Returns {project_id: [customer_name, ...]}."""
    cust_map = {}
    if not project_ids:
        return cust_map
    links = db.query(CustomerProjectLink).filter(CustomerProjectLink.project_id.in_(project_ids)).all()
    if links:
        cids = set(l.customer_id for l in links)
        cnames = {c.id: c.name for c in db.query(PmaCustomer).filter(PmaCustomer.id.in_(cids)).all()}
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
        "progress": _calc_stage_avg_progress(db, p.id),
        "estimate": p.estimate,
        "consumed": p.consumed,
        "pm_name": p.pm_name,
        "customer_name": _resolve_customer(p, linked_customers or []),
        "reporter_id": p.reporter_id,
        "reporter_name": _resolve_reporter_name(db, p.reporter_id),
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
