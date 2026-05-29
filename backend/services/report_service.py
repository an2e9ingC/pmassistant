from __future__ import annotations
from datetime import date, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from backend.models.zentao import CachedProject, CachedExecution, CachedTask
from backend.models.bug import CachedBug
from backend.models.delivery import DeliveryRecord


def get_project_summary(db: Session) -> dict:
    """Overall project status summary."""
    projects = db.query(CachedProject).all()
    total = len(projects)
    active = sum(1 for p in projects if p.status in ("doing", "wait"))
    done = sum(1 for p in projects if p.status in ("done", "closed"))
    blocked = sum(1 for p in projects if p.status == "suspended")

    rd_count = sum(1 for p in projects if p.project_type == "RD")
    sc_count = sum(1 for p in projects if p.project_type == "SC")

    return {
        "total": total, "active": active, "done": done, "blocked": blocked,
        "rd_count": rd_count, "sc_count": sc_count,
    }


def get_weekly_report(db: Session, project_id: Optional[int] = None) -> dict:
    """Generate a weekly progress report."""
    today = date.today()
    week_ago = today - timedelta(days=7)

    # Completed tasks this week
    tasks_q = db.query(CachedTask)
    if project_id:
        tasks_q = tasks_q.filter(CachedTask.project_id == project_id)
    recent_done_tasks = tasks_q.filter(
        CachedTask.status == "done",
        CachedTask.finished_date >= week_ago,
    ).count()

    # New bugs this week
    bugs_q = db.query(CachedBug)
    if project_id:
        bugs_q = bugs_q.filter(CachedBug.project_id == project_id)
    new_bugs = bugs_q.filter(CachedBug.opened_date >= week_ago).count()
    resolved_bugs = bugs_q.filter(
        CachedBug.resolved_date >= week_ago,
    ).count()

    # Active stages
    execs_q = db.query(CachedExecution)
    if project_id:
        execs_q = execs_q.filter(CachedExecution.project_id == project_id)
    active_stages = execs_q.filter(CachedExecution.status == "doing").all()

    # Delivery this week
    del_q = db.query(DeliveryRecord)
    if project_id:
        del_q = del_q.filter(DeliveryRecord.project_id == project_id)
    week_deliveries = del_q.filter(DeliveryRecord.delivery_date >= week_ago).all()
    week_delivery_qty = sum(r.quantity or 0 for r in week_deliveries)

    return {
        "period": f"{week_ago} ~ {today}",
        "tasks_completed": recent_done_tasks,
        "new_bugs": new_bugs,
        "resolved_bugs": resolved_bugs,
        "active_stages": [{"name": s.name, "project_id": s.project_id} for s in active_stages],
        "delivery_quantity": week_delivery_qty,
        "generated_at": str(today),
    }


def get_monthly_report(db: Session) -> dict:
    """Generate a monthly project report."""
    today = date.today()
    month_start = today.replace(day=1)

    projects = db.query(CachedProject).all()
    summary = get_project_summary(db)

    # Monthly task completion
    done_tasks = db.query(CachedTask).filter(
        CachedTask.status == "done",
        CachedTask.finished_date >= month_start,
    ).count()

    # Monthly bugs
    new_bugs = db.query(CachedBug).filter(
        CachedBug.opened_date >= month_start,
    ).count()
    resolved_bugs = db.query(CachedBug).filter(
        CachedBug.resolved_date >= month_start,
    ).count()

    # Monthly deliveries
    month_deliveries = db.query(DeliveryRecord).filter(
        DeliveryRecord.delivery_date >= month_start,
    ).all()
    month_delivery_qty = sum(r.quantity or 0 for r in month_deliveries)

    # Per-project breakdown
    project_details = []
    for p in projects:
        p_tasks_done = db.query(CachedTask).filter(
            CachedTask.project_id == p.id,
            CachedTask.status == "done",
        ).count()
        p_tasks_total = db.query(CachedTask).filter(
            CachedTask.project_id == p.id,
        ).count()
        project_details.append({
            "id": p.id, "name": p.name, "code": p.code,
            "status": p.status, "progress": p.progress,
            "tasks_done": p_tasks_done,
            "tasks_total": p_tasks_total,
        })

    return {
        "period": f"{month_start} ~ {today}",
        "summary": summary,
        "tasks_completed_this_month": done_tasks,
        "new_bugs_this_month": new_bugs,
        "resolved_bugs_this_month": resolved_bugs,
        "delivery_quantity_this_month": month_delivery_qty,
        "projects": project_details,
        "generated_at": str(today),
    }
