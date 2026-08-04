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


async def _sync_wecom_users(db, client):
    """Sync WeCom user list to pma_wecom_users table."""
    import json
    from backend.models.wecom import WeComUser
    raw_users = await client.get_user_list()
    now = datetime.now(timezone.utc)
    for ru in raw_users:
        uid = ru.get("userid", "")
        if not uid:
            continue
        existing = db.query(WeComUser).filter(WeComUser.userid == uid).first()
        name = str(ru.get("name", "") or "")
        dept = str(ru.get("department", "") or "")
        if existing:
            existing.name = name
            existing.department = dept
            existing.raw_data = json.dumps(ru, ensure_ascii=False)
            existing.synced_at = now
        else:
            db.add(WeComUser(
                userid=uid,
                name=name,
                department=dept,
                raw_data=json.dumps(ru, ensure_ascii=False),
                synced_at=now,
            ))
    # Backfill LocalUser.display_name from WeChat Work name for linked users
    from backend.models.local import LocalUser
    for ru in raw_users:
        uid = ru.get("userid", "")
        name = str(ru.get("name", "") or "")
        if uid and name:
            linked = db.query(LocalUser).filter(
                LocalUser.wecom_userid == uid,
            ).first()
            if linked:
                linked.display_name = name

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

        # ── Sync user list first ──
        await _sync_wecom_users(db, client)
        db.commit()

        now = datetime.now(timezone.utc)
        end_ts = int(now.timestamp())
        start_ts = end_ts - 60 * 86400  # last 60 days

        created, updated, total_fetched = 0, 0, 0

        # ── Accumulate all records across batches BEFORE processing ──
        # (records for the same day can be split across batch boundaries)
        daily = {}  # (user_id, date_str) -> {checkins_in: [], checkins_out: [], raw: []}
        wecom_userids = [u.wecom_userid for u in users]

        for batch_start in range(start_ts, end_ts, 30 * 86400):
            batch_end = min(batch_start + 30 * 86400, end_ts)
            checkins = await client.get_checkin_data(batch_start, batch_end, wecom_userids)

            # Debug: log first record to verify data format
            if checkins and total_fetched == 0:
                logger.info(f"WeCom checkin sample: {json.dumps(checkins[0], ensure_ascii=False)[:300]}")

            total_fetched += len(checkins)

            for record in checkins:
                uid = record.get("userid", "")
                ct = record.get("checkin_time", 0)
                ctype = record.get("checkin_type", "")
                if not uid:
                    continue
                dt = datetime.fromtimestamp(ct, tz=timezone.utc) if ct > 0 else None
                ds = dt.strftime("%Y-%m-%d") if dt else None
                if not ds:
                    continue
                key = (uid, ds)
                if key not in daily:
                    daily[key] = {"checkins_in": [], "checkins_out": [], "raw": []}
                daily[key]["raw"].append(record)
                if ct > 0:
                    if "上班" in ctype:
                        daily[key]["checkins_in"].append(ct)
                    elif "下班" in ctype:
                        daily[key]["checkins_out"].append(ct)

        # ── Process all accumulated records ──
        for (uid, ds), d in daily.items():
            d["checkins_in"].sort()
            d["checkins_out"].sort()

            # ── Check if day has any valid (non-未打卡) punch records ──
            has_valid_punch = any(
                r.get("checkin_time", 0) > 0
                and r.get("exception_type", "") != "未打卡"
                for r in d["raw"]
            )

            if not has_valid_punch:
                # Truly no valid punches (外出/真正缺勤/全部未打卡)
                # Hours will come from approval data (Phase 3) or stay 0
                hours = 0.0
            else:
                # ── Pair 上班→下班 records ──
                hours = 0.0
                used_out = set()
                for cin in d["checkins_in"]:
                    best = None
                    for j, cout in enumerate(d["checkins_out"]):
                        if j not in used_out and cout > cin:
                            if best is None or cout < d["checkins_out"][best]:
                                best = j
                    if best is not None:
                        hours += (d["checkins_out"][best] - cin) / 3600.0
                        used_out.add(best)

            # ── Lunch deduction: only for single-pair days with raw >= 9h ──
            # Threshold of 9h raw span: only full workdays that include lunch break
            # Weekend/short days (<9h raw) won't trigger the deduction
            lunch_deducted = False
            if (hours >= 9.0 and len(d["checkins_in"]) == 1 and len(d["checkins_out"]) == 1
                    and has_valid_punch):
                hours -= 1.5
                lunch_deducted = True

            hours = max(0, hours)

            # ── Structured logging for debugging ──
            exception_types = [r.get("exception_type", "") for r in d["raw"]]
            logger.info(
                f"WeCom calc: user={uid}, date={ds}, "
                f"records={len(d['raw'])}, "
                f"in={len(d['checkins_in'])}, out={len(d['checkins_out'])}, "
                f"exceptions={exception_types}, "
                f"hours={hours:.2f}, lunch_deducted={lunch_deducted}, "
                f"valid_punch={has_valid_punch}"
            )

            existing = db.query(WeComCheckin).filter(
                WeComCheckin.user_id == uid,
                WeComCheckin.date == date.fromisoformat(ds),
                WeComCheckin.source == "checkin",
            ).first()
            if existing:
                existing.work_hours = hours
                existing.raw_data = json.dumps(d["raw"][:5], ensure_ascii=False)
                existing.synced_at = datetime.now(timezone.utc)
                updated += 1
            else:
                db.add(WeComCheckin(
                    user_id=uid,
                    date=date.fromisoformat(ds),
                    work_hours=hours,
                    source="checkin",
                    raw_data=json.dumps(d["raw"][:5], ensure_ascii=False),
                    synced_at=datetime.now(timezone.utc),
                ))
                created += 1

        db.commit()

        # ── Fetch approval data (补卡审批, 外出审批 etc.) ──
        # Approval records fill the gap for days without valid checkin punches
        # (e.g. 外出: user doesn't clock in/out, hours come from approval)
        try:
            approval_created, approval_updated = 0, 0
            seen_sp = set()  # deduplicate across batch ranges
            client2 = WeComClient()
            await client2.authenticate()
            try:
                for batch_start in range(start_ts, end_ts, 31 * 86400):
                    batch_end = min(batch_start + 31 * 86400, end_ts)
                    sp_list = await client2.get_approval_data(batch_start, batch_end)
                    logger.info(f"WeCom approval batch {batch_start}-{batch_end}: {len(sp_list)} approvals")
                    for sp_no in sp_list:
                        if sp_no in seen_sp:
                            continue
                        seen_sp.add(sp_no)
                        try:
                            detail = await client2.get_approval_detail(sp_no)
                            if not detail:
                                continue
                            result = _process_approval(db, detail, wecom_userids)
                            if result == "created":
                                approval_created += 1
                            elif result == "updated":
                                approval_updated += 1
                        except Exception as e:
                            logger.warning(f"WeCom approval detail failed for {sp_no}: {e}")
                db.commit()
                logger.info(f"WeCom approvals: created={approval_created}, updated={approval_updated}")
            finally:
                await client2.close()
        except Exception as e:
            logger.warning(f"WeCom approval sync failed (non-fatal): {e}")

        # Fetch schedule (expected working hours, non-blocking)
        try:
            await sync_wecom_schedule(db)
            db.commit()
        except Exception as e:
            logger.error(f"WeCom schedule sync failed: {e}")

        return {"fetched": total_fetched, "created": created, "updated": updated}
    finally:
        await client.close()


