"""WorkLog CRUD + calendar aggregation + multi-dimensional summary."""
from __future__ import annotations
from datetime import date, datetime
from typing import Optional, List

from sqlalchemy.orm import Session
from sqlalchemy.sql import func as sa_func

from backend.models.task import WorkLog, Task
from backend.database import to_local_str


def _auto_update_task_status(db: Session, task_id: int):
    """Auto-transition task status: todo→in_progress, over-budget→review.
    Over-budget tasks go to 'review' for user decision instead of auto-completing.
    """
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task or not task.estimate_hours or task.estimate_hours <= 0:
        return
    consumed = task.consumed_hours or 0.0
    estimate = task.estimate_hours
    status = task.status

    if consumed >= estimate and status not in ('done', 'closed', 'review'):
        # Over budget: flag for user decision instead of auto-completing
        task.status = 'review'
        if not task.original_estimate_hours:
            task.original_estimate_hours = estimate
        db.commit()
    elif consumed > 0 and status == 'todo':
        task.status = 'in_progress'
        db.commit()


def _fetch_task_map(db: Session, task_ids: set) -> dict:
    """Batch-load Task rows by ID, returning {id: Task} map."""
    if not task_ids:
        return {}
    tasks = db.query(Task).filter(Task.id.in_(task_ids)).all()
    return {t.id: t for t in tasks}


def get_worklogs(
    db: Session,
    task_id: Optional[int] = None,
    user_id: Optional[int] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
) -> List[dict]:
    """List worklog entries with optional filters."""
    q = db.query(WorkLog)
    if task_id:
        q = q.filter(WorkLog.task_id == task_id)
    if user_id:
        q = q.filter(WorkLog.user_id == user_id)
    if date_from:
        q = q.filter(WorkLog.date >= _parse_date(date_from))
    if date_to:
        q = q.filter(WorkLog.date <= _parse_date(date_to))
    q = q.order_by(WorkLog.date.desc(), WorkLog.created_at.desc())
    logs = q.all()
    task_ids = {w.task_id for w in logs}
    task_map = _fetch_task_map(db, task_ids)
    return [_worklog_dict(w, task_map.get(w.task_id), db) for w in logs]


def create_worklog(db: Session, data: dict, user_id: int) -> dict:
    """Create a worklog entry and recalc task consumed_hours."""
    w = WorkLog(
        task_id=data.get("task_id"),
        user_id=user_id,
        hours=float(data.get("hours", 0) or 0),
        date=_parse_date(data.get("date")) or date.today(),
        description=data.get("description"),
    )
    db.add(w)
    db.commit()
    db.refresh(w)

    from backend.services.task_service import recalc_consumed_hours
    recalc_consumed_hours(db, w.task_id)
    _auto_update_task_status(db, w.task_id)

    task = db.query(Task).filter(Task.id == w.task_id).first()
    return _worklog_dict(w, task, db)


def update_worklog(db: Session, worklog_id: int, data: dict) -> Optional[dict]:
    """Update a worklog entry and recalc task consumed_hours."""
    w = db.query(WorkLog).filter(WorkLog.id == worklog_id).first()
    if not w:
        return None

    if "hours" in data:
        w.hours = float(data["hours"] or 0)
    if "date" in data:
        w.date = _parse_date(data["date"]) or w.date
    if "description" in data:
        w.description = data["description"]

    db.commit()
    db.refresh(w)

    from backend.services.task_service import recalc_consumed_hours
    recalc_consumed_hours(db, w.task_id)
    _auto_update_task_status(db, w.task_id)

    task = db.query(Task).filter(Task.id == w.task_id).first()
    return _worklog_dict(w, task, db)


def delete_worklog(db: Session, worklog_id: int) -> bool:
    """Delete a worklog entry and recalc task consumed_hours."""
    w = db.query(WorkLog).filter(WorkLog.id == worklog_id).first()
    if not w:
        return False
    task_id = w.task_id
    db.delete(w)
    db.commit()

    from backend.services.task_service import recalc_consumed_hours
    recalc_consumed_hours(db, task_id)
    _auto_update_task_status(db, task_id)
    return True


