"""Bug CRUD, worklog, analysis, attachments, and import logic."""
from __future__ import annotations
import logging
from datetime import date, datetime, timezone, timedelta
from typing import Optional
import os
import json

from sqlalchemy import or_
from sqlalchemy.orm import Session
from sqlalchemy.sql import func as sa_func

logger = logging.getLogger(__name__)

from backend.models.bug import PmaBug, BugWorkLog, BugAnalysis, BugAttachment, BugTransfer, BugComment
from backend.database import to_local_str
from backend.services.task_service import _sync_cc_favorites

UPLOAD_ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data", "uploads", "bugs")

# 维修类 Bug 类型值（驱动板卡 维修中/已维修 流转）
BUG_TYPE_REPAIR = "repair"


# ═══════════════════════════════════════════ Bug CRUD

def _parse_bug_id(query):
    """Parse a bare numeric id or '#N' from a search keyword, else None."""
    s = (query or "").strip()
    if s.startswith("#"):
        s = s[1:]
    if s.isdigit():
        return int(s)
    return None


def _build_bug_filter(db, product_id=None, project_id=None, status=None, assignee_id=None,
                      component_id=None, search=None, reporter_id=None, severity=None,
                      priority=None, type=None, created_from=None, created_to=None):
    """Build a filtered PmaBug query shared by list + stats."""
    q = db.query(PmaBug)
    if product_id: q = q.filter(PmaBug.product_id == product_id)
    if project_id: q = q.filter(PmaBug.project_id == project_id)
    if status: q = q.filter(PmaBug.status == status)
    if assignee_id: q = q.filter(PmaBug.assignee_id == assignee_id)
    if component_id: q = q.filter(PmaBug.component_id == component_id)
    if severity is not None: q = q.filter(PmaBug.severity == int(severity))
    if priority: q = q.filter(PmaBug.priority == priority)
    if type: q = q.filter(PmaBug.type == type)
    if reporter_id: q = q.filter(PmaBug.reporter_id == reporter_id)
    if created_from:
        try:
            q = q.filter(PmaBug.created_at >= datetime.strptime(created_from, "%Y-%m-%d"))
        except (ValueError, TypeError):
            pass
    if created_to:
        try:
            q = q.filter(PmaBug.created_at <= datetime.strptime(created_to + " 23:59:59", "%Y-%m-%d %H:%M:%S"))
        except (ValueError, TypeError):
            pass
    if search:
        cond = PmaBug.title.ilike(f"%{search}%")
        qid = _parse_bug_id(search)
        if qid is not None:
            cond = or_(PmaBug.title.ilike(f"%{search}%"), PmaBug.id == qid)
        q = q.filter(cond)
    return q


def get_bugs(db, product_id=None, project_id=None, status=None, assignee_id=None,
             component_id=None, search=None, reporter_id=None, severity=None,
             priority=None, type=None, created_from=None, created_to=None, limit=500):
    q = _build_bug_filter(db, product_id, project_id, status, assignee_id,
                          component_id, search, reporter_id, severity,
                          priority, type, created_from, created_to)
    q = q.order_by(PmaBug.created_at.desc()).limit(limit)
    return [_bug_dict(b, db) for b in q.all()]

def get_my_bugs(db, user_id, limit=200):
    """Get bugs for a user: assigned + reported + CC'd + watched (tagged with _source)."""
    bugs = []
    seen_ids = set()

    # 1. Bugs assigned to the user
    assigned = db.query(PmaBug).filter(
        PmaBug.assignee_id == user_id
    ).order_by(PmaBug.created_at.desc()).limit(limit).all()
    for b in assigned:
        d = _bug_dict(b, db)
        d["_source"] = "assigned"
        bugs.append(d)
        seen_ids.add(b.id)

    # 2. Bugs reported by the user
    reported = db.query(PmaBug).filter(
        PmaBug.reporter_id == user_id
    ).order_by(PmaBug.created_at.desc()).limit(limit).all()
    for b in reported:
        if b.id not in seen_ids:
            d = _bug_dict(b, db)
            d["_source"] = "reported"
            bugs.append(d)
            seen_ids.add(b.id)

    # 3. Bugs CC'd to the user (Python-side filter for SQLite compatibility)
    cc_q = db.query(PmaBug).filter(
        PmaBug.cc_user_ids.isnot(None)
    ).order_by(PmaBug.created_at.desc()).limit(limit * 2)
    for b in cc_q.all():
        if b.id not in seen_ids and user_id in (b.cc_user_ids or []):
            d = _bug_dict(b, db)
            d["_source"] = "cc"
            bugs.append(d)
            seen_ids.add(b.id)

    # 4. Bugs the user is watching (from favorites.bugs[]) — only those not already loaded
    from backend.models.local import LocalUser
    user = db.query(LocalUser).filter(LocalUser.id == user_id).first()
    if user:
        try:
            favs = json.loads(user.favorites or '{}')
        except (json.JSONDecodeError, TypeError):
            favs = {}
        if isinstance(favs, list):
            favs = {"products": favs, "projects": [], "tasks": [], "bugs": []}
        watched_ids = favs.get("bugs", [])
        if watched_ids:
            watched_bugs = db.query(PmaBug).filter(
                PmaBug.id.in_(watched_ids)
            ).order_by(PmaBug.created_at.desc()).all()
            for b in watched_bugs:
                if b.id not in seen_ids:
                    d = _bug_dict(b, db)
                    d["_source"] = "watched"
                    bugs.append(d)
                    seen_ids.add(b.id)

    source_order = {"assigned": 0, "reported": 1, "cc": 2, "watched": 3}
    bugs.sort(key=lambda d: (
        source_order.get(d.get("_source", "watched"), 3),
        -(d.get("id") or 0)
    ))
    return bugs[:limit * 2]

