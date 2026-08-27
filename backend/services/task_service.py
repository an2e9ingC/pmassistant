"""Task CRUD + stats + consumed_hours recalculation."""
from __future__ import annotations
import json
import logging
from datetime import date, datetime, timezone
from typing import Optional, List

logger = logging.getLogger(__name__)

from sqlalchemy.orm import Session
from sqlalchemy import or_
from sqlalchemy.sql import func as sa_func

from backend.models.task import Task, WorkLog, TaskComment
from backend.models.local import PmaSetting
from backend.database import to_local_str
from backend.audit_categories import FIELD_LABEL


def get_tasks(
    db: Session,
    project_id: Optional[int] = None,
    stage_name: Optional[str] = None,
    status: Optional[str] = None,
    assignee_id: Optional[int] = None,
    reviewer_id: Optional[int] = None,
    source: Optional[str] = None,
) -> List[dict]:
    """List tasks with optional filters. `source` = 'template' | 'manual'."""
    q = db.query(Task)
    if project_id:
        q = q.filter(Task.project_id == project_id)
    if stage_name:
        q = q.filter(Task.stage_name == stage_name)
    if status:
        q = q.filter(Task.status == status)
    if assignee_id:
        q = q.filter(Task.assignee_id == assignee_id)
    if reviewer_id:
        q = q.filter(Task.reviewer_id == reviewer_id)
    if source == 'template':
        q = q.filter(Task.template_id.isnot(None))
    elif source == 'manual':
        q = q.filter(Task.template_id.is_(None))
    elif source == 'diverged':
        q = q.filter(Task.template_id.isnot(None), Task.is_diverged == 1)
    q = q.filter(or_(Task.is_deleted == 0, Task.is_deleted == None))
    q = q.order_by(Task.sort_order, Task.created_at.desc())
    results = [_task_dict(t, db) for t in q.all()]

    # If filtering by assignee_id, also include tasks where user is in assignee_ids but not first
    if assignee_id:
        seen_ids = {r["id"] for r in results}
        extra_q = db.query(Task).filter(
            Task.assignee_ids.isnot(None),
            Task.assignee_id != assignee_id,
            or_(Task.is_deleted == 0, Task.is_deleted == None),
        )
        if project_id:
            extra_q = extra_q.filter(Task.project_id == project_id)
        if stage_name:
            extra_q = extra_q.filter(Task.stage_name == stage_name)
        if status:
            extra_q = extra_q.filter(Task.status == status)
        if reviewer_id:
            extra_q = extra_q.filter(Task.reviewer_id == reviewer_id)
        if source == 'template':
            extra_q = extra_q.filter(Task.template_id.isnot(None))
        elif source == 'manual':
            extra_q = extra_q.filter(Task.template_id.is_(None))
        elif source == 'diverged':
            extra_q = extra_q.filter(Task.template_id.isnot(None), Task.is_diverged == 1)
        extra_q = extra_q.order_by(Task.sort_order, Task.created_at.desc())
        for t in extra_q.all():
            if t.id not in seen_ids and assignee_id in (t.assignee_ids or []):
                results.append(_task_dict(t, db))
                seen_ids.add(t.id)

    return results


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
    """Get tasks for a user: assigned + reported + CC'd + watched (tagged with _source)."""
    # 1. Tasks assigned to the user (primary assignee)
    tasks = db.query(Task).filter(
        Task.assignee_id == user_id,
        or_(Task.is_deleted == 0, Task.is_deleted == None),
    ).order_by(
        Task.status != "closed",
        Task.due_date.asc().nullslast(),
        Task.created_at.desc(),
    ).all()
    seen_ids = {t.id for t in tasks}
    result = [_task_dict(t, db) for t in tasks]
    for d in result:
        d["_source"] = "assigned"

    # 1b. Tasks where user is in assignee_ids but not the first assignee
    # (Python-side filter for SQLite JSON compatibility)
    assignee_q = db.query(Task).filter(
        Task.assignee_ids.isnot(None),
        Task.assignee_id != user_id,
        or_(Task.is_deleted == 0, Task.is_deleted == None),
    ).all()
    for t in assignee_q:
        if t.id not in seen_ids and user_id in (t.assignee_ids or []):
            d = _task_dict(t, db)
            d["_source"] = "assigned"
            result.append(d)
            seen_ids.add(t.id)

    # 2. Tasks CC'd to the user (Python-side filter for SQLite compatibility)
    cc_q = db.query(Task).filter(
        Task.cc_user_ids.isnot(None),
        or_(Task.is_deleted == 0, Task.is_deleted == None),
    ).all()
    for t in cc_q:
        if t.id not in seen_ids and user_id in (t.cc_user_ids or []):
            d = _task_dict(t, db)
            d["_source"] = "cc"
            result.append(d)
            seen_ids.add(t.id)

    # 3. Tasks reported (created) by the user
    reported = db.query(Task).filter(
        Task.reporter_id == user_id,
        or_(Task.is_deleted == 0, Task.is_deleted == None),
    ).order_by(Task.created_at.desc()).all()
    for t in reported:
        if t.id not in seen_ids:
            d = _task_dict(t, db)
            d["_source"] = "reported"
            result.append(d)
            seen_ids.add(t.id)

    # 4. Tasks the user is watching (from favorites.tasks[]) — only those not already loaded
    from backend.models.local import LocalUser
    user = db.query(LocalUser).filter(LocalUser.id == user_id).first()
    if user:
        try:
            favs = json.loads(user.favorites or '{}')
        except (json.JSONDecodeError, TypeError):
            favs = {}
        if isinstance(favs, list):
            favs = {"products": favs, "projects": [], "tasks": [], "bugs": []}
        watched_ids = favs.get("tasks", [])
        if watched_ids:
            watched_tasks = db.query(Task).filter(
                Task.id.in_(watched_ids),
                or_(Task.is_deleted == 0, Task.is_deleted == None),
            ).all()
            for t in watched_tasks:
                if t.id not in seen_ids:
                    d = _task_dict(t, db)
                    d["_source"] = "watched"
                    result.append(d)
                    seen_ids.add(t.id)

    # Sort: assigned first, then reported, then CC'd, then watched; within each group by status/due_date
    source_order = {"assigned": 0, "reported": 1, "cc": 2, "watched": 3}
    result.sort(key=lambda d: (
        source_order.get(d.get("_source", "watched"), 3),
        d.get("status") == "closed",
        not (d.get("due_date") or ""),
        d.get("due_date") or "9999-12-31",
        -(d.get("id") or 0)
    ))
    return result


