from __future__ import annotations
import json
from collections import Counter
from datetime import date
from typing import Optional

from sqlalchemy.orm import Session

from backend.models.delivery import DeliveryRecord, DeliveryMaterialCode


def get_delivery_summary(db: Session, project_id: int) -> dict:
    """Get delivery summary for a project.

    Compares planned delivery quantity against actual delivery records
    to compute progress and remaining count. Includes per-product stats.
    """
    from backend.models.zentao import CachedProject

    project = db.query(CachedProject).filter(CachedProject.id == project_id).first()
    planned = (project.planned_delivery_qty or 0) if project else 0

    records = db.query(DeliveryRecord).filter(
        DeliveryRecord.project_id == project_id
    ).order_by(DeliveryRecord.delivery_date.desc()).all()

    delivered_qty = sum(r.quantity or 0 for r in records)

    remaining = max(0, planned - delivered_qty) if planned > 0 else 0
    progress = min(100, round(delivered_qty / planned * 100)) if planned > 0 else 0

    # Parse per-product delivery plans — auto-initialize from linked products if empty
    plans = []
    if project and project.product_delivery_plans:
        try:
            plans = json.loads(project.product_delivery_plans)
        except (json.JSONDecodeError, TypeError):
            plans = []

    if not plans and project:
        from backend.models.zentao import ProductProjectLink, PmaProduct
        links = db.query(ProductProjectLink).filter(
            ProductProjectLink.project_id == project_id
        ).all()
        if links:
            product_ids = [l.product_id for l in links]
            products_map = {}
            if product_ids:
                prods = db.query(PmaProduct).filter(PmaProduct.id.in_(product_ids)).all()
                products_map = {p.id: p for p in prods}
            plans = []
            for link in links:
                prod = products_map.get(link.product_id)
                plans.append({
                    "product_code": prod.code if prod else "",
                    "product_name": prod.name if prod else "",
                    "planned_qty": link.quantity or 0,
                })
            # Persist for future queries
            project.product_delivery_plans = json.dumps(plans, ensure_ascii=False)
            db.commit()

    # Compute per-product delivered counts
    product_delivered = Counter()
    for r in records:
        if r.product_code:
            product_delivered[r.product_code] += (r.quantity or 0)

    # Build per-product stats
    prod_stats = []
    for plan in plans:
        code = plan.get("product_code", "")
        delivered = product_delivered.get(code, 0)
        planned_qty = plan.get("planned_qty", 0)
        prod_stats.append({
            "product_code": code,
            "product_name": plan.get("product_name", ""),
            "planned_qty": planned_qty,
            "delivered_qty": delivered,
            "progress": min(100, round(delivered / planned_qty * 100)) if planned_qty > 0 else 0,
        })

    # Big-ring arc progress: aggregate from per-product stats (sum delivered / sum planned)
    total_prod_delivered = sum(s["delivered_qty"] for s in prod_stats)
    total_prod_planned = sum(s["planned_qty"] for s in prod_stats)
    ring_progress = min(100, round(total_prod_delivered / total_prod_planned * 100)) if total_prod_planned > 0 else 0

    return {
        "planned": planned,
        "delivered_manual": project.delivered_sets_qty or 0 if project else 0,
        "total": delivered_qty,
        "done": delivered_qty,
        "remaining": remaining,
        "progress": ring_progress,  # computed from product aggregation
        "delivery_note": project.delivery_note if project else None,
        "product_delivery_plans": plans,
        "product_stats": prod_stats,
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
        product_code=data.get("product_code", ""),
        quantity=data.get("quantity", 0),
        delivery_date=_parse_date(data.get("delivery_date")),
        receiver=data.get("receiver", ""),
        responsible_person=data.get("responsible_person", ""),
        delivery_method=data.get("delivery_method", ""),
        note=data.get("note", ""),
    )
    db.add(record)
    db.flush()  # get record.id for material codes

    # Insert material codes
    material_codes = data.get("material_codes", [])
    for idx, mc in enumerate(material_codes):
        if mc and mc.strip():
            db.add(DeliveryMaterialCode(
                record_id=record.id,
                material_code=mc.strip(),
                sort_order=idx,
            ))

    db.commit()
    db.refresh(record)
    return record


def update_delivery_record(db: Session, record_id: int, data: dict) -> Optional[DeliveryRecord]:
    r = db.query(DeliveryRecord).filter(DeliveryRecord.id == record_id).first()
    if not r:
        return None
    for field in ("product_name", "product_code", "quantity", "receiver",
                  "responsible_person", "delivery_method", "note"):
        if field in data:
            setattr(r, field, data[field])
    if "delivery_date" in data:
        r.delivery_date = _parse_date(data["delivery_date"])

    # Replace material codes if provided
    if "material_codes" in data:
        db.query(DeliveryMaterialCode).filter(
            DeliveryMaterialCode.record_id == record_id
        ).delete()
        for idx, mc in enumerate(data["material_codes"]):
            if mc and mc.strip():
                db.add(DeliveryMaterialCode(
                    record_id=record_id,
                    material_code=mc.strip(),
                    sort_order=idx,
                ))
        valid_codes = [c for c in data["material_codes"] if c and c.strip()]
        r.quantity = len(valid_codes)

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
    # Eager-load material codes
    mcs = sorted(r.material_codes, key=lambda x: x.sort_order) if r.material_codes else []
    material_codes = [mc.material_code for mc in mcs]
    return {
        "id": r.id,
        "project_id": r.project_id,
        "product_name": r.product_name,
        "product_code": r.product_code,
        "material_codes": material_codes,
        "material_code": ", ".join(material_codes),
        "qty": r.quantity or 0,
        "date": str(r.delivery_date) if r.delivery_date else None,
        "receiver": r.receiver,
        "responsible_person": r.responsible_person,
        "delivery_method": r.delivery_method,
        "note": r.note,
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
