from __future__ import annotations
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.middleware.auth import get_current_user, require_perm
from backend.services import delivery_service
from backend.services.entity_resolver import resolve_project
from backend.services.project_service import log_project_activity
from backend.routers.logs import log_audit
from backend.audit_categories import AUDIT_CAT_PROJECT

router = APIRouter(prefix="/api/delivery", tags=["delivery"])


class DeliveryRecordCreate(BaseModel):
    product_name: str
    product_code: Optional[str] = None
    material_codes: Optional[List[str]] = None
    quantity: int = 0
    delivery_date: Optional[str] = None
    receiver: Optional[str] = None
    responsible_person: Optional[str] = None
    delivery_method: Optional[str] = None
    note: Optional[str] = None


class DeliveryRecordUpdate(BaseModel):
    product_name: Optional[str] = None
    product_code: Optional[str] = None
    material_codes: Optional[List[str]] = None
    quantity: Optional[int] = None
    delivery_date: Optional[str] = None
    receiver: Optional[str] = None
    responsible_person: Optional[str] = None
    delivery_method: Optional[str] = None
    note: Optional[str] = None


@router.get("/projects/{identifier}", response_model=dict)
def get_delivery(identifier: str, db: Session = Depends(get_db), _=Depends(get_current_user)):
    project = resolve_project(db, identifier)
    data = delivery_service.get_delivery_summary(db, project.id)
    return {"code": 0, "data": data, "message": "ok"}


@router.get("/projects/{identifier}/records", response_model=dict)
def list_records(identifier: str, db: Session = Depends(get_db), _=Depends(get_current_user)):
    project = resolve_project(db, identifier)
    records = delivery_service.list_delivery_records(db, project.id)
    return {"code": 0, "data": records, "message": "ok"}


@router.post("/projects/{identifier}/records", response_model=dict)
def create_record(
    identifier: str,
    body: DeliveryRecordCreate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("project_edit")),
):
    project = resolve_project(db, identifier)
    data = body.model_dump()
    data["material_codes"] = body.material_codes or []
    record = delivery_service.create_delivery_record(db, project.id, data)
    log_audit(db, user, "delivery_record_create",
              f"项目={project.code} 新增:{body.product_name} x{body.quantity}",
              AUDIT_CAT_PROJECT, "medium")
    log_project_activity(db, project.id, user.username, "交付记录",
        f"新增:{body.product_name} x{body.quantity}")
    return {"code": 0, "data": delivery_service.record_dict(record), "message": "ok"}


@router.put("/records/{record_id}", response_model=dict)
def update_record(
    record_id: int,
    body: DeliveryRecordUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("project_edit")),
):
    from backend.models.delivery import DeliveryRecord as _DR
    from backend.models.zentao import CachedProject
    old_record = db.query(_DR).filter(_DR.id == record_id).first()
    if not old_record:
        raise HTTPException(status_code=404, detail="Record not found")
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    if not data:
        raise HTTPException(status_code=400, detail="No fields to update")
    del_changes = []
    for k, v in data.items():
        if k == "material_codes":
            continue  # handled separately in update
        old_val = getattr(old_record, k, None)
        if str(old_val) != str(v):
            del_changes.append(f"{k}:'{old_val}'->'{v}'")
    record = delivery_service.update_delivery_record(db, record_id, data)
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")
    proj = db.query(CachedProject).filter(CachedProject.id == record.project_id).first()
    proj_code = proj.code if proj else str(record.project_id)
    log_audit(db, user, "delivery_record_update",
              f"项目={proj_code} {'; '.join(del_changes) if del_changes else '无变更'}",
              AUDIT_CAT_PROJECT, "medium")
    log_project_activity(db, record.project_id, user.username, "交付记录编辑",
        "; ".join(del_changes) if del_changes else "无变更")
    return {"code": 0, "data": delivery_service.record_dict(record), "message": "ok"}


@router.delete("/records/{record_id}", response_model=dict)
def delete_record(
    record_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_perm("project_edit")),
):
    from backend.models.delivery import DeliveryRecord
    from backend.models.zentao import CachedProject
    r = db.query(DeliveryRecord).filter(DeliveryRecord.id == record_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Record not found")
    proj = db.query(CachedProject).filter(CachedProject.id == r.project_id).first()
    proj_code = proj.code if proj else str(r.project_id)
    detail = f"{r.product_name} x{r.quantity} ({r.delivery_date})"
    project_id = r.project_id
    db.delete(r)
    db.commit()
    log_audit(db, user, "delivery_record_delete",
              f"项目={proj_code} 删除: {detail}",
              AUDIT_CAT_PROJECT, "medium")
    log_project_activity(db, project_id, user.username, "交付记录删除",
        f"删除: {detail}")
    return {"code": 0, "data": {"deleted": True}, "message": "ok"}