def get_bug(db, bug_id):
    b = db.query(PmaBug).filter(PmaBug.id == bug_id).first()
    if not b: return None
    d = _bug_dict(b, db)
    d["analyses"] = [_analysis_dict(a, db) for a in db.query(BugAnalysis).filter(BugAnalysis.bug_id == bug_id).order_by(BugAnalysis.created_at.asc()).all()]
    d["transfers"] = [_transfer_dict(t, db) for t in db.query(BugTransfer).filter(BugTransfer.bug_id == bug_id).order_by(BugTransfer.created_at.asc()).all()]
    d["attachments"] = [_attachment_dict(a) for a in db.query(BugAttachment).filter(BugAttachment.bug_id == bug_id, BugAttachment.analysis_id.is_(None)).all()]
    return d

def _board_ids_norm(data):
    """Normalize board_ids from request data → list[int]."""
    ids = data.get("board_ids") or []
    try:
        return [int(x) for x in ids if x is not None]
    except (TypeError, ValueError):
        return []


def _reporter_display_name(db, bug) -> str:
    from backend.models.local import LocalUser
    if not bug.reporter_id:
        return ""
    u = db.query(LocalUser).filter(LocalUser.id == bug.reporter_id).first()
    return (u.display_name or u.username) if u else ""


def _user_display_name(db, user_id) -> str:
    from backend.models.local import LocalUser
    if not user_id:
        return ""
    u = db.query(LocalUser).filter(LocalUser.id == user_id).first()
    return (u.display_name or u.username) if u else ""


def create_bug(db, data):
    board_ids = _board_ids_norm(data)
    b = PmaBug(
        title=data["title"], description=data.get("description", ""),
        product_id=data["product_id"], project_id=data.get("project_id"),
        component_id=data.get("component_id"),
        severity=data.get("severity", 3), priority=data.get("priority", "medium"),
        type=data.get("type", "codeerror"),
        reporter_id=data["reporter_id"], assignee_id=data.get("assignee_id"),
        estimate_hours=float(data.get("estimate_hours", 0) or 0),
        cc_user_ids=data.get("cc_user_ids"),
        progress=int(data.get("progress", 0) or 0),
        board_ids=board_ids or None,
    )
    db.add(b); db.commit(); db.refresh(b)
    _sync_cc_favorites(db, data.get("cc_user_ids"), b.id, 'bug')
    # 维修 Bug → 关联板卡进入维修中（系统联动，绕开归属人授权）
    if data.get("type") == BUG_TYPE_REPAIR and board_ids:
        from backend.services import board_service
        reporter_name = _reporter_display_name(db, b)
        for bid in board_ids:
            board_service.repair_start(db, bid, b, reporter_name)
    return _bug_dict(b, db)

def _fmt_change_val(v):
    """Format a change value for display (list/date/None → readable string)."""
    if v is None:
        return ""
    if isinstance(v, list):
        return "、".join(str(x) for x in v) if v else ""
    if isinstance(v, (date, datetime)):
        return str(v)[:10]
    return str(v)


