from __future__ import annotations
import re
from datetime import date, datetime
from typing import Optional

from sqlalchemy import desc as _desc, asc as _asc, case
from sqlalchemy.orm import Session, joinedload

from backend.models.zentao import CachedProject, CachedExecution, CachedTask


def get_kpi(db: Session) -> dict:
    projects = db.query(CachedProject).all()

    # Active = only truly in-progress (doing), not wait
    active = [p for p in projects if p.status == "doing"]

    # Per-project-type counts (for filter tabs + KPI)
    type_active: dict[str, int] = {}
    type_all: dict[str, int] = {}
    for p in projects:
        pt = p.project_type or "RD"
        type_all[pt] = type_all.get(pt, 0) + 1
    for p in active:
        pt = p.project_type or "RD"
        type_active[pt] = type_active.get(pt, 0) + 1

    # Average progress of active projects
    progresses = []
    for p in active:
        try:
            progresses.append(float(p.progress or 0))
        except (ValueError, TypeError):
            pass
    avg_progress = sum(progresses) / len(progresses) if progresses else 0.0

    # Alert count + category counts (pass active list to avoid redundant computation)
    alerts = _detect_alerts_internal(db)
    alert_count = len(alerts)
    cat_counts = _get_category_counts(db, alerts, active)

    # TODO: 本月交付数量 — 需统计DeliveryRecord表中本月交付记录的总数量（Phase 2）
    delivered_this_month = 0

    # Unique programs (project sets) for filtering
    programs = []
    seen_pids = set()
    for p in projects:
        if p.program_id and p.program_id not in seen_pids:
            seen_pids.add(p.program_id)
            programs.append({
                "id": p.program_id,
                "name": p.program_name or f"项目集#{p.program_id}",
            })
    programs.sort(key=lambda x: x["name"])

    # Project filter config
    import os
    from backend.config import settings
    pf = getattr(settings, "ZENTAO_PROJECT_FILTER", "") or os.environ.get("ZENTAO_PROJECT_FILTER", "")

    return {
        "project_filter": pf,
        "active_projects": len(active),
        "total_projects": len(projects),
        "type_active": type_active,
        "type_all": type_all,
        "pending_alerts": alert_count,
        "delivered_this_month": delivered_this_month,
        "avg_progress": round(avg_progress, 1),
        "active_count": cat_counts["active"],
        "completed_count": cat_counts["completed"],
        "high_risk_count": cat_counts["high_risk"],
        "incomplete_docs_count": cat_counts["incomplete_docs"],
        "programs": programs,
    }


def get_project_list(
    db: Session,
    search: Optional[str] = None,
    type_filter: Optional[str] = None,
    status: Optional[str] = None,
    category: Optional[str] = None,
    program_id: Optional[int] = None,
    sort_by: str = "end",
    sort_order: str = "asc",
    page: int = 1,
    limit: int = 50,
) -> tuple[list[CachedProject], int]:
    q = db.query(CachedProject)

    if search:
        pattern = f"%{search}%"
        q = q.filter(
            (CachedProject.code.ilike(pattern)) |
            (CachedProject.name.ilike(pattern)) |
            (CachedProject.customer_name.ilike(pattern)) |
            (CachedProject.pm_name.ilike(pattern))
        )

    if type_filter and type_filter != "all":
        q = q.filter(CachedProject.project_type == type_filter)

    if status:
        q = q.filter(CachedProject.status == status)

    if program_id is not None:
        q = q.filter(CachedProject.program_id == program_id)

    # Category filter: applies alert-based filtering
    if category:
        if category == "active":
            q = q.filter(CachedProject.status == "doing")
        elif category == "completed":
            # Use PMA 4-condition check (not raw status)
            from backend.services.project_service import _get_pending_doc_counts, _get_incomplete_task_counts, _get_stage_anomaly_counts
            q = q.filter(CachedProject.status.in_(["done", "closed"]))
            all_items = q.options(joinedload(CachedProject.executions)).order_by(CachedProject.id).all()
            pids_done = [p.id for p in all_items]
            pending_map = _get_pending_doc_counts(db, pids_done)
            incomplete_task_map = _get_incomplete_task_counts(db, pids_done)
            stage_anomaly_map = _get_stage_anomaly_counts(db, pids_done)
            all_items = [p for p in all_items if not (
                pending_map.get(p.id) or
                incomplete_task_map.get(p.id) or
                stage_anomaly_map.get(p.id)
            )]
            total = len(all_items)
            start = (page - 1) * limit
            return all_items[start:start + limit], total
        elif category in ("high_risk", "incomplete_docs"):
            # Compute alert project IDs for the requested severity
            alerts = _detect_alerts_internal(db)
            severity = "red" if category == "high_risk" else "yellow"
            alert_pids = {a["project_id"] for a in alerts if a["severity"] == severity}
            if alert_pids:
                q = q.filter(CachedProject.id.in_(alert_pids))
            else:
                # No alerts of this severity → return empty
                return [], 0

    total = q.count()

    # Default: sort by end ASC, NULLS LAST (long-term projects at bottom)
    sort_col = {
        "end": CachedProject.end,
        "code": CachedProject.code,
    }.get(sort_by, CachedProject.id)
    direction = _asc if sort_order == "asc" else _desc
    items = q.options(joinedload(CachedProject.executions)).order_by(
        direction(case((sort_col.is_(None), 1), else_=0)),
        direction(sort_col),
    ).offset((page - 1) * limit).limit(limit).all()

    return items, total


