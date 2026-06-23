"""Broadcast notification publishing and listing."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from backend.database import get_db, to_local_str
from backend.middleware.auth import get_current_user, require_perm, _get_perms
from backend.models.local import LocalUser, PmaNotification

router = APIRouter(prefix="/api/notifications", tags=["notifications"])

MAX_CONTENT_LENGTH = 32


class PublishRequest(BaseModel):
    level: str = "general"  # severe / important / general
    content: str = ""

    @field_validator("content")
    @classmethod
    def content_length(cls, v: str) -> str:
        if len(v) > MAX_CONTENT_LENGTH:
            raise ValueError(f"通知内容不能超过{MAX_CONTENT_LENGTH}字")
        if not v.strip():
            raise ValueError("通知内容不能为空")
        return v.strip()

    @field_validator("level")
    @classmethod
    def level_valid(cls, v: str) -> str:
        if v not in ("severe", "important", "general"):
            raise ValueError("通知级别无效，可选: severe, important, general")
        return v


@router.get("", response_model=dict)
def list_notifications(db: Session = Depends(get_db), _=Depends(get_current_user)):
    """Get all active notifications, newest first."""
    notifs = db.query(PmaNotification).filter(
        PmaNotification.is_active == True
    ).order_by(PmaNotification.created_at.desc()).all()

    return {
        "code": 0,
        "data": [
            {
                "id": n.id,
                "level": n.level,
                "content": n.content,
                "created_by": n.created_by,
                "created_at": to_local_str(n.created_at) if n.created_at else "",
            }
            for n in notifs
        ],
        "message": "ok",
    }


@router.post("", response_model=dict)
def publish_notification(
    payload: PublishRequest,
    db: Session = Depends(get_db),
    user: LocalUser = Depends(get_current_user),
):
    """Publish a broadcast notification.
    Requires project_edit permission.
    severe level requires admin permission.
    """
    perms = _get_perms(user)

    # Permission check: project_edit or admin
    if "admin" not in perms and "project_edit" not in perms:
        raise HTTPException(status_code=403, detail="需要项目编辑或管理员权限才能发布通知")

    # Severe level only for admin
    if payload.level == "severe" and "admin" not in perms:
        raise HTTPException(status_code=403, detail="仅管理员可发布严重级别通知")

    notif = PmaNotification(
        level=payload.level,
        content=payload.content,
        created_by=user.username,
    )
    db.add(notif)
    db.commit()
    db.refresh(notif)

    return {
        "code": 0,
        "data": {
            "id": notif.id,
            "level": notif.level,
            "content": notif.content,
            "created_by": notif.created_by,
            "created_at": to_local_str(notif.created_at) if notif.created_at else "",
        },
        "message": "通知已发布",
    }


@router.put("/{notif_id}/dismiss", response_model=dict)
def dismiss_notification(
    notif_id: int,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """Dismiss a notification (important/general only, severe cannot be dismissed)."""
    notif = db.query(PmaNotification).filter(PmaNotification.id == notif_id).first()
    if not notif:
        raise HTTPException(status_code=404, detail="通知不存在")
    if not notif.is_active:
        raise HTTPException(status_code=400, detail="通知已关闭")
    if notif.level == "severe":
        raise HTTPException(status_code=403, detail="严重级别通知不可关闭")

    notif.is_active = False
    db.commit()

    return {"code": 0, "message": "通知已关闭"}


@router.put("/{notif_id}/toggle", response_model=dict)
def toggle_notification(
    notif_id: int,
    db: Session = Depends(get_db),
    user: LocalUser = Depends(get_current_user),
):
    """Toggle notification active state. Owner or admin only."""
    notif = db.query(PmaNotification).filter(PmaNotification.id == notif_id).first()
    if not notif:
        raise HTTPException(status_code=404, detail="通知不存在")

    perms = _get_perms(user)
    if "admin" not in perms and notif.created_by != user.username:
        raise HTTPException(status_code=403, detail="只能管理自己发布的通知")

    notif.is_active = not notif.is_active
    db.commit()

    return {"code": 0, "data": {"is_active": notif.is_active}, "message": "通知已" + ("开启" if notif.is_active else "关闭")}


@router.put("/{notif_id}", response_model=dict)
def update_notification(
    notif_id: int,
    payload: dict,
    db: Session = Depends(get_db),
    user: LocalUser = Depends(get_current_user),
):
    """Edit notification content. Owner or admin only."""
    notif = db.query(PmaNotification).filter(PmaNotification.id == notif_id).first()
    if not notif:
        raise HTTPException(status_code=404, detail="通知不存在")

    perms = _get_perms(user)
    if "admin" not in perms and notif.created_by != user.username:
        raise HTTPException(status_code=403, detail="只能编辑自己发布的通知")

    content = (payload.get("content") or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="通知内容不能为空")
    if len(content) > MAX_CONTENT_LENGTH:
        raise HTTPException(status_code=400, detail=f"通知内容不能超过{MAX_CONTENT_LENGTH}字")

    notif.content = content
    db.commit()

    return {"code": 0, "message": "通知已更新"}


@router.get("/manage", response_model=dict)
def manage_notifications(
    scope: str = "mine",
    db: Session = Depends(get_db),
    user: LocalUser = Depends(get_current_user),
):
    """Get notifications for management.
    scope=mine: user's own notifications
    scope=all: all notifications (admin only)
    """
    perms = _get_perms(user)

    if scope == "all":
        if "admin" not in perms:
            raise HTTPException(status_code=403, detail="仅管理员可查看所有通知")
        query = db.query(PmaNotification)
    else:
        query = db.query(PmaNotification).filter(PmaNotification.created_by == user.username)

    notifs = query.order_by(PmaNotification.created_at.desc()).all()

    return {
        "code": 0,
        "data": [
            {
                "id": n.id,
                "level": n.level,
                "content": n.content,
                "created_by": n.created_by,
                "is_active": n.is_active,
                "created_at": to_local_str(n.created_at) if n.created_at else "",
            }
            for n in notifs
        ],
        "message": "ok",
    }


@router.delete("/{notif_id}", response_model=dict)
def delete_notification(
    notif_id: int,
    db: Session = Depends(get_db),
    user: LocalUser = Depends(get_current_user),
):
    """Delete a notification. Owner can delete own; admin can delete any."""
    notif = db.query(PmaNotification).filter(PmaNotification.id == notif_id).first()
    if not notif:
        raise HTTPException(status_code=404, detail="通知不存在")

    perms = _get_perms(user)
    if "admin" not in perms and notif.created_by != user.username:
        raise HTTPException(status_code=403, detail="只能删除自己发布的通知")

    db.delete(notif)
    db.commit()

    return {"code": 0, "message": "通知已删除"}
