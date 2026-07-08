"""Task CRUD + stats + consumed_hours recalculation."""
from __future__ import annotations
import json
from datetime import date, datetime
from typing import Optional, List

from sqlalchemy.orm import Session
from sqlalchemy.sql import func as sa_func

from backend.models.task import Task, WorkLog, TaskComment
from backend.database import to_local_str


def get_tasks(
    db: Session,
    project_id: Optional[int] = None,
    execution_id: Optional[int] = None,
    status: Optional[str] = None,
    assignee_id: Optional[int] = None,
) -> List[dict]:
    """List tasks with optional filters."""
    q = db.query(Task)
    if project_id:
        q = q.filter(Task.project_id == project_id)
    if execution_id:
        q = q.filter(Task.execution_id == execution_id)
    if status:
        q = q.filter(Task.status == status)
    if assignee_id:
        q = q.filter(Task.assignee_id == assignee_id)
    q = q.order_by(Task.sort_order, Task.created_at.desc())
    return [_task_dict(t, db) for t in q.all()]


def get_task(db: Session, task_id: int) -> Optional[dict]:
    """Get task detail including worklog history and comments."""
    t = db.query(Task).filter(Task.id == task_id).first()
    if not t:
        return None
    d = _task_dict(t, db)
    # Attach worklogs
    logs = db.query(WorkLog).filter(WorkLog.task_id == task_id).order_by(WorkLog.date.desc(), WorkLog.created_at.desc()).all()
    from backend.services.worklog_service import _worklog_dict, _comment_dict
    d["worklogs"] = [_worklog_dict(w) for w in logs]
    # Attach comments
    comments = db.query(TaskComment).filter(TaskComment.task_id == task_id).order_by(TaskComment.created_at.asc()).all()
    d["comments"] = [_comment_dict(c, db) for c in comments]
    return d


def get_my_tasks(db: Session, user_id: int) -> List[dict]:
    """Get tasks assigned to a user across all projects."""
    tasks = db.query(Task).filter(Task.assignee_id == user_id).order_by(
        Task.status != "closed",
        Task.due_date.asc().nullslast(),
        Task.created_at.desc(),
    ).all()
    return [_task_dict(t, db) for t in tasks]


def get_task_stats(db: Session, project_id: Optional[int] = None) -> dict:
    """Task statistics grouped by status, priority, and execution."""
    q = db.query(Task)
    if project_id:
        q = q.filter(Task.project_id == project_id)
    tasks = q.all()

    by_status = {}
    by_priority = {}
    by_execution = {}
    for t in tasks:
        s = t.status or "todo"
        by_status[s] = by_status.get(s, 0) + 1
        p = t.priority or "medium"
        by_priority[p] = by_priority.get(p, 0) + 1
        eid = t.execution_id or 0
        if eid not in by_execution:
            by_execution[eid] = {"execution_id": eid, "total": 0, "done": 0, "consumed": 0.0, "estimate": 0.0}
        by_execution[eid]["total"] += 1
        if t.status in ("done", "closed"):
            by_execution[eid]["done"] += 1
        by_execution[eid]["consumed"] += t.consumed_hours or 0.0
        by_execution[eid]["estimate"] += t.estimate_hours or 0.0

    return {
        "total": len(tasks),
        "by_status": by_status,
        "by_priority": by_priority,
        "by_execution": list(by_execution.values()),
    }


def _get_user_info(user):
    """Extract id and username from LocalUser or dict."""
    if user is None:
        return None, None
    if hasattr(user, 'id'):
        return user.id, user.username
    return user.get('id'), user.get('username')


