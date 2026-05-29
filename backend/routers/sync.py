from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func

from backend.config import settings
from backend.database import get_db
from backend.middleware.auth import get_current_user, require_admin
from backend.models.local import SyncLog
from backend.services.sync_service import SyncService

router = APIRouter(prefix="/api/sync", tags=["sync"])


@router.post("/trigger", response_model=dict)
async def trigger_sync(_=Depends(require_admin)):
    svc = SyncService()
    result = await svc.full_sync()
    return result


@router.get("/status", response_model=dict)
def sync_status(db: Session = Depends(get_db), _=Depends(get_current_user)):
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
            duration = None
            if log.finished_at and log.started_at:
                duration = round((log.finished_at - log.started_at).total_seconds(), 1)
            status_list.append({
                "entity_type": log.entity_type,
                "status": log.status,
                "items_fetched": log.items_fetched,
                "items_created": log.items_created,
                "items_updated": log.items_updated,
                "started_at": log.started_at.isoformat() if log.started_at else None,
                "finished_at": log.finished_at.isoformat() if log.finished_at else None,
                "duration_seconds": duration,
                "error_message": log.error_message,
            })
    return {"code": 0, "data": status_list, "message": "ok"}


@router.get("/history", response_model=dict)
def sync_history(
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    logs = (
        db.query(SyncLog)
        .order_by(SyncLog.started_at.desc())
        .limit(limit)
        .all()
    )
    items = []
    for log in logs:
        duration = None
        if log.finished_at and log.started_at:
            duration = round((log.finished_at - log.started_at).total_seconds(), 1)
        items.append({
            "id": log.id,
            "entity_type": log.entity_type,
            "status": log.status,
            "items_fetched": log.items_fetched,
            "started_at": log.started_at.isoformat() if log.started_at else None,
            "finished_at": log.finished_at.isoformat() if log.finished_at else None,
            "duration_seconds": duration,
            "error_message": log.error_message,
        })
    return {"code": 0, "data": items, "message": "ok"}


@router.get("/sources", response_model=dict)
def sync_sources(db: Session = Depends(get_db), _=Depends(get_current_user)):
    """Return configuration and sync status for all data sources."""
    sources = []

    # Zentao — always configured (required)
    zentao_log = (
        db.query(SyncLog)
        .filter(SyncLog.entity_type == "projects")
        .order_by(SyncLog.started_at.desc())
        .first()
    )
    zentao_status = "pending"
    if zentao_log:
        zentao_status = zentao_log.status if zentao_log.status != "running" else "ok"
    sources.append({
        "key": "zentao",
        "name": "禅道",
        "configured": True,
        "sync_status": zentao_status,
        "last_sync": zentao_log.finished_at.isoformat() if (zentao_log and zentao_log.finished_at) else None,
        "description": "项目管理（项目/迭代/任务/Bug）",
    })

    # GitLab — configured if token is set
    gitlab_configured = bool(settings.GITLAB_TOKEN)
    sources.append({
        "key": "gitlab",
        "name": "GitLab",
        "configured": gitlab_configured,
        "sync_status": "pending",
        "last_sync": None,
        "description": "代码仓库（commit统计、发布验证）" if gitlab_configured else "代码仓库（未配置Token）",
    })

    # NAS — not yet integrated
    sources.append({
        "key": "nas",
        "name": "NAS",
        "configured": False,
        "sync_status": "pending",
        "last_sync": None,
        "description": "文件存储（售前项目检测、交付文档）",
    })

    return {"code": 0, "data": sources, "message": "ok"}
