"""WorkLog CRUD + calendar aggregation + multi-dimensional summary."""
from __future__ import annotations
from datetime import date, datetime, timezone
from typing import Optional, List, Tuple

from sqlalchemy.orm import Session
from sqlalchemy.sql import func as sa_func

from backend.models.task import WorkLog, Task
from backend.models.bug import BugWorkLog, PmaBug
from backend.models.local import PmaSetting, LocalUser, ProjectActivity
from backend.database import to_local_str


# ─────────────────────────────────────────────────────────────
# 派生口径：只存 percentage，小时一律实时推导（worklog_hours.py）
# 本文件原先按行落库派生值的 _calc_calculated_hours /
# _recalc_calculated_hours_for_date 已删除，读路径改走
# collect_baselines + row_derived_hours / effective_hours_for。
# ─────────────────────────────────────────────────────────────


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
    from backend.services.worklog_hours import collect_baselines
    _bls = collect_baselines(db, logs)
    return [_worklog_dict(w, task_map.get(w.task_id), db, _bls) for w in logs]


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
    """Create a worklog entry and recalc task consumed_hours.

    只存 percentage（+ date/description）；派生小时列休眠（hours 因 NOT NULL 写 0.0 占位，
    读路径与任务消耗缓存一律实时推导，见 worklog_hours.py）。
    """
    pct = float(data.get("percentage", 0) or 0)
    wl_date = _parse_date(data.get("date")) or date.today()
    # 单条新增同样校验：当日已填 + 本条 ≤ 100%（与批量/编辑口径一致）
    _validate_percentage_not_exceeded(db, user_id, wl_date, pct)

    w = WorkLog(
        task_id=data.get("task_id"),
        user_id=user_id,
        hours=0.0,  # dormant: NOT NULL 占位
        percentage=pct,
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

    from backend.services.worklog_hours import baselines_for, effective_hours_for
    bl = baselines_for(db, [(user_id, wl_date)]).get((user_id, wl_date))
    dh = effective_hours_for(pct, bl)
    task = db.query(Task).filter(Task.id == w.task_id).first()
    # Log to project activity timeline
    _log_worklog_activity(db, w.task_id, user_id, "工时记录",
        f"记录工时 {pct}% ({dh}h): {w.description or ''}")
    return _worklog_dict(w, task, db)


def update_worklog(db: Session, worklog_id: int, data: dict) -> Optional[dict]:
    """Update a worklog entry and recalc task consumed_hours."""
    w = db.query(WorkLog).filter(WorkLog.id == worklog_id).first()
    if not w:
        return None

    changes = []
    if "percentage" in data:
        new_pct = float(data["percentage"] or 0)
        # Validate: new percentage + other records on the same date <= 100
        _validate_percentage_not_exceeded(db, w.user_id, w.date, new_pct, exclude_task_id=w.id)
        if new_pct != w.percentage:
            changes.append(f"{w.percentage}% → {new_pct}%")
        w.percentage = new_pct
    if "date" in data:
        new_date = _parse_date(data["date"]) or w.date
        if new_date != w.date:
            if w.percentage:
                # Validate: percentage + records on the NEW date <= 100
                _validate_percentage_not_exceeded(db, w.user_id, new_date, w.percentage)
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
    # 时间线文案用实时推导小时 + 百分比表述（派生小时列已休眠，不读 w.hours）
    from backend.services.worklog_hours import baselines_for, effective_hours_for
    bl = baselines_for(db, [(user_id, w.date)]).get((user_id, w.date))
    if w.percentage is not None:
        dh = effective_hours_for(w.percentage, bl)
        detail = f"删除工时 {w.percentage}% ({dh}h): {w.description or ''}"
    else:  # 史前行（0 条兜底）
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


def _validate_percentage_not_exceeded(db: Session, user_id: int, date_val: date, new_pct: float, exclude_task_id: int = None, exclude_bug_id: int = None):
    """Check that existing + new percentage doesn't exceed 100 for a user on a date.
    Raises ValueError if exceeded.
    exclude_task_id / exclude_bug_id: exclude the record being edited from the sum.
    """
    # Sum existing task worklogs for this user+date
    existing_task = db.query(sa_func.coalesce(sa_func.sum(WorkLog.percentage), 0)).filter(
        WorkLog.user_id == user_id,
        WorkLog.date == date_val,
    )
    if exclude_task_id:
        existing_task = existing_task.filter(WorkLog.id != exclude_task_id)
    task_total = existing_task.scalar() or 0.0

    existing_bug = db.query(sa_func.coalesce(sa_func.sum(BugWorkLog.percentage), 0)).filter(
        BugWorkLog.user_id == user_id,
        BugWorkLog.date == date_val,
    )
    if exclude_bug_id:
        existing_bug = existing_bug.filter(BugWorkLog.id != exclude_bug_id)
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

    return created


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

    # Batch-load project info (PmaProduct + CachedProject)
    proj_ids = {t.project_id for t in task_map.values() if t and t.project_id}
    # Also load bug project IDs for calendar display
    if bug_map:
        proj_ids.update(b.project_id for b in bug_map.values() if b and b.project_id)
    proj_map = {}
    if proj_ids:
        from backend.models.zentao import PmaProduct, CachedProject
        projs = db.query(PmaProduct).filter(PmaProduct.id.in_(proj_ids)).all()
        proj_map.update({p.id: p for p in projs})
        zprojs = db.query(CachedProject).filter(CachedProject.id.in_(proj_ids)).all()
        proj_map.update({p.id: p for p in zprojs})
    # Resolve bug component names
    bug_comp_map = {}
    if bug_map:
        bug_comp_ids = {b.component_id for b in bug_map.values() if b and b.component_id}
        if bug_comp_ids:
            from backend.models.document import ProductDocTemplate
            comps = db.query(ProductDocTemplate).filter(ProductDocTemplate.id.in_(bug_comp_ids)).all()
            bug_comp_map = {c.id: c.doc_name for c in comps if c.doc_name}

    # 派生口径：单次批量取当日企微基准，(user_id,date)→hours 由 percentage 实时推导
    from backend.services.worklog_hours import collect_baselines, row_derived_hours
    _bls = collect_baselines(db, list(logs) + list(bug_logs))

    def _eff(_w):
        return row_derived_hours(_w, _bls.get((_w.user_id, _w.date)))

    # Group by date
    daily_map = {}
    for w in logs:
        d = str(w.date)
        if d not in daily_map:
            daily_map[d] = {"date": d, "total_hours": 0.0, "tasks": []}
        task = task_map.get(w.task_id)
        proj = proj_map.get(task.project_id) if task else None
        stage = task.stage_name if task else ''
        daily_map[d]["total_hours"] += _eff(w)
        daily_map[d]["tasks"].append({
            "id": w.id,
            "task_id": w.task_id,
            "title": task.title if task else "(已删除)",
            "hours": _eff(w),
            "percentage": w.percentage,
            "calculated_hours": _eff(w),
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
        daily_map[d]["total_hours"] += _eff(bw)
        daily_map[d]["tasks"].append({
            "id": bw.id,
            "task_id": None,
            "bug_id": bw.bug_id,
            "title": ("Bug #" + str(bw.bug_id) + " " + bug.title) if bug else ("Bug #" + str(bw.bug_id)),
            "hours": _eff(bw),
            "percentage": bw.percentage,
            "calculated_hours": _eff(bw),
            "progress": bug.progress if bug else 0,
            "created_at": to_local_str(bw.created_at) if bw.created_at else '',
            "project_id": bug.project_id if bug else None,
            "project_code": getattr(proj_map.get(bug.project_id), 'code', '') if bug and bug.project_id else '',
            "project_name": getattr(proj_map.get(bug.project_id), 'name', '') if bug and bug.project_id else '',
            "stage_name": '',
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

    # 派生口径：单次批量取当日企微基准
    from backend.services.worklog_hours import collect_baselines, row_derived_hours
    _bls = collect_baselines(db, list(logs) + list(bug_logs))

    def _eff(_w):
        return row_derived_hours(_w, _bls.get((_w.user_id, _w.date)))

    by_user = {}
    by_project = {}
    by_date = {}
    total = 0.0

    for w in logs:
        h = _eff(w)
        total += h
        uid = w.user_id
        if uid not in by_user:
            by_user[uid] = 0.0
        by_user[uid] += h
        d = str(w.date)
        if d not in by_date:
            by_date[d] = 0.0
        by_date[d] += h

    for bw in bug_logs:
        h = _eff(bw)
        total += h
        uid = bw.user_id
        if uid not in by_user:
            by_user[uid] = 0.0
        by_user[uid] += h
        d = str(bw.date)
        if d not in by_date:
            by_date[d] = 0.0
        by_date[d] += h

    return {
        "total_hours": total,
        "by_user": by_user,
        "by_project": by_project,
        "by_date": by_date,
    }


def _worklog_dict(w: WorkLog, task: Task = None, db: Session = None, bls: dict = None) -> dict:
    """序列化一行工时。bls：collect_baselines 预取的 (user_id,date)→基准 映射（列表场景避免 N+1）。

    实时推导（percentage×当日企微口径；无基准日按 8h 暂计待核正）。db 用于取用户名；二者皆无时按
    兜底（无基准日 8h 口径）推导展示值，不影响主路径。
    """
    from backend.models.local import LocalUser
    from backend.services.worklog_hours import baselines_for, row_derived_hours, row_basis
    user = db.query(LocalUser).filter(LocalUser.id == w.user_id).first() if db and w.user_id else None

    bl = None
    if w.user_id and w.date:
        bl = bls.get((w.user_id, w.date)) if bls is not None else None
    if bl is None and db and w.user_id and w.date:
        bl = baselines_for(db, [(w.user_id, w.date)]).get((w.user_id, w.date))
    basis = row_basis(bl)
    dh = row_derived_hours(w, bl)

    return {
        "id": w.id,
        "task_id": w.task_id,
        "user_id": w.user_id,
        "username": user.username if user else "?",
        "display_name": user.display_name if user else "?",
        "hours": dh,
        "percentage": w.percentage,
        "calculated_hours": dh,
        "basis": basis,
        "has_checkin": basis == "ok",
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