def update_bug(db, bug_id, data, user_id=None):
    b = db.query(PmaBug).filter(PmaBug.id == bug_id).first()
    if not b: return None
    old_status = b.status
    old_cc_user_ids = (b.cc_user_ids or [])[:]  # snapshot for CC favorites sync
    old_board_ids = [int(x) for x in (b.board_ids or []) if x is not None]  # snapshot for repair linkage
    # Collect field-level changes (Zentao-style) for structured history
    changes = []
    for k in ["title","description","product_id","project_id","component_id","status","resolution",
              "severity","priority","type","assignee_id","estimate_hours",
              "gitlab_url","gitlab_iid","resolved_by_id","cc_user_ids","progress","board_ids"]:
        if k in data:
            old_val = getattr(b, k)
            new_val = data[k]
            if old_val != new_val:
                setattr(b, k, new_val)
                changes.append({"field": k, "old_value": _fmt_change_val(old_val), "new_value": _fmt_change_val(new_val)})
    if data.get("status") == "resolved" and not b.resolved_at:
        b.resolved_at = datetime.now(timezone.utc)
    if data.get("status") == "closed" and not b.closed_at:
        b.closed_at = datetime.now(timezone.utc)
    b.updated_at = datetime.now(timezone.utc)
    db.commit()
    # Sync CC favorites: add for new CC users, remove for removed CC users
    if "cc_user_ids" in data:
        try:
            new_cc = data.get("cc_user_ids") or []
            added = [uid for uid in new_cc if uid not in old_cc_user_ids]
            removed = [uid for uid in old_cc_user_ids if uid not in new_cc]
            _sync_cc_favorites(db, added, b.id, 'bug')
            from backend.models.local import LocalUser
            for uid in removed:
                try:
                    ru = db.query(LocalUser).filter(LocalUser.id == uid).first()
                    if ru:
                        try:
                            rfavs = json.loads(ru.favorites or '{}')
                        except (json.JSONDecodeError, TypeError):
                            rfavs = {}
                        if isinstance(rfavs, list):
                            rfavs = {"products": rfavs, "projects": [], "tasks": [], "bugs": []}
                        rlst = rfavs.get("bugs", [])
                        if b.id in rlst:
                            rlst.remove(b.id)
                            rfavs["bugs"] = rlst
                            ru.favorites = json.dumps(rfavs)
                except Exception:
                    logger.exception(f"[cc:fav] failed to remove bug#{b.id} from user_id={uid}")
        except Exception:
            logger.exception(f"[cc:fav] CC sync failed for bug#{b.id}")
    # Auto-sync linked bugs when resolved/closed
    if data.get("status") in ("resolved","closed") and old_status not in ("resolved","closed"):
        linked = db.query(PmaBug).filter(PmaBug.original_bug_id == bug_id).all()
        for lb in linked:
            if lb.status not in ("resolved","closed"):
                lb.status = "resolved"; lb.resolved_at = datetime.now(timezone.utc)
                db.add(BugAnalysis(bug_id=lb.id, user_id=lb.assignee_id or lb.reporter_id,
                        content=f"关联 Bug #{bug_id} 已解决，自动同步状态"))
        if linked: db.commit()
    # 维修 Bug 板卡联动（新增关联板卡，bug 未解决 → 补 维修中 事件；移除的不回退）
    if "board_ids" in data:
        new_board_ids = [int(x) for x in (b.board_ids or []) if x is not None]
        if b.type == BUG_TYPE_REPAIR and b.status not in ("resolved", "closed"):
            added = [x for x in new_board_ids if x not in old_board_ids]
            if added:
                from backend.services import board_service
                reporter_name = _reporter_display_name(db, b)
                for bid in added:
                    board_service.repair_start(db, bid, b, reporter_name)
    # 维修 Bug 解决/关闭 → 关联板卡 维修中→已维修（系统联动）
    if data.get("status") in ("resolved", "closed") and old_status not in ("resolved", "closed"):
        bid_list = [int(x) for x in (b.board_ids or []) if x is not None]
        if bid_list:
            from backend.services import board_service
            actor_name = _user_display_name(db, user_id)
            for bid in bid_list:
                board_service.repair_finish(db, bid, b, actor_name)
    # Record structured change history
    if changes and user_id:
        from backend.services.action_service import record_action
        record_action(db, "bug", b.id, user_id, "updated", changes)
    return _bug_dict(b, db)

def delete_bug(db, bug_id):
    b = db.query(PmaBug).filter(PmaBug.id == bug_id).first()
    if not b: return False
    db.delete(b); db.commit()
    return True

# ═══════════════════════════════════════════ Worklogs

def get_worklogs(db, bug_id):
    logs = db.query(BugWorkLog).filter(BugWorkLog.bug_id == bug_id).order_by(BugWorkLog.date.desc()).all()
    from backend.models.local import LocalUser
    from backend.services.worklog_hours import collect_baselines, row_derived_hours, row_basis
    uids = {w.user_id for w in logs}
    users = {u.id: (u.display_name or u.username) for u in db.query(LocalUser).filter(LocalUser.id.in_(uids)).all()}
    bls = collect_baselines(db, logs)
    return [{"id": w.id, "bug_id": w.bug_id, "user_id": w.user_id,
             "username": users.get(w.user_id, "?"),
             "hours": row_derived_hours(w, bls.get((w.user_id, w.date))),
             "percentage": w.percentage,
             "calculated_hours": row_derived_hours(w, bls.get((w.user_id, w.date))),
             "basis": row_basis(bls.get((w.user_id, w.date))),
             "date": str(w.date) if w.date else None,
             "description": w.description,
             "created_at": to_local_str(w.created_at) if w.created_at else None}
            for w in logs]

def create_worklog(db, data, user_id):
    from backend.services.worklog_service import _parse_date, _validate_percentage_not_exceeded
    pct = float(data.get("percentage", 0) or 0)
    d = _parse_date(data.get("date")) or date.today()
    # 单条新增同样校验：当日已填 + 本条 ≤ 100%（与批量/编辑口径一致）
    _validate_percentage_not_exceeded(db, user_id, d, pct)
    # 只存百分比；派生小时列休眠（hours 因 NOT NULL 写 0.0 占位，读路径一律实时推导）
    w = BugWorkLog(bug_id=data["bug_id"], user_id=user_id,
                   hours=0.0, percentage=pct,
                   date=d, description=data.get("description", ""))
    db.add(w); db.commit()
    _recalc_bug_hours(db, data["bug_id"])
    return _worklog_dict(w, db)

