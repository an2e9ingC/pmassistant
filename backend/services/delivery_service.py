from __future__ import annotations
import json
from collections import Counter
from datetime import date
from typing import Optional

from sqlalchemy.orm import Session

from backend.models.delivery import (DeliveryRecord, DeliveryMaterialCode,
                                     DeliveryBoard, DeliveryBoardEvent)
from backend.services import board_service


def _attach_code_boards(db: Session, records: list) -> list[dict]:
    """给每条交付记录的每个物料编码附上对应板卡 id。

    板卡与交付记录的对应关系以「交付事件」为准：sync_delivery_record 为每个
    编码各写一条 delivery_record_id=r.id 的交付事件（按 sort_order 顺序）。
    不能用 编码==serial_no 字符串匹配——历史交付记录的编码可能与板卡现编号
    不一致（如编码 26080454019 对应板卡 2608030454019，板卡中途改过编号）。
    返回 [{...record_dict, code_boards: {material_code: board_id|None}}]。"""
    out = [record_dict(r) for r in records]
    if not out:
        return out
    ids = [d["id"] for d in out]
    evs = db.query(DeliveryBoardEvent).filter(
        DeliveryBoardEvent.delivery_record_id.in_(ids)
    ).order_by(DeliveryBoardEvent.delivery_record_id, DeliveryBoardEvent.id.asc()).all()
    by_rec: dict[int, list[int]] = {}
    for e in evs:
        by_rec.setdefault(e.delivery_record_id, []).append(e.board_id)
    for d in out:
        bids = by_rec.get(d["id"], [])
        cb = {}
        for i, code in enumerate(d["material_codes"]):
            cb[code] = bids[i] if i < len(bids) else None
        d["code_boards"] = cb
    return out


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

    # 板卡动态统计：已交付/已维修 计入交付进度；维修中 −1；维修完成 +1
    boards = db.query(DeliveryBoard).filter(DeliveryBoard.project_id == project_id).all()
    has_boards = bool(boards)
    board_delivered = sum(1 for b in boards if b.status in ("已交付", "已维修"))
    effective_delivered = board_delivered if has_boards else delivered_qty

    remaining = max(0, planned - effective_delivered) if planned > 0 else 0
    progress = min(100, round(effective_delivered / planned * 100)) if planned > 0 else 0

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

    # Compute per-product delivered counts (record-based fallback)
    product_delivered = Counter()
    for r in records:
        if r.product_code:
            product_delivered[r.product_code] += (r.quantity or 0)

    # Board-based per-product delivered counts (当前状态实时动态)
    board_by_code = {}
    for b in boards:
        board_by_code.setdefault(b.product_code or "", []).append(b)

    # Build per-product stats
    prod_stats = []
    for plan in plans:
        code = plan.get("product_code", "")
        bs = board_by_code.get(code, [])
        if bs:
            delivered = sum(1 for b in bs if b.status in ("已交付", "已维修"))
        else:
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
        "total": effective_delivered,
        "done": effective_delivered,
        "remaining": remaining,
        "progress": ring_progress,  # computed from product aggregation
        "delivery_note": project.delivery_note if project else None,
        "product_delivery_plans": plans,
        "product_stats": prod_stats,
        "records": _attach_code_boards(db, records),
        "boards": board_service.boards_with_prev(db, boards),
        "board_meta": board_service.board_meta(),
    }


def list_delivery_records(db: Session, project_id: int) -> list[dict]:
    records = db.query(DeliveryRecord).filter(
        DeliveryRecord.project_id == project_id
    ).order_by(DeliveryRecord.delivery_date.desc()).all()
    return [record_dict(r) for r in records]


def _clean_time(val) -> Optional[str]:
    """规范化 delivery_time 输入（HH:MM / HH:MM:SS）；无效/空返回 None。"""
    if not val:
        return None
    s = str(val).strip()
    if not s:
        return None
    from datetime import time as _time
    try:
        _time.fromisoformat(s[:8])
    except ValueError:
        return None
    return s[:8]


