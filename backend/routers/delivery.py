from __future__ import annotations
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.middleware.auth import get_current_user, require_admin
from backend.services import delivery_service
from backend.services.project_service import log_project_activity

router = APIRouter(prefix="/api/delivery", tags=["delivery"])


class DeliveryRecordCreate(BaseModel):
    product_name: str
    serial_numbers: Optional[List[str]] = None
    quantity: int = 0
    delivery_date: Optional[str] = None
    receiver: Optional[str] = None
    responsible_person: Optional[str] = None
    note: Optional[str] = None


class DeliveryRecordUpdate(BaseModel):
    product_name: Optional[str] = None
    serial_numbers: Optional[List[str]] = None
    quantity: Optional[int] = None
    delivery_date: Optional[str] = None
    receiver: Optional[str] = None
    responsible_person: Optional[str] = None
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
    user=Depends(require_admin),
):
    data = body.model_dump()
    data["serial_numbers"] = body.serial_numbers or []
    record = delivery_service.create_delivery_record(db, project_id, data)
    log_project_activity(db, project_id, user.username, "交付记录",
        f"新增:{body.product_name} x{body.quantity}")
    return {"code": 0, "data": delivery_service.record_dict(record), "message": "ok"}


@router.put("/records/{record_id}", response_model=dict)
def update_record(
    record_id: int,
    body: DeliveryRecordUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    from backend.models.delivery import DeliveryRecord as _DR
    old_record = db.query(_DR).filter(_DR.id == record_id).first()
    if not old_record:
        raise HTTPException(status_code=404, detail="Record not found")
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    if not data:
        raise HTTPException(status_code=400, detail="No fields to update")
    del_changes = []
    for k, v in data.items():
        old_val = getattr(old_record, k, None)
        if str(old_val) != str(v):
            del_changes.append(f"{k}:'{old_val}'->'{v}'")
    record = delivery_service.update_delivery_record(db, record_id, data)
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")
    log_project_activity(db, record.project_id, user.username, "交付记录编辑",
        "; ".join(del_changes) if del_changes else "无变更")
    return {"code": 0, "data": delivery_service.record_dict(record), "message": "ok"}


@router.delete("/records/{record_id}", response_model=dict)
def delete_record(
    record_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    from backend.models.delivery import DeliveryRecord
    r = db.query(DeliveryRecord).filter(DeliveryRecord.id == record_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Record not found")
    detail = f"{r.product_name} x{r.quantity} ({r.delivery_date})"
    db.delete(r)
    db.commit()
    log_project_activity(db, r.project_id, user.username, "交付记录删除",
        f"删除: {detail}")
    return {"code": 0, "data": {"deleted": True}, "message": "ok"}