def create_worklog_batch(db, bug_id, entries, user_id):
    """Batch-create multiple worklog entries for the same bug."""
    from collections import defaultdict
    from backend.services.worklog_service import _parse_date, _validate_percentage_not_exceeded

    # Pre-validate: group entries by date and check cumulative percentage
    date_new_pcts = defaultdict(float)
    for entry in entries:
        d = _parse_date(entry.get("date")) or date.today()
        date_new_pcts[d] += float(entry.get("percentage", 0) or 0)
    for d, total_new_pct in date_new_pcts.items():
        _validate_percentage_not_exceeded(db, user_id, d, total_new_pct)

    created = []
    max_progress = None
    for entry in entries:
        data = {
            "bug_id": bug_id,
            "percentage": entry.get("percentage", 0),
            "date": entry.get("date"),
            "description": entry.get("description"),
        }
        wl = create_worklog(db, data, user_id)
        created.append(wl)
        progress = entry.get("progress")
        if progress is not None:
            max_progress = max(max_progress or 0, int(progress))

    # Only-up-not-down: bump bug progress to the highest entry progress
    if max_progress is not None:
        bug = db.query(PmaBug).filter(PmaBug.id == bug_id).first()
        if bug:
            new_progress = max(bug.progress or 0, max_progress)
            if new_progress > (bug.progress or 0):
                bug.progress = new_progress
                db.commit()
    return created

def update_worklog(db, wl_id, data):
    from backend.services.worklog_service import _parse_date, _validate_percentage_not_exceeded
    w = db.query(BugWorkLog).filter(BugWorkLog.id == wl_id).first()
    if not w: return None
    if "percentage" in data:
        pct = float(data["percentage"] or 0)
        _validate_percentage_not_exceeded(db, w.user_id, w.date, pct, exclude_bug_id=w.id)
        w.percentage = pct
    if "date" in data:
        v = data["date"]
        if isinstance(v, str):
            v = _parse_date(v) or w.date
        if v != w.date and w.percentage:
            _validate_percentage_not_exceeded(db, w.user_id, v, w.percentage)
        w.date = v
    if "description" in data:
        w.description = data["description"]
    db.commit(); _recalc_bug_hours(db, w.bug_id)
    return _worklog_dict(w, db)

def delete_worklog(db, wl_id):
    w = db.query(BugWorkLog).filter(BugWorkLog.id == wl_id).first()
    if not w: return False
    bug_id = w.bug_id; db.delete(w); db.commit()
    _recalc_bug_hours(db, bug_id)
    return True

# ═══════════════════════════════════════════ Analysis

def create_analysis(db, data, user_id):
    a = BugAnalysis(bug_id=data["bug_id"], user_id=user_id,
                    title=data.get("title"), content=data["content"],
                    attachments=data.get("attachments"))
    db.add(a); db.commit()
    return _analysis_dict(a, db)

def update_analysis(db, aid, data):
    a = db.query(BugAnalysis).filter(BugAnalysis.id == aid).first()
    if not a: return None
    if "title" in data: a.title = data["title"]
    if "content" in data: a.content = data["content"]
    if "attachments" in data: a.attachments = data["attachments"]
    db.commit()
    return _analysis_dict(a, db)

def delete_analysis(db, aid):
    a = db.query(BugAnalysis).filter(BugAnalysis.id == aid).first()
    if not a: return False
    a.is_deleted = 1  # 软删除：保留内容，前端显示删除线
    db.commit()
    return True

# ═══════════════════════════════════════════ Comments

def get_comments(db, bug_id):
    comments = db.query(BugComment).filter(BugComment.bug_id == bug_id).order_by(BugComment.created_at.asc()).all()
    from backend.models.local import LocalUser
    uids = {c.user_id for c in comments}
    users = {u.id: (u.display_name or u.username) for u in db.query(LocalUser).filter(LocalUser.id.in_(uids)).all()}
    return [{"id": c.id, "bug_id": c.bug_id, "user_id": c.user_id,
             "username": users.get(c.user_id, "?"), "content": c.content,
             "is_system": c.is_system, "is_deleted": c.is_deleted or 0,
             "created_at": to_local_str(c.created_at) if c.created_at else None}
            for c in comments]

def create_comment(db, bug_id, content, user_id, is_system=0):
    c = BugComment(bug_id=bug_id, user_id=user_id, content=content, is_system=is_system)
    db.add(c); db.commit()
    return {"id": c.id, "bug_id": c.bug_id, "user_id": c.user_id,
            "content": c.content, "is_system": c.is_system, "is_deleted": c.is_deleted or 0,
            "created_at": to_local_str(c.created_at) if c.created_at else None}

def update_comment(db, cid, content):
    c = db.query(BugComment).filter(BugComment.id == cid).first()
    if not c: return None
    c.content = content
    db.commit()
    return {"id": c.id, "bug_id": c.bug_id, "user_id": c.user_id,
            "content": c.content, "is_system": c.is_system, "is_deleted": c.is_deleted or 0,
            "created_at": to_local_str(c.created_at) if c.created_at else None}

def delete_comment(db, cid):
    c = db.query(BugComment).filter(BugComment.id == cid).first()
    if not c: return False
    c.is_deleted = 1  # 软删除：保留内容，前端显示删除线
    db.commit()
    return True

def add_system_comment(db, bug_id, user_id, content):
    return create_comment(db, bug_id, content, user_id, is_system=1)


# ═══════════════════════════════════════════ Attachments

