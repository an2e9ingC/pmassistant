from __future__ import annotations
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.middleware.auth import get_current_user, require_admin
from backend.services import delivery_service

router = APIRouter(prefix="/api/delivery", tags=["delivery"])


class DeliveryRecordCreate(BaseModel):
    product_name: str
    serial_numbers: Optional[List[str]] = None
    quantity: int = 0
    delivery_date: Optional[str] = None
    receiver: Optional[str] = None
    note: Optional[str] = None


class DeliveryRecordUpdate(BaseModel):
    product_name: Optional[str] = None
    serial_numbers: Optional[List[str]] = None
    quantity: Optional[int] = None
    delivery_date: Optional[str] = None
    receiver: Optional[str] = None
    note: Optional[str] = None


@router.get("/projects/{project_id}", response_model=dict)
def get_delivery(project_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    data = delivery_service.get_delivery_summary(db, project_id)
    return {"code": 0, "data": data, "message": "ok"}


@router.get("/projects/{project_id}/records", response_model=dict)
def list_records(project_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    records = delivery_service.list_delivery_records(db, project_id)
    return {"code": 0, "data": records, "message": "ok"}


@router.post("/projects/{project_id}/records", response_model=dict)
def create_record(
    project_id: int,
    body: DeliveryRecordCreate,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    data = body.model_dump()
    data["serial_numbers"] = body.serial_numbers or []
    record = delivery_service.create_delivery_record(db, project_id, data)
    return {"code": 0, "data": delivery_service._record_dict(record), "message": "ok"}


@router.put("/records/{record_id}", response_model=dict)
def update_record(
    record_id: int,
    body: DeliveryRecordUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    if not data:
        raise HTTPException(status_code=400, detail="No fields to update")
    record = delivery_service.update_delivery_record(db, record_id, data)
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")
    return {"code": 0, "data": delivery_service._record_dict(record), "message": "ok"}


@router.delete("/records/{record_id}", response_model=dict)
def delete_record(
    record_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    ok = delivery_service.delete_delivery_record(db, record_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Record not found")
    return {"code": 0, "data": {"deleted": True}, "message": "ok"}
