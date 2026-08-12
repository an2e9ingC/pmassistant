"""WorkLog CRUD + calendar aggregation + multi-dimensional summary."""
from __future__ import annotations
from datetime import date, datetime, timezone
from typing import Optional, List, Tuple

from sqlalchemy.orm import Session
from sqlalchemy.sql import func as sa_func

from backend.models.task import WorkLog, Task
from backend.models.bug import BugWorkLog, PmaBug
from backend.models.local import PmaSetting, LocalUser, ProjectActivity
from backend.models.wecom import WeComCheckin, WeComSchedule
from backend.database import to_local_str


def _calc_calculated_hours(db: Session, user_id: int, wl_date: date, percentage: float) -> Tuple[float, bool]:
    """Calculate hours from percentage × day checkin hours.
    Returns (calculated_hours, has_checkin).

    Priority: WeComCheckin.work_hours → WeComSchedule daily avg → default 8h
    """
    has_checkin = False
    default_hours = 8.0

    # Find LocalUser → wecom_userid
    user = db.query(LocalUser).filter(LocalUser.id == user_id).first()
    if user and user.wecom_userid:
        # Look up checkin hours
        checkin = db.query(WeComCheckin).filter(
            WeComCheckin.user_id == user.wecom_userid,
            WeComCheckin.date == wl_date,
        ).first()
        if checkin and checkin.work_hours and checkin.work_hours > 0:
            has_checkin = True
            return (round(percentage / 100.0 * float(checkin.work_hours), 2), has_checkin)

        # Fallback: WeComSchedule
        schedule = db.query(WeComSchedule).filter(
            WeComSchedule.year == wl_date.year,
            WeComSchedule.month == wl_date.month,
        ).first()
        if schedule and schedule.work_days and schedule.work_days > 0 and schedule.work_hours:
            daily = float(schedule.work_hours) / int(schedule.work_days)
            return (round(percentage / 100.0 * daily, 2), has_checkin)

    # Default fallback
    return (round(percentage / 100.0 * default_hours, 2), has_checkin)


def _recalc_calculated_hours_for_date(db: Session, local_user_id: int, wl_date: date):
    """Recalculate calculated_hours for all worklogs on a given date after WeCom sync.
    Called from wecom_service after checkin data is updated.
    """
    user = db.query(LocalUser).filter(LocalUser.id == local_user_id).first()
    if not user:
        return

    # Update task worklogs
    wls = db.query(WorkLog).filter(
        WorkLog.user_id == local_user_id,
        WorkLog.date == wl_date,
        WorkLog.percentage.isnot(None),
    ).all()
    for wl in wls:
        calc_h, _ = _calc_calculated_hours(db, local_user_id, wl.date, wl.percentage)
        wl.calculated_hours = calc_h

    # Update bug worklogs
    bwls = db.query(BugWorkLog).filter(
        BugWorkLog.user_id == local_user_id,
        BugWorkLog.date == wl_date,
        BugWorkLog.percentage.isnot(None),
    ).all()
    for bwl in bwls:
        calc_h, _ = _calc_calculated_hours(db, local_user_id, bwl.date, bwl.percentage)
        bwl.calculated_hours = calc_h

    if wls or bwls:
        db.commit()


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
    pct = float(data.get("percentage", 0) or 0)
    wl_date = _parse_date(data.get("date")) or date.today()
    calc_h, has_checkin = _calc_calculated_hours(db, user_id, wl_date, pct)

    w = WorkLog(
        task_id=data.get("task_id"),
        user_id=user_id,
        hours=calc_h,  # backward compat
        percentage=pct,
        calculated_hours=calc_h,
        date=wl_date,
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
        f"记录工时 {pct}% ({calc_h}h): {w.description or ''}")
    result = _worklog_dict(w, task, db)
    result["has_checkin"] = has_checkin
    result["percentage"] = w.percentage
    result["calculated_hours"] = w.calculated_hours
    return result


def update_worklog(db: Session, worklog_id: int, data: dict) -> Optional[dict]:
    """Update a worklog entry and recalc task consumed_hours."""
    w = db.query(WorkLog).filter(WorkLog.id == worklog_id).first()
    if not w:
        return None

    changes = []
    has_checkin = False
    if "percentage" in data:
        new_pct = float(data["percentage"] or 0)
        if new_pct != w.percentage:
            changes.append(f"{w.percentage}% → {new_pct}%")
        w.percentage = new_pct
        # Recalculate hours based on new percentage
        calc_h, has_checkin = _calc_calculated_hours(db, w.user_id, w.date, new_pct)
        w.hours = calc_h
        w.calculated_hours = calc_h
    if "date" in data:
        new_date = _parse_date(data["date"]) or w.date
        if new_date != w.date:
            changes.append(f"日期 → {new_date}")
            w.date = new_date
            if w.percentage:
                calc_h, has_checkin = _calc_calculated_hours(db, w.user_id, new_date, w.percentage)
                w.hours = calc_h
                w.calculated_hours = calc_h
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
    result = _worklog_dict(w, task, db)
    result["has_checkin"] = has_checkin
    result["percentage"] = w.percentage
    result["calculated_hours"] = w.calculated_hours
    return result


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


