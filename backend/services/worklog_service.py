"""WorkLog CRUD + calendar aggregation + multi-dimensional summary."""
from __future__ import annotations
from datetime import date, datetime, timezone
from typing import Optional, List

from sqlalchemy.orm import Session
from sqlalchemy.sql import func as sa_func

from backend.models.task import WorkLog, Task
from backend.models.bug import BugWorkLog, PmaBug
from backend.models.local import PmaSetting, LocalUser, ProjectActivity
from backend.database import to_local_str


def _auto_update_task_status(db: Session, task_id: int):
    """Auto-transition task status: todo→in_progress, over-budget→review/done.
    When approval is disabled, auto-complete over-budget tasks instead of entering review.
    """
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        return
    consumed = task.consumed_hours or 0.0
    estimate = task.estimate_hours or 0.0
    status = task.status

    # todo → in_progress: any consumed hours, regardless of estimate
    if consumed > 0 and status == 'todo':
        task.status = 'in_progress'
        db.commit()
        # Reload status after commit for the over-budget check below
        status = task.status

    # over-budget → review/done: only when estimate is set and consumed >= estimate
    if estimate > 0 and consumed >= estimate and status not in ('done', 'closed', 'review'):
        if not task.original_estimate_hours:
            task.original_estimate_hours = estimate
        approval_enabled = PmaSetting.get(db, "approval_enabled", "1") == "1"
        if not approval_enabled:
            # Approval disabled: auto-complete directly
            task.status = 'done'
            task.completed_at = datetime.now(timezone.utc)
        else:
            # Approval enabled: flag for user decision
            task.status = 'review'
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


def _log_worklog_activity(db: Session, task_id: int, user_id: int, action: str, detail: str):
    """Log worklog operation to ProjectActivity for project timeline."""
    try:
        task = db.query(Task).filter(Task.id == task_id).first()
        if not task or not task.project_id:
            return
        user = db.query(LocalUser).filter(LocalUser.id == user_id).first()
        username = user.username if user else "unknown"
        from backend.services.task_service import _resolve_assignee_name
        act = ProjectActivity(
            project_id=task.project_id,
            username=username,
            action=action,
            detail=detail,
            task_id=task.id,
            task_name=task.title or "",
            task_assignee=_resolve_assignee_name(db, task.assignee_id),
        )
        db.add(act)
        db.commit()
    except Exception:
        pass  # never fail the main operation


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

    from backend.services.task_service import recalc_consumed_hours, _recalc_stage_progress
    recalc_consumed_hours(db, w.task_id)
    _auto_update_task_status(db, w.task_id)
    if w.task_id:
        task = db.query(Task).filter(Task.id == w.task_id).first()
        if task and task.stage_id:
            _recalc_stage_progress(db, task.stage_id)

    task = db.query(Task).filter(Task.id == w.task_id).first()
    # Log to project activity timeline
    _log_worklog_activity(db, w.task_id, user_id, "工时记录",
        f"记录工时 {w.hours}h: {w.description or ''}")
    return _worklog_dict(w, task, db)


def update_worklog(db: Session, worklog_id: int, data: dict) -> Optional[dict]:
    """Update a worklog entry and recalc task consumed_hours."""
    w = db.query(WorkLog).filter(WorkLog.id == worklog_id).first()
    if not w:
        return None

    changes = []
    if "hours" in data:
        new_hours = float(data["hours"] or 0)
        if new_hours != w.hours:
            changes.append(f"{w.hours}h → {new_hours}h")
        w.hours = new_hours
    if "date" in data:
        new_date = _parse_date(data["date"]) or w.date
        if new_date != w.date:
            changes.append(f"日期 → {new_date}")
        w.date = new_date
    if "description" in data:
        new_desc = data["description"]
        if new_desc != w.description:
            changes.append(f"描述更新")
        w.description = new_desc

    db.commit()
    db.refresh(w)

    from backend.services.task_service import recalc_consumed_hours, _recalc_stage_progress
    recalc_consumed_hours(db, w.task_id)
    _auto_update_task_status(db, w.task_id)
    if w.task_id:
        task = db.query(Task).filter(Task.id == w.task_id).first()
        if task and task.stage_id:
            _recalc_stage_progress(db, task.stage_id)

    task = db.query(Task).filter(Task.id == w.task_id).first()
    # Log to project activity timeline
    if changes:
        _log_worklog_activity(db, w.task_id, w.user_id, "工时更新",
            f"更新工时: {'; '.join(changes)}")
    return _worklog_dict(w, task, db)


