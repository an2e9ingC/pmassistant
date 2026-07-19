"""WeCom checkin data service — sync, calendar aggregation, read-only queries."""
import json
import logging
from datetime import date, datetime, timezone, timedelta
from typing import Optional

from sqlalchemy.orm import Session
from sqlalchemy import and_

from backend.models.wecom import WeComCheckin, WeComSchedule
from backend.models.local import LocalUser

logger = logging.getLogger(__name__)


def _parse_date(d: Optional[str]) -> Optional[date]:
    """Parse YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ to date."""
    if not d:
        return None
    return date.fromisoformat(d[:10])


# ── Sync ──

async def sync_wecom_data(db: Session) -> dict:
    """Full sync: fetch checkin + approval data from WeCom for all linked users.

    Fetches the last 60 days of data. Only writes if API succeeds;
    keeps existing data on failure.
    """
    from backend.services.wecom_client import WeComClient

    users = db.query(LocalUser).filter(
        LocalUser.wecom_userid.isnot(None),
        LocalUser.wecom_userid != "",
    ).all()

    if not users:
        return {"fetched": 0, "created": 0, "updated": 0, "message": "no linked users"}

    client = WeComClient()
    try:
        await client.authenticate()

        now = datetime.now(timezone.utc)
        end_ts = int(now.timestamp())
        start_ts = end_ts - 60 * 86400  # last 60 days

        created, updated = 0, 0

        # Fetch checkin data in 30-day batches
        for batch_start in range(start_ts, end_ts, 30 * 86400):
            batch_end = min(batch_start + 30 * 86400, end_ts)
            wecom_userids = [u.wecom_userid for u in users]
            checkins = await client.get_checkin_data(batch_start, batch_end, wecom_userids)

            for record in checkins:
                result = _upsert_checkin(db, record, "checkin")
                if result == "created":
                    created += 1
                elif result == "updated":
                    updated += 1

            db.commit()

        # Fetch approval data
        try:
            approvals = await client.get_approval_data(start_ts, end_ts)
            for record in approvals:
                result = _upsert_approval(db, record)
                if result == "created":
                    created += 1
                elif result == "updated":
                    updated += 1
            db.commit()
        except Exception as e:
            logger.warning(f"WeCom approval sync failed (non-fatal): {e}")

        # Fetch schedule (expected working hours)
        try:
            await sync_wecom_schedule(db)
            db.commit()
        except Exception as e:
            logger.warning(f"WeCom schedule sync failed (non-fatal): {e}")

        return {"fetched": len(checkins), "created": created, "updated": updated}
    finally:
        await client.close()


def _upsert_checkin(db: Session, record: dict, source: str) -> Optional[str]:
    """Upsert one checkin record. Returns 'created' or 'updated'."""
    user_id = record.get("userid", "")
    checkin_epoch = record.get("opencheckintime")
    checkout_epoch = record.get("finishcheckintime")

    if not user_id or not checkin_epoch:
        return None

    dt = datetime.fromtimestamp(checkin_epoch, tz=timezone.utc)
    date_key = dt.date()

    if checkout_epoch:
        hours = max(0, (checkout_epoch - checkin_epoch) / 3600.0)
        checkout_dt = datetime.fromtimestamp(checkout_epoch, tz=timezone.utc)
    else:
        hours = 0.0
        checkout_dt = None

    existing = db.query(WeComCheckin).filter(
        WeComCheckin.user_id == user_id,
        WeComCheckin.date == date_key,
        WeComCheckin.source == source,
    ).first()

    if existing:
        existing.work_hours = hours
        existing.raw_data = json.dumps(record, ensure_ascii=False)
        existing.synced_at = datetime.now(timezone.utc)
        return "updated"
    else:
        db.add(WeComCheckin(
            user_id=user_id,
            date=date_key,
            work_hours=hours,
            source=source,
            raw_data=json.dumps(record, ensure_ascii=False),
            synced_at=datetime.now(timezone.utc),
        ))
        return "created"


