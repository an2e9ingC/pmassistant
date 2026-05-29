from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.middleware.auth import get_current_user
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
