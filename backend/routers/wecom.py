"""WeCom (企业微信) API endpoints — calendar read-only."""
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.middleware.auth import get_current_user
from backend.models.local import LocalUser
from backend.services import wecom_service

router = APIRouter(prefix="/api/wecom", tags=["wecom"])


@router.get("/calendar", response_model=dict)
def wecom_calendar(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    user: LocalUser = Depends(get_current_user),
):
    """Get WeCom checkin calendar data for the current user.

    Read-only — fetches from PMA DB only, no remote WeCom API call.
    """
    data = wecom_service.get_checkin_calendar(db, user, date_from, date_to)
    return {"code": 0, "data": data, "message": "ok"}