def create_delivery_record(db: Session, project_id: int, data: dict, actor: str = "") -> DeliveryRecord:
    record = DeliveryRecord(
        project_id=project_id,
        product_name=data.get("product_name", ""),
        product_code=data.get("product_code", ""),
        quantity=data.get("quantity", 0),
        delivery_date=_parse_date(data.get("delivery_date")),
        delivery_time=_clean_time(data.get("delivery_time")),
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

    # 板卡联动：物料编码自动登记为板卡（→已交付）
    valid_codes = [c for c in material_codes if c and c.strip()]
    if valid_codes:
        board_service.sync_delivery_record(db, project_id, record, valid_codes, actor)
    return record


def _sync_delivery_event_times(db: Session, r: DeliveryRecord) -> None:
    """交付记录 delivery_date 变更 → 就地更新既有交付事件 event_time（保留事件 id）。

    此前编辑一律删旧事件+重建，新 id 会按插入序把事件顶到时间线"最新"，
    即使其业务日期早于后续返修事件——导致补录/反填日期后时间线错位、状态被覆盖。
    编码未变时只需改 event_time，随后把受影响板卡状态对齐到业务时间线。"""
    if not r.delivery_date:
        return
    evs = db.query(DeliveryBoardEvent).filter(
        DeliveryBoardEvent.delivery_record_id == r.id
    ).all()
    if not evs:
        return
    t = board_service.delivery_event_ts(r)
    bid_set = {e.board_id for e in evs}
    # 同源自动建档事件（建档时打了 source_delivery_record_id 标记）一并归位，
    # 否则反填日期后建档(旧日期) 会反超交付(新日期) 成为"最新"→ 板卡被顶回在库
    for bid in bid_set:
        for e in db.query(DeliveryBoardEvent).filter(
                DeliveryBoardEvent.board_id == bid,
                DeliveryBoardEvent.delivery_record_id.is_(None),
                DeliveryBoardEvent.to_status == "在库").all():
            if (e.data or {}).get("source_delivery_record_id") == r.id:
                e.event_time = t
    for e in evs:
        e.event_time = t
        # 编辑（补/改交付时间）后把墙面时刻快照写进事件 data，前端据此判定完整时刻显示
        if e.delivery_record_id is not None:
            d2 = dict(e.data or {})
            d2["delivery_time"] = r.delivery_time
            e.data = d2
    db.commit()
    for bid in bid_set:
        board_service.refresh_board_state(db, bid)


def update_delivery_record(db: Session, record_id: int, data: dict, actor: str = "") -> Optional[DeliveryRecord]:
    r = db.query(DeliveryRecord).filter(DeliveryRecord.id == record_id).first()
    if not r:
        return None
    for field in ("product_name", "product_code", "quantity", "receiver",
                  "responsible_person", "delivery_method", "note"):
        if field in data:
            setattr(r, field, data[field])
    if "delivery_date" in data:
        r.delivery_date = _parse_date(data["delivery_date"])
    if "delivery_time" in data:
        r.delivery_time = _clean_time(data["delivery_time"])

    if "material_codes" in data:
        new_codes = [c.strip() for c in (data["material_codes"] or []) if c and c.strip()]
        old_codes = [mc.material_code for mc in db.query(DeliveryMaterialCode).filter(
            DeliveryMaterialCode.record_id == record_id
        ).order_by(DeliveryMaterialCode.sort_order.asc()).all()]
        r.quantity = len(new_codes)
        if old_codes != new_codes:
            # 编码集合真的变化 → 替换编码并重建关联事件（按最新编码重新登记板卡）
            db.query(DeliveryMaterialCode).filter(
                DeliveryMaterialCode.record_id == record_id
            ).delete()
            for idx, mc in enumerate(new_codes):
                if mc:
                    db.add(DeliveryMaterialCode(
                        record_id=record_id,
                        material_code=mc,
                        sort_order=idx,
                    ))
            db.commit()
            db.refresh(r)
            board_service.remove_delivery_events(db, record_id)
            if new_codes:
                board_service.sync_delivery_record(db, r.project_id, r, new_codes, actor)
        else:
            # 编码未变（如仅改交付日期）：不删+重建，就地同步事件业务时间
            db.commit()
            db.refresh(r)
            _sync_delivery_event_times(db, r)
    else:
        db.commit()
        db.refresh(r)
        _sync_delivery_event_times(db, r)
    return r


def delete_delivery_record(db: Session, record_id: int) -> bool:
    r = db.query(DeliveryRecord).filter(DeliveryRecord.id == record_id).first()
    if not r:
        return False
    # 板卡联动：先删除该交付记录关联事件，受影响板卡回退在库
    board_service.remove_delivery_events(db, record_id)
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
        "delivery_time": r.delivery_time,
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
