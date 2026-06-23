from __future__ import annotations
import os
import re
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import desc

from backend.database import SessionLocal, get_db, to_local_str
from backend.middleware.auth import require_admin, get_current_user
from backend.models.local import AuditLog, LocalUser
from backend.models.log_entry import LogEntry
from sqlalchemy.orm import Session

router = APIRouter(prefix="/api/logs", tags=["logs"])


def log_audit(db: Session, user: LocalUser, action: str, detail: str = "", category: str = "", level: str = "medium"):
    """Write an audit log entry.

    category: dynamic—query /api/logs/audit/categories for available values
    level: high(删除/权限)/medium(编辑/新增)/low(配置/查看)
    """
    import logging
    logger = logging.getLogger(__name__)
    try:
        db.add(AuditLog(username=user.username, action=action, detail=detail or "",
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


def _read_from_db(db, level, search, tail):
    """Query log entries from database. Returns list of formatted lines."""
    q = db.query(LogEntry)

    if level:
        min_lvl = LEVEL_ORDER.get(level.upper(), 0)
        allowed = [l for l, v in LEVEL_ORDER.items() if v >= min_lvl]
        q = q.filter(LogEntry.level.in_(allowed))
    else:
        q = q.filter(LogEntry.level.in_(["INFO", "WARNING", "ERROR", "CRITICAL"]))

    if search:
        q = q.filter(LogEntry.message.ilike(f"%{search}%"))

    entries = q.order_by(desc(LogEntry.timestamp)).limit(tail).all()

    lines = []
    for e in reversed(entries):
        ts = to_local_str(e.timestamp) if e.timestamp else ""
        lines.append(f"{ts} {e.level:8s} {e.logger}: {e.message}")
    return lines


def _read_from_file(tail, level, search):
    """Fallback: read log lines from file."""
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
    """Return recent log entries with optional filtering. Admin only."""
    lines = []
    db = SessionLocal()
    try:
        lines = _read_from_db(db, level, search, tail)
    except Exception:
        pass  # DB table may not exist yet; fall through to file
    finally:
        db.close()

    if not lines:
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
    """Truncate the log file and clear DB log entries (NOT audit logs)."""
    try:
        open(LOG_FILE, "w").close()
        db.query(LogEntry).delete()
        db.commit()
        log_audit(db, cu, "clear_logs", "system logs cleared")
        return {"code": 0, "message": "日志已清除"}
    except Exception as e:
        return {"code": 1, "message": f"清除失败: {e}"}


# ── Audit Logs (separate from system logs, admin-only delete) ──

@router.get("/audit/categories", response_model=dict)
def audit_categories(db: Session = Depends(get_db), _=Depends(require_admin)):
    """Return distinct categories from existing audit logs (dynamic, not hardcoded)."""
    from backend.models.local import AuditLog
    rows = db.query(AuditLog.category).filter(AuditLog.category != "").distinct().all()
    categories = sorted([r[0] for r in rows if r[0]])
    return {"code": 0, "data": categories, "message": "ok"}


@router.get("/audit", response_model=dict)
def view_audit_logs(
    tail: int = Query(100, ge=10, le=500),
    category: str = Query("", description="Filter by category (动态获取自 /audit/categories)"),
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
    db.query(AuditLog).delete()
    db.commit()
    return {"code": 0, "message": "操作日志已清除"}