def save_attachment(db, bug_id, analysis_id, filename, mime_type, file_data, user_id):
    bug_dir = os.path.join(UPLOAD_ROOT, str(bug_id))
    os.makedirs(bug_dir, exist_ok=True)
    base, ext = os.path.splitext(filename)
    fname, fpath = filename, os.path.join(bug_dir, filename)
    counter = 1
    while os.path.exists(fpath):
        fname = f"{base}_{counter}{ext}"
        fpath = os.path.join(bug_dir, fname)
        counter += 1
    with open(fpath, "wb") as f: f.write(file_data)
    rel = os.path.join("bugs", str(bug_id), fname)
    a = BugAttachment(bug_id=bug_id, analysis_id=analysis_id, filename=fname,
                      mime_type=mime_type, file_path=rel, file_size=len(file_data),
                      uploaded_by=user_id)
    db.add(a); db.commit()
    return _attachment_dict(a)

def get_attachment_path(attachment_id, db):
    a = db.query(BugAttachment).filter(BugAttachment.id == attachment_id).first()
    if not a: return None
    abs_path = os.path.normpath(os.path.join(UPLOAD_ROOT, "..", a.file_path))
    if not os.path.exists(abs_path): return None
    return abs_path, a.mime_type, a.filename

# ═══════════════════════════════════════════ Import

def import_from_zentao(db, zentao_bug_id, product_id, reporter_id, project_id=None):
    from backend.models.bug import CachedBug
    zb = db.query(CachedBug).filter(CachedBug.id == zentao_bug_id).first()
    if not zb: return None
    existing = db.query(PmaBug).filter(PmaBug.source_bug_id == zentao_bug_id).first()
    if existing: return _bug_dict(existing, db)
    sev_map = {1:1,2:2,3:3,4:4}
    prio_map = {1:"high",2:"medium",3:"medium",4:"low"}
    bt = zb.type or "codeerror"
    if bt not in ("codeerror","design","compatibility","standard","security","performance"): bt = "other"
    b = PmaBug(title=zb.title, description=f"（导入自禅道 Bug #{zentao_bug_id}）", product_id=product_id,
               project_id=project_id or zb.project_id, status="open",
               severity=sev_map.get(zb.severity,3), priority=prio_map.get(zb.priority,"medium"),
               type=bt, reporter_id=reporter_id, source_bug_id=zentao_bug_id)
    db.add(b); db.commit(); db.refresh(b)
    return _bug_dict(b, db)

def import_batch(db, ids, product_id, reporter_id):
    imported = skipped = 0
    for zid in ids:
        r = import_from_zentao(db, zid, product_id, reporter_id)
        if r: imported += 1
        else: skipped += 1
    return {"imported": imported, "skipped": skipped}


def get_zentao_candidates(db, product_id, search=None, limit=200):
    """List CachedBug rows for a product not yet imported as PmaBug."""
    from backend.models.bug import CachedBug
    imported = db.query(PmaBug.source_bug_id).filter(
        PmaBug.source_bug_id.isnot(None)
    ).all()
    imported_ids = {r[0] for r in imported}
    q = db.query(CachedBug).filter(CachedBug.product_id == product_id)
    if search:
        q = q.filter(CachedBug.title.ilike(f"%{search}%"))
    results = []
    for cb in q.order_by(CachedBug.id.desc()).limit(limit).all():
        if cb.id in imported_ids:
            continue
        results.append({
            "id": cb.id,
            "title": cb.title,
            "severity": cb.severity,
            "priority": cb.priority,
            "status": cb.status,
            "opened_date": str(cb.opened_date) if cb.opened_date else None,
            "assigned_to": cb.assigned_to,
        })
    return results

# ═══════════════════════════════════════════ Transfer

def transfer_bug(db, bug_id, to_project_id, transfer_type, user_id):
    b = db.query(PmaBug).filter(PmaBug.id == bug_id).first()
    if not b: return None
    from_pid = b.project_id
    if transfer_type == "move":
        b.project_id = to_project_id
        db.commit()
        target = b
    elif transfer_type == "copy":
        nb = PmaBug(title=b.title, description=b.description, product_id=b.product_id,
                    project_id=to_project_id, component_id=b.component_id,
                    status="open", severity=b.severity, priority=b.priority, type=b.type,
                    reporter_id=user_id, original_bug_id=b.id, estimate_hours=0.0)
        db.add(nb); db.commit(); db.refresh(nb)
        target = nb
    else: return None
    t = BugTransfer(bug_id=target.id, from_project_id=from_pid, to_project_id=to_project_id,
                    transfer_type=transfer_type, transferred_by=user_id)
    db.add(t)
    from backend.models.zentao import CachedProject
    fp = db.query(CachedProject).filter(CachedProject.id == from_pid).first() if from_pid else None
    tp = db.query(CachedProject).filter(CachedProject.id == to_project_id).first()
    note = f"Bug {'转移到' if transfer_type=='move' else '复制到'}项目「{tp.name if tp else to_project_id}」"
    if fp: note += f"（来源：{fp.name}）"
    db.add(BugAnalysis(bug_id=bug_id, user_id=user_id, content=note))
    db.commit()
    return _bug_dict(target, db)

# ═══════════════════════════════════════════ Helpers