def create_task(db: Session, data: dict, user) -> dict:
    """Create a single task. user is LocalUser from Depends(get_current_user)."""
    uid, uname = _get_user_info(user)
    t = Task(
        project_id=data.get("project_id"),
        execution_id=data.get("execution_id"),
        stage_name=data.get("stage_name") or None,
        title=data.get("title", ""),
        description=data.get("description"),
        status=data.get("status", "todo"),
        priority=data.get("priority", "medium"),
        type=data.get("type", "development"),
        assignee_id=data.get("assignee_id"),
        reporter_id=uid,
        parent_id=data.get("parent_id"),
        blocked_by_id=data.get("blocked_by_id"),
        progress=int(data.get("progress", 0) or 0),
        estimate_hours=float(data.get("estimate_hours", 0) or 0),
        start_date=_parse_date(data.get("start_date")),
        due_date=_parse_date(data.get("due_date")),
        output_items=json.dumps(data.get("output_items") or [], ensure_ascii=False) if data.get("output_items") is not None else None,
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    _log_audit(db, t.project_id, uname, "task_create", f"创建任务 #{t.id}: {t.title}")
    return _task_dict(t, db)


def create_tasks_batch(db: Session, tasks_data: list, user) -> List[dict]:
    """Create multiple tasks in one transaction."""
    uid, uname = _get_user_info(user)
    created = []
    for data in tasks_data:
        t = Task(
            project_id=data.get("project_id"),
            execution_id=data.get("execution_id"),
            stage_name=data.get("stage_name"),
            title=data.get("title", ""),
            description=data.get("description"),
            status=data.get("status", "todo"),
            priority=data.get("priority", "medium"),
            type=data.get("type", "development"),
            assignee_id=data.get("assignee_id"),
            reporter_id=uid,
            progress=int(data.get("progress", 0) or 0),
            estimate_hours=float(data.get("estimate_hours", 0) or 0),
            start_date=_parse_date(data.get("start_date")),
            due_date=_parse_date(data.get("due_date")),
        )
        db.add(t)
        created.append(t)
    db.commit()
    for t in created:
        db.refresh(t)
    _log_audit(db, t.project_id, uname, "task_create_batch", f"批量创建任务 #{t.id}: {t.title}")
    return [_task_dict(t, db) for t in created]


def import_tasks(db: Session, task_ids: list, target_project_id: int, execution_mapping: dict, user) -> List[dict]:
    """Import tasks from other projects."""
    uid, uname = _get_user_info(user)
    created = []
    for sid in task_ids:
        src = db.query(Task).filter(Task.id == sid).first()
        if not src:
            continue
        target_exec_id = execution_mapping.get(str(src.execution_id or 0)) if execution_mapping else src.execution_id
        t = Task(
            project_id=target_project_id,
            execution_id=target_exec_id,
            title=src.title,
            description=src.description,
            status="todo",
            priority=src.priority,
            type=src.type,
            assignee_id=src.assignee_id,
            reporter_id=uid,
            estimate_hours=src.estimate_hours,
            output_items=src.output_items,
        )
        db.add(t)
        created.append(t)
    db.commit()
    for t in created:
        db.refresh(t)
    _log_audit(db, target_project_id, uname, "task_import", f"从其他项目导入 {len(created)} 个任务")
    return [_task_dict(t, db) for t in created]


def update_task(db: Session, task_id: int, data: dict, user=None) -> Optional[dict]:
    """Update a task. Status change to done/closed auto-sets completed_at."""
    uid, uname = _get_user_info(user)
    t = db.query(Task).filter(Task.id == task_id).first()
    if not t:
        return None

    old_status = t.status
    changes = []
    for field in ("title", "description", "status", "priority", "type",
                   "execution_id", "stage_name", "assignee_id", "parent_id", "blocked_by_id",
                   "start_date", "due_date", "sort_order", "progress"):
        if field in data and getattr(t, field) != data[field]:
            old_val = getattr(t, field)
            new_val = data[field]
            if field == "execution_id":
                setattr(t, field, int(new_val) if new_val else None)
            elif field in ("assignee_id", "parent_id", "blocked_by_id"):
                setattr(t, field, int(new_val) if new_val else None)
            elif field in ("start_date", "due_date"):
                setattr(t, field, _parse_date(new_val) if new_val else None)
            else:
                setattr(t, field, new_val)
            changes.append(f"{field}: {old_val} -> {new_val}")

    if "stage_name" in data:
        t.stage_name = data["stage_name"] or None
    if "estimate_hours" in data:
        t.estimate_hours = float(data["estimate_hours"] or 0)
    if "output_items" in data:
        t.output_items = json.dumps(data["output_items"], ensure_ascii=False) if data["output_items"] is not None else None

    if "status" in data and data["status"] in ("done", "closed") and old_status not in ("done", "closed"):
        t.completed_at = datetime.utcnow()

    db.commit()
    db.refresh(t)

    if changes:
        _log_audit(db, t.project_id, uname, "task_update", f"更新任务 #{t.id}: " + "; ".join(changes[:3]))

    return _task_dict(t, db)


def extend_task_estimate(db: Session, task_id: int, additional_hours: float) -> Optional[dict]:
    """Extend task estimate by additional hours. Saves original estimate on first extend."""
    t = db.query(Task).filter(Task.id == task_id).first()
    if not t:
        return None
    old_estimate = t.estimate_hours or 0.0
    if not t.original_estimate_hours:
        t.original_estimate_hours = old_estimate
    t.estimate_hours = old_estimate + additional_hours
    t.status = 'in_progress'  # Move back from review to in_progress
    db.commit()
    return _task_dict(t, db)


def delete_task(db: Session, task_id: int, user=None) -> bool:
    """Delete a task and its worklogs + comments."""
    uid, uname = _get_user_info(user)
    t = db.query(Task).filter(Task.id == task_id).first()
    if not t:
        return False

    db.query(WorkLog).filter(WorkLog.task_id == task_id).delete()
    db.query(TaskComment).filter(TaskComment.task_id == task_id).delete()
    project_id = t.project_id
    title = t.title
    db.delete(t)
    db.commit()

    _log_audit(db, project_id, uname, "task_delete", f"删除任务 #{task_id}: {title}")
    return True


def recalc_consumed_hours(db: Session, task_id: int):
    """Update task.consumed_hours from sum of worklogs."""
    total = db.query(WorkLog).with_entities(
        sa_func.coalesce(sa_func.sum(WorkLog.hours), 0)
    ).filter(WorkLog.task_id == task_id).scalar() or 0.0
    db.query(Task).filter(Task.id == task_id).update({Task.consumed_hours: float(total)})
    db.commit()


def _task_dict(t: Task, db=None) -> dict:
    output = []
    if t.output_items:
        try:
            output = json.loads(t.output_items)
        except (json.JSONDecodeError, TypeError):
            pass
    # Resolve execution name, assignee name, and project name
    exec_name = None
    assignee_name = None
    proj_code = None
    proj_name = None
    if t.execution_id:
        from backend.models.zentao import CachedExecution
        exc = db.query(CachedExecution).filter(CachedExecution.id == t.execution_id).first() if db else None
        if exc:
            exec_name = exc.name
    if t.assignee_id:
        from backend.models.local import LocalUser
        u = db.query(LocalUser).filter(LocalUser.id == t.assignee_id).first() if db else None
        if u:
            assignee_name = u.display_name or u.username
    if t.project_id:
        from backend.models.zentao import CachedProject
        proj = db.query(CachedProject).filter(CachedProject.id == t.project_id).first() if db else None
        if proj:
            proj_name = proj.name
            proj_code = proj.code

    return {
        "id": t.id,
        "project_id": t.project_id,
        "project_name": proj_name,
        "project_code": proj_code,
        "execution_id": t.execution_id,
        "stage_name": t.stage_name,
        "execution_name": exec_name or t.stage_name,
        "title": t.title,
        "description": t.description,
        "status": t.status,
        "priority": t.priority,
        "type": t.type,
        "assignee_id": t.assignee_id,
        "assignee_name": assignee_name,
        "assignee_username": None,
        "reporter_id": t.reporter_id,
        "parent_id": t.parent_id,
        "blocked_by_id": t.blocked_by_id,
        "progress": t.progress or 0,
        "estimate_hours": t.estimate_hours or 0.0,
        "original_estimate_hours": t.original_estimate_hours or 0.0,
        "consumed_hours": t.consumed_hours or 0.0,
        "start_date": str(t.start_date) if t.start_date else None,
        "due_date": str(t.due_date) if t.due_date else None,
        "completed_at": to_local_str(t.completed_at) if t.completed_at else None,
        "output_items": output,
        "sort_order": t.sort_order or 0,
        "created_at": to_local_str(t.created_at) if t.created_at else None,
        "updated_at": to_local_str(t.updated_at) if t.updated_at else None,
    }


def _parse_date(val) -> Optional[date]:
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


def _log_audit(db: Session, project_id: int, username: Optional[str], action: str, detail: str):
    """Record task operation to audit log + project activity."""
    if not username:
        return
    try:
        from backend.audit_categories import AUDIT_CAT_TASK
        from backend.models.local import AuditLog, ProjectActivity
        log = AuditLog(
            username=username,
            action=action,
            detail=detail,
            category=AUDIT_CAT_TASK,
            level="low",
        )
        db.add(log)
        # Also write to ProjectActivity so it appears in project detail timeline
        if project_id:
            act = ProjectActivity(
                project_id=project_id,
                username=username,
                action="PMA任务: " + action,
                detail=detail,
            )
            db.add(act)
        db.commit()
    except Exception:
        pass  # audit log should never block task operations