def _sync_cc_favorites(db: Session, cc_user_ids: list, item_id: int, item_type: str):
    """Add item_id to favorites[key] for each user in cc_user_ids. item_type: 'task' or 'bug'."""
    if not cc_user_ids:
        return
    from backend.models.local import LocalUser
    key = item_type + 's'  # 'tasks' or 'bugs'
    for uid in cc_user_ids:
        try:
            user = db.query(LocalUser).filter(LocalUser.id == uid).first()
            if not user:
                continue
            try:
                favs = json.loads(user.favorites or '{}')
            except (json.JSONDecodeError, TypeError):
                favs = {}
            # Handle old list format → dict
            if isinstance(favs, list):
                favs = {"products": favs, "projects": [], "tasks": [], "bugs": []}
            # Ensure new keys
            favs.setdefault("tasks", [])
            favs.setdefault("bugs", [])
            lst = favs.get(key, [])
            if item_id not in lst:
                lst.append(item_id)
                favs[key] = lst
                user.favorites = json.dumps(favs)
                logger.info(f"[cc:fav] auto-added {item_type}#{item_id} to user={user.username}(id={user.id}) {key}")
        except Exception:
            logger.exception(f"[cc:fav] failed to sync {item_type}#{item_id} to user_id={uid}")


def get_task_stats(db: Session, project_id: Optional[int] = None) -> dict:
    """Task statistics grouped by status and priority."""
    q = db.query(Task).filter(or_(Task.is_deleted == 0, Task.is_deleted == None))
    if project_id:
        q = q.filter(Task.project_id == project_id)
    tasks = q.all()

    by_status = {}
    by_priority = {}
    for t in tasks:
        s = t.status or "todo"
        by_status[s] = by_status.get(s, 0) + 1
        p = t.priority or "medium"
        by_priority[p] = by_priority.get(p, 0) + 1

    return {
        "total": len(tasks),
        "by_status": by_status,
        "by_priority": by_priority,
    }


def _get_user_info(user):
    """Extract id and display name from LocalUser or dict."""
    if user is None:
        return None, None
    if hasattr(user, 'id'):
        return user.id, (user.display_name or user.username)
    return user.get('id'), user.get('display_name') or user.get('username')


def _resolve_assignee_name(db: Session, assignee_id) -> str:
    """Resolve assignee_id to display_name."""
    if not assignee_id:
        return ""
    from backend.models.local import LocalUser
    u = db.query(LocalUser).filter(LocalUser.id == assignee_id).first()
    if u:
        return u.display_name or u.username
    return ""


def _resolve_assignee_names(db: Session, assignee_ids) -> list:
    """Resolve assignee_ids list to display_name list (in order)."""
    if not assignee_ids:
        return []
    from backend.models.local import LocalUser
    users = db.query(LocalUser).filter(LocalUser.id.in_(assignee_ids)).all()
    id_to_name = {u.id: (u.display_name or u.username) for u in users}
    return [id_to_name.get(uid, "") for uid in assignee_ids]


