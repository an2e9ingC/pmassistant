from __future__ import annotations
import json
from datetime import date
from typing import Optional

from sqlalchemy.orm import Session

from backend.models.delivery import DeliveryRecord


def get_delivery_summary(db: Session, project_id: int) -> dict:
    """Get delivery summary for a project (FR-011).

    Compares planned delivery quantity (set by PM) against actual
    delivery records to compute progress and remaining count.
    """
    from backend.models.zentao import CachedProject

    project = db.query(CachedProject).filter(CachedProject.id == project_id).first()
    planned = (project.planned_delivery_qty or 0) if project else 0

    records = db.query(DeliveryRecord).filter(
        DeliveryRecord.project_id == project_id
    ).order_by(DeliveryRecord.delivery_date.desc()).all()

    delivered_qty = sum(r.quantity or 0 for r in records)
    serials = []
    for r in records:
        if r.serial_numbers:
            try:
                serials.extend(json.loads(r.serial_numbers))
            except (json.JSONDecodeError, TypeError):
                pass

    remaining = max(0, planned - delivered_qty) if planned > 0 else 0
    progress = round(delivered_qty / planned * 100) if planned > 0 else 0

    return {
        "planned": planned,
        "total": delivered_qty,
        "done": delivered_qty,
        "remaining": remaining,
        "progress": progress,
        "delivery_note": project.delivery_note if project else None,
        "records": [record_dict(r) for r in records],
    }


def list_delivery_records(db: Session, project_id: int) -> list[dict]:
    records = db.query(DeliveryRecord).filter(
        DeliveryRecord.project_id == project_id
    ).order_by(DeliveryRecord.delivery_date.desc()).all()
    return [record_dict(r) for r in records]


def create_delivery_record(db: Session, project_id: int, data: dict) -> DeliveryRecord:
    record = DeliveryRecord(
        project_id=project_id,
        product_name=data.get("product_name", ""),
        serial_numbers=json.dumps(data.get("serial_numbers", []), ensure_ascii=False),
        quantity=data.get("quantity", 0),
        delivery_date=_parse_date(data.get("delivery_date")),
        receiver=data.get("receiver", ""),
        responsible_person=data.get("responsible_person", ""),
        note=data.get("note", ""),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def update_delivery_record(db: Session, record_id: int, data: dict) -> Optional[DeliveryRecord]:
    r = db.query(DeliveryRecord).filter(DeliveryRecord.id == record_id).first()
    if not r:
        return None
    for field in ("product_name", "quantity", "receiver", "responsible_person", "note"):
        if field in data:
            setattr(r, field, data[field])
    if "serial_numbers" in data:
        r.serial_numbers = json.dumps(data["serial_numbers"], ensure_ascii=False)
    if "delivery_date" in data:
        r.delivery_date = _parse_date(data["delivery_date"])
    db.commit()
    db.refresh(r)
    return r


def delete_delivery_record(db: Session, record_id: int) -> bool:
    r = db.query(DeliveryRecord).filter(DeliveryRecord.id == record_id).first()
    if not r:
        return False
    db.delete(r)
    db.commit()
    return True


def record_dict(r: DeliveryRecord) -> dict:
    serials = []
    if r.serial_numbers:
        try:
            serials = json.loads(r.serial_numbers)
        except (json.JSONDecodeError, TypeError):
            pass
    return {
        "id": r.id,
        "project_id": r.project_id,
        "product_name": r.product_name,
        "serial_numbers": serials,
        "qty": r.quantity or 0,
        "date": str(r.delivery_date) if r.delivery_date else None,
        "receiver": r.receiver,
        "responsible_person": r.responsible_person,
        "note": r.note,
        "items": ", ".join(serials) if serials else "",
    }


def _parse_date(val) -> Optional[date]:
    if not val:
        return None
    if isinstance(val, date):
        return val
    if isinstance(val, str):
        from datetime import datetime as dt
        val = val.strip()
        if not val:
            return None
        try:
            return dt.strptime(val[:10], "%Y-%m-%d").date()
        except ValueError:
            return None
    return None