def get_alerts(db: Session, severity: Optional[str] = None,
               project_id: Optional[int] = None,
               page: int = 1, limit: int = 50) -> tuple[list[dict], int]:
    alerts = _detect_alerts_internal(db)
    if severity:
        alerts = [a for a in alerts if a["severity"] == severity]
    if project_id is not None:
        alerts = [a for a in alerts if a["project_id"] == project_id]
    total = len(alerts)
    start = (page - 1) * limit
    return alerts[start:start + limit], total


def _get_category_counts(db: Session, alerts: list[dict], active: list[CachedProject] | None = None) -> dict:
    """Return project counts for the 5 dashboard KPI cards.

    - active: only truly in-progress (status == "doing"), not "wait"
    - completed: PMA 4-condition strict check
    - high_risk: projects with red alerts (stage overdue)
    - incomplete_docs: projects with yellow alerts (doc/task/stage warnings)
    """
    from backend.services.project_service import _get_pending_doc_counts, _get_incomplete_task_counts, _get_stage_anomaly_counts

    projects = db.query(CachedProject).all()
    pids = [p.id for p in projects]
    pending_map = _get_pending_doc_counts(db, pids)
    incomplete_task_map = _get_incomplete_task_counts(db, pids)
    stage_anomaly_map = _get_stage_anomaly_counts(db, pids)

    # active_count: only truly in-progress (doing), matches _map_status(doing) → active
    active_count = len(active) if active is not None else sum(1 for p in projects if p.status == "doing")

    completed_count = 0
    for p in projects:
        if p.status in ("done", "closed"):
            has_pending = pending_map.get(p.id, False)
            has_incomplete_tasks = incomplete_task_map.get(p.id, False)
            has_stage_anomalies = stage_anomaly_map.get(p.id, False)
            if not has_pending and not has_incomplete_tasks and not has_stage_anomalies:
                completed_count += 1

    high_risk_count = len({a["project_id"] for a in alerts if a["severity"] == "red"})
    incomplete_docs_count = len({a["project_id"] for a in alerts if a["severity"] == "yellow"})
    return {
        "active": active_count,
        "completed": completed_count,
        "high_risk": high_risk_count,
        "incomplete_docs": incomplete_docs_count,
    }