def _bug_dict(b, db=None):
    pc = pn = pj_n = pj_c = cn = rn = an = cc_names = None
    board_nos = []
    if db:
        if b.product_id:
            p = db.query(__import__('backend.models.zentao', fromlist=['PmaProduct']).PmaProduct).filter_by(id=b.product_id).first()
            if p: pn, pc = p.name, p.code
        if b.project_id:
            pj = db.query(__import__('backend.models.zentao', fromlist=['CachedProject']).CachedProject).filter_by(id=b.project_id).first()
            if pj: pj_n, pj_c = pj.name, pj.code
        if b.component_id:
            tpl = db.query(__import__('backend.models.document', fromlist=['ProductDocTemplate']).ProductDocTemplate).filter_by(id=b.component_id).first()
            if tpl: cn = tpl.doc_name
        if b.reporter_id or b.assignee_id:
            LU = __import__('backend.models.local', fromlist=['LocalUser']).LocalUser
            if b.reporter_id:
                u = db.query(LU).filter_by(id=b.reporter_id).first()
                if u: rn = u.display_name or u.username
            if b.assignee_id:
                u = db.query(LU).filter_by(id=b.assignee_id).first()
                if u: an = u.display_name or u.username
        if b.cc_user_ids:
            LU = __import__('backend.models.local', fromlist=['LocalUser']).LocalUser
            cc_users = db.query(LU).filter(LU.id.in_(b.cc_user_ids)).all()
            cc_names = [u.display_name or u.username for u in cc_users]
        if b.board_ids:
            try:
                ids = [int(x) for x in b.board_ids if x is not None]
            except (TypeError, ValueError):
                ids = []
            if ids:
                DB = __import__('backend.models.delivery', fromlist=['DeliveryBoard']).DeliveryBoard
                rows = db.query(DB).filter(DB.id.in_(ids)).all()
                idmap = {r.id: r.serial_no for r in rows}
                board_nos = [idmap.get(x, "") for x in ids]
    return {"id":b.id,"title":b.title,"description":b.description or "","product_id":b.product_id,"product_name":pn,"product_code":pc,
            "project_id":b.project_id,"project_name":pj_n,"project_code":pj_c,
            "component_id":b.component_id,"component_name":cn,
            "status":b.status or "open","resolution":b.resolution,"severity":b.severity or 3,"priority":b.priority or "medium","type":b.type or "codeerror",
            "reporter_id":b.reporter_id,"reporter_name":rn,"assignee_id":b.assignee_id,"assignee_name":an,"resolved_by_id":b.resolved_by_id,
            "original_bug_id":b.original_bug_id,"source_bug_id":b.source_bug_id,
            "gitlab_url":b.gitlab_url,"gitlab_iid":b.gitlab_iid,
            "estimate_hours":b.estimate_hours or 0,"consumed_hours":b.consumed_hours or 0,
            "progress":b.progress or 0,
            "due_date":str(b.due_date) if b.due_date else None,
            "resolved_at":to_local_str(b.resolved_at) if b.resolved_at else None,
            "closed_at":to_local_str(b.closed_at) if b.closed_at else None,
            "created_at":to_local_str(b.created_at) if b.created_at else None,
            "updated_at":to_local_str(b.updated_at) if b.updated_at else None,
            "cc_user_ids": b.cc_user_ids or [],
            "cc_user_names": cc_names or [],
            "board_ids": b.board_ids or [],
            "board_nos": board_nos}

def _analysis_dict(a, db=None):
    from backend.models.local import LocalUser
    result = {"id":a.id,"bug_id":a.bug_id,"user_id":a.user_id,"title":a.title,"content":a.content,"attachments":a.attachments or [],
              "is_deleted": a.is_deleted or 0,
              "created_at":to_local_str(a.created_at) if a.created_at else None}
    if db:
        u = db.query(LocalUser).filter(LocalUser.id == a.user_id).first()
        result["username"] = u.display_name or u.username if u else None
    return result

def _attachment_dict(a):
    return {"id":a.id,"bug_id":a.bug_id,"analysis_id":a.analysis_id,"filename":a.filename,"mime_type":a.mime_type,
            "file_path":a.file_path,"file_size":a.file_size,"url":f"/api/attachments/{a.id}",
            "created_at":to_local_str(a.created_at) if a.created_at else None}

def _worklog_dict(w, db=None):
    from backend.models.local import LocalUser
    from backend.services.worklog_hours import baselines_for, row_derived_hours, row_basis
    bl = None
    if db and w.user_id and w.date:
        bl = baselines_for(db, [(w.user_id, w.date)]).get((w.user_id, w.date))
    basis = row_basis(bl)
    dh = row_derived_hours(w, bl)
    result = {"id":w.id,"bug_id":w.bug_id,"user_id":w.user_id,"hours":dh,
              "percentage":w.percentage,"calculated_hours":dh,
              "basis":basis, "has_checkin": basis == "ok",
              "date":str(w.date) if w.date else None,"description":w.description,
              "created_at":to_local_str(w.created_at) if w.created_at else None}
    if db:
        u = db.query(LocalUser).filter(LocalUser.id == w.user_id).first()
        result["username"] = u.display_name or u.username if u else None
    return result

def _transfer_dict(t, db=None):
    fp_n=tp_n=un="?"
    if db:
        from backend.models.zentao import CachedProject
        from backend.models.local import LocalUser
        if t.from_project_id:
            fp = db.query(CachedProject).filter_by(id=t.from_project_id).first()
            if fp: fp_n = fp.name
        if t.to_project_id:
            tp = db.query(CachedProject).filter_by(id=t.to_project_id).first()
            if tp: tp_n = tp.name
        if t.transferred_by:
            u = db.query(LocalUser).filter_by(id=t.transferred_by).first()
            if u: un = u.display_name or u.username
    return {"id":t.id,"from_project_id":t.from_project_id,"from_project_name":fp_n,
            "to_project_id":t.to_project_id,"to_project_name":tp_n,
            "transfer_type":t.transfer_type,"transferred_by":un,
            "created_at":to_local_str(t.created_at) if t.created_at else None}

