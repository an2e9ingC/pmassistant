from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.middleware.auth import require_admin
from backend.models.local import SyncLog
from backend.services.sync_service import SyncService

router = APIRouter(prefix="/api/sync", tags=["sync"])


@router.post("/trigger", response_model=dict)
async def trigger_sync(_=Depends(require_admin)):
    svc = SyncService()
    result = await svc.full_sync()
    return result


@router.get("/status", response_model=dict)
def sync_status(db: Session = Depends(get_db), _=Depends(require_admin)):
    # Get latest sync log for each entity type
    entity_types = db.query(SyncLog.entity_type).distinct().all()
    status_list = []
    for (entity_type,) in entity_types:
        log = (
            db.query(SyncLog)
            .filter(SyncLog.entity_type == entity_type)
            .order_by(SyncLog.started_at.desc())
            .first()
        )
        if log:
            status_list.append({
                "entity_type": log.entity_type,
                "status": log.status,
                "items_fetched": log.items_fetched,
                "items_created": log.items_created,
                "items_updated": log.items_updated,
                "finished_at": log.finished_at.isoformat() if log.finished_at else None,
                "error_message": log.error_message,
            })
    return {"code": 0, "data": status_list, "message": "ok"}
