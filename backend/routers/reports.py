import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.middleware.auth import get_current_user, has_perm
from backend.services import report_service

router = APIRouter(prefix="/api/reports", tags=["reports"])


@router.get("/weekly", response_model=dict)
def weekly_report(
    project_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    data = report_service.get_weekly_report(db, project_id)
    return {"code": 0, "data": data, "message": "ok"}


@router.get("/monthly", response_model=dict)
def monthly_report(db: Session = Depends(get_db), _=Depends(get_current_user)):
    data = report_service.get_monthly_report(db)
    return {"code": 0, "data": data, "message": "ok"}


@router.get("/summary", response_model=dict)
def project_summary(db: Session = Depends(get_db), _=Depends(get_current_user)):
    data = report_service.get_project_summary(db)
    return {"code": 0, "data": data, "message": "ok"}


@router.get("/daily-summary", response_model=dict)
def daily_summary(
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Generate a daily system update summary report as self-contained HTML.

    Time span runs from the user's last-viewed timestamp (preference key
    ``pma_last_daily_summary_at``) to now. First-time visitors default to a
    7-day window, capped at 30 days.
    """
    # 1. Determine the "since" datetime from user preferences
    beijing_tz = timezone(timedelta(hours=8))
    now = datetime.now(timezone.utc).astimezone(beijing_tz)

    try:
        prefs = json.loads(user.preferences or "{}")
    except (json.JSONDecodeError, TypeError):
        prefs = {}

    last_viewed_str = prefs.get("pma_last_daily_summary_at")
    if last_viewed_str:
        try:
            since = datetime.fromisoformat(last_viewed_str)
        except (ValueError, TypeError):
            since = now - timedelta(days=7)
    else:
        since = now - timedelta(days=7)

    # Cap at 30 days
    max_window = timedelta(days=30)
    if now - since > max_window:
        since = now - max_window

    # 2. Locate the generator script relative to project root
    backend_dir = os.path.dirname(os.path.abspath(__file__))       # .../backend/routers
    project_root = os.path.dirname(os.path.dirname(backend_dir))   # repo root
    script_path = os.path.join(
        project_root,
        ".claude", "skills", "pma-daily-summary", "scripts",
        "generate_daily_summary.py",
    )
    if not os.path.isfile(script_path):
        raise HTTPException(status_code=500, detail="Daily summary generator script not found")

    # 3. Run the generator via temp file
    with tempfile.NamedTemporaryFile(
        mode="w+", suffix=".html", delete=False, encoding="utf-8"
    ) as tmp:
        output_path = tmp.name

    try:
        since_iso = since.strftime("%Y-%m-%dT%H:%M:%S+08:00")
        result = subprocess.run(
            [sys.executable, script_path,
             "--repo-path", project_root,
             "--output", output_path,
             "--since", since_iso],
            capture_output=True, text=True, timeout=60,
            cwd=project_root,
        )
        if result.returncode != 0:
            stderr_tail = (result.stderr or "").strip()[-500:]
            raise HTTPException(
                status_code=500,
                detail=f"Report generation failed (exit {result.returncode}): {stderr_tail}",
            )
        with open(output_path, "r", encoding="utf-8") as f:
            html = f.read()
    finally:
        try:
            os.unlink(output_path)
        except OSError:
            pass

    # 4. Update user's last-viewed timestamp
    now_iso = now.strftime("%Y-%m-%dT%H:%M:%S+08:00")
    prefs["pma_last_daily_summary_at"] = now_iso
    user.preferences = json.dumps(prefs, ensure_ascii=False)
    db.commit()

    return {
        "code": 0,
        "data": {
            "html": html,
            "since": since.strftime("%Y-%m-%d %H:%M"),
            "until": now.strftime("%Y-%m-%d %H:%M"),
        },
        "message": "ok",
    }


# ── Manpower Report ──

@router.get("/manpower", response_model=dict)
def manpower_report(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    user_id: Optional[int] = Query(None),
    project_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Manpower/hours report — by project, user, product dimensions.

    普通用户（无 manpower_view 权限）只能查看自己的报表：强制 self-scope。
    """
    if not has_perm(user, "manpower_view"):
        user_id = user.id
        project_id = None
    data = report_service.get_manpower_report(
        db, date_from=date_from, date_to=date_to,
        user_id=user_id, project_id=project_id,
    )
    return {"code": 0, "data": data, "message": "ok"}


@router.get("/manpower/export", response_model=dict)
def manpower_export(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    user_id: Optional[int] = Query(None),
    project_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Export manpower report as Excel (.xlsx)."""
    if not has_perm(user, "manpower_view"):
        user_id = user.id
        project_id = None
    from fastapi.responses import StreamingResponse
    import io

    output = io.BytesIO()
    report_service.export_manpower_excel(
        db, output,
        date_from=date_from, date_to=date_to,
        user_id=user_id, project_id=project_id,
    )
    output.seek(0)

    filename = f"manpower_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.get("/manpower/user/{user_id}/detail", response_model=dict)
def manpower_user_detail(
    user_id: int,
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Per-user manpower detail: project breakdown + daily breakdown.

    普通用户（无 manpower_view 权限）只能查看自己的详情。
    """
    if not has_perm(user, "manpower_view") and user_id != user.id:
        raise HTTPException(status_code=403, detail="无权限查看他人报表")
    data = report_service.get_user_manpower_detail(
        db, user_id, date_from=date_from, date_to=date_to,
    )
    return {"code": 0, "data": data, "message": "ok"}
