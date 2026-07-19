import os

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func

from backend.config import settings
from backend.database import get_db, to_local_str
from backend.middleware.auth import get_current_user, require_admin, require_perm
from backend.models.local import SyncLog
from backend.services.sync_service import SyncService

router = APIRouter(prefix="/api/sync", tags=["sync"])


@router.post("/trigger", response_model=dict)
async def trigger_sync(_=Depends(require_perm("sync"))):
    svc = SyncService()
    result = await svc.full_sync()
    return result


@router.post("/trigger/{source}", response_model=dict)
async def trigger_single_sync(source: str, db: Session = Depends(get_db), _=Depends(require_perm("sync"))):
    """Trigger sync for a single data source (zentao/gitlab/nas/svn)."""
    import time as _time, os as _os
    from datetime import datetime as _dt, timezone as _tz

    if source == "svn":
        from backend.services.doc_scanner import check_product_docs
        from backend.models.zentao import PmaProduct
        from backend.models.document import ProductDocument
        # Clear all document locations before scanning — rely on latest SVN data
        db.query(ProductDocument).filter(
            ProductDocument.location.isnot(None), ProductDocument.location != ""
        ).update({ProductDocument.location: None, ProductDocument.status: "pending"})
        db.commit()
        products = db.query(PmaProduct).all()
        t0 = _time.time()
        total_scanned, total_submitted, total_reverted, total_location, total_matched = 0, 0, 0, 0, 0
        for prod in products:
            r = await check_product_docs(db, prod.id)
            total_scanned += r.get("scanned", 0)
            total_submitted += r.get("auto_submitted", 0)
            total_reverted += r.get("reverted", 0)
            total_location += r.get("location_filled", 0)
            total_matched += r.get("total_matched", 0)
        elapsed = round(_time.time() - t0, 1)
        summary_parts = [f"总匹配{total_matched}个", f"新匹配{total_submitted}个"]
        if total_reverted: summary_parts.append(f"回退{total_reverted}个")
        if total_location: summary_parts.append(f"补填路径{total_location}个")
        return {"code": 0, "data": {
            "svn_summary": {"status": "success", "summary": " / ".join(summary_parts),
                             "scanned": total_scanned, "total_matched": total_matched, "auto_submitted": total_submitted,
                             "reverted": total_reverted, "location_filled": total_location, "products": len(products)},
            "timings": {"total": elapsed},
        }, "message": "ok"}

    if source == "gitlab":
        from backend.config import settings
        if not settings.GITLAB_TOKEN:
            return {"code": 0, "data": {"gitlab_summary": {"status": "skipped", "summary": "未配置Token"}}, "message": "ok"}
        from backend.services.doc_scanner import check_all_product_docs
        from backend.services.sync_service import _log_sync, _finish_log
        t0 = _time.time()
        gitlab_sync_log = _log_sync(db, "gitlab")
        try:
            r = await check_all_product_docs(db)
            elapsed = r.get("elapsed", round(_time.time() - t0, 1))
            gl_checked = r.get("gl_checked", 0)
            gl_matched = r.get("gl_matched", 0)
            gl_valid = r.get("gl_valid", 0)
            gl_new = r.get("gl_new", 0)
            summary_parts = [f"检查{gl_checked}个", f"匹配{gl_matched}个", f"有效{gl_valid}个"]
            if gl_new: summary_parts.append(f"新提交{gl_new}个")
            summary = " / ".join(summary_parts)
            _finish_log(db, gitlab_sync_log, "success", gl_checked, gl_matched, gl_valid)
            return {"code": 0, "data": {
                "gitlab_summary": {"status": "success", "summary": summary,
                                   "gl_checked": gl_checked, "gl_matched": gl_matched,
                                   "gl_valid": gl_valid, "gl_new": gl_new},
                "timings": {"total": elapsed},
            }, "message": "ok"}
        except Exception as e:
            _finish_log(db, gitlab_sync_log, "failed", 0, 0, 0)
            raise

    if source in ("zentao", "nas"):
        return {"code": 0, "data": {
            f"{source}_summary": {"status": "skipped" if source == "nas" else "triggered",
                                   "summary": "单源同步请使用完整同步" if source == "zentao" else "NAS同步尚未实现"},
        }, "message": "ok"}

    if source == "wecom":
        from backend.config import settings
        if not settings.WECOM_CORP_ID or not settings.WECOM_SECRET:
            return {"code": 0, "data": {"wecom_summary": {"status": "skipped", "summary": "未配置企业微信"}}, "message": "ok"}
        from backend.services import wecom_service as _wecom_svc
        t0 = _time.time()
        wc_result = await _wecom_svc.sync_wecom_data(db)
        elapsed = round(_time.time() - t0, 1)
        return {"code": 0, "data": {
            "wecom_summary": {"status": "success",
                               "summary": f"打卡{wc_result.get('fetched',0)}条 / 新增{wc_result.get('created',0)} / 更新{wc_result.get('updated',0)}"},
            "timings": {"total": elapsed},
        }, "message": "ok"}

    return {"code": 1, "message": f"不支持的数据源: {source}"}


