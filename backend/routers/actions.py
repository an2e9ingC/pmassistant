"""Entity action timeline (task/bug change history) API routes."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.middleware.auth import get_current_user
from backend.services import action_service

router = APIRouter(prefix="/api/actions", tags=["actions"])


@router.get("")
def list_actions(
    entity_type: str = Query(..., description="'task' | 'bug'"),
    entity_id: int = Query(..., description="Entity primary key"),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """Return merged, time-ordered timeline of actions + comments."""
    if entity_type not in ("task", "bug"):
        return {"code": 1, "data": [], "message": f"不支持的 entity_type: {entity_type}"}
    timeline = action_service.get_timeline(db, entity_type, entity_id)
    return {"code": 0, "data": timeline, "message": "ok"}
