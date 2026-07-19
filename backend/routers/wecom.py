"""WeCom (企业微信) API endpoints — calendar read-only + user search."""
import time as _time
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.middleware.auth import get_current_user, require_admin
from backend.models.local import LocalUser
from backend.services import wecom_service

router = APIRouter(prefix="/api/wecom", tags=["wecom"])

# Cached user list from WeCom — refreshed every 5 minutes
_wecom_users_cache = {"users": [], "fetched_at": 0.0}


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
    _=Depends(get_current_user),
):
    """Search WeCom users by name or userid. Cached for 5 minutes."""
    global _wecom_users_cache
    if not _wecom_users_cache["users"] or _time.time() - _wecom_users_cache["fetched_at"] > 300:
        from backend.services.wecom_client import WeComClient
        client = WeComClient()
        try:
            await client.authenticate()
            users = await client.get_user_list()
            _wecom_users_cache = {"users": users, "fetched_at": _time.time()}
        except Exception as e:
            if not _wecom_users_cache["users"]:
                return {"code": 0, "data": [], "message": f"获取失败: {e}"}
        finally:
            await client.close()

    users = _wecom_users_cache["users"]
    q_lower = q.strip().lower()
    if q_lower:
        users = [u for u in users if q_lower in (u.get("name", "") + u.get("userid", "")).lower()]
    result = [{"userid": u.get("userid", ""), "name": u.get("name", ""),
               "department": u.get("department", "")} for u in users[:50]]
    return {"code": 0, "data": result, "message": "ok"}
