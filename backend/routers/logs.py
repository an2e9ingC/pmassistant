from __future__ import annotations
import os
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc

from backend.database import get_db
from backend.middleware.auth import require_admin
from backend.models.log_entry import LogEntry

router = APIRouter(prefix="/api/logs", tags=["logs"])

LOG_FILE = "data/pma.log"
MAX_LINES = 2000

LEVEL_ORDER = {"DEBUG": 10, "INFO": 20, "WARNING": 30, "ERROR": 40, "CRITICAL": 50}


@router.get("/view", response_model=dict)
def view_logs(
    level: Optional[str] = Query(None, description="Minimum log level (DEBUG/INFO/WARNING/ERROR/CRITICAL)"),
    tail: int = Query(200, ge=10, le=MAX_LINES, description="Number of recent entries"),
    search: Optional[str] = Query(None, description="Filter messages containing this text"),
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    """Return recent log entries from database with optional filtering. Admin only."""
    q = db.query(LogEntry)

    if level:
        min_lvl = LEVEL_ORDER.get(level.upper(), 0)
        allowed = [l for l, v in LEVEL_ORDER.items() if v >= min_lvl]
        q = q.filter(LogEntry.level.in_(allowed))
    else:
        # Default: INFO and above (skip DEBUG noise)
        q = q.filter(LogEntry.level.in_(["INFO", "WARNING", "ERROR", "CRITICAL"]))

    if search:
        q = q.filter(LogEntry.message.ilike(f"%{search}%"))

    entries = q.order_by(desc(LogEntry.timestamp)).limit(tail).all()

    # Format lines (chronological order)
    lines = []
    for e in reversed(entries):
        ts = e.timestamp.strftime("%Y-%m-%d %H:%M:%S") if e.timestamp else ""
        lines.append(f"{ts} {e.level:8s} {e.logger}: {e.message}")

    # Fallback to file if DB is empty (e.g., right after migration)
    if not lines and os.path.exists(LOG_FILE):
        try:
            with open(LOG_FILE, "r", encoding="utf-8") as f:
                file_lines = [l.rstrip("\n") for l in f.readlines()[-tail:]]
            lines = file_lines
        except Exception:
            pass

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
