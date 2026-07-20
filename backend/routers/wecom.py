"""WeCom (企业微信) API endpoints — calendar + user search + user list."""
import json
import time as _time
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.middleware.auth import get_current_user, require_admin
from backend.models.local import LocalUser
from backend.models.wecom import WeComUser
from backend.services import wecom_service

router = APIRouter(prefix="/api/wecom", tags=["wecom"])


@router.get("/calendar", response_model=dict)
def wecom_calendar(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    user: LocalUser = Depends(get_current_user),
):
    """Get WeCom checkin calendar data for the current user."""
    data = wecom_service.get_checkin_calendar(db, user, date_from, date_to)
    return {"code": 0, "data": data, "message": "ok"}


@router.get("/users", response_model=dict)
async def wecom_users(
    q: str = Query("", description="Search query (name or userid)"),
    refresh: bool = Query(False, description="Force re-sync from WeCom"),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """Search WeCom users by name or userid. Reads from PMA DB, syncs on first call or refresh."""
    from backend.models.wecom import WeComUser

    # Check if we need to sync first
    last_synced = db.query(WeComUser.synced_at).order_by(WeComUser.synced_at.desc()).first()
    need_sync = refresh or not last_synced

    if need_sync:
        try:
            from backend.services.wecom_client import WeComClient
            client = WeComClient()
            await client.authenticate()
            raw_users = await client.get_user_list()
            await client.close()

            now = datetime.now(timezone.utc)
            # Full overwrite: delete all existing, re-insert from API
            db.query(WeComUser).delete()
            for ru in raw_users:
                uid = ru.get("userid", "")
                if not uid:
                    continue
                db.add(WeComUser(
                    userid=uid,
                    name=str(ru.get("name", "") or ""),
                    department=str(ru.get("department", "") or ""),
                    raw_data=json.dumps(ru, ensure_ascii=False),
                    synced_at=now,
                ))
            db.commit()

            # Auto-match: link PMA users to WeCom users by case-insensitive userid
            unlinked = db.query(LocalUser).filter(
                (LocalUser.wecom_userid.is_(None)) | (LocalUser.wecom_userid == "")
            ).all()
            wecom_uids = {u.userid.lower(): u.userid for u in db.query(WeComUser).all()}
            matched = 0
            for pu in unlinked:
                key = pu.username.lower()
                if key in wecom_uids:
                    pu.wecom_userid = wecom_uids[key]
                    matched += 1
            if matched:
                db.commit()
                import logging
                logging.getLogger(__name__).info(f"WeCom auto-match: {matched} PMA users linked")

        except Exception as e:
            db.rollback()
            import logging
            logging.getLogger(__name__).error(f"WeCom user sync failed: {e}")
            raise

    q_lower = q.strip().lower()
    users = db.query(WeComUser).order_by(WeComUser.name).all()
    if q_lower:
        users = [u for u in users if q_lower in (u.name + u.userid).lower()]
    result = [{"userid": u.userid, "name": u.name, "department": u.department or ""} for u in users[:50]]
    return {"code": 0, "data": result, "message": "ok"}


@router.get("/users/list", response_model=dict)
def wecom_user_list(
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    """List all synced WeCom users (admin only)."""
    users = db.query(WeComUser).order_by(WeComUser.name).all()
    result = [{
        "id": u.id,
        "userid": u.userid,
        "name": u.name,
        "department": u.department or "",
        "synced_at": u.synced_at.isoformat() if u.synced_at else None,
    } for u in users]
    # Count linked PMA users
    linked_map = {}
    pma_users = db.query(LocalUser).filter(LocalUser.wecom_userid.isnot(None), LocalUser.wecom_userid != "").all()
    for pu in pma_users:
        linked_map[pu.wecom_userid] = pu.username
    for r in result:
        r["pma_user"] = linked_map.get(r["userid"], "")
    return {"code": 0, "data": result, "message": "ok"}