def _upsert_checkin(db: Session, record: dict, source: str) -> Optional[str]:
    """Upsert one checkin record. Returns 'created' or 'updated'."""
    user_id = record.get("userid", "")
    checkin_epoch = record.get("opencheckintime")
    checkout_epoch = record.get("finishcheckintime")

    if not user_id:
        return None
    if checkin_epoch is None or checkin_epoch == 0:
        return None  # no checkin time — skip

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


def _extract_approval_hours(detail: dict) -> tuple:
    """Extract (user_id, date, hours) from approval detail record.

    Parses the WeCom approval detail format. Handles:
    - 外出审批 (out-of-office): extracts date range, no lunch deduction
    - 补卡审批 (supplementary checkin): skipped (handled by checkin data)
    - Other approval types: logged and skipped

    Returns (user_id, date_key, hours) or (None, None, 0) if irrelevant.
    """
    sp_name = detail.get("sp_name", "")
    apply_user_id = detail.get("applyer", {}).get("userid", "") or detail.get("sp_applicant", "")

    if not apply_user_id:
        return (None, None, 0)

    # Only process relevant approval types
    if "外出" not in sp_name:
        return (None, None, 0)  # skip non-out-of-office approvals

    # Parse apply_data for time range
    apply_data = detail.get("apply_data", {})
    contents = apply_data.get("contents", [])

    start_ts, end_ts = None, None

    for item in contents:
        ctrl = item.get("control", "")
        val = item.get("value", {})

        if ctrl == "Attendance":
            # 外出审批 uses Attendance control — contains date range in 'attendance' field
            att = val.get("attendance", {})
            if att:
                # attendance may be a dict with date_range or a direct date range
                if isinstance(att, dict):
                    dr = att.get("date_range", {})
                    if dr:
                        start_ts = dr.get("new_begin")
                        end_ts = dr.get("new_end")
                    if not start_ts:
                        # Try direct fields on attendance
                        start_ts = att.get("new_begin") or att.get("start_time")
                        end_ts = att.get("new_end") or att.get("end_time")
                if start_ts and end_ts:
                    break

        elif ctrl == "DateRange":
            # Date range picker — extract begin/end timestamps
            dr = val.get("date_range", {})
            if dr:
                start_ts = dr.get("new_begin")
                end_ts = dr.get("new_end")
                if start_ts and end_ts:
                    break  # found the time range

        elif ctrl == "Date":
            # Single date picker
            dt = val.get("date", {})
            s = dt.get("s") or dt.get("s_timestamp")
            e = dt.get("e") or dt.get("e_timestamp")
            if s:
                start_ts = s if not start_ts else start_ts
                end_ts = e if e else s  # same-day
                break

        elif ctrl == "PunchCorrection":
            # 补卡审批 — already handled by checkin data, skip
            return (None, None, 0)

    if not start_ts or not end_ts:
        # Log the contents structure for debugging
        ctrls = [f"{c.get('control')}(val_keys={list(c.get('value', {}).keys())})" for c in contents[:3]]
        logger.warning(f"WeCom approval: no time range in '{sp_name}' for {apply_user_id}, controls={ctrls}")
        return (None, None, 0)

    # Calculate hours (no lunch deduction for 外出)
    duration_sec = end_ts - start_ts
    if duration_sec <= 0:
        return (None, None, 0)
    hours = duration_sec / 3600.0

    # Determine the date of the approval start
    try:
        dt = datetime.fromtimestamp(int(start_ts), tz=timezone.utc)
        date_key = dt.date()
    except (ValueError, OSError):
        return (None, None, 0)

    return (apply_user_id, date_key, hours)


