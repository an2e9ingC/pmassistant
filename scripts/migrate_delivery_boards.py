"""One-time migration (issue #5): expand existing delivery records into DeliveryBoard rows.

Idempotent: sync_delivery_record skips boards/events that already exist for a record.
Handles both material_codes rows and the legacy serial_numbers (JSON string) field.
Run manually inside the worktree:
    python3 scripts/migrate_delivery_boards.py
"""
import json

from backend.database import SessionLocal
from backend.models.delivery import DeliveryRecord
from backend.services import board_service


def _material_codes(record):
    mcs = [mc.material_code for mc in (record.material_codes or [])]
    if mcs:
        return mcs
    raw = (record.serial_numbers or "").strip()
    if not raw:
        return []
    try:
        arr = json.loads(raw)
        if isinstance(arr, list):
            return [str(x).strip() for x in arr if str(x).strip()]
    except (json.JSONDecodeError, TypeError):
        pass
    cleaned = raw.replace('"', "").replace("[", "").replace("]", "").replace(",", "\n")
    return [s.strip() for s in cleaned.splitlines() if s.strip()]


db = SessionLocal()
try:
    total = 0
    for record in db.query(DeliveryRecord).order_by(DeliveryRecord.id).all():
        mcs = _material_codes(record)
        if not mcs:
            print(f"record#{record.id} project={record.project_id}: no material codes, skip")
            continue
        boards = board_service.sync_delivery_record(db, record.project_id, record, mcs, actor="system")
        total += len(boards)
        print(f"record#{record.id} project={record.project_id} -> {len(boards)} boards")
    print(f"DONE: {total} boards synced")
finally:
    db.close()