@router.get("/status", response_model=dict)
def sync_status(db: Session = Depends(get_db), _=Depends(get_current_user)):
    # Get latest sync log for each entity type
    entity_types = db.query(SyncLog.entity_type).distinct().all()
    status_list = []
    for (entity_type,) in entity_types:
        log = (
            db.query(SyncLog)
            .filter(SyncLog.entity_type == entity_type)
            .order_by(SyncLog.started_at.desc())
            .first()
        )
        if log:
            duration = None
            if log.finished_at and log.started_at:
                duration = round((log.finished_at - log.started_at).total_seconds(), 1)
            status_list.append({
                "entity_type": log.entity_type,
                "status": log.status,
                "items_fetched": log.items_fetched,
                "items_created": log.items_created,
                "items_updated": log.items_updated,
                "started_at": to_local_str(log.started_at) if log.started_at else None,
                "finished_at": to_local_str(log.finished_at) if log.finished_at else None,
                "duration_seconds": duration,
                "error_message": log.error_message,
            })
    return {"code": 0, "data": status_list, "message": "ok"}


@router.get("/history", response_model=dict)
def sync_history(
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    logs = (
        db.query(SyncLog)
        .order_by(SyncLog.started_at.desc())
        .limit(limit)
        .all()
    )
    items = []
    for log in logs:
        duration = None
        if log.finished_at and log.started_at:
            duration = round((log.finished_at - log.started_at).total_seconds(), 1)
        items.append({
            "id": log.id,
            "entity_type": log.entity_type,
            "status": log.status,
            "items_fetched": log.items_fetched,
            "started_at": to_local_str(log.started_at) if log.started_at else None,
            "finished_at": to_local_str(log.finished_at) if log.finished_at else None,
            "duration_seconds": duration,
            "error_message": log.error_message,
        })
    return {"code": 0, "data": items, "message": "ok"}


@router.get("/progress", response_model=dict)
def sync_progress(_=Depends(get_current_user)):
    from backend.services.sync_service import get_sync_progress
    return {"code": 0, "data": get_sync_progress(), "message": "ok"}


@router.post("/pause", response_model=dict)
def sync_pause(_=Depends(require_admin)):
    from backend.services.sync_service import _sync_progress
    _sync_progress["paused"] = True
    return {"code": 0, "message": "同步已暂停"}


@router.post("/resume", response_model=dict)
def sync_resume(_=Depends(require_admin)):
    from backend.services.sync_service import _sync_progress
    _sync_progress["paused"] = False
    return {"code": 0, "message": "同步已恢复"}


@router.post("/cancel", response_model=dict)
def sync_cancel(_=Depends(require_admin)):
    from backend.services.sync_service import _sync_progress
    _sync_progress["cancelled"] = True
    _sync_progress["paused"] = False  # unpause to allow cancellation to take effect
    return {"code": 0, "message": "同步已取消"}


@router.get("/auto-notify", response_model=dict)
def auto_sync_notify(_=Depends(get_current_user)):
    from backend.services.sync_service import _auto_sync_notify
    result = dict(_auto_sync_notify)
    _auto_sync_notify["completed"] = False  # consume the notification
    return {"code": 0, "data": result, "message": "ok"}


@router.get("/sources", response_model=dict)
def sync_sources(db: Session = Depends(get_db), _=Depends(get_current_user)):
    """Return configuration and sync status for all data sources."""
    sources = []

    # Zentao — always configured (required)
    zentao_log = (
        db.query(SyncLog)
        .filter(SyncLog.entity_type == "projects")
        .order_by(SyncLog.started_at.desc())
        .first()
    )
    zentao_status = "pending"
    if zentao_log:
        zentao_status = zentao_log.status if zentao_log.status != "running" else "ok"
    # Build sync result detail from latest SyncLog entries
    zentao_detail = "暂无同步数据"
    if zentao_log:
        entity_types = ["users", "projects", "executions", "tasks", "bugs"]
        parts = []
        for et in entity_types:
            log = db.query(SyncLog).filter(SyncLog.entity_type == et).order_by(SyncLog.started_at.desc()).first()
            if log and log.items_fetched is not None:
                label = {"users": "用户", "projects": "项目", "executions": "执行", "tasks": "任务", "bugs": "Bug"}.get(et, et)
                parts.append(f"{label}{log.items_fetched}")
        if parts:
            zentao_detail = " / ".join(parts)
    sources.append({
        "key": "zentao",
        "name": "禅道",
        "configured": True,
        "sync_status": zentao_status,
        "last_sync": to_local_str(zentao_log.finished_at) if (zentao_log and zentao_log.finished_at) else None,
        "description": "项目管理（项目/迭代/任务/Bug/发布版本）",
        "detail": zentao_detail,
    })

    # GitLab — configured if token is set; show product doc scan results
    gitlab_configured = bool(settings.GITLAB_TOKEN)
    gitlab_log = (
        db.query(SyncLog)
        .filter(SyncLog.entity_type == "gitlab")
        .order_by(SyncLog.started_at.desc())
        .first()
    )
    gitlab_sync_status = "pending"
    gitlab_last_sync = None
    if gitlab_log:
        gitlab_sync_status = gitlab_log.status if gitlab_log.status != "running" else "ok"
        gitlab_last_sync = to_local_str(gitlab_log.finished_at) if gitlab_log.finished_at else None

    # Show product doc scan summary
    gitlab_detail = "未配置Token"
    if gitlab_configured:
        if gitlab_log and gitlab_log.items_fetched is not None:
            parts = [f"检查{gitlab_log.items_fetched}个"]
            if gitlab_log.items_created:
                parts.append(f"匹配{gitlab_log.items_created}个")
            if gitlab_log.items_updated:
                parts.append(f"有效{gitlab_log.items_updated}个")
            gitlab_detail = " / ".join(parts)
        else:
            from backend.models.document import ProductDocument
            gitlab_doc_count = db.query(ProductDocument).filter(
                ProductDocument.doc_type == "gitlab"
            ).count()
            gitlab_detail = f"已配置，{gitlab_doc_count}个GitLab文档待扫描"

    sources.append({
        "key": "gitlab",
        "name": "GitLab",
        "configured": gitlab_configured,
        "sync_status": gitlab_sync_status,
        "last_sync": gitlab_last_sync,
        "description": "代码仓库（产品文档GitLab扫描）" if gitlab_configured else "代码仓库（未配置Token）",
        "detail": gitlab_detail,
    })

    # NAS — not yet integrated
    nas_host = os.environ.get("NAS_HOST", "")
    sources.append({
        "key": "nas",
        "name": "NAS",
        "configured": bool(nas_host),
        "sync_status": "pending",
        "last_sync": None,
        "description": "文件存储（售前项目检测、交付文档）",
        "detail": "未配置NAS路径" if not nas_host else "已配置，待首次同步",
    })

    # SVN — document scanning
    svn_url = os.environ.get("SVN_BASE_URL", "")
    svn_configured = bool(svn_url)
    # Get last SVN scan result from sync log
    svn_sync_log = (
        db.query(SyncLog)
        .filter(SyncLog.entity_type == "svn")
        .order_by(SyncLog.started_at.desc())
        .first()
    )
    svn_detail = "未配置SVN地址"
    if svn_configured:
        if svn_sync_log and svn_sync_log.items_fetched is not None:
            svn_detail = f"扫描{svn_sync_log.items_fetched}个 / 自动提交{svn_sync_log.items_created or 0}个"
        else:
            svn_detail = "已配置，待首次同步"
    sources.append({
        "key": "svn",
        "name": "SVN",
        "configured": svn_configured,
        "sync_status": svn_sync_log.status if svn_sync_log else "pending",
        "last_sync": to_local_str(svn_sync_log.finished_at) if (svn_sync_log and svn_sync_log.finished_at) else None,
        "description": "版本管理（产品文档自动扫描）",
        "detail": svn_detail,
    })

    return {"code": 0, "data": sources, "message": "ok"}
