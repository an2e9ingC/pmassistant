from __future__ import annotations
from typing import Optional

from sqlalchemy.orm import Session
from sqlalchemy import func

from backend.models.bug import CachedBug
from backend.models.zentao import CachedProject


def get_bug_stats(db: Session, project_id: Optional[int] = None) -> dict:
    """Get bug statistics (FR-013)."""
    q = db.query(CachedBug)
    if project_id:
        q = q.filter(CachedBug.project_id == project_id)

    total = q.count()
    open_count = q.filter(CachedBug.status.in_(["active", "confirmed"])).count()
    resolved_count = q.filter(CachedBug.status == "resolved").count()
    closed_count = q.filter(CachedBug.status == "closed").count()

    # By severity
    severity_dist = {}
    for sev, label in [(1, "致命"), (2, "严重"), (3, "一般"), (4, "建议")]:
        cnt = q.filter(CachedBug.severity == sev).count()
        if cnt > 0:
            severity_dist[label] = cnt

    # Recent bugs (last 30 days)
    from datetime import date, timedelta
    cutoff = date.today() - timedelta(days=30)
    recent_count = q.filter(CachedBug.opened_date >= cutoff).count()

    return {
        "total": total,
        "open": open_count,
        "resolved": resolved_count,
        "closed": closed_count,
        "by_severity": severity_dist,
        "recent_30d": recent_count,
    }


def get_bug_list(
    db: Session,
    project_id: Optional[int] = None,
    status: Optional[str] = None,
    page: int = 1,
    limit: int = 50,
) -> tuple[list[dict], int]:
    q = db.query(CachedBug)
    if project_id:
        q = q.filter(CachedBug.project_id == project_id)
    if status:
        q = q.filter(CachedBug.status == status)

    total = q.count()
    bugs = q.order_by(CachedBug.severity, CachedBug.opened_date.desc()).offset(
        (page - 1) * limit
    ).limit(limit).all()
    return [_bug_item(b) for b in bugs], total


def _bug_item(b: CachedBug) -> dict:
    sev_labels = {1: "致命", 2: "严重", 3: "一般", 4: "建议"}
    return {
        "id": b.id,
        "title": b.title,
        "severity": b.severity,
        "severity_label": sev_labels.get(b.severity, str(b.severity)),
        "priority": b.priority,
        "status": b.status,
        "type": b.type,
        "opened_by": b.opened_by,
        "opened_date": str(b.opened_date) if b.opened_date else None,
        "assigned_to": b.assigned_to,
        "project_id": b.project_id,
    }