def delete_worklog(db: Session, worklog_id: int) -> bool:
    """Delete a worklog entry and recalc task consumed_hours."""
    w = db.query(WorkLog).filter(WorkLog.id == worklog_id).first()
    if not w:
        return False
    task_id = w.task_id
    user_id = w.user_id
    detail = f"删除工时 {w.hours}h: {w.description or ''}"
    db.delete(w)
    db.commit()

    from backend.services.task_service import recalc_consumed_hours, _recalc_stage_progress
    recalc_consumed_hours(db, task_id)
    _auto_update_task_status(db, task_id)
    t = db.query(Task).filter(Task.id == task_id).first()
    if t and t.stage_id:
        _recalc_stage_progress(db, t.stage_id)
    # Log to project activity timeline
    _log_worklog_activity(db, task_id, user_id, "工时删除", detail)
    return True


def get_calendar(
    db: Session,
    user_id: Optional[int] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
) -> dict:
    """Calendar view: daily hours grouped by date, with task/bug breakdown."""
    # Task worklogs
    q = db.query(WorkLog)
    if user_id:
        q = q.filter(WorkLog.user_id == user_id)
    if date_from:
        q = q.filter(WorkLog.date >= _parse_date(date_from))
    if date_to:
        q = q.filter(WorkLog.date <= _parse_date(date_to))
    logs = q.order_by(WorkLog.date.desc()).all()

    # Bug worklogs
    bq = db.query(BugWorkLog)
    if user_id:
        bq = bq.filter(BugWorkLog.user_id == user_id)
    if date_from:
        bq = bq.filter(BugWorkLog.date >= _parse_date(date_from))
    if date_to:
        bq = bq.filter(BugWorkLog.date <= _parse_date(date_to))
    bug_logs = bq.order_by(BugWorkLog.date.desc()).all()

    # Batch-load tasks and bugs
    task_ids = {w.task_id for w in logs}
    task_map = _fetch_task_map(db, task_ids)
    bug_ids = {b.bug_id for b in bug_logs}
    bug_map = {b.id: b for b in db.query(PmaBug).filter(PmaBug.id.in_(bug_ids)).all()} if bug_ids else {}

    # Batch-load project info (PmaProduct + CachedProject) and executions
    proj_ids = {t.project_id for t in task_map.values() if t and t.project_id}
    # Also load bug project IDs for calendar display
    if bug_map:
        proj_ids.update(b.project_id for b in bug_map.values() if b and b.project_id)
    proj_map = {}
    exec_map = {}
    if proj_ids:
        from backend.models.zentao import PmaProduct, CachedProject
        projs = db.query(PmaProduct).filter(PmaProduct.id.in_(proj_ids)).all()
        proj_map.update({p.id: p for p in projs})
        zprojs = db.query(CachedProject).filter(CachedProject.id.in_(proj_ids)).all()
        proj_map.update({p.id: p for p in zprojs})
    exec_ids = {t.execution_id for t in task_map.values() if t and t.execution_id}
    exec_map = {}
    if exec_ids:
        from backend.models.zentao import CachedExecution
        execs = db.query(CachedExecution).filter(CachedExecution.id.in_(exec_ids)).all()
        exec_map = {e.id: e for e in execs}
    # Bug worklogs: resolve stage info from the bug's project executions
    bug_stage_map = {}
    bug_comp_map = {}
    if bug_map:
        bug_proj_ids = {b.project_id for b in bug_map.values() if b and b.project_id}
        if bug_proj_ids:
            from backend.models.zentao import CachedExecution
            bug_execs = db.query(CachedExecution).filter(CachedExecution.project_id.in_(bug_proj_ids)).all()
            _bug_proj_execs = {}
            for e in bug_execs:
                _bug_proj_execs.setdefault(e.project_id, []).append(e)
            for pid, execs in _bug_proj_execs.items():
                bug_stage_map[pid] = ', '.join(sorted(set((e.stage_name or e.name) for e in execs if (e.stage_name or e.name))))
        # Resolve bug component names
        bug_comp_ids = {b.component_id for b in bug_map.values() if b and b.component_id}
        if bug_comp_ids:
            from backend.models.document import ProductDocTemplate
            comps = db.query(ProductDocTemplate).filter(ProductDocTemplate.id.in_(bug_comp_ids)).all()
            bug_comp_map = {c.id: c.doc_name for c in comps if c.doc_name}

    # Group by date
    daily_map = {}
    for w in logs:
        d = str(w.date)
        if d not in daily_map:
            daily_map[d] = {"date": d, "total_hours": 0.0, "tasks": []}
        task = task_map.get(w.task_id)
        proj = proj_map.get(task.project_id) if task else None
        exe = exec_map.get(task.execution_id) if task and task.execution_id else None
        stage = (exe.name if exe else '') or (task.stage_name if task else '')
        daily_map[d]["total_hours"] += w.hours or 0.0
        daily_map[d]["tasks"].append({
            "id": w.id,
            "task_id": w.task_id,
            "title": task.title if task else "(已删除)",
            "hours": w.hours,
            "progress": task.progress if task else 0,
            "created_at": to_local_str(w.created_at) if w.created_at else '',
            "project_id": task.project_id if task else None,
            "project_code": getattr(proj, 'code', '') or '',
            "project_name": getattr(proj, 'name', '') or '',
            "stage_name": stage,
            "description": w.description,
            "source": "task",
        })
    for bw in bug_logs:
        d = str(bw.date)
        if d not in daily_map:
            daily_map[d] = {"date": d, "total_hours": 0.0, "tasks": []}
        bug = bug_map.get(bw.bug_id)
        daily_map[d]["total_hours"] += bw.hours or 0.0
        daily_map[d]["tasks"].append({
            "id": bw.id,
            "task_id": None,
            "bug_id": bw.bug_id,
            "title": ("Bug #" + str(bw.bug_id) + " " + bug.title) if bug else ("Bug #" + str(bw.bug_id)),
            "hours": bw.hours,
            "progress": 0,
            "created_at": to_local_str(bw.created_at) if bw.created_at else '',
            "project_id": bug.project_id if bug else None,
            "project_code": getattr(proj_map.get(bug.project_id), 'code', '') if bug and bug.project_id else '',
            "project_name": getattr(proj_map.get(bug.project_id), 'name', '') if bug and bug.project_id else '',
            "stage_name": bug_stage_map.get(bug.project_id, '') if bug and bug.project_id else '',
            "component_name": bug_comp_map.get(bug.component_id, '') if bug and bug.component_id else '',
            "description": bw.description,
            "source": "bug",
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
    """Multi-dimensional worklog summary (task + bug)."""
    # Task worklogs
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

    # Bug worklogs (not filtered by project_id — bugs don't have project association in worklog context)
    bq = db.query(BugWorkLog)
    if user_id:
        bq = bq.filter(BugWorkLog.user_id == user_id)
    if date_from:
        bq = bq.filter(BugWorkLog.date >= _parse_date(date_from))
    if date_to:
        bq = bq.filter(BugWorkLog.date <= _parse_date(date_to))
    bug_logs = bq.all()

    by_user = {}
    by_project = {}
    by_date = {}
    total = 0.0

    for w in logs:
        total += w.hours or 0.0
        uid = w.user_id
        if uid not in by_user:
            by_user[uid] = 0.0
        by_user[uid] += w.hours or 0.0
        d = str(w.date)
        if d not in by_date:
            by_date[d] = 0.0
        by_date[d] += w.hours or 0.0

    for bw in bug_logs:
        total += bw.hours or 0.0
        uid = bw.user_id
        if uid not in by_user:
            by_user[uid] = 0.0
        by_user[uid] += bw.hours or 0.0
        d = str(bw.date)
        if d not in by_date:
            by_date[d] = 0.0
        by_date[d] += bw.hours or 0.0

    return {
        "total_hours": total,
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
