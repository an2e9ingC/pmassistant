"""Entity action log (task/bug change history) service."""
from __future__ import annotations
import logging

logger = logging.getLogger(__name__)

from sqlalchemy.orm import Session

from backend.models.action import EntityAction, EntityActionChange
from backend.models.task import TaskComment
from backend.models.bug import BugComment
from backend.models.local import LocalUser
from backend.database import to_local_str


def record_action(db: Session, entity_type: str, entity_id: int, user_id: int,
                  action: str, changes: list = None, comment: str = None) -> EntityAction:
    """Record an action + its field-level changes (Zentao-style)."""
    a = EntityAction(
        entity_type=entity_type,
        entity_id=entity_id,
        user_id=user_id,
        action=action,
        comment=comment,
    )
    db.add(a)
    db.flush()  # get a.id

    for ch in (changes or []):
        db.add(EntityActionChange(
            action_id=a.id,
            field=ch.get("field"),
            old_value=ch.get("old_value"),
            new_value=ch.get("new_value"),
        ))
    db.commit()
    return a


def _resolve_users(db: Session, user_ids) -> dict:
    """Batch-resolve user_id → (username, display_name)."""
    if not user_ids:
        return {}
    users = db.query(LocalUser).filter(LocalUser.id.in_(user_ids)).all()
    return {u.id: (u.username or "?", u.display_name or u.username or "?") for u in users}


def _action_dict(a: EntityAction, changes: list, username: str, display_name: str,
                 name_map: dict = None) -> dict:
    """Serialize an action. User-id fields render as Chinese names (see _resolve_change_user_ids)."""
    name_map = name_map or {}
    return {
        "id": a.id,
        "type": "action",
        "action": a.action,
        "user_id": a.user_id,
        "username": username,
        "display_name": display_name,
        "comment": a.comment,
        "changes": [
            {"field": c.field,
             "old_value": _map_change_value(c.field, c.old_value, name_map),
             "new_value": _map_change_value(c.field, c.new_value, name_map)}
            for c in changes
        ],
        "created_at": to_local_str(a.created_at) if a.created_at else None,
    }


# 用户字段：变更历史中这些字段的取值是"用户id"或"用户id、用户id…"，读取时统一映射为中文名
_USER_FIELDS = {"assignee_id", "assignee_ids", "reviewer_id", "resolved_by_id", "cc_user_ids"}


def _map_change_value(field, value, name_map):
    """Map numeric user-id tokens in a change value to Chinese display names (names kept as-is)."""
    if field not in _USER_FIELDS or not value:
        return value
    tokens = [t for t in str(value).split("、")]
    resolved = []
    for t in tokens:
        ts = t.strip()
        if ts.isdigit() and int(ts) in name_map:
            resolved.append(name_map[int(ts)])
        else:
            resolved.append(t)
    return "、".join(resolved)


def _collect_change_user_ids(changes):
    """Gather all user ids referenced by user-field change rows."""
    ids = set()
    for c in changes:
        if c.field not in _USER_FIELDS:
            continue
        for v in (c.old_value, c.new_value):
            if not v:
                continue
            for t in str(v).split("、"):
                ts = t.strip()
                if ts.isdigit():
                    ids.add(int(ts))
    return ids


def _comment_dict(type_label: str, c, username: str, display_name: str) -> dict:
    return {
        "id": c.id,
        "type": "comment",
        "entity_type": type_label,
        "user_id": c.user_id,
        "username": username,
        "display_name": display_name,
        "content": c.content,
        "is_deleted": c.is_deleted or 0,
        "created_at": to_local_str(c.created_at) if c.created_at else None,
    }


def get_timeline(db: Session, entity_type: str, entity_id: int) -> list:
    """Return a merged, time-ordered timeline of actions + comments."""
    # Actions + changes
    actions = db.query(EntityAction).filter(
        EntityAction.entity_type == entity_type,
        EntityAction.entity_id == entity_id,
    ).order_by(EntityAction.created_at.asc()).all()

    changes = {}
    if actions:
        change_rows = db.query(EntityActionChange).filter(
            EntityActionChange.action_id.in_([a.id for a in actions])
        ).all()
        for c in change_rows:
            changes.setdefault(c.action_id, []).append(c)

    # 变更历史中用户字段的取值是用户 id：读取时统一映射为中文名（负责人/审批人/解决人/抄送人）
    change_uids = _collect_change_user_ids([c for cs in changes.values() for c in cs])
    change_name_map = {}
    if change_uids:
        for u in db.query(LocalUser).filter(LocalUser.id.in_(change_uids)).all():
            change_name_map[u.id] = u.display_name or u.username or u.id

    # Comments (task vs bug)
    comments = []
    if entity_type == "task":
        comments = db.query(TaskComment).filter(TaskComment.task_id == entity_id).order_by(TaskComment.created_at.asc()).all()
    elif entity_type == "bug":
        comments = db.query(BugComment).filter(BugComment.bug_id == entity_id).order_by(BugComment.created_at.asc()).all()

    # Resolve users
    uids = set()
    for a in actions:
        uids.add(a.user_id)
    for c in comments:
        uids.add(c.user_id)
    users = _resolve_users(db, uids)

    timeline = []
    for a in actions:
        uname, dname = users.get(a.user_id, ("?", "?"))
        timeline.append(_action_dict(a, changes.get(a.id, []), uname, dname, change_name_map))
    for c in comments:
        uname, dname = users.get(c.user_id, ("?", "?"))
        timeline.append(_comment_dict(entity_type, c, uname, dname))

    timeline.sort(key=lambda x: x["created_at"] or "")
    return timeline
