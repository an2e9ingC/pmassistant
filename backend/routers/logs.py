from __future__ import annotations
import re
from typing import Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import PlainTextResponse

from backend.middleware.auth import get_current_user

router = APIRouter(prefix="/api/logs", tags=["logs"])

LOG_FILE = "data/pma.log"
MAX_LINES = 2000


def _filter_lines(lines: list[str], level: Optional[str]) -> list[str]:
    """Filter log lines by minimum level."""
    if not level:
        return lines
    levels = {"DEBUG": 10, "INFO": 20, "WARNING": 30, "ERROR": 40, "CRITICAL": 50}
    min_lvl = levels.get(level.upper(), 0)
    filtered = []
    for line in lines:
        # Extract level from log line: "2026-05-29 10:00:00,123 INFO module: msg"
        m = re.search(r"\s(DEBUG|INFO|WARNING|ERROR|CRITICAL)\s", line)
        if m:
            line_lvl = levels.get(m.group(1), 0)
            if line_lvl < min_lvl:
                continue
        filtered.append(line)
    return filtered


@router.get("/view", response_class=PlainTextResponse)
def view_logs(
    level: Optional[str] = Query(None, description="Minimum log level (DEBUG/INFO/WARNING/ERROR/CRITICAL)"),
    tail: int = Query(200, ge=10, le=MAX_LINES, description="Number of lines from end of file"),
    search: Optional[str] = Query(None, description="Filter lines containing this text"),
    _=Depends(get_current_user),
):
    """Return recent log file contents with optional level/text filtering."""
    try:
        with open(LOG_FILE, "r", encoding="utf-8") as f:
            lines = f.readlines()
    except FileNotFoundError:
        return "暂无日志"

    # Take tail from end
    if len(lines) > tail:
        lines = lines[-tail:]

    # Strip trailing newlines for cleaner output
    lines = [line.rstrip("\n") for line in lines]

    # Filter by level
    lines = _filter_lines(lines, level)

    # Filter by search text
    if search:
        q = search.lower()
        lines = [l for l in lines if q in l.lower()]

    return "\n".join(lines)


@router.get("/levels", response_model=dict)
def log_levels(_=Depends(get_current_user)):
    """Return available log levels."""
    return {
        "code": 0,
        "data": [
            {"value": "DEBUG", "label": "DEBUG"},
            {"value": "INFO", "label": "INFO"},
            {"value": "WARNING", "label": "WARNING"},
            {"value": "ERROR", "label": "ERROR"},
            {"value": "CRITICAL", "label": "CRITICAL"},
        ],
        "message": "ok",
    }