def get_calendar(
    db: Session,
    user_id: Optional[int] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
) -> dict:
    """Calendar view: daily hours grouped by date, with task breakdown."""
    q = db.query(WorkLog)
    if user_id:
        q = q.filter(WorkLog.user_id == user_id)
    if date_from:
        q = q.filter(WorkLog.date >= _parse_date(date_from))
    if date_to:
        q = q.filter(WorkLog.date <= _parse_date(date_to))
    logs = q.order_by(WorkLog.date.desc()).all()

    # Batch-load all referenced tasks in one query
    task_ids = {w.task_id for w in logs}
    task_map = _fetch_task_map(db, task_ids)

    # Group by date
    daily_map = {}
    for w in logs:
        d = str(w.date)
        if d not in daily_map:
            daily_map[d] = {"date": d, "total_hours": 0.0, "tasks": []}
        task = task_map.get(w.task_id)
        daily_map[d]["total_hours"] += w.hours or 0.0
        daily_map[d]["tasks"].append({
            "task_id": w.task_id,
            "title": task.title if task else "(已删除)",
            "hours": w.hours,
            "project_id": task.project_id if task else None,
            "description": w.description,
        })

    daily = sorted(daily_map.values(), key=lambda x: x["date"], reverse=True)
    total = sum(d["total_hours"] for d in daily)

    return {
        "daily": daily,
        "total": total,
    }


def get_summary(
    db: Session,
    user_id: Optional[int] = None,
    project_id: Optional[int] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
) -> dict:
    """Multi-dimensional worklog summary."""
    q = db.query(WorkLog)
    if user_id:
        q = q.filter(WorkLog.user_id == user_id)
    if date_from:
        q = q.filter(WorkLog.date >= _parse_date(date_from))
    if date_to:
        q = q.filter(WorkLog.date <= _parse_date(date_to))

    if project_id:
        task_ids = db.query(Task.id).filter(Task.project_id == project_id).all()
        task_id_list = [t[0] for t in task_ids]
        q = q.filter(WorkLog.task_id.in_(task_id_list)) if task_id_list else q.filter(WorkLog.task_id == -1)

    logs = q.all()

    # Batch-load all referenced tasks in one query
    task_ids = {w.task_id for w in logs}
    task_map = _fetch_task_map(db, task_ids)

    by_user = {}
    by_project = {}
    by_date = {}

    for w in logs:
        uid = w.user_id
        if uid not in by_user:
            by_user[uid] = 0.0
        by_user[uid] += w.hours or 0.0

        d = str(w.date)
        if d not in by_date:
            by_date[d] = 0.0
        by_date[d] += w.hours or 0.0

        task = task_map.get(w.task_id)
        if task:
            pid = task.project_id
            if pid not in by_project:
                by_project[pid] = 0.0
            by_project[pid] += w.hours or 0.0

    return {
        "total_hours": sum(w.hours or 0.0 for w in logs),
        "by_user": by_user,
        "by_project": by_project,
        "by_date": by_date,
    }


def _worklog_dict(w: WorkLog, task: Task = None, db: Session = None) -> dict:
    from backend.models.local import LocalUser
    user = db.query(LocalUser).filter(LocalUser.id == w.user_id).first() if db and w.user_id else None
    return {
        "id": w.id,
        "task_id": w.task_id,
        "user_id": w.user_id,
        "username": user.username if user else "?",
        "display_name": user.display_name if user else "?",
        "hours": w.hours,
        "date": str(w.date) if w.date else None,
        "description": w.description,
        "task_title": task.title if task else None,
        "created_at": to_local_str(w.created_at) if w.created_at else None,
    }


def _comment_dict(c, db=None) -> dict:
    """Serialize TaskComment, resolving username."""
    from backend.models.local import LocalUser
    user = db.query(LocalUser).filter(LocalUser.id == c.user_id).first() if db and c.user_id else None
    return {
        "id": c.id,
        "task_id": c.task_id,
        "user_id": c.user_id,
        "username": user.username if user else "?",
        "display_name": user.display_name if user else "?",
        "content": c.content,
        "created_at": to_local_str(c.created_at) if c.created_at else None,
    }


def _parse_date(val):
    if not val:
        return None
    if isinstance(val, date):
        return val
    if isinstance(val, str):
        val = val.strip()
        if not val:
            return None
        try:
            return datetime.strptime(val[:10], "%Y-%m-%d").date()
        except ValueError:
            return None
    return None