# Track whether we've logged a sample (module-level)
_approval_sample_logged = False


def _process_approval(db: Session, detail: dict, wecom_userids: list) -> Optional[str]:
    """Process one approval detail record. Returns 'created', 'updated', or None."""
    global _approval_sample_logged

    if not _approval_sample_logged:
        logger.info(f"WeCom approval detail keys: {list(detail.keys())}")
        ad = detail.get("apply_data", {})
        if ad:
            logger.info(f"WeCom approval apply_data keys: {list(ad.keys())}")
            contents = ad.get("contents", [])
            for i, c in enumerate(contents[:5]):
                logger.info(f"WeCom approval content[{i}]: control={c.get('control')}, id={c.get('id')}, title={c.get('title')}, value_keys={list(c.get('value', {}).keys()) if c.get('value') else 'None'}")
        logger.info(f"WeCom approval full sample: {json.dumps(detail, ensure_ascii=False)[:2000]}")
        _approval_sample_logged = True

    user_id, date_key, hours = _extract_approval_hours(detail)

    if not user_id or hours <= 0:
        return None

    # Only process if user is linked in PMA
    if user_id not in wecom_userids:
        return None

    sp_name = detail.get("sp_name", "审批")
    sp_no = detail.get("sp_no", "")

    existing = db.query(WeComCheckin).filter(
        WeComCheckin.user_id == user_id,
        WeComCheckin.date == date_key,
        WeComCheckin.source == "approval",
    ).first()

    if existing:
        existing.work_hours = hours
        existing.raw_data = json.dumps(detail, ensure_ascii=False)
        existing.synced_at = datetime.now(timezone.utc)
        logger.info(f"WeCom approval: updated {user_id} {date_key} {hours:.2f}h ({sp_name})")
        return "updated"
    else:
        db.add(WeComCheckin(
            user_id=user_id,
            date=date_key,
            work_hours=hours,
            source="approval",
            raw_data=json.dumps(detail, ensure_ascii=False),
            synced_at=datetime.now(timezone.utc),
        ))
        logger.info(f"WeCom approval: created {user_id} {date_key} {hours:.2f}h ({sp_name})")
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
            daily_map[d] = {"date": d, "total_hours": 0.0, "checkin_info": ""}
        daily_map[d]["total_hours"] += c.work_hours or 0.0
        # Extract details from raw_data based on source type
        try:
            if c.source == "approval":
                # Approval records: raw_data is a single dict {sp_name, sp_status, ...}
                raw = json.loads(c.raw_data or "{}")
                if isinstance(raw, dict):
                    sp_name = raw.get("sp_name", "")
                    if sp_name:
                        # Extract time range from apply_data
                        start_str, end_str = "", ""
                        try:
                            apply_data = raw.get("apply_data", {})
                            for content in (apply_data.get("contents") or []):
                                ctrl = content.get("control", "")
                                cid = content.get("id", "")
                                if ctrl == "Attendance" and cid == "smart-time":
                                    dr = (content.get("value", {})
                                          .get("attendance", {})
                                          .get("date_range", {}))
                                    begin_ts = dr.get("new_begin", 0)
                                    end_ts = dr.get("new_end", 0)
                                    if begin_ts:
                                        bt = datetime.fromtimestamp(begin_ts, tz=timezone.utc) + timedelta(hours=8)
                                        start_str = bt.strftime("%H:%M")
                                    if end_ts:
                                        et = datetime.fromtimestamp(end_ts, tz=timezone.utc) + timedelta(hours=8)
                                        end_str = et.strftime("%H:%M")
                                    break
                        except Exception:
                            pass
                        time_label = f"{start_str}-{end_str}" if start_str and end_str else ""
                        # Add approval label with time to checkin_info
                        if time_label:
                            daily_map[d]["checkin_info"] += f"[{sp_name} {time_label}] "
                        else:
                            daily_map[d]["checkin_info"] += f"[{sp_name}] "
                        if "approvals" not in daily_map[d]:
                            daily_map[d]["approvals"] = []
                        daily_map[d]["approvals"].append({
                            "name": sp_name,
                            "status": raw.get("sp_status", 0),
                            "apply_time": raw.get("apply_time", 0),
                            "start_time": start_str,
                            "end_time": end_str,
                        })
            else:
                # Checkin records: raw_data is an array [{checkin_type, checkin_time, ...}]
                raw = json.loads(c.raw_data or "[]")
                if "checkins" not in daily_map[d]:
                    daily_map[d]["checkins"] = []
                if isinstance(raw, list):
                    for r in raw:
                        ct = r.get("checkin_time", 0)
                        if ct:
                            t = datetime.fromtimestamp(ct, tz=timezone.utc) + timedelta(hours=8)
                            ctype = r.get("checkin_type", "")
                            tag = "↑" if "上班" in ctype else "↓"
                            daily_map[d]["checkin_info"] += f"{tag}{t.strftime('%H:%M')} "
                            daily_map[d]["checkins"].append({
                                "type": ctype,
                                "time": t.strftime("%H:%M:%S"),
                                "exception": r.get("exception_type", ""),
                                "location": r.get("location_title", "") or r.get("location_detail", "") or "",
                            })
        except Exception:
            pass

    daily = sorted(daily_map.values(), key=lambda x: x["date"], reverse=True)
    total = sum(d["total_hours"] for d in daily)

    # Last sync time
    last = db.query(WeComCheckin.synced_at).filter(
        WeComCheckin.user_id == user.wecom_userid,
    ).order_by(WeComCheckin.synced_at.desc()).first()
    last_sync_at = (last[0] + timedelta(hours=8)).strftime("%Y-%m-%dT%H:%M:%S") if last and last[0] else None

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
