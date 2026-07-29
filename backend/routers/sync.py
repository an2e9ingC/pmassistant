import os

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func

import logging

from backend.config import settings
from backend.database import get_db, to_local_str
from backend.middleware.auth import get_current_user, require_admin, require_perm
from backend.models.local import SyncLog
from backend.routers.config import _load_config
from backend.routers.logs import log_audit
from backend.audit_categories import AUDIT_CAT_SYSTEM
from backend.services.sync_service import SyncService

router = APIRouter(prefix="/api/sync", tags=["sync"])
_logger = logging.getLogger(__name__)


@router.post("/trigger", response_model=dict)
async def trigger_sync(db: Session = Depends(get_db), user: dict = Depends(get_current_user), _=Depends(require_perm("sync"))):
    _logger.info("全量同步: 手动触发")
    log_audit(db, user, "trigger_full_sync", "手动触发全量同步", AUDIT_CAT_SYSTEM, "medium")
    svc = SyncService()
    result = await svc.full_sync()
    summary = result.get("message", "完成")
    _logger.info(f"全量同步: {summary}")
    log_audit(db, user, "full_sync_done", f"全量同步完成: {summary}", AUDIT_CAT_SYSTEM, "low")
    return result


@router.post("/trigger/{source}", response_model=dict)
async def trigger_single_sync(source: str, db: Session = Depends(get_db), user: dict = Depends(get_current_user), _=Depends(require_perm("sync"))):
    """Trigger sync for a single data source."""
    import time as _time, os as _os
    from datetime import datetime as _dt, timezone as _tz

    if source == "svn":
        _logger.info("SVN 单源同步: 手动触发")
        log_audit(db, user, "trigger_svn_sync", "手动触发SVN文档扫描", AUDIT_CAT_SYSTEM, "medium")
        from backend.services.doc_scanner import check_product_docs
        from backend.models.zentao import PmaProduct
        from backend.models.document import ProductDocument
        from backend.services.sync_service import _log_sync as _svn_log_sync, _finish_log as _svn_finish_log
        svn_sync_log = _svn_log_sync(db, "svn")
        # Clear all document locations before scanning — rely on latest SVN data
        db.query(ProductDocument).filter(
            ProductDocument.location.isnot(None), ProductDocument.location != ""
        ).update({ProductDocument.location: None, ProductDocument.status: "pending"})
        db.commit()
        products = db.query(PmaProduct).all()
        t0 = _time.time()
        total_scanned, total_submitted, total_reverted, total_location, total_matched = 0, 0, 0, 0, 0
        try:
            for prod in products:
                r = await check_product_docs(db, prod.id, skip_gitlab=True)
                total_scanned += r.get("scanned", 0)
                total_submitted += r.get("auto_submitted", 0)
                total_reverted += r.get("reverted", 0)
                total_location += r.get("location_filled", 0)
                total_matched += r.get("total_matched", 0)
            elapsed = round(_time.time() - t0, 1)
            summary_parts = [f"总匹配{total_matched}个", f"新匹配{total_submitted}个"]
            if total_reverted: summary_parts.append(f"回退{total_reverted}个")
            if total_location: summary_parts.append(f"补填路径{total_location}个")
            summary = " / ".join(summary_parts)
            _svn_finish_log(db, svn_sync_log, "success", total_scanned, total_submitted, total_matched)
            _logger.info(f"SVN 单源同步完成: {summary}")
            log_audit(db, user, "svn_sync_done", f"SVN同步完成: {summary}", AUDIT_CAT_SYSTEM, "low")
            return {"code": 0, "data": {
                "svn_summary": {"status": "success", "summary": summary,
                                 "scanned": total_scanned, "total_matched": total_matched, "auto_submitted": total_submitted,
                                 "reverted": total_reverted, "location_filled": total_location, "products": len(products)},
                "timings": {"total": elapsed},
            }, "message": "ok"}
        except Exception as e:
            _svn_finish_log(db, svn_sync_log, "failed", total_scanned, total_submitted, 0)
            _logger.error(f"SVN 单源同步失败: {e}")
            raise

    if source == "pdm":
        _logger.info("PDM 单源同步: 手动触发")
        log_audit(db, user, "trigger_pdm_sync", "手动触发PDM文档扫描", AUDIT_CAT_SYSTEM, "medium")
        from backend.services.doc_scanner import check_product_docs, check_project_docs
        from backend.models.zentao import PmaProduct, CachedProject
        from backend.models.document import ProductDocument, ProjectDocument
        from backend.services.sync_service import _log_sync as _pdm_log_sync, _finish_log as _pdm_finish_log
        pdm_sync_log = _pdm_log_sync(db, "pdm")
        # Clear all solidworks document locations before scanning
        db.query(ProductDocument).filter(
            ProductDocument.doc_type == "solidworks",
            ProductDocument.location.isnot(None), ProductDocument.location != ""
        ).update({ProductDocument.location: None, ProductDocument.status: "pending"})
        db.query(ProjectDocument).filter(
            ProjectDocument.doc_type == "solidworks",
            ProjectDocument.location.isnot(None), ProjectDocument.location != ""
        ).update({ProjectDocument.location: None, ProjectDocument.status: "pending"})
        db.commit()
        t0 = _time.time()
        total_scanned, total_submitted, total_reverted, total_location, total_matched = 0, 0, 0, 0, 0
        try:
            # Scan product documents
            for prod in db.query(PmaProduct).all():
                r = await check_product_docs(db, prod.id, skip_gitlab=True)
                total_scanned += r.get("scanned", 0)
                total_submitted += r.get("auto_submitted", 0)
                total_reverted += r.get("reverted", 0)
                total_location += r.get("location_filled", 0)
                total_matched += r.get("total_matched", 0)
            # Scan project documents
            for proj in db.query(CachedProject).all():
                r = check_project_docs(db, proj.id)
                total_scanned += r.get("scanned", 0)
                total_submitted += r.get("auto_submitted", 0)
                total_reverted += r.get("reverted", 0)
                total_location += r.get("location_filled", 0)
                total_matched += r.get("total_matched", 0)
            elapsed = round(_time.time() - t0, 1)
            summary_parts = [f"总匹配{total_matched}个", f"新匹配{total_submitted}个"]
            if total_reverted: summary_parts.append(f"回退{total_reverted}个")
            if total_location: summary_parts.append(f"补填路径{total_location}个")
            summary = " / ".join(summary_parts)
            _pdm_finish_log(db, pdm_sync_log, "success", total_scanned, total_submitted, total_matched)
            _logger.info(f"PDM 单源同步完成: {summary}")
            log_audit(db, user, "pdm_sync_done", f"PDM同步完成: {summary}", AUDIT_CAT_SYSTEM, "low")
            return {"code": 0, "data": {
                "pdm_summary": {"status": "success", "summary": summary,
                                "scanned": total_scanned, "total_matched": total_matched,
                                "auto_submitted": total_submitted,
                                "reverted": total_reverted, "location_filled": total_location},
                "timings": {"total": elapsed},
            }, "message": "ok"}
        except Exception as e:
            _pdm_finish_log(db, pdm_sync_log, "failed", 0, 0, 0)
            _logger.error(f"PDM 单源同步失败: {e}")
            raise

    if source == "gitlab":
        _logger.info("GitLab 单源同步: 手动触发")
        log_audit(db, user, "trigger_gitlab_sync", "手动触发GitLab文档扫描", AUDIT_CAT_SYSTEM, "medium")
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
            _logger.info(f"GitLab 单源同步完成: {summary}")
            log_audit(db, user, "gitlab_sync_done", f"GitLab同步完成: {summary}", AUDIT_CAT_SYSTEM, "low")
            return {"code": 0, "data": {
                "gitlab_summary": {"status": "success", "summary": summary,
                                   "gl_checked": gl_checked, "gl_matched": gl_matched,
                                   "gl_valid": gl_valid, "gl_new": gl_new},
                "timings": {"total": elapsed},
            }, "message": "ok"}
        except Exception as e:
            _finish_log(db, gitlab_sync_log, "failed", 0, 0, 0)
            _logger.error(f"GitLab 单源同步失败: {e}")
            raise

    if source in ("zentao", "nas"):
        return {"code": 0, "data": {
            f"{source}_summary": {"status": "skipped" if source == "nas" else "triggered",
                                   "summary": "单源同步请使用完整同步" if source == "zentao" else "NAS同步尚未实现"},
        }, "message": "ok"}

    if source == "wecom":
        _logger.info("企业微信 单源同步: 手动触发")
        log_audit(db, user, "trigger_wecom_sync", "手动触发企业微信同步", AUDIT_CAT_SYSTEM, "medium")
        from backend.config import settings
        if not settings.WECOM_CORP_ID or not settings.WECOM_SECRET:
            return {"code": 0, "data": {"wecom_summary": {"status": "skipped", "summary": "未配置企业微信"}}, "message": "ok"}
        from backend.services import wecom_service as _wecom_svc
        from backend.services.sync_service import _log_sync as _wc_log_sync, _finish_log as _wc_finish_log
        t0 = _time.time()
        wc_sync_log = _wc_log_sync(db, "wecom")
        try:
            wc_result = await _wecom_svc.sync_wecom_data(db)
            elapsed = round(_time.time() - t0, 1)
            fetched = wc_result.get('fetched', 0)
            created = wc_result.get('created', 0)
            updated = wc_result.get('updated', 0)
            summary = f"打卡{fetched}条 / 新增{created} / 更新{updated}"
            _wc_finish_log(db, wc_sync_log, "success", fetched, created, updated)
            _logger.info(f"企业微信 单源同步完成: {summary}")
            log_audit(db, user, "wecom_sync_done", f"企业微信同步完成: {summary}", AUDIT_CAT_SYSTEM, "low")
            return {"code": 0, "data": {
                "wecom_summary": {"status": "success", "summary": summary},
                "timings": {"total": elapsed},
            }, "message": "ok"}
        except Exception as e:
            _wc_finish_log(db, wc_sync_log, "failed", 0, 0, 0)
            _logger.error(f"企业微信 单源同步失败: {e}")
            log_audit(db, user, "wecom_sync_failed", f"企业微信同步失败: {e}", AUDIT_CAT_SYSTEM, "high")
            return {"code": 0, "data": {
                "wecom_summary": {"status": "failed", "summary": str(e)[:120]},
                "timings": {"total": round(_time.time() - t0, 1)},
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
    cfg = _load_config()
    sources = []

    # Helper to build a source entry
    def _enabled(key: str) -> bool:
        return cfg.get(key, {}).get("enabled", True)

    # WeCom: configured if corp_id + secret are set
    wecom_cfg = cfg.get("wecom", {})
    wecom_configured = bool(wecom_cfg.get("corp_id") and wecom_cfg.get("secret"))
    wecom_log = (
        db.query(SyncLog)
        .filter(SyncLog.entity_type == "wecom")
        .order_by(SyncLog.started_at.desc())
        .first()
    )
    wecom_detail = "未配置企微"
    if wecom_configured:
        if wecom_log and wecom_log.items_fetched is not None:
            parts = [f"检查{wecom_log.items_fetched}人"]
            if wecom_log.items_created:
                parts.append(f"新增{wecom_log.items_created}人")
            wecom_detail = " / ".join(parts)
        else:
            wecom_detail = "已配置，待首次同步"
    sources.append({
        "key": "wecom",
        "name": "企微",
        "configured": wecom_configured,
        "enabled": _enabled("wecom"),
        "sync_status": wecom_log.status if wecom_log else "pending",
        "last_sync": to_local_str(wecom_log.finished_at) if (wecom_log and wecom_log.finished_at) else None,
        "description": "企业微信通讯录同步",
        "detail": wecom_detail,
    })

    # PDM — SolidWorks PDM vault access
    pdm_cfg = cfg.get("pdm", {})
    pdm_configured = bool(pdm_cfg.get("ssh_host") and pdm_cfg.get("base_url"))
    pdm_log = (
        db.query(SyncLog)
        .filter(SyncLog.entity_type == "pdm")
        .order_by(SyncLog.started_at.desc())
        .first()
    )
    pdm_detail = "未配置PDM"
    if pdm_configured:
        if pdm_log and pdm_log.items_fetched is not None:
            parts = [f"扫描{pdm_log.items_fetched}个", f"匹配{pdm_log.items_created or 0}个"]
            if pdm_log.items_updated:
                parts.append(f"有效{pdm_log.items_updated}个")
            pdm_detail = " / ".join(parts)
        else:
            pdm_detail = "已配置，待首次同步"
    sources.append({
        "key": "pdm",
        "name": "PDM",
        "configured": pdm_configured,
        "enabled": _enabled("pdm"),
        "sync_status": pdm_log.status if pdm_log else "pending",
        "last_sync": to_local_str(pdm_log.finished_at) if (pdm_log and pdm_log.finished_at) else None,
        "description": "SolidWorks PDM（文档自动检测）",
        "detail": pdm_detail,
    })

    # Zentao
    zentao_cfg = cfg.get("zentao", {})
    zentao_configured = bool(zentao_cfg.get("base_url") and zentao_cfg.get("account"))
    zentao_log = (
        db.query(SyncLog)
        .filter(SyncLog.entity_type == "projects")
        .order_by(SyncLog.started_at.desc())
        .first()
    )
    zentao_status = "pending"
    if zentao_log:
        zentao_status = zentao_log.status if zentao_log.status != "running" else "ok"
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
        "configured": zentao_configured,
        "enabled": _enabled("zentao"),
        "sync_status": zentao_status,
        "last_sync": to_local_str(zentao_log.finished_at) if (zentao_log and zentao_log.finished_at) else None,
        "description": "项目管理（项目/迭代/任务/Bug/发布版本）",
        "detail": zentao_detail,
    })

    # GitLab
    gitlab_cfg = cfg.get("gitlab", {})
    gitlab_configured = bool(gitlab_cfg.get("token"))
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
        "enabled": _enabled("gitlab"),
        "sync_status": gitlab_sync_status,
        "last_sync": gitlab_last_sync,
        "description": "代码仓库（产品文档GitLab扫描）" if gitlab_configured else "代码仓库（未配置Token）",
        "detail": gitlab_detail,
    })

    # NAS
    nas_cfg = cfg.get("nas", {})
    nas_configured = bool(nas_cfg.get("host"))
    nas_detail = "未配置NAS路径"
    if nas_configured:
        nas_detail = "已配置，待首次同步"
    sources.append({
        "key": "nas",
        "name": "NAS",
        "configured": nas_configured,
        "enabled": _enabled("nas"),
        "sync_status": "pending",
        "last_sync": None,
        "description": "文件存储（售前项目检测、交付文档）",
        "detail": nas_detail,
    })

    # SVN
    svn_cfg = cfg.get("svn", {})
    svn_configured = bool(svn_cfg.get("base_url"))
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
        "enabled": _enabled("svn"),
        "sync_status": svn_sync_log.status if svn_sync_log else "pending",
        "last_sync": to_local_str(svn_sync_log.finished_at) if (svn_sync_log and svn_sync_log.finished_at) else None,
        "description": "版本管理（产品文档自动扫描）",
        "detail": svn_detail,
    })

    return {"code": 0, "data": sources, "message": "ok"}