def _detect_alerts_internal(db: Session) -> list[dict]:
    """Detect alerts from cached data. Returns list of alert dicts."""
    alerts = []
    alert_id = 0
    today = date.today()

    projects = db.query(CachedProject).all()

    for p in projects:
        proj_code = p.code or (p.name.split('-')[0] if p.name and '-' in p.name else None)
        executions = db.query(CachedExecution).filter(
            CachedExecution.project_id == p.id
        ).all()

        for e in executions:
            # Red: stage overdue
            if e.end and e.status not in ("done", "closed"):
                e_end = e.end if isinstance(e.end, date) else datetime.strptime(str(e.end), "%Y-%m-%d").date()
                if e_end < today:
                    alert_id += 1
                    alerts.append({
                        "id": alert_id, "severity": "red",
                        "message": f"阶段「{e.name}」计划结束日期已过，状态未完成",
                        "sub_message": f"计划结束: {e.end}，当前状态: {e.status}",
                        "project_id": p.id, "project_code": proj_code, "stage_name": e.name,
                    })

            # Check tasks in each execution
            tasks = db.query(CachedTask).filter(
                CachedTask.execution_id == e.id
            ).all()

            for t in tasks:
                # Yellow: task done but no files
                if t.status == "done" and not t.has_files:
                    # Check if this task type should have output files
                    if t.type in ("devel", "design", "test"):
                        alert_id += 1
                        alerts.append({
                            "id": alert_id, "severity": "yellow",
                            "message": f"任务「{t.name}」已完成但无附件/输出件",
                            "sub_message": f"任务状态=done, 类型={t.type}, 无文件附件",
                            "project_id": p.id, "project_code": proj_code, "stage_name": e.name,
                        })

                # Yellow: review task missing approval keyword
                if t.status == "done" and t.description:
                    has_review_kw = bool(re.search(r"评审|确认|审核|审批", t.name))
                    has_approve = bool(re.search(r"【同意】|同意", t.description))
                    if has_review_kw and not has_approve:
                        alert_id += 1
                        alerts.append({
                            "id": alert_id, "severity": "yellow",
                            "message": f"审核任务「{t.name}」描述中缺少【同意】关键字",
                            "sub_message": "任务名称包含评审/确认/审核关键字，但描述中无同意标记",
                            "project_id": p.id, "project_code": proj_code, "stage_name": e.name,
                        })

    # Stage info missing: check for executions that don't match standard stages
    from backend.services.document_service import _match_stage_type, get_stage_types_for_project
    for p in projects:
        proj_code = p.code or (p.name.split('-')[0] if p.name and '-' in p.name else None)
        standard_stages = get_stage_types_for_project(p.project_type or "RD")
        executions = db.query(CachedExecution).filter(
            CachedExecution.project_id == p.id
        ).all()
        for e in executions:
            actual_name = (e.name or "").strip()
            if actual_name and not _match_stage_type(actual_name, standard_stages):
                alert_id += 1
                alerts.append({
                    "id": alert_id, "severity": "yellow",
                    "message": f"阶段名不匹配: 「{e.name}」",
                    "sub_message": f"请修改禅道阶段名为标准名字: {', '.join(standard_stages)}",
                    "project_id": p.id, "project_code": proj_code, "stage_name": e.name,
                })

    # Doc completeness: check ProjectDocument status for completed stages
    from backend.models.document import ProjectDocument
    for p in projects:
        proj_code = p.code or (p.name.split('-')[0] if p.name and '-' in p.name else None)
        executions = db.query(CachedExecution).filter(
            CachedExecution.project_id == p.id
        ).all()
        for e in executions:
            if e.status not in ("done", "closed"):
                continue
            # Check for pending documents in completed stages
            pending_docs = db.query(ProjectDocument).filter(
                ProjectDocument.execution_id == e.id,
                ProjectDocument.status == "pending"
            ).all()
            for pd in pending_docs:
                alert_id += 1
                alerts.append({
                    "id": alert_id, "severity": "yellow",
                    "message": f"阶段「{e.name}」已完成，但文档「{pd.doc_name}」未提交",
                    "sub_message": f"请及时提交输出件或标记文档状态",
                    "project_id": p.id, "project_code": proj_code, "stage_name": e.name,
                })

    # GitLab release URL validation alerts (FR-004)
    from backend.models.zentao import CachedRelease, PmaProduct
    invalid_releases = db.query(CachedRelease).filter(
        CachedRelease.gitlab_url.isnot(None),
        CachedRelease.gitlab_url != "",
        CachedRelease.gitlab_url_valid == False,
    ).all()
    for r in invalid_releases:
        product = db.query(PmaProduct).filter(PmaProduct.id == r.product_id).first()
        product_name = product.name if product else f"产品#{r.product_id}"
        alert_id += 1
        alerts.append({
            "id": alert_id, "severity": "yellow",
            "message": f"产品「{product_name}」版本 {r.name} 的 GitLab 发布链接无效",
            "sub_message": f"链接: {r.gitlab_url[:80]}{'...' if len(r.gitlab_url or '') > 80 else ''}，请检查 GitLab 上是否存在对应 release",
            "project_id": None, "product_id": r.product_id,
            "stage_name": r.name,
        })

    # GitLab URL not set but release has description (may contain non-URL text)
    missing_url_releases = db.query(CachedRelease).filter(
        (CachedRelease.gitlab_url.is_(None)) | (CachedRelease.gitlab_url == ""),
        CachedRelease.desc.isnot(None),
        CachedRelease.desc != "",
    ).all()
    for r in missing_url_releases:
        product = db.query(PmaProduct).filter(PmaProduct.id == r.product_id).first()
        product_name = product.name if product else f"产品#{r.product_id}"
        alert_id += 1
        alerts.append({
            "id": alert_id, "severity": "yellow",
            "message": f"产品「{product_name}」版本 {r.name} 未填写 GitLab 发布链接",
            "sub_message": "请在禅道发布页面补充 GitLab release 链接",
            "project_id": None, "product_id": r.product_id,
            "stage_name": r.name,
        })

    # ── Data source unconfigured alerts ──
    from backend.config import settings
    import os

    # GitLab not configured
    if not settings.GITLAB_TOKEN:
        alert_id += 1
        alerts.append({
            "id": alert_id, "severity": "yellow",
            "message": "GitLab 数据源未配置",
            "sub_message": "请在「管理 → 数据源配置」中填写 GitLab Token，以启用发布版本校验功能",
            "project_id": None, "product_id": None,
            "stage_name": "GitLab",
        })

    # NAS not configured
    nas_host = os.environ.get("NAS_HOST", "")
    if not nas_host:
        alert_id += 1
        alerts.append({
            "id": alert_id, "severity": "yellow",
            "message": "NAS 数据源未配置",
            "sub_message": "请在「管理 → 数据源配置」中填写 NAS 连接信息，以启用售前项目检测功能",
            "project_id": None, "product_id": None,
            "stage_name": "NAS",
        })

    return alerts
