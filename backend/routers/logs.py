from __future__ import annotations
import os
import re
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


def _read_from_db(db: Session, level: Optional[str], search: Optional[str], tail: int) -> list[str]:
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
        ts = e.timestamp.strftime("%Y-%m-%d %H:%M:%S") if e.timestamp else ""
        lines.append(f"{ts} {e.level:8s} {e.logger}: {e.message}")
    return lines


def _read_from_file(tail: int, level: Optional[str], search: Optional[str]) -> list[str]:
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
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    """Return recent log entries with optional filtering. Admin only."""
    lines = []
    try:
        lines = _read_from_db(db, level, search, tail)
    except Exception:
        pass  # DB table may not exist yet; fall through to file

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
