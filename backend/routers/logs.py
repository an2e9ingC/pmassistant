from __future__ import annotations
import logging
import os
import re
from typing import Optional

from fastapi import APIRouter, Depends, Query

from backend.audit_categories import AUDIT_CAT_SYSTEM
from backend.database import get_db, to_local_str
from backend.middleware.auth import require_admin, get_current_user
from backend.models.local import AuditLog, LocalUser
from sqlalchemy.orm import Session

router = APIRouter(prefix="/api/logs", tags=["logs"])


def log_audit(db: Session, user: LocalUser, action: str, detail: str = "", category: str = "", level: str = "medium"):
    """Write a structured audit log entry to the database (audit_logs table).

    Also writes a plain-text copy to the file log for backup/debugging.

    category: dynamic—query /api/logs/audit/categories for available values
    level: high(删除/权限变更)/medium(编辑/新增)/low(配置/查看)
    """
    logger = logging.getLogger("backend.routers.logs")
    uname = user.username if user else "system"
    # File log (plain-text backup)
    log_msg = f"[操作日志] {uname} | {action} | {detail}"
    if level == "high":
        logger.warning(log_msg)
    elif level == "low":
        logger.info(log_msg)
    else:
        logger.info(log_msg)
    # Database audit table (structured, authoritative)
    try:
        db.add(AuditLog(username=uname, action=action, detail=detail or "",
                         category=category or "", level=level))
        db.commit()
    except Exception as e:
        logger.error(f"Audit log write failed: {e}")


# Resolve log file path (same directory as database, port-specific)
import backend.database as _db_module
_db_dir = os.path.dirname(getattr(_db_module, "_db_path", "data/pma-8800.db"))
_port = os.environ.get("PMA_PORT", "8800")
LOG_FILE = os.path.join(_db_dir, f"pma-{_port}.log")
MAX_LINES = 2000

LEVEL_ORDER = {"DEBUG": 10, "INFO": 20, "WARNING": 30, "ERROR": 40, "CRITICAL": 50}


def _read_from_file(tail, level, search):
    """Read log lines from file with optional filtering."""
    if not os.path.exists(LOG_FILE):
        return []
    with open(LOG_FILE, "r", encoding="utf-8") as f:
        lines = [l.rstrip("\n") for l in f.readlines()[-tail:]]

    if level:
        min_lvl = LEVEL_ORDER.get(level.upper(), 0)
        filtered = []
        for line in lines:
            m = re.search(r"\s(DEBUG|INFO|WARNING|ERROR|CRITICAL)\s", line)
            if m:
                line_lvl = LEVEL_ORDER.get(m.group(1), 0)
                if line_lvl < min_lvl:
                    continue
            filtered.append(line)
        lines = filtered

    if search:
        q = search.lower()
        lines = [l for l in lines if q in l.lower()]

    return lines


@router.get("/view", response_model=dict)
def view_logs(
    level: Optional[str] = Query(None),
    tail: int = Query(200, ge=10, le=MAX_LINES),
    search: Optional[str] = Query(None),
    _=Depends(require_admin),
):
    """Return recent log entries from file. Admin only."""
    lines = _read_from_file(tail, level, search)
    return {"code": 0, "data": "\n".join(lines), "message": "ok"}


@router.get("/levels", response_model=dict)
def log_levels(_=Depends(require_admin)):
    """Return available log levels."""
    return {
        "code": 0,
        "data": [
            {"value": "INFO", "label": "INFO（默认）"},
            {"value": "DEBUG", "label": "DEBUG"},
            {"value": "WARNING", "label": "WARNING"},
            {"value": "ERROR", "label": "ERROR"},
            {"value": "CRITICAL", "label": "CRITICAL"},
        ],
        "message": "ok",
    }


@router.post("/clear", response_model=dict)
def clear_logs(db: Session = Depends(get_db), _=Depends(require_admin), cu = Depends(get_current_user)):
    """Truncate the system log file (does NOT touch audit_logs)."""
    try:
        open(LOG_FILE, "w").close()
        log_audit(db, cu, "clear_logs", "system logs cleared", AUDIT_CAT_SYSTEM)
        return {"code": 0, "message": "日志已清除"}
    except Exception as e:
        return {"code": 1, "message": f"清除失败: {e}"}


# ── Audit Logs (structured user operation records, admin-only delete) ──

@router.get("/audit/categories", response_model=dict)
def audit_categories(db: Session = Depends(get_db), _=Depends(require_admin)):
    """Return distinct categories from existing audit logs (dynamic, not hardcoded)."""
    rows = db.query(AuditLog.category).filter(AuditLog.category != "").distinct().all()
    categories = sorted([r[0] for r in rows if r[0]])
    return {"code": 0, "data": categories, "message": "ok"}


@router.get("/audit", response_model=dict)
def view_audit_logs(
    tail: int = Query(100, ge=10, le=500),
    category: str = Query("", description="Filter by category"),
    level: str = Query("", description="Filter by level (high/medium/low)"),
    search: str = Query("", description="Search in action and detail"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=10, le=200),
    _=Depends(require_admin),
    db: Session = Depends(get_db),
):
    q = db.query(AuditLog)
    if category:
        q = q.filter(AuditLog.category == category)
    if level:
        q = q.filter(AuditLog.level == level)
    if search:
        pattern = f"%{search}%"
        q = q.filter((AuditLog.action.ilike(pattern)) | (AuditLog.detail.ilike(pattern)))
    total = q.count()
    entries = q.order_by(AuditLog.id.desc()).offset((page - 1) * limit).limit(limit).all()
    return {
        "code": 0,
        "data": {
            "items": [
                {
                    "id": e.id,
                    "username": e.username,
                    "action": e.action,
                    "category": e.category or "",
                    "level": e.level or "medium",
                    "detail": e.detail or "",
                    "created_at": to_local_str(e.created_at) if e.created_at else "",
                    "project_id": getattr(e, "project_id", None),
                    "project_code": getattr(e, "project_code", None) or "",
                    "task_id": getattr(e, "task_id", None),
                    "task_name": getattr(e, "task_name", None) or "",
                    "task_assignee": getattr(e, "task_assignee", None) or "",
                }
                for e in entries
            ],
            "total": total,
            "page": page,
            "limit": limit,
        },
        "message": "ok",
    }


@router.post("/audit/clear", response_model=dict)
def clear_audit_logs(db: Session = Depends(get_db), _=Depends(require_admin)):
    """Clear all audit log entries (admin only). Requires frontend password verification."""
    db.query(AuditLog).delete()
    db.commit()
    return {"code": 0, "message": "操作日志已清除"}