def _upsert_approval(db: Session, record: dict) -> Optional[str]:
    """Upsert one approval record as a checkin entry."""
    # Approval records vary by template; store raw data and mark source="approval"
    user_id = record.get("apply_user_id", "") or record.get("sp_applicant", "")
    apply_time = record.get("apply_time", 0)

    if not user_id or not apply_time:
        return None

    dt = datetime.fromtimestamp(int(apply_time), tz=timezone.utc)
    date_key = dt.date()

    # Try to extract hours from approval data
    duration = record.get("duration", 0)  # some templates have duration in hours
    if not duration:
        duration = record.get("leave_duration", 0)
    hours = float(duration) if duration else 0

    existing = db.query(WeComCheckin).filter(
        WeComCheckin.user_id == user_id,
        WeComCheckin.date == date_key,
        WeComCheckin.source == "approval",
    ).first()

    if existing:
        existing.work_hours = hours if hours else existing.work_hours
        existing.raw_data = json.dumps(record, ensure_ascii=False)
        existing.synced_at = datetime.now(timezone.utc)
        return "updated"
    else:
        db.add(WeComCheckin(
            user_id=user_id,
            date=date_key,
            work_hours=hours,
            source="approval",
            raw_data=json.dumps(record, ensure_ascii=False),
            synced_at=datetime.now(timezone.utc),
        ))
        return "created"


async def sync_wecom_schedule(db: Session) -> None:
    """Fetch WeCom company work schedule for current year/month."""
    from backend.services.wecom_client import WeComClient

    now = datetime.now(timezone.utc)
    year, month = now.year, now.month

    # Check if already synced this month
    existing = db.query(WeComSchedule).filter(
        WeComSchedule.year == year,
        WeComSchedule.month == month,
    ).first()
    if existing:
        return  # already synced for this month

    client = WeComClient()
    try:
        schedule = await client.get_work_schedule(year, month)
        db.add(WeComSchedule(
            year=year, month=month,
            work_days=schedule.get("work_days", 0),
            work_hours=schedule.get("work_hours", 0),
            raw_data=json.dumps(schedule, ensure_ascii=False),
        ))
    finally:
        await client.close()


# ── Calendar Aggregation ──

def get_checkin_calendar(
    db: Session,
    user: LocalUser,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
) -> dict:
    """Aggregate WeCom checkin data by date for the given user.

    Returns {daily, total, last_sync_at, schedule, status}.
    Only reads from PMA DB — does NOT trigger remote sync.
    """
    if not user.wecom_userid:
        return {
            "daily": [], "total": 0.0,
            "last_sync_at": None, "schedule": None,
            "status": "unlinked",
        }

    q = db.query(WeComCheckin).filter(
        WeComCheckin.user_id == user.wecom_userid,
    )
    if date_from:
        q = q.filter(WeComCheckin.date >= _parse_date(date_from))
    if date_to:
        q = q.filter(WeComCheckin.date <= _parse_date(date_to))

    checkins = q.order_by(WeComCheckin.date.desc()).all()

    daily_map = {}
    for c in checkins:
        d = str(c.date)
        if d not in daily_map:
            daily_map[d] = {"date": d, "total_hours": 0.0}
        daily_map[d]["total_hours"] += c.work_hours or 0.0

    daily = sorted(daily_map.values(), key=lambda x: x["date"], reverse=True)
    total = sum(d["total_hours"] for d in daily)

    # Last sync time
    last = db.query(WeComCheckin.synced_at).filter(
        WeComCheckin.user_id == user.wecom_userid,
    ).order_by(WeComCheckin.synced_at.desc()).first()
    last_sync_at = last[0].isoformat() if last and last[0] else None

    # Schedule
    now = datetime.now(timezone.utc)
    sched = db.query(WeComSchedule).filter(
        WeComSchedule.year == now.year,
        WeComSchedule.month == now.month,
    ).first()
    schedule = None
    if sched:
        schedule = {
            "year": sched.year, "month": sched.month,
            "work_days": sched.work_days,
            "work_hours": sched.work_hours,
        }

    status = "ok"
    if not checkins:
        status = "no_data"

    return {
        "daily": daily,
        "total": total,
        "last_sync_at": last_sync_at,
        "schedule": schedule,
        "status": status,
    }
