"""Bug CRUD, worklog, analysis, attachments, and import logic."""
from __future__ import annotations
from datetime import date, datetime, timezone
from typing import Optional
import os

from sqlalchemy.orm import Session
from sqlalchemy.sql import func as sa_func

from backend.models.bug import PmaBug, BugWorkLog, BugAnalysis, BugAttachment, BugTransfer
from backend.database import to_local_str

UPLOAD_ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data", "uploads", "bugs")


# ═══════════════════════════════════════════ Bug CRUD

def get_bugs(db, product_id=None, project_id=None, status=None, assignee_id=None,
             component_id=None, search=None, limit=100):
    q = db.query(PmaBug)
    if product_id: q = q.filter(PmaBug.product_id == product_id)
    if project_id: q = q.filter(PmaBug.project_id == project_id)
    if status: q = q.filter(PmaBug.status == status)
    if assignee_id: q = q.filter(PmaBug.assignee_id == assignee_id)
    if component_id: q = q.filter(PmaBug.component_id == component_id)
    if search: q = q.filter(PmaBug.title.ilike(f"%{search}%"))
    q = q.order_by(PmaBug.created_at.desc()).limit(limit)
    return [_bug_dict(b, db) for b in q.all()]

def get_my_bugs(db, user_id, limit=200):
    q = db.query(PmaBug).filter(
        (PmaBug.assignee_id == user_id) | (PmaBug.reporter_id == user_id)
    ).order_by(PmaBug.created_at.desc()).limit(limit)
    return [_bug_dict(b, db) for b in q.all()]

def get_bug(db, bug_id):
    b = db.query(PmaBug).filter(PmaBug.id == bug_id).first()
    if not b: return None
    d = _bug_dict(b, db)
    d["analyses"] = [_analysis_dict(a) for a in db.query(BugAnalysis).filter(BugAnalysis.bug_id == bug_id).order_by(BugAnalysis.created_at.asc()).all()]
    d["transfers"] = [_transfer_dict(t, db) for t in db.query(BugTransfer).filter(BugTransfer.bug_id == bug_id).order_by(BugTransfer.created_at.asc()).all()]
    d["attachments"] = [_attachment_dict(a) for a in db.query(BugAttachment).filter(BugAttachment.bug_id == bug_id, BugAttachment.analysis_id.is_(None)).all()]
    return d

def create_bug(db, data):
    b = PmaBug(
        title=data["title"], description=data.get("description", ""),
        product_id=data["product_id"], project_id=data.get("project_id"),
        component_id=data.get("component_id"),
        severity=data.get("severity", 3), priority=data.get("priority", "medium"),
        type=data.get("type", "codeerror"),
        reporter_id=data["reporter_id"], assignee_id=data.get("assignee_id"),
        estimate_hours=float(data.get("estimate_hours", 0) or 0),
    )
    db.add(b); db.commit(); db.refresh(b)
    return _bug_dict(b, db)

def update_bug(db, bug_id, data):
    b = db.query(PmaBug).filter(PmaBug.id == bug_id).first()
    if not b: return None
    for k in ["title","description","project_id","component_id","status","resolution",
              "severity","priority","type","assignee_id","estimate_hours",
              "gitlab_url","gitlab_iid","resolved_by_id"]:
        if k in data: setattr(b, k, data[k])
    if data.get("status") == "resolved" and not b.resolved_at:
        b.resolved_at = datetime.now(timezone.utc)
    if data.get("status") == "closed" and not b.closed_at:
        b.closed_at = datetime.now(timezone.utc)
    b.updated_at = datetime.now(timezone.utc)
    db.commit()
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
    uids = {w.user_id for w in logs}
    users = {u.id: (u.display_name or u.username) for u in db.query(LocalUser).filter(LocalUser.id.in_(uids)).all()}
    return [{"id": w.id, "bug_id": w.bug_id, "user_id": w.user_id,
             "username": users.get(w.user_id, "?"), "hours": w.hours,
             "date": str(w.date) if w.date else None,
             "description": w.description,
             "created_at": to_local_str(w.created_at) if w.created_at else None}
            for w in logs]

def create_worklog(db, data, user_id):
    w = BugWorkLog(bug_id=data["bug_id"], user_id=user_id,
                   hours=data["hours"], date=data.get("date") or date.today(),
                   description=data.get("description", ""))
    db.add(w); db.commit()
    _recalc_bug_hours(db, data["bug_id"])
    return _worklog_dict(w)