def create_task(db: Session, data: dict, user) -> dict:
    """Create a single task. user is LocalUser from Depends(get_current_user)."""
    uid, uname = _get_user_info(user)
    # Resolve assignee_ids: if provided use it, else derive from assignee_id
    assignee_ids = data.get("assignee_ids")
    if assignee_ids is not None:
        assignee_ids = [int(x) for x in assignee_ids]
    elif data.get("assignee_id"):
        assignee_ids = [int(data["assignee_id"])]
    else:
        assignee_ids = None
    t = Task(
        project_id=data.get("project_id"),
        product_id=data.get("product_id"),
        stage_name=data.get("stage_name") or None,
        title=data.get("title", ""),
        description=data.get("description"),
        status=data.get("status", "todo"),
        priority=data.get("priority", "medium"),
        type=data.get("type", "development"),
        assignee_id=assignee_ids[0] if assignee_ids else None,
        assignee_ids=assignee_ids,
        reviewer_id=data.get("reviewer_id") or uid,  # default to reporter
        reporter_id=uid,
        parent_id=data.get("parent_id"),
        blocked_by_id=data.get("blocked_by_id"),
        progress=int(data.get("progress", 0) or 0),
        estimate_hours=float(data.get("estimate_hours", 0) or 0),
        start_date=_parse_date(data.get("start_date")),
        due_date=_parse_date(data.get("due_date")),
        output_items=json.dumps(data.get("output_items") or [], ensure_ascii=False) if data.get("output_items") is not None else None,
        cc_user_ids=data.get("cc_user_ids"),
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    _link_task_to_stage(db, t)
    _sync_cc_favorites(db, data.get("cc_user_ids"), t.id, 'task')
    assignee_names = _resolve_assignee_names(db, t.assignee_ids) if t.assignee_ids else []
    _log_audit(db, t.project_id, uname, "task_create", f"创建任务 #{t.id}: {t.title}",
               task_name=t.title, task_assignee="、".join(assignee_names) if assignee_names else _resolve_assignee_name(db, t.assignee_id), task_id=t.id)
    from backend.services.action_service import record_action
    record_action(db, "task", t.id, uid, "created")
    auto_messages = []
    if t.stage_id:
        auto_messages = _recalc_stage_progress(db, t.stage_id)
    result = _task_dict(t, db)
    result["auto_messages"] = auto_messages
    return result


def create_tasks_batch(db: Session, tasks_data: list, user) -> List[dict]:
    """Create multiple tasks in one transaction."""
    uid, uname = _get_user_info(user)
    created = []
    for data in tasks_data:
        # Resolve assignee_ids: if provided use it, else derive from assignee_id
        assignee_ids = data.get("assignee_ids")
        if assignee_ids is not None:
            assignee_ids = [int(x) for x in assignee_ids]
        elif data.get("assignee_id"):
            assignee_ids = [int(data["assignee_id"])]
        else:
            assignee_ids = None
        t = Task(
            project_id=data.get("project_id"),
            stage_name=data.get("stage_name"),
            title=data.get("title", ""),
            description=data.get("description"),
            status=data.get("status", "todo"),
            priority=data.get("priority", "medium"),
            type=data.get("type", "development"),
            assignee_id=assignee_ids[0] if assignee_ids else None,
            assignee_ids=assignee_ids,
            reviewer_id=data.get("reviewer_id") or uid,  # default to reporter
            reporter_id=uid,
            progress=int(data.get("progress", 0) or 0),
            estimate_hours=float(data.get("estimate_hours", 0) or 0),
            start_date=_parse_date(data.get("start_date")),
            due_date=_parse_date(data.get("due_date")),
        )
        db.add(t)
        created.append(t)
    db.commit()
    from backend.models.zentao import CachedProject
    for t in created:
        db.refresh(t)
        proj = db.query(CachedProject).filter(CachedProject.id == t.project_id).first()
        proj_info = f"[{proj.code}]" if proj and proj.code else f"项目#{t.project_id}"
        assignee_names = _resolve_assignee_names(db, t.assignee_ids) if t.assignee_ids else []
        _log_audit(db, t.project_id, uname, "task_create_batch", f"批量创建任务 {proj_info} #{t.id}: {t.title}",
                   task_name=t.title, task_assignee="、".join(assignee_names) if assignee_names else _resolve_assignee_name(db, t.assignee_id), task_id=t.id)
    return [_task_dict(t, db) for t in created]


def import_tasks(db: Session, task_ids: list, target_project_id: int, user) -> List[dict]:
    """Import tasks from other projects. Copies the source stage_name and re-links to the target project's stage."""
    uid, uname = _get_user_info(user)
    created = []
    for sid in task_ids:
        src = db.query(Task).filter(Task.id == sid).first()
        if not src:
            continue
        t = Task(
            project_id=target_project_id,
            stage_name=src.stage_name,
            title=src.title,
            description=src.description,
            status="todo",
            priority=src.priority,
            type=src.type,
            assignee_id=src.assignee_id,
            assignee_ids=src.assignee_ids or ([src.assignee_id] if src.assignee_id else None),
            reporter_id=uid,
            estimate_hours=src.estimate_hours,
            output_items=src.output_items,
        )
        db.add(t)
        created.append(t)
    db.commit()
    for t in created:
        db.refresh(t)
        _link_task_to_stage(db, t)
    _log_audit(db, target_project_id, uname, "task_import", f"从其他项目导入 {len(created)} 个任务")
    return [_task_dict(t, db) for t in created]


def update_task(db: Session, task_id: int, data: dict, user=None) -> Optional[dict]:
    """Update a task. Template tasks cannot change title or stage_name."""
    uid, uname = _get_user_info(user)
    t = db.query(Task).filter(Task.id == task_id).first()
    if not t:
        return None

    # Template-created tasks: title and stage_name are locked (controlled by template)
    if t.template_id is not None:
        if "title" in data and data["title"] != t.title:
            raise PermissionError("模板任务不允许修改任务名称，请通过模板管理修改。")
        if "stage_name" in data and data["stage_name"] != t.stage_name:
            raise PermissionError("模板任务不允许修改所属阶段，请通过模板管理修改。")

    old_status = t.status
    old_stage_name = t.stage_name
    old_cc_user_ids = (t.cc_user_ids or [])[:]  # snapshot for CC favorites sync
    changes = []
    structured_changes = []  # field/old_value/new_value for EntityActionChange
    # Batch-resolve assignee ID → display name for readable logs
    user_name_map = {}
    for fid in ("assignee_id", "reviewer_id"):
        ov = getattr(t, fid) if fid in ("assignee_id",) else None
        nv = data.get(fid)
        ids = set()
        if ov: ids.add(int(ov))
        if nv: ids.add(int(nv))
        if ids:
            from backend.models.local import LocalUser
            for u in db.query(LocalUser).filter(LocalUser.id.in_(ids)).all():
                user_name_map[u.id] = u.display_name or u.username
    # Also resolve assignee_ids names for change logging
    old_assignee_ids = (t.assignee_ids or [])[:]
    old_assignee_id_single = t.assignee_id if t.assignee_id is not None else None
    if "assignee_ids" in data:
        new_assignee_ids = data["assignee_ids"] or []
        all_ids = set(old_assignee_ids) | set(new_assignee_ids)
        if all_ids:
            from backend.models.local import LocalUser
            for u in db.query(LocalUser).filter(LocalUser.id.in_(all_ids)).all():
                if u.id not in user_name_map:
                    user_name_map[u.id] = u.display_name or u.username
    for field in ("assignee_ids", "title", "description", "project_id", "product_id", "status", "priority", "type",
                   "stage_name", "assignee_id", "reviewer_id",
                   "parent_id", "blocked_by_id",
                   "start_date", "due_date", "sort_order", "progress", "cc_user_ids"):
        if field in data:
            if field == "assignee_ids":
                # Handle assignee_ids: keep assignee_id in sync (first ID)
                new_ids = [int(x) for x in (data[field] or [])]
                old_val = (t.assignee_ids or [])[:]
                new_val = new_ids
                if old_val != new_val:
                    t.assignee_ids = new_ids if new_ids else None
                    t.assignee_id = new_ids[0] if new_ids else None
                    ov_names = "、".join(user_name_map.get(uid, str(uid)) for uid in old_val)
                    nv_names = "、".join(user_name_map.get(uid, str(uid)) for uid in new_val)
                    field_label = FIELD_LABEL.get("assignee_id", "assignee_id")
                    changes.append(f"{field_label}: {ov_names or '无'} -> {nv_names or '无'}")
                    structured_changes.append({"field": "assignee_id", "old_value": ov_names or "无", "new_value": nv_names or "无"})
                continue
            old_val = getattr(t, field)
            new_val = data[field]
            if old_val != new_val:
                if field in ("reviewer_id", "parent_id", "blocked_by_id"):
                    setattr(t, field, int(new_val) if new_val else None)
                elif field == "assignee_id":
                    new_id = int(new_val) if new_val else None
                    setattr(t, field, new_id)
                    # Sync assignee_ids if not separately provided
                    if "assignee_ids" not in data:
                        t.assignee_ids = [new_id] if new_id else None
                elif field in ("start_date", "due_date"):
                    setattr(t, field, _parse_date(new_val) if new_val else None)
                else:
                    setattr(t, field, new_val)
                ov_display = old_val
                nv_display = new_val if new_val else ''
                if field in ("assignee_id", "reviewer_id"):
                    ov_display = user_name_map.get(int(old_val), old_val) if old_val else ''
                    nv_display = user_name_map.get(int(new_val), new_val) if new_val else ''
                field_label = FIELD_LABEL.get(field, field)
                changes.append(f"{field_label}: {ov_display} -> {nv_display}")
                structured_changes.append({"field": field, "old_value": str(ov_display) if ov_display is not None else "", "new_value": str(nv_display) if nv_display is not None else ""})

    if "stage_name" in data:
        t.stage_name = data["stage_name"] or None
    # When assignee of a template task changes (single or multi), mark as diverged
    # (prevent template sync from overwriting the user's responsible-person change).
    if t.template_id and ("assignee_ids" in data or "assignee_id" in data):
        new_ids = set(t.assignee_ids or ([t.assignee_id] if t.assignee_id else []))
        old_ids = set(old_assignee_ids) if old_assignee_ids else (
            set([old_assignee_id_single]) if old_assignee_id_single is not None else set())
        if new_ids != old_ids:
            t.is_diverged = 1
            changes.append("已脱离模板（责任人变更）")
            structured_changes.append({"field": "template", "old_value": "跟随模板", "new_value": "已脱离模板"})
    if "estimate_hours" in data:
        t.estimate_hours = float(data["estimate_hours"] or 0)
    if "output_items" in data:
        t.output_items = json.dumps(data["output_items"], ensure_ascii=False) if data["output_items"] is not None else None

    if "status" in data and data["status"] in ("done", "closed") and old_status not in ("done", "closed"):
        t.completed_at = datetime.now(timezone.utc)

    auto_messages = []
    # When status is set to done/closed, auto-set progress to 100
    # (complements the reverse direction: progress >= 100 → auto review/done below)
    if "status" in data and data["status"] in ("done", "closed") and old_status not in ("done", "closed") and (t.progress or 0) < 100:
        t.progress = 100
        auto_messages.append("状态已设为完成，进度已自动设为100%")
    # When status changes from done/closed to a non-done status, auto-set progress to 90
    if "status" in data and data["status"] not in ("done", "closed") and old_status in ("done", "closed") and (t.progress or 0) >= 100:
        t.progress = 90
        auto_messages.append("状态已改为进行中，进度已自动设为90%")

    # Auto review flow: progress >= 100 → review (or auto-done if self-review/approval disabled)
    new_progress = data.get("progress")
    if new_progress is not None and new_progress >= 100 and old_status != "done":
        approval_enabled = PmaSetting.get(db, "approval_enabled", "1") == "1"
        if not approval_enabled:
            # Approval disabled: auto-complete directly (including from 'review' state)
            if old_status != "done":
                t.status = "done"
                t.completed_at = datetime.now(timezone.utc)
                auto_messages.append("进度已达100%，任务已自动完成")
        elif old_status not in ("review",):
            # Approval enabled and not yet in review: enter review or auto-complete for self-review
            reviewer_id = None
            if t.stage_id:
                from backend.models.project_stage import ProjectStage
                stage = db.query(ProjectStage).filter(ProjectStage.id == t.stage_id).first()
                if stage and stage.owner_id:
                    reviewer_id = stage.owner_id
            if reviewer_id and (reviewer_id == t.assignee_id or (t.assignee_ids and reviewer_id in t.assignee_ids)):
                # Self-review: reviewer is one of the assignees, skip approval, auto-complete
                t.status = "done"
                t.completed_at = datetime.now(timezone.utc)
                auto_messages.append("审批人与责任人相同，任务已自动完成")
            else:
                t.status = "review"
                t.reviewer_id = reviewer_id
                auto_messages.append("进度已达100%，任务已进入评审中")
        if old_status != t.status:
            changes.append(f"状态: {old_status} -> {t.status}")

    db.commit()
    db.refresh(t)

    # Auto-link to project stage by name, then recalc stage progress
    stage_id = _link_task_to_stage(db, t)
    if stage_id:
        auto_messages += _recalc_stage_progress(db, stage_id)

    # Sync CC favorites: add for new CC users, remove for removed CC users
    if "cc_user_ids" in data:
        new_cc = data.get("cc_user_ids") or []
        added = [uid for uid in new_cc if uid not in old_cc_user_ids]
        removed = [uid for uid in old_cc_user_ids if uid not in new_cc]
        try:
            _sync_cc_favorites(db, added, t.id, 'task')
            from backend.models.local import LocalUser
            for uid in removed:
                try:
                    ru = db.query(LocalUser).filter(LocalUser.id == uid).first()
                    if ru:
                        try:
                            rfavs = json.loads(ru.favorites or '{}')
                        except (json.JSONDecodeError, TypeError):
                            rfavs = {}
                        if isinstance(rfavs, list):
                            rfavs = {"products": rfavs, "projects": [], "tasks": [], "bugs": []}
                        rlst = rfavs.get("tasks", [])
                        if t.id in rlst:
                            rlst.remove(t.id)
                            rfavs["tasks"] = rlst
                            ru.favorites = json.dumps(rfavs)
                except Exception:
                    logger.exception(f"[cc:fav] failed to remove task#{t.id} from user_id={uid}")
        except Exception:
            logger.exception(f"[cc:fav] CC sync failed for task#{t.id}")

    if changes:
        assignee_names = _resolve_assignee_names(db, t.assignee_ids) if t.assignee_ids else []
        _log_audit(db, t.project_id, uname, "task_update", f"更新任务「{t.title}」: " + "; ".join(changes[:3]),
                   task_name=t.title, task_assignee="、".join(assignee_names) if assignee_names else _resolve_assignee_name(db, t.assignee_id), task_id=t.id)
        # Record structured change history (Zentao-style action + changes)
        from backend.services.action_service import record_action
        record_action(db, "task", t.id, uid, "updated", structured_changes)

    result = _task_dict(t, db)
    result["auto_messages"] = auto_messages
    return result


def approve_task(db: Session, task_id: int, user=None) -> Optional[dict]:
    """Approve a task in review status. Only the assigned reviewer can approve."""
    uid, uname = _get_user_info(user)
    t = db.query(Task).filter(Task.id == task_id).first()
    if not t:
        return None
    if t.reviewer_id and t.reviewer_id != uid:
        raise PermissionError("只有审批人可以批准此任务")
    if t.status != "review":
        raise ValueError("任务不在评审状态")

    t.status = "done"
    t.completed_at = datetime.now(timezone.utc)
    if (t.progress or 0) < 100:
        t.progress = 100
    db.commit()

    # Record approval as structured action
    from backend.services.action_service import record_action
    record_action(db, "task", t.id, uid, "approved",
                  changes=[{"field": "status", "old_value": "review", "new_value": "done"}])

    _log_audit(db, t.project_id, uname, "task_update", f"审批通过「{t.title}」→ 已完成",
               task_name=t.title, task_assignee=_resolve_assignee_name(db, t.assignee_id))
    return _task_dict(t, db)


def reject_task(db: Session, task_id: int, reason: str, user=None) -> Optional[dict]:
    """Reject a task in review status. Only the assigned reviewer can reject."""
    uid, uname = _get_user_info(user)
    t = db.query(Task).filter(Task.id == task_id).first()
    if not t:
        return None
    if t.reviewer_id and t.reviewer_id != uid:
        raise PermissionError("只有审批人可以驳回此任务")
    if t.status != "review":
        raise ValueError("任务不在评审状态")

    t.status = "in_progress"
    t.progress = 90
    db.commit()

    # Record rejection as structured action
    from backend.services.action_service import record_action
    record_action(db, "task", t.id, uid, "rejected",
                  changes=[{"field": "status", "old_value": "review", "new_value": "in_progress"}],
                  comment=reason)

    _log_audit(db, t.project_id, uname, "task_update", f"驳回「{t.title}」: {reason}",
               task_name=t.title, task_assignee=_resolve_assignee_name(db, t.assignee_id))
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
    """Delete a task. Template-originated tasks are soft-deleted (is_deleted=1)
    to prevent re-creation on template re-sync. Manual tasks are hard-deleted."""
    uid, uname = _get_user_info(user)
    t = db.query(Task).filter(Task.id == task_id).first()
    if not t:
        return False

    project_id = t.project_id
    stage_id = t.stage_id
    title = t.title
    assignee_name = "、".join(_resolve_assignee_names(db, t.assignee_ids)) if t.assignee_ids else _resolve_assignee_name(db, t.assignee_id)

    if t.template_id:
        # Soft-delete template task: hide from lists but preserve data
        t.is_deleted = 1
        db.commit()
        if stage_id:
            _recalc_stage_progress(db, stage_id)
        _log_audit(db, project_id, uname, "task_delete", f"移除模板任务 #{task_id}: {title}",
                   task_name=title, task_assignee=assignee_name, task_id=task_id)
    else:
        # Hard delete manual task
        db.query(WorkLog).filter(WorkLog.task_id == task_id).delete()
        db.query(TaskComment).filter(TaskComment.task_id == task_id).delete()
        db.delete(t)
        db.commit()
        if stage_id:
            _recalc_stage_progress(db, stage_id)
        _log_audit(db, project_id, uname, "task_delete", f"删除任务 #{task_id}: {title}",
                   task_name=title, task_assignee=assignee_name, task_id=task_id)
    return True


def recalc_consumed_hours(db: Session, task_id: int):
    """Update task.consumed_hours from sum of worklog calculated_hours (fallback to hours)."""
    total = db.query(WorkLog).with_entities(
        sa_func.coalesce(
            sa_func.sum(sa_func.coalesce(WorkLog.calculated_hours, WorkLog.hours)),
        0)
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
    # Resolve assignee name and project name
    assignee_name = None
    proj_code = None
    proj_name = None
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

    # Resolve product: 优先 task.product_id（多产品项目显式指定），否则回退「项目 → 第一个产品」
    prod_id = t.product_id
    prod_name = None
    prod_code = None
    from backend.models.zentao import ProductProjectLink as PPL, PmaProduct
    if prod_id and db:
        prod = db.query(PmaProduct).filter(PmaProduct.id == prod_id).first()
        if prod:
            prod_name = prod.name
            prod_code = prod.code
    elif t.project_id and db:
        plink = db.query(PPL).filter(PPL.project_id == t.project_id).first()
        if plink:
            prod = db.query(PmaProduct).filter(PmaProduct.id == plink.product_id).first()
            if prod:
                prod_id = prod.id
                prod_name = prod.name
                prod_code = prod.code

    # Latest activity: most recent worklog description or comment content
    latest_activity = None
    if db:
        latest_wl = db.query(WorkLog).filter(WorkLog.task_id == t.id).order_by(WorkLog.created_at.desc()).first()
        latest_cmt = db.query(TaskComment).filter(TaskComment.task_id == t.id).order_by(TaskComment.created_at.desc()).first()
        wl_time = latest_wl.created_at if latest_wl else None
        cmt_time = latest_cmt.created_at if latest_cmt else None
        if wl_time or cmt_time:
            if wl_time and (not cmt_time or wl_time >= cmt_time):
                # Resolve worklog username
                wl_user = None
                if latest_wl.user_id:
                    u = db.query(LocalUser).filter(LocalUser.id == latest_wl.user_id).first()
                    if u:
                        wl_user = u.display_name or u.username
                latest_activity = {
                    "type": "worklog",
                    "content": latest_wl.description or "",
                    "username": wl_user or "?",
                    "created_at": to_local_str(wl_time) if wl_time else None,
                }
            else:
                cmt_user = None
                if latest_cmt.user_id:
                    u = db.query(LocalUser).filter(LocalUser.id == latest_cmt.user_id).first()
                    if u:
                        cmt_user = u.display_name or u.username
                latest_activity = {
                    "type": "comment",
                    "content": latest_cmt.content or "",
                    "username": cmt_user or "?",
                    "created_at": to_local_str(cmt_time) if cmt_time else None,
                }

    return {
        "id": t.id,
        "project_id": t.project_id,
        "project_name": proj_name,
        "project_code": proj_code,
        "product_id": prod_id,
        "product_name": prod_name,
        "product_code": prod_code,
        "stage_name": t.stage_name,
        "title": t.title,
        "description": t.description,
        "status": t.status,
        "priority": t.priority,
        "type": t.type,
        "assignee_id": t.assignee_id,
        "assignee_name": assignee_name,
        "assignee_username": None,
        "assignee_ids": t.assignee_ids or ([t.assignee_id] if t.assignee_id else []),
        "assignee_names": _resolve_assignee_names(db, t.assignee_ids) if db and t.assignee_ids else ([assignee_name] if assignee_name else []),
        "assignee_progress": t.assignee_progress or {},
        "reviewer_id": t.reviewer_id,
        "reviewer_name": _resolve_reviewer_name(db, t.reviewer_id) if db else "",
        "reporter_id": t.reporter_id,
        "reporter_name": _resolve_reporter_name(db, t.reporter_id) if db else "",
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
        "latest_activity": latest_activity,
        "stage_id": t.stage_id,
        "template_id": t.template_id,
        "template_info": _resolve_template_info(db, t.template_id),
        "is_diverged": t.is_diverged,
        "is_deleted": t.is_deleted,
        "cc_user_ids": t.cc_user_ids or [],
        "cc_user_names": _resolve_cc_names(db, t.cc_user_ids) if db and t.cc_user_ids else [],
    }


def _resolve_template_info(db, template_id):
    """Return template detail {id, name, stage_type, project_type} for a task's
    template, or None if the task is manual / template missing. Used by the 任务来源
    badge in task detail to show + link to the source template."""
    if not template_id or not db:
        return None
    from backend.models.document import TaskTemplate
    tpl = db.query(TaskTemplate).filter(TaskTemplate.id == template_id).first()
    if not tpl:
        return None
    return {
        "id": tpl.id,
        "name": tpl.task_name,
        "stage_type": tpl.stage_type,
        "project_type": tpl.project_type,
        "project_type_label": _project_type_label(tpl.project_type),
    }


def _project_type_label(project_type):
    """Map project_type code → display label (RD→研发项目, SC→生产项目, fallback=code)."""
    try:
        from backend.services.document_service import PROJECT_TYPE_DEFS
        return PROJECT_TYPE_DEFS.get(project_type, {}).get("label") or project_type
    except Exception:
        return project_type


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


def _log_audit(db: Session, project_id: int, username: Optional[str], action: str, detail: str,
               task_name: str = "", task_assignee: str = "", task_id: int = None):
    """Record task operation to audit log + project activity."""
    if not username:
        return
    try:
        from backend.audit_categories import AUDIT_CAT_TASK
        from backend.models.local import AuditLog, ProjectActivity
        _TASK_ACTION_CN = {
            "task_create": "任务创建",
            "task_create_batch": "批量创建任务",
            "task_import": "导入任务",
            "task_update": "任务更新",
            "task_delete": "任务删除",
        }
        # Resolve project code for structured context (PEXXX shown in operation log)
        project_code = ""
        if project_id:
            from backend.models.zentao import CachedProject
            proj = db.query(CachedProject).filter(CachedProject.id == project_id).first()
            if proj:
                project_code = proj.code or ""
        # Level per CLAUDE.md: 删除=high；新增/编辑=medium；其余 low
        _TASK_ACTION_LEVEL = {
            "task_delete": "high",
            "task_create": "medium",
            "task_create_batch": "medium",
            "task_import": "medium",
            "task_update": "medium",
        }
        log = AuditLog(
            username=username,
            action=action,
            detail=detail,
            category=AUDIT_CAT_TASK,
            level=_TASK_ACTION_LEVEL.get(action, "low"),
            project_id=project_id,
            project_code=project_code,
            task_id=task_id,
            task_name=task_name or "",
            task_assignee=task_assignee or "",
        )
        db.add(log)
        # Also write to ProjectActivity so it appears in project detail timeline
        if project_id:
            act = ProjectActivity(
                project_id=project_id,
                username=username,
                action=_TASK_ACTION_CN.get(action, action),
                detail=detail,
                task_id=task_id,
                task_name=task_name or "",
                task_assignee=task_assignee or "",
            )
            db.add(act)
        db.commit()
    except Exception:
        pass  # audit log should never block task operations


def _link_task_to_stage(db: Session, t: Task) -> Optional[int]:
    """Auto-set t.stage_id by matching t.stage_name to a ProjectStage row in the same project.
    Returns the stage_id if linked, or None."""
    if not t.stage_name or not t.project_id:
        return t.stage_id
    from backend.models.project_stage import ProjectStage
    # If already linked, verify stage_name still matches; re-link if changed
    if t.stage_id:
        current = db.query(ProjectStage).filter(ProjectStage.id == t.stage_id).first()
        if current and current.name == t.stage_name:
            return t.stage_id
    # Find matching stage by name
    stage = db.query(ProjectStage).filter(
        ProjectStage.project_id == t.project_id,
        ProjectStage.name == t.stage_name,
    ).first()
    if stage:
        t.stage_id = stage.id
        db.commit()
        return stage.id
    return None


def _recalc_stage_progress(db: Session, stage_id: int) -> list[str]:
    """Recalculate and cache stage.progress from all linked tasks.
    Returns a list of human-readable messages about auto-updates performed."""
    messages = []
    from backend.models.project_stage import ProjectStage
    stage = db.query(ProjectStage).filter(ProjectStage.id == stage_id).first()
    if not stage:
        return messages
    tasks = db.query(Task).filter(Task.stage_id == stage_id).all()
    if not tasks:
        # Fallback: match by stage_name
        tasks = db.query(Task).filter(
            Task.project_id == stage.project_id,
            Task.stage_name == stage.name,
        ).all()
    progs = [t.progress or 0 for t in tasks]
    pct = round(sum(progs) / len(progs)) if progs else 0
    if stage.progress != pct:
        stage.progress = pct
        db.commit()
    # #125: 阶段进度100% → 自动切换阶段状态为"已完成"
    if pct >= 100 and stage.status != 'completed':
        stage.status = 'completed'
        db.commit()
        messages.append(f'阶段"{stage.name}"进度100%，已自动设为已完成')
    # Sync project overall progress
    from backend.models.zentao import CachedProject
    project = db.query(CachedProject).filter(CachedProject.id == stage.project_id).first()
    if project:
        all_tasks = db.query(Task).filter(Task.project_id == stage.project_id).all()
        all_progs = [t.progress or 0 for t in all_tasks]
        proj_pct = round(sum(all_progs) / len(all_progs)) if all_progs else 0
        if project.progress != proj_pct:
            project.progress = proj_pct
            db.commit()
        # #122: 项目立项阶段进度 ↔ 项目状态联动
        if stage.name and '项目立项' in stage.name:
            # NEVER auto-transition abolished projects (#231)
            if project.status == "abolished":
                pass  # abolished is a terminal manual state, no auto-transitions
            elif stage.status == 'completed' and pct >= 100 and project.status != 'doing':
                project.status = 'doing'
                db.commit()
                messages.append(f'项目"{project.name}"立项阶段已完成，项目状态已自动切换为进行中')
            elif (stage.status != 'completed' or pct < 100) and project.status == 'doing':
                project.status = 'wait'
                db.commit()
                messages.append(f'项目"{project.name}"立项阶段进度回退，项目状态已自动切换为待启动')
    return messages

def _resolve_reporter_name(db: Session, reporter_id) -> str:
    """Resolve reporter_id to display_name."""
    if not reporter_id:
        return ""
    from backend.models.local import LocalUser
    u = db.query(LocalUser).filter(LocalUser.id == reporter_id).first()
    if u:
        return u.display_name or u.username
    return ""


def _resolve_reviewer_name(db: Session, reviewer_id) -> str:
    """Resolve reviewer_id to display_name."""
    if not reviewer_id:
        return ""
    from backend.models.local import LocalUser
    u = db.query(LocalUser).filter(LocalUser.id == reviewer_id).first()
    if u:
        return u.display_name or u.username
    return ""


def _resolve_cc_names(db, cc_user_ids) -> list:
    """Resolve cc_user_ids list to display_name list."""
    if not cc_user_ids:
        return []
    from backend.models.local import LocalUser
    cc_users = db.query(LocalUser).filter(LocalUser.id.in_(cc_user_ids)).all()
    return [u.display_name or u.username for u in cc_users]


def get_user_tasks(db, user_id, limit=500):
    """返回某用户的所有相关任务：负责人 + 创建人 + 被抄送 + 关注 (tagged with _source)."""
    result = []
    seen_ids = set()

    # 1. Tasks assigned to the user (primary assignee)
    assigned = db.query(Task).filter(
        Task.assignee_id == user_id,
        or_(Task.is_deleted == 0, Task.is_deleted == None),
    ).order_by(Task.created_at.desc()).limit(limit).all()
    for t in assigned:
        d = _task_dict(t, db)
        d["_source"] = "assigned"
        result.append(d)
        seen_ids.add(t.id)

    # 1b. Tasks where user is in assignee_ids but not the first assignee
    assignee_q = db.query(Task).filter(
        Task.assignee_ids.isnot(None),
        Task.assignee_id != user_id,
        or_(Task.is_deleted == 0, Task.is_deleted == None),
    ).order_by(Task.created_at.desc()).limit(limit * 2).all()
    for t in assignee_q:
        if t.id not in seen_ids and user_id in (t.assignee_ids or []):
            d = _task_dict(t, db)
            d["_source"] = "assigned"
            result.append(d)
            seen_ids.add(t.id)

    # 2. Tasks reported by the user
    reported = db.query(Task).filter(
        Task.reporter_id == user_id,
        or_(Task.is_deleted == 0, Task.is_deleted == None),
    ).order_by(Task.created_at.desc()).limit(limit).all()
    for t in reported:
        if t.id not in seen_ids:
            d = _task_dict(t, db)
            d["_source"] = "reported"
            result.append(d)
            seen_ids.add(t.id)

    # 3. Tasks CC'd to the user
    cc_q = db.query(Task).filter(
        Task.cc_user_ids.isnot(None),
        or_(Task.is_deleted == 0, Task.is_deleted == None),
    ).order_by(Task.created_at.desc()).limit(limit * 2)
    for t in cc_q.all():
        if t.id not in seen_ids and user_id in (t.cc_user_ids or []):
            d = _task_dict(t, db)
            d["_source"] = "cc"
            result.append(d)
            seen_ids.add(t.id)

    # 4. Tasks the user is watching (from favorites.tasks[])
    from backend.models.local import LocalUser
    user = db.query(LocalUser).filter(LocalUser.id == user_id).first()
    if user:
        try:
            favs = json.loads(user.favorites or '{}')
        except (json.JSONDecodeError, TypeError):
            favs = {}
        if isinstance(favs, list):
            favs = {"products": favs, "projects": [], "tasks": [], "bugs": []}
        watched_ids = favs.get("tasks", [])
        if watched_ids:
            watched_tasks = db.query(Task).filter(
                Task.id.in_(watched_ids),
                or_(Task.is_deleted == 0, Task.is_deleted == None),
            ).all()
            for t in watched_tasks:
                if t.id not in seen_ids:
                    d = _task_dict(t, db)
                    d["_source"] = "watched"
                    result.append(d)
                    seen_ids.add(t.id)

    source_order = {"assigned": 0, "reported": 1, "cc": 2, "watched": 3}
    result.sort(key=lambda d: (
        source_order.get(d.get("_source", "watched"), 3),
        -(d.get("id") or 0)
    ))
    return result[:limit * 2]


def _recalc_task_progress(db: Session, t: Task) -> int:
    """Calculate task overall progress from assignee_progress.
    Equal weight average of all assignees' individual progress.
    Returns the calculated progress value (0-100)."""
    assignee_ids = t.assignee_ids or ([t.assignee_id] if t.assignee_id else [])
    if not assignee_ids:
        return 0
    progress_map = t.assignee_progress or {}
    total = sum(int(progress_map.get(str(aid), progress_map.get(aid, 0)) or 0) for aid in assignee_ids)
    return int(total / len(assignee_ids))


def update_my_progress(db: Session, task_id: int, user_id: int, progress: int, user=None) -> Optional[dict]:
    """Update current user's own progress on a task. Only the assignee can update their own progress."""
    t = db.query(Task).filter(Task.id == task_id).first()
    if not t:
        return None

    assignee_ids = t.assignee_ids or ([t.assignee_id] if t.assignee_id else [])
    if user_id not in assignee_ids:
        raise PermissionError("只有任务责任人才可以更新自己的进度")

    progress = max(0, min(100, int(progress or 0)))
    progress_map = dict(t.assignee_progress or {})
    # Store with both int keys (for SQLite JSON roundtrip compatibility)
    progress_map[str(user_id)] = progress
    t.assignee_progress = progress_map

    # Recalculate overall task progress
    new_progress = _recalc_task_progress(db, t)
    t.progress = new_progress

    # Auto-update task status based on progress
    auto_messages = []
    old_status = t.status

    if new_progress >= 100 and old_status not in ("done", "closed"):
        approval_enabled = PmaSetting.get(db, "approval_enabled", "1") == "1"
        if not approval_enabled:
            t.status = "done"
            t.completed_at = datetime.now(timezone.utc)
            auto_messages.append("所有成员进度已达100%，任务已自动完成")
        else:
            reviewer_id = None
            if t.stage_id:
                from backend.models.project_stage import ProjectStage
                stage = db.query(ProjectStage).filter(ProjectStage.id == t.stage_id).first()
                if stage and stage.owner_id:
                    reviewer_id = stage.owner_id
            if reviewer_id and (reviewer_id == t.assignee_id or (t.assignee_ids and reviewer_id in t.assignee_ids)):
                t.status = "done"
                t.completed_at = datetime.now(timezone.utc)
                auto_messages.append("所有成员进度已达100%（自审），任务已自动完成")
            elif old_status not in ("review",):
                t.status = "review"
                t.reviewer_id = reviewer_id
                auto_messages.append("所有成员进度已达100%，任务已进入评审中")

    # Also handle the reverse: progress drops below 100 from a completed state
    if new_progress < 100 and old_status in ("done", "closed"):
        t.status = "in_progress"
        t.completed_at = None
        auto_messages.append("进度更新，任务已重新打开")

    db.commit()
    db.refresh(t)

    # Add auto-message as a comment
    uid, uname = _get_user_info(user) if user else (None, None)
    if auto_messages:
        for msg in auto_messages:
            db.add(TaskComment(task_id=t.id, user_id=user_id, content=msg))
        db.commit()

        if uname and t.project_id:
            _log_audit(db, t.project_id, uname, "task_update",
                       f"更新任务「{t.title}」进度: {auto_messages[0]}",
                       task_name=t.title,
                       task_assignee="、".join(_resolve_assignee_names(db, t.assignee_ids)) if t.assignee_ids else _resolve_assignee_name(db, t.assignee_id),
                       task_id=t.id)

    result = _task_dict(t, db)
    result["auto_messages"] = auto_messages
    return result