def _recalc_bug_hours(db, bug_id):
    """Refresh PmaBug.consumed_hours 缓存（冗余列）—— 派生口径，与任务侧 recalc_consumed_hours 一致。"""
    from backend.services.worklog_hours import derived_bug_hours
    total = derived_bug_hours(db, bug_id)
    db.query(PmaBug).filter(PmaBug.id == bug_id).update({PmaBug.consumed_hours: float(total)})
    db.commit()


def _month_bucket(dt):
    """Return 'YYYY-MM' string for a datetime (or None)."""
    if not dt:
        return None
    try:
        return dt.strftime("%Y-%m")
    except Exception:
        return None


def get_bug_stats(db: Session, project_id: Optional[int] = None, product_id: Optional[int] = None,
                  status: Optional[str] = None, assignee_id: Optional[int] = None,
                  component_id: Optional[int] = None, search: Optional[str] = None,
                  reporter_id: Optional[int] = None, severity: Optional[int] = None,
                  priority: Optional[str] = None, type: Optional[str] = None,
                  created_from: Optional[str] = None, created_to: Optional[str] = None) -> dict:
    """Return bug statistics: total, open/resolved/closed/recent_30d, distributions, monthly trend."""
    q = _build_bug_filter(db, product_id, project_id, status, assignee_id,
                          component_id, search, reporter_id, severity,
                          priority, type, created_from, created_to)
    total = q.count()

    def _group(col):
        return {str(k): c for k, c in q.with_entities(col, sa_func.count()).group_by(col).all()}

    by_status = _group(PmaBug.status)
    by_severity = {str(k): c for k, c in q.with_entities(PmaBug.severity, sa_func.count()).group_by(PmaBug.severity).all()}
    by_priority = _group(PmaBug.priority)
    by_type = _group(PmaBug.type)

    open_statuses = ("open", "confirmed", "in_progress", "gitlab_submitted")
    open_n = sum(c for s, c in by_status.items() if s in open_statuses)
    resolved_n = int(by_status.get("resolved", 0))
    closed_n = int(by_status.get("closed", 0))

    now = datetime.now()
    recent_30d = q.filter(PmaBug.created_at >= (now - timedelta(days=30))).count()

    # Distribution by product
    product_rows = q.with_entities(PmaBug.product_id, sa_func.count()).group_by(PmaBug.product_id).all()
    pid_set = [r[0] for r in product_rows if r[0]]
    prod_names = {}
    if pid_set:
        from backend.models.zentao import PmaProduct
        prod_names = {p.id: p.name for p in db.query(PmaProduct).filter(PmaProduct.id.in_(pid_set)).all()}
    by_product = [{"id": rid, "name": prod_names.get(rid, f"产品#{rid}"), "count": c}
                  for rid, c in product_rows if rid][:20]

    # Distribution by assignee
    assignee_rows = q.with_entities(PmaBug.assignee_id, sa_func.count()).group_by(PmaBug.assignee_id).all()
    uid_set = [r[0] for r in assignee_rows if r[0]]
    uname_map = {}
    if uid_set:
        from backend.models.local import LocalUser
        uname_map = {u.id: (u.display_name or u.username)
                     for u in db.query(LocalUser).filter(LocalUser.id.in_(uid_set)).all()}
    by_assignee = [{"id": rid, "name": uname_map.get(rid, f"用户#{rid}"), "count": c}
                   for rid, c in assignee_rows if rid][:20]

    # Distribution by project
    project_rows = q.with_entities(PmaBug.project_id, sa_func.count()).group_by(PmaBug.project_id).all()
    proj_id_set = [r[0] for r in project_rows if r[0]]
    proj_map = {}
    if proj_id_set:
        from backend.models.zentao import CachedProject
        proj_map = {p.id: (p.name, p.code) for p in db.query(CachedProject).filter(CachedProject.id.in_(proj_id_set)).all()}
    by_project = [{"id": rid, "name": (proj_map.get(rid) or (None, None))[0] or f"项目#{rid}",
                   "code": (proj_map.get(rid) or (None, None))[1],
                   "count": c}
                  for rid, c in project_rows if rid][:20]

    # Monthly trend — last 12 months created (by created_at) + resolved (by resolved_at)
    created_rows = q.with_entities(PmaBug.created_at, sa_func.count()).group_by(PmaBug.created_at).all()
    resolved_rows = q.with_entities(PmaBug.resolved_at, sa_func.count()).group_by(PmaBug.resolved_at).all()
    created_buckets = {}
    for dt, c in created_rows:
        m = _month_bucket(dt)
        if m:
            created_buckets[m] = created_buckets.get(m, 0) + c
    resolved_buckets = {}
    for dt, c in resolved_rows:
        m = _month_bucket(dt)
        if m:
            resolved_buckets[m] = resolved_buckets.get(m, 0) + c
    trend = []
    for i in range(11, -1, -1):
        d = now.replace(day=1) - timedelta(days=0)
        y, mo = (now.year, now.month - i)
        while mo <= 0:
            y -= 1
            mo += 12
        month_key = f"{y:04d}-{mo:02d}"
        trend.append({"month": month_key, "created": created_buckets.get(month_key, 0),
                      "resolved": resolved_buckets.get(month_key, 0)})

    return {"total": total, "open": open_n, "resolved": resolved_n, "closed": closed_n,
            "recent_30d": recent_30d, "by_status": by_status, "by_severity": by_severity,
            "by_priority": by_priority, "by_type": by_type,
            "by_product": by_product, "by_assignee": by_assignee, "by_project": by_project, "trend": trend}