def _validate_percentage_not_exceeded(db: Session, user_id: int, date_val: date, new_pct: float, exclude_worklog_id: int = None):
    """Check that existing + new percentage doesn't exceed 100 for a user on a date.
    Raises ValueError if exceeded.
    """
    # Sum existing worklogs for this user+date
    existing_task = db.query(sa_func.coalesce(sa_func.sum(WorkLog.percentage), 0)).filter(
        WorkLog.user_id == user_id,
        WorkLog.date == date_val,
    )
    if exclude_worklog_id:
        existing_task = existing_task.filter(WorkLog.id != exclude_worklog_id)
    task_total = existing_task.scalar() or 0.0

    existing_bug = db.query(sa_func.coalesce(sa_func.sum(BugWorkLog.percentage), 0)).filter(
        BugWorkLog.user_id == user_id,
        BugWorkLog.date == date_val,
    )
    if exclude_worklog_id:
        existing_bug = existing_bug.filter(BugWorkLog.id != exclude_worklog_id)
    bug_total = existing_bug.scalar() or 0.0

    total_existing = float(task_total) + float(bug_total)
    if total_existing + new_pct > 100:
        raise ValueError(
            f"日期 {date_val} 已填 {total_existing:.0f}%，加上 {new_pct:.0f}% 超过 100%"
        )


def create_worklog_batch(db: Session, task_id: int, entries: list, user_id: int) -> List[dict]:
    """Batch-create multiple worklog entries for the same task."""
    # Pre-validate: group entries by date and check cumulative percentage
    from collections import defaultdict
    date_new_pcts = defaultdict(float)
    for entry in entries:
        d = _parse_date(entry.get("date")) or date.today()
        date_new_pcts[d] += float(entry.get("percentage", 0) or 0)

    for d, total_new_pct in date_new_pcts.items():
        _validate_percentage_not_exceeded(db, user_id, d, total_new_pct)

    created = []
    for entry in entries:
        data = {
            "task_id": task_id,
            "percentage": entry.get("percentage", 0),
            "date": entry.get("date"),
            "description": entry.get("description"),
        }
        wl = create_worklog(db, data, user_id)
        created.append(wl)

        # Update progress if provided
        progress = entry.get("progress")
        if progress is not None:
            task = db.query(Task).filter(Task.id == task_id).first()
            if task:
                new_progress = max(task.progress or 0, int(progress))
                if new_progress > (task.progress or 0):
                    task.progress = new_progress
                    from backend.services.task_service import _recalc_stage_progress
                    if task.stage_id:
                        _recalc_stage_progress(db, task.stage_id)
                if int(progress) >= 100:
                    _handle_100_percent_task(db, task, user_id)
        db.commit()

    return created


def _handle_100_percent_task(db: Session, task: Task, user_id: int):
    """Handle task progress reaching 100%."""
    approval_enabled = PmaSetting.get(db, "approval_enabled", "1") == "1"
    if not approval_enabled:
        task.status = 'done'
        task.completed_at = datetime.now(timezone.utc)
    else:
        task.status = 'review'
    # Ensure reviewer is set if possible
    if not task.reviewer_id and task.stage_id:
        from backend.services.task_service import _resolve_reviewer_from_stage
        _resolve_reviewer_from_stage(db, task)


def get_daily_usage(db: Session, user_id: int, d: date) -> dict:
    """Get total percentage used and remaining for a user on a given date."""
    total_pct = 0.0
    entries = []

    # Task worklogs
    wls = db.query(WorkLog).filter(
        WorkLog.user_id == user_id,
        WorkLog.date == d,
    ).all()
    for wl in wls:
        total_pct += wl.percentage or 0
        task = db.query(Task).filter(Task.id == wl.task_id).first()
        entries.append({
            "id": wl.id, "source": "task", "task_id": wl.task_id,
            "title": task.title if task else "(已删除)",
            "percentage": wl.percentage,
        })

    # Bug worklogs
    bwls = db.query(BugWorkLog).filter(
        BugWorkLog.user_id == user_id,
        BugWorkLog.date == d,
    ).all()
    for bwl in bwls:
        total_pct += bwl.percentage or 0
        bug = db.query(PmaBug).filter(PmaBug.id == bwl.bug_id).first()
        entries.append({
            "id": bwl.id, "source": "bug", "bug_id": bwl.bug_id,
            "title": f"Bug #{bwl.bug_id} {bug.title}" if bug else f"Bug #{bwl.bug_id}",
            "percentage": bwl.percentage,
        })

    return {
        "total_percentage_used": round(total_pct, 1),
        "remaining_percentage": round(max(0, 100 - total_pct), 1),
        "entries": entries,
    }


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
            "percentage": w.percentage,
            "calculated_hours": w.calculated_hours,
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
            "percentage": bw.percentage,
            "calculated_hours": bw.calculated_hours,
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

    # Determine has_checkin
    has_checkin = False
    if db and w.user_id and w.date:
        from backend.models.wecom import WeComCheckin
        luser = db.query(LocalUser).filter(LocalUser.id == w.user_id).first()
        if luser and luser.wecom_userid:
            checkin = db.query(WeComCheckin).filter(
                WeComCheckin.user_id == luser.wecom_userid,
                WeComCheckin.date == w.date,
            ).first()
            has_checkin = bool(checkin and checkin.work_hours and checkin.work_hours > 0)

    return {
        "id": w.id,
        "task_id": w.task_id,
        "user_id": w.user_id,
        "username": user.username if user else "?",
        "display_name": user.display_name if user else "?",
        "hours": w.hours,
        "percentage": w.percentage,
        "calculated_hours": w.calculated_hours,
        "has_checkin": has_checkin,
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
