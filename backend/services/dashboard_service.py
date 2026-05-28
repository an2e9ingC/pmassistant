from __future__ import annotations
import re
from datetime import date, datetime
from typing import Optional

from sqlalchemy.orm import Session

from backend.models.zentao import CachedProject, CachedExecution, CachedTask


def get_kpi(db: Session) -> dict:
    projects = db.query(CachedProject).all()
    active = [p for p in projects if p.status in ("doing", "wait")]
    rd_count = sum(1 for p in active if p.project_type == "RD")
    sc_count = sum(1 for p in active if p.project_type == "SC")

    # Average progress of active projects
    progresses = []
    for p in active:
        try:
            progresses.append(float(p.progress or 0))
        except (ValueError, TypeError):
            pass
    avg_progress = sum(progresses) / len(progresses) if progresses else 0.0

    # Alert count
    alerts = _detect_alerts_internal(db)
    alert_count = len(alerts)

    # Delivered this month (Phase 2 enhancement, placeholder = 0)
    delivered_this_month = 0

    return {
        "active_projects": len(active),
        "rd_count": rd_count,
        "sc_count": sc_count,
        "pending_alerts": alert_count,
        "delivered_this_month": delivered_this_month,
        "avg_progress": round(avg_progress, 1),
    }


def get_project_list(
    db: Session,
    search: Optional[str] = None,
    type_filter: Optional[str] = None,
    status: Optional[str] = None,
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
            (CachedProject.pm_name.ilike(pattern)) |
            (CachedProject.alias_name.ilike(pattern))
        )

    if type_filter and type_filter in ("RD", "SC"):
        q = q.filter(CachedProject.project_type == type_filter)

    if status:
        q = q.filter(CachedProject.status == status)

    total = q.count()
    items = q.order_by(CachedProject.status, CachedProject.end).offset(
        (page - 1) * limit
    ).limit(limit).all()

    return items, total


def get_alerts(db: Session, severity: Optional[str] = None,
               page: int = 1, limit: int = 50) -> tuple[list[dict], int]:
    alerts = _detect_alerts_internal(db)
    if severity:
        alerts = [a for a in alerts if a["severity"] == severity]
    total = len(alerts)
    start = (page - 1) * limit
    return alerts[start:start + limit], total


def _detect_alerts_internal(db: Session) -> list[dict]:
    """Detect alerts from cached data. Returns list of alert dicts."""
    alerts = []
    alert_id = 0
    today = date.today()

    projects = db.query(CachedProject).all()

    for p in projects:
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
                        "project_id": p.id, "project_code": p.code, "stage_name": e.name,
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
                            "project_id": p.id, "project_code": p.code, "stage_name": e.name,
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
                            "project_id": p.id, "project_code": p.code, "stage_name": e.name,
                        })

    return alerts
