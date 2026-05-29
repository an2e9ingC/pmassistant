from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.middleware.auth import get_current_user
from backend.services import dashboard_service, bug_service

_STATUS_MAP = {
    "wait": "pending", "doing": "active", "done": "completed",
    "closed": "completed", "suspended": "blocked", "canceled": "canceled",
}

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/kpi", response_model=dict)
def get_kpi(db: Session = Depends(get_db), _=Depends(get_current_user)):
    data = dashboard_service.get_kpi(db)
    return {"code": 0, "data": data, "message": "ok"}


@router.get("/projects", response_model=dict)
def get_projects(
    search: Optional[str] = Query(None),
    type: Optional[str] = Query(None),  # noqa: A002
    status: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    sort_by: str = Query("end"),
    sort_order: str = Query("asc"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    items, total = dashboard_service.get_project_list(
        db, search, type, status, category, sort_by, sort_order, page, limit,
    )
    return {
        "code": 0,
        "data": {
            "page": page,
            "limit": limit,
            "total": total,
            "items": [_project_list_item(p) for p in items],
        },
        "message": "ok",
    }


@router.get("/alerts", response_model=dict)
def get_alerts(
    severity: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    items, total = dashboard_service.get_alerts(db, severity, page, limit)
    return {
        "code": 0,
        "data": {
            "page": page,
            "limit": limit,
            "total": total,
            "items": items,
        },
        "message": "ok",
    }


@router.get("/bugs", response_model=dict)
def get_bug_stats(
    project_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    stats = bug_service.get_bug_stats(db, project_id)
    bugs, total = bug_service.get_bug_list(db, project_id, page=1, limit=100)
    return {"code": 0, "data": {"stats": stats, "bugs": bugs, "total": total}, "message": "ok"}


def _project_list_item(p) -> dict:
    # Determine current stage
    exc = getattr(p, "executions", None)
    current_stage = None
    if exc and len(exc) > 0:
        active = [e for e in exc if e.status in ("doing",)]
        current_stage = (active[0].name if active else exc[-1].name) if exc else None

    # Customer: prefer stored value, fallback to on-the-fly extraction
    customer = p.customer_name or ""
    if not customer:
        customer = _extract_customer_fallback(p)

    # Tags: prefer stored value, fallback to on-the-fly extraction from raw_json desc
    tags_str = p.tags or ""
    if not tags_str:
        tags_str = _extract_tags_fallback(p)
    tags_list = tags_str.split(",") if tags_str else []

    return {
        "id": p.id,
        "code": p.code,
        "name": p.name,
        "type": p.project_type or "RD",
        "status": _STATUS_MAP.get(p.status, p.status or "pending"),
        "progress": p.progress or "0",
        "begin": str(p.begin) if p.begin else None,
        "end": str(p.end) if p.end else None,
        "pm_name": p.pm_name,
        "current_stage": current_stage,
        "customer_name": customer,
        "description": p.description or "",
        "tags": tags_str,
        "tags_list": tags_list,
    }


def _extract_customer_fallback(p) -> str:
    """Extract customer from project name or raw_json desc as fallback."""
    import re as _re
    # Try project name pattern: PE0406-CDLY-xxx -> CDLY
    if p.name:
        parts = p.name.split("-")
        if len(parts) >= 2:
            second = parts[1].strip()
            if _re.match(r"^[A-Z]{2,6}$", second):
                return second
    # Fallback to 【...】 in raw_json desc (strip HTML tags first)
    if p.raw_json:
        try:
            import json as _json
            data = _json.loads(p.raw_json)
            desc = data.get("desc", "") or ""
            plain = _re.sub(r"<[^>]+>", "", desc)
            m = _re.search(r"【([A-Z]{2,6})】", plain)
            if m:
                return m.group(1).strip()
        except Exception:
            pass
    return ""


def _extract_tags_fallback(p) -> str:
    """Extract #tags from project raw_json desc as fallback."""
    import re as _re
    if p.raw_json:
        try:
            import json as _json
            data = _json.loads(p.raw_json)
            desc = data.get("desc", "") or ""
            plain = _re.sub(r"<[^>]+>", "", desc)
            tags = _re.findall(r"#([\w一-鿿]+)", plain)
            return ",".join(tags) if tags else ""
        except Exception:
            pass
    return ""