def get_bug_list(db: Session, project_id: Optional[int] = None, product_id: Optional[int] = None,
                 page: int = 1, limit: int = 100):
    """Return paginated bug list."""
    q = db.query(PmaBug)
    if project_id:
        q = q.filter(PmaBug.project_id == project_id)
    if product_id:
        q = q.filter(PmaBug.product_id == product_id)
    total = q.count()
    items = q.order_by(PmaBug.id.desc()).offset((page - 1) * limit).limit(limit).all()
    return [_bug_dict(b, db) for b in items], total


def get_user_bugs(db, user_id, limit=500):
    """返回某用户的所有相关 Bug：负责人 + 创建人 + 被抄送 + 关注 (tagged with _source)."""
    result = []
    seen_ids = set()

    # 1. Bugs assigned to the user
    assigned = db.query(PmaBug).filter(
        PmaBug.assignee_id == user_id
    ).order_by(PmaBug.created_at.desc()).limit(limit).all()
    for b in assigned:
        d = _bug_dict(b, db)
        d["_source"] = "assigned"
        result.append(d)
        seen_ids.add(b.id)

    # 2. Bugs reported by the user
    reported = db.query(PmaBug).filter(
        PmaBug.reporter_id == user_id
    ).order_by(PmaBug.created_at.desc()).limit(limit).all()
    for b in reported:
        if b.id not in seen_ids:
            d = _bug_dict(b, db)
            d["_source"] = "reported"
            result.append(d)
            seen_ids.add(b.id)

    # 3. Bugs CC'd to the user
    cc_q = db.query(PmaBug).filter(
        PmaBug.cc_user_ids.isnot(None)
    ).order_by(PmaBug.created_at.desc()).limit(limit * 2)
    for b in cc_q.all():
        if b.id not in seen_ids and user_id in (b.cc_user_ids or []):
            d = _bug_dict(b, db)
            d["_source"] = "cc"
            result.append(d)
            seen_ids.add(b.id)

    # 4. Bugs the user is watching (from favorites.bugs[])
    from backend.models.local import LocalUser
    user = db.query(LocalUser).filter(LocalUser.id == user_id).first()
    if user:
        try:
            favs = json.loads(user.favorites or '{}')
        except (json.JSONDecodeError, TypeError):
            favs = {}
        if isinstance(favs, list):
            favs = {"products": favs, "projects": [], "tasks": [], "bugs": []}
        watched_ids = favs.get("bugs", [])
        if watched_ids:
            watched_bugs = db.query(PmaBug).filter(
                PmaBug.id.in_(watched_ids)
            ).order_by(PmaBug.created_at.desc()).all()
            for b in watched_bugs:
                if b.id not in seen_ids:
                    d = _bug_dict(b, db)
                    d["_source"] = "watched"
                    result.append(d)
                    seen_ids.add(b.id)

    source_order = {"assigned": 0, "reported": 1, "cc": 2, "watched": 3}
    result.sort(key=lambda d: (
        source_order.get(d.get("_source", "watched"), 3),
        -(d.get("id") or 0)
    ))
    return result[:limit * 2]


# ═══════════════════════════════════════════ Batch operations

def batch_update_status(db, bug_ids, status, user_id=None):
    """Change status of multiple bugs. Returns updated count."""
    updated = 0
    for bid in bug_ids:
        bug = db.query(PmaBug).filter(PmaBug.id == bid).first()
        if not bug:
            continue
        update_bug(db, bid, {"status": status}, user_id=user_id)
        updated += 1
    db.commit()
    return updated


def batch_assign(db, bug_ids, assignee_id, user_id=None):
    """Reassign multiple bugs. Returns updated count."""
    updated = 0
    for bid in bug_ids:
        bug = db.query(PmaBug).filter(PmaBug.id == bid).first()
        if not bug:
            continue
        update_bug(db, bid, {"assignee_id": assignee_id}, user_id=user_id)
        updated += 1
    db.commit()
    return updated


def batch_delete(db, bug_ids):
    """Delete multiple bugs. Returns deleted count."""
    deleted = 0
    for bid in bug_ids:
        if delete_bug(db, bid):
            deleted += 1
    db.commit()
    return deleted


def batch_transfer(db, bug_ids, to_project_id, transfer_type, user_id=None):
    """Move/copy multiple bugs to another project. Returns processed count."""
    processed = 0
    for bid in bug_ids:
        bug = db.query(PmaBug).filter(PmaBug.id == bid).first()
        if not bug:
            continue
        transfer_bug(db, bid, to_project_id, transfer_type, user_id)
        processed += 1
    db.commit()
    return processed
