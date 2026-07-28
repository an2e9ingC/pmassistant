import json
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.middleware.auth import get_current_user, require_perm
from backend.services import dashboard_service, bug_service
from backend.routers.logs import log_audit
from backend.audit_categories import AUDIT_CAT_SYSTEM

_STATUS_MAP = {
    "wait": "pending", "doing": "active", "done": "completed",
    "closed": "completed", "suspended": "blocked", "canceled": "canceled",
}

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/kpi", response_model=dict)
def get_kpi(db: Session = Depends(get_db), _=Depends(get_current_user)):
    data = dashboard_service.get_kpi(db)
    return {"code": 0, "data": data, "message": "ok"}


@router.get("/risk-config", response_model=dict)
def get_risk_config(
    db: Session = Depends(get_db),
    user=Depends(require_perm("project_edit")),
):
    """Get risk detection configuration."""
    config = dashboard_service.get_risk_config(db)
    return {"code": 0, "data": config, "message": "ok"}


@router.put("/risk-config", response_model=dict)
def update_risk_config(
    payload: dict,
    db: Session = Depends(get_db),
    user=Depends(require_perm("project_edit")),
):
    """Update risk detection configuration."""
    config = dashboard_service.set_risk_config(db, payload)
    log_audit(db, user, "risk_config_update", json.dumps(config, ensure_ascii=False), AUDIT_CAT_SYSTEM, "medium")
    return {"code": 0, "data": config, "message": "风险配置已更新"}


@router.get("/projects", response_model=dict)
def get_projects(
    search: Optional[str] = Query(None),
    type: Optional[str] = Query(None),  # noqa: A002
    status: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    program_id: Optional[int] = Query(None),
    sort_by: str = Query("end"),
    sort_order: str = Query("asc"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    items, total = dashboard_service.get_project_list(
        db, search, type, status, category, program_id, sort_by, sort_order, page, limit,
    )
    # Batch-load linked customers for all items
    from backend.models.zentao import CustomerProjectLink, PmaCustomer
    proj_ids = [p.id for p in items]
    cust_links = db.query(CustomerProjectLink).filter(CustomerProjectLink.project_id.in_(proj_ids)).all()
    cust_map = {}
    if cust_links:
        cids = set(l.customer_id for l in cust_links)
        cnames = {c.id: c.name for c in db.query(PmaCustomer).filter(PmaCustomer.id.in_(cids)).all()}
        for cl in cust_links:
            name = cnames.get(cl.customer_id)
            if name:
                cust_map.setdefault(cl.project_id, []).append(name)
    # Batch-load completion checks (4-condition: project + docs + tasks + stages)
    from backend.services.project_service import _get_pending_doc_counts, _get_incomplete_task_counts, _get_stage_anomaly_counts
    pending_map = _get_pending_doc_counts(db, proj_ids)
    incomplete_task_map = _get_incomplete_task_counts(db, proj_ids)
    stage_anomaly_map = _get_stage_anomaly_counts(db, proj_ids)
    return {
        "code": 0,
        "data": {
            "page": page,
            "limit": limit,
            "total": total,
            "items": [
                _project_list_item(p,
                    cust_map.get(p.id, []),
                    pending_map.get(p.id, False),
                    incomplete_task_map.get(p.id, False),
                    stage_anomaly_map.get(p.id, False))
                for p in items
            ],
        },
        "message": "ok",
    }


@router.get("/alerts", response_model=dict)
def get_alerts(
    severity: Optional[str] = Query(None),
    project_id: Optional[int] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    items, total = dashboard_service.get_alerts(db, severity, project_id, page, limit)
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


def _project_list_item(p, linked_customers=None, has_pending_docs: bool = False, has_incomplete_tasks: bool = False, has_stage_anomalies: bool = False) -> dict:
    # Determine current stage
    exc = getattr(p, "executions", None)
    current_stage = None
    if exc and len(exc) > 0:
        active = [e for e in exc if e.status in ("doing",)]
        current_stage = (active[0].name if active else exc[-1].name) if exc else None

    # Customer: from linked customers only (p.customer_name is deprecated stale text)
    customer = "、".join(linked_customers or [])

    # Tags: prefer stored value, fallback to on-the-fly extraction from raw_json desc
    tags_str = p.tags or ""
    if not tags_str:
        tags_str = _extract_tags_fallback(p)
    tags_list = tags_str.split(",") if tags_str else []

    from backend.services.project_service import _calc_risk_level, _map_status

    # Resolve linked project IDs to brief info for display
    linked_project_ids_str = p.linked_project_ids or ""
    linked_project_ids = [int(x.strip()) for x in linked_project_ids_str.split(",") if x.strip()]
    linked_projects = []
    if linked_project_ids:
        try:
            from sqlalchemy.orm import object_session
            from backend.models.zentao import CachedProject as CP
            sess = object_session(p)
            rows = sess.query(CP.id, CP.code, CP.name).filter(CP.id.in_(linked_project_ids)).all()
            linked_projects = [{"id": r[0], "code": r[1] or "", "name": r[2] or ""} for r in rows]
        except Exception:
            pass

    return {
        "id": p.id,
        "code": p.code,
        "name": p.name,
        "type": p.project_type or "RD",
        "status": _map_status(p.status, has_pending_docs, has_incomplete_tasks, has_stage_anomalies),
        "progress": p.progress or "0",
        "begin": str(p.begin) if p.begin else None,
        "end": str(p.end) if p.end else None,
        "pm_name": p.pm_name,
        "current_stage": current_stage,
        "customer_name": customer,
        "description": p.description or "",
        "tags": tags_str,
        "tags_list": tags_list,
        "risk_level": _calc_risk_level(p, has_pending_docs, has_incomplete_tasks, has_stage_anomalies),
        "linked_projects": linked_projects,
    }



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