def update_worklog(db, wl_id, data):
    w = db.query(BugWorkLog).filter(BugWorkLog.id == wl_id).first()
    if not w: return None
    for k in ("hours","date","description"):
        if k in data: setattr(w, k, data[k])
    db.commit(); _recalc_bug_hours(db, w.bug_id)
    return _worklog_dict(w)

def delete_worklog(db, wl_id):
    w = db.query(BugWorkLog).filter(BugWorkLog.id == wl_id).first()
    if not w: return False
    bug_id = w.bug_id; db.delete(w); db.commit()
    _recalc_bug_hours(db, bug_id)
    return True

# ═══════════════════════════════════════════ Analysis

def create_analysis(db, data, user_id):
    a = BugAnalysis(bug_id=data["bug_id"], user_id=user_id, content=data["content"],
                    attachments=data.get("attachments"))
    db.add(a); db.commit()
    return _analysis_dict(a)

def update_analysis(db, aid, data):
    a = db.query(BugAnalysis).filter(BugAnalysis.id == aid).first()
    if not a: return None
    if "content" in data: a.content = data["content"]
    if "attachments" in data: a.attachments = data["attachments"]
    db.commit()
    return _analysis_dict(a)

def delete_analysis(db, aid):
    a = db.query(BugAnalysis).filter(BugAnalysis.id == aid).first()
    if not a: return False
    db.delete(a); db.commit()
    return True

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
    pn = pj_n = pj_c = cn = rn = an = None
    if db:
        if b.product_id:
            p = db.query(__import__('backend.models.zentao', fromlist=['PmaProduct']).PmaProduct).filter_by(id=b.product_id).first()
            if p: pn = p.name
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
    return {"id":b.id,"title":b.title,"description":b.description or "","product_id":b.product_id,"product_name":pn,
            "project_id":b.project_id,"project_name":pj_n,"project_code":pj_c,
            "component_id":b.component_id,"component_name":cn,
            "status":b.status or "open","resolution":b.resolution,"severity":b.severity or 3,"priority":b.priority or "medium","type":b.type or "codeerror",
            "reporter_id":b.reporter_id,"reporter_name":rn,"assignee_id":b.assignee_id,"assignee_name":an,"resolved_by_id":b.resolved_by_id,
            "original_bug_id":b.original_bug_id,"source_bug_id":b.source_bug_id,
            "gitlab_url":b.gitlab_url,"gitlab_iid":b.gitlab_iid,
            "estimate_hours":b.estimate_hours or 0,"consumed_hours":b.consumed_hours or 0,
            "due_date":str(b.due_date) if b.due_date else None,
            "resolved_at":to_local_str(b.resolved_at) if b.resolved_at else None,
            "closed_at":to_local_str(b.closed_at) if b.closed_at else None,
            "created_at":to_local_str(b.created_at) if b.created_at else None,
            "updated_at":to_local_str(b.updated_at) if b.updated_at else None}

def _analysis_dict(a):
    from backend.models.local import LocalUser
    return {"id":a.id,"bug_id":a.bug_id,"user_id":a.user_id,"content":a.content,"attachments":a.attachments or [],
            "created_at":to_local_str(a.created_at) if a.created_at else None}

def _attachment_dict(a):
    return {"id":a.id,"bug_id":a.bug_id,"analysis_id":a.analysis_id,"filename":a.filename,"mime_type":a.mime_type,
            "file_path":a.file_path,"file_size":a.file_size,"url":f"/api/attachments/{a.id}",
            "created_at":to_local_str(a.created_at) if a.created_at else None}

def _worklog_dict(w):
    return {"id":w.id,"bug_id":w.bug_id,"user_id":w.user_id,"hours":w.hours,
            "date":str(w.date) if w.date else None,"description":w.description,
            "created_at":to_local_str(w.created_at) if w.created_at else None}

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
    total = db.query(BugWorkLog).with_entities(
        sa_func.coalesce(sa_func.sum(BugWorkLog.hours), 0)
    ).filter(BugWorkLog.bug_id == bug_id).scalar() or 0.0
    db.query(PmaBug).filter(PmaBug.id == bug_id).update({PmaBug.consumed_hours: float(total)})
    db.commit()
