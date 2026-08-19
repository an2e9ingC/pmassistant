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


def _action_dict(a: EntityAction, changes: list, username: str, display_name: str) -> dict:
    return {
        "id": a.id,
        "type": "action",
        "action": a.action,
        "user_id": a.user_id,
        "username": username,
        "display_name": display_name,
        "comment": a.comment,
        "changes": [
            {"field": c.field, "old_value": c.old_value, "new_value": c.new_value}
            for c in changes
        ],
        "created_at": to_local_str(a.created_at) if a.created_at else None,
    }


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
        timeline.append(_action_dict(a, changes.get(a.id, []), uname, dname))
    for c in comments:
        uname, dname = users.get(c.user_id, ("?", "?"))
        timeline.append(_comment_dict(entity_type, c, uname, dname))

    timeline.sort(key=lambda x: x["created_at"] or "")
    return timeline
