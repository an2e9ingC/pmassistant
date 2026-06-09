"""GitLab integration API routes.

Endpoints for:
- GitLab connection status
- Cached Zentao releases with GitLab URL validation status
- Trigger GitLab URL validation
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.middleware.auth import get_current_user, require_admin
from backend.models.zentao import CachedRelease, CachedProduct
from backend.config import settings

router = APIRouter(prefix="/api/gitlab", tags=["gitlab"])


@router.get("/status", response_model=dict)
async def gitlab_status(_=Depends(get_current_user)):
    """Get GitLab connection status (real-time check)."""
    if not settings.GITLAB_TOKEN:
        return {
            "code": 0,
            "data": {"configured": False, "connected": False, "version": None, "detail": "未配置Token"},
            "message": "ok",
        }

    from backend.services.gitlab_client import GitLabClient
    client = GitLabClient()
    try:
        ok, detail = await client.check_connection()
        ver = await client.get_version()
        return {
            "code": 0,
            "data": {
                "configured": True,
                "connected": ok,
                "version": ver.get("version") if ver else None,
                "detail": detail,
            },
            "message": "ok",
        }
    except Exception as e:
        return {
            "code": 0,
            "data": {"configured": True, "connected": False, "version": None, "detail": str(e)[:100]},
            "message": "ok",
        }
    finally:
        await client.close()


@router.get("/releases", response_model=dict)
def list_releases(
    product_id: int = Query(None),
    valid: bool = Query(None),  # None=all, True=valid, False=invalid
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """Get cached Zentao releases with GitLab URL validation status."""
    q = db.query(CachedRelease)

    if product_id:
        q = q.filter(CachedRelease.product_id == product_id)
    if valid is not None:
        q = q.filter(CachedRelease.gitlab_url_valid == valid)

    releases = q.order_by(CachedRelease.date.desc()).all()

    items = []
    for r in releases:
        product = db.query(CachedProduct).filter(CachedProduct.id == r.product_id).first()
        items.append({
            "id": r.id,
            "product_id": r.product_id,
            "product_name": product.name if product else "",
            "name": r.name,
            "marker": r.marker,
            "status": r.status,
            "date": r.date.isoformat() if r.date else None,
            "desc": r.desc,
            "gitlab_url": r.gitlab_url,
            "gitlab_url_valid": r.gitlab_url_valid,
            "gitlab_url_checked_at": r.gitlab_url_checked_at.isoformat() if r.gitlab_url_checked_at else None,
            "synced_at": r.synced_at.isoformat() if r.synced_at else None,
        })

    return {"code": 0, "data": items, "message": "ok"}


@router.post("/validate", response_model=dict)
async def validate_gitlab_urls(_=Depends(require_admin)):
    """Trigger GitLab URL validation for all cached releases."""
    if not settings.GITLAB_TOKEN:
        return {"code": 1, "message": "GitLab Token 未配置，无法校验"}

    from backend.database import SessionLocal
    from backend.services.gitlab_service import validate_all_releases

    db = SessionLocal()
    try:
        result = await validate_all_releases(db)
        return {"code": 0, "data": result, "message": "ok"}
    except Exception as e:
        return {"code": 1, "message": f"校验失败: {e}"}
    finally:
        db.close()


@router.get("/releases/stats", response_model=dict)
def releases_stats(db: Session = Depends(get_db), _=Depends(get_current_user)):
    """Get GitLab releases statistics with KPI data and release list."""
    from sqlalchemy import func as sa_func

    releases = db.query(CachedRelease).order_by(CachedRelease.date.desc()).all()

    total = len(releases)
    with_url = sum(1 for r in releases if r.gitlab_url)
    valid = sum(1 for r in releases if r.gitlab_url_valid is True)
    invalid = sum(1 for r in releases if r.gitlab_url_valid is False)
    unchecked = sum(1 for r in releases if r.gitlab_url and r.gitlab_url_valid is None)
    missing_url = sum(1 for r in releases if not r.gitlab_url)

    # Build detailed list
    items = []
    for r in releases:
        product = db.query(CachedProduct).filter(CachedProduct.id == r.product_id).first()
        items.append({
            "id": r.id,
            "product_id": r.product_id,
            "product_name": product.name if product else "",
            "product_code": product.code if product else "",
            "version": r.name,
            "marker": r.marker,
            "status": r.status,
            "date": r.date.isoformat() if r.date else None,
            "desc": (r.desc or "")[:200],  # preview of Zentao release description
            "gitlab_url": r.gitlab_url,
            "gitlab_url_valid": r.gitlab_url_valid,
            "gitlab_url_checked_at": r.gitlab_url_checked_at.isoformat() if r.gitlab_url_checked_at else None,
        })

    return {
        "code": 0,
        "data": {
            "kpi": {
                "total": total,
                "with_url": with_url,
                "valid": valid,
                "invalid": invalid,
                "unchecked": unchecked,
                "missing_url": missing_url,
            },
            "items": items,
        },
        "message": "ok",
    }


@router.post("/validate/url", response_model=dict)
async def validate_single_url(
    url: str = Query(...),
    _=Depends(get_current_user),
):
    """Validate a single GitLab release URL (for testing)."""
    from backend.services.gitlab_service import validate_release_url

    result = await validate_release_url(url)
    return {"code": 0, "data": result, "message": "ok"}
