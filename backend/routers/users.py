"""Public user listing for organization chart (all authenticated users)."""

import logging
logger = logging.getLogger(__name__)

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.middleware.auth import get_current_user
from backend.models.local import LocalUser
from backend.models.wecom import WeComUser
from backend.routers.admin_users import ROLE_LABELS

router = APIRouter(prefix="/api/users", tags=["users"])


def _resolve_wecom_names(users: list, db: Session) -> dict:
    """Resolve WeCom Chinese display names for a list of users."""
    wecom_uids = [u.wecom_userid for u in users if u.wecom_userid]
    wecom_map = {}
    if wecom_uids:
        for wu in db.query(WeComUser).filter(WeComUser.userid.in_(wecom_uids)).all():
            wecom_map[wu.userid] = wu.name
    return wecom_map


def _user_to_public(u: LocalUser, wecom_name: str = "") -> dict:
    """Serialize a user to the public-safe dict (no sensitive fields)."""
    return {
        "id": u.id,
        "username": u.username,
        "display_name": u.display_name or u.username,
        "role": u.role,
        "role_label": ROLE_LABELS.get(u.role, u.role),
        "roles": [
            {
                "id": ur.role_id,
                "label": ur.role.label if ur.role else "",
                "key": ur.role.key if ur.role else "",
            }
            for ur in (u.user_roles or [])
        ],
        "is_active": u.is_active,
        "auth_source": u.auth_source or "local",
        "wecom_userid": u.wecom_userid,
        "wecom_name": wecom_name,
    }


@router.get("/{user_id}", response_model=dict)
def get_user_public(
    user_id: int,
    db: Session = Depends(get_db),
    _user: LocalUser = Depends(get_current_user),
):
    """Return a single user's public profile (all authenticated users)."""
    u = db.query(LocalUser).filter(LocalUser.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    wm = _resolve_wecom_names([u], db)
    return {"code": 0, "data": _user_to_public(u, wm.get(u.wecom_userid, "")), "message": "ok"}


@router.get("", response_model=dict)
def list_users_public(
    db: Session = Depends(get_db),
    _user: LocalUser = Depends(get_current_user),
):
    """Return limited user list for organization chart (all authenticated users).

    Does NOT expose: last_login_ip, last_login_ua, permissions, last_login_at, created_at.
    """
    users = db.query(LocalUser).order_by(LocalUser.id).all()
    wecom_map = _resolve_wecom_names(users, db)

    return {
        "code": 0,
        "data": [_user_to_public(u, wecom_map.get(u.wecom_userid, "")) for u in users],
        "message": "ok",
    }
