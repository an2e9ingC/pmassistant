from __future__ import annotations
import asyncio
import json
import logging
import os
import re
import time
from datetime import datetime, timezone, date
from typing import Optional

from sqlalchemy.orm import Session

from backend.database import SessionLocal
from backend.models.bug import CachedBug
from backend.models.zentao import (
    CachedProject,
    CachedUser, PmaProduct, ProductProjectLink,
    PmaCustomer, CustomerProjectLink,
)
from backend.models.local import SyncLog
from backend.services.zentao_client import ZentaoClient

logger = logging.getLogger(__name__)


def _parse_date(val) -> Optional[date]:
    """Parse a date value, returning a date object or None.
    Handles non-date strings like '长期' gracefully by returning None."""
    if not val:
        return None
    if isinstance(val, (date, datetime)):
        return val.date() if isinstance(val, datetime) else val
    if isinstance(val, str):
        val = val.strip()
        if not val:
            return None
        # ISO datetime: "2026-05-28T06:16:11Z"
        if "T" in val:
            return date.fromisoformat(val[:10])
        # Simple date: "2026-05-28"
        if re.match(r"^\d{4}-\d{2}-\d{2}$", val):
            return date.fromisoformat(val)
        # Non-date string like "长期", "待定", etc.
        logger.debug(f"Non-date value in date field: {val!r}")
        return None
    return None


def _parse_float(val) -> Optional[float]:
    """Parse a numeric value, handling strings like '24h', '8.5d' etc."""
    if val is None:
        return None
    if isinstance(val, (int, float)):
        return float(val)
    if isinstance(val, str):
        val = val.strip()
        if not val:
            return None
        # Extract leading number: "24h" -> 24.0, "8.5d" -> 8.5, "0.00" -> 0.0
        m = re.match(r"^(\d+\.?\d*)", val)
        if m:
            return float(m.group(1))
        return None
    return None


def _extract_gitlab_url(text: str) -> Optional[str]:
    """Extract the first GitLab release URL from a text (release desc).
    Supports formats like:
      - Plain text: http://192.168.0.100/rd/product/-/releases/v1.0
      - HTML links: <a href="http://192.168.0.100/rd/product/-/releases/v1.0">text</a>
    Returns the full URL string or None.
    """
    if not text:
        return None
    import re as _re

    # Pattern for GitLab release/tag URLs (stop at whitespace, quotes, brackets, commas)
    url_pattern = r"https?://[^\s/]+(?:/[^\s/]+)*/-/(?:releases|tags)/[^\s)\]\",;]+"

    # 1. First try extracting from href attributes (URL may not appear in visible text)
    href_m = _re.search(r'href="(' + url_pattern + r')"', text)
    if href_m:
        return href_m.group(1)

    # 2. Fall back to plain text extraction (strip HTML tags first)
    plain = _re.sub(r"<[^>]+>", "", text)
    m = _re.search(url_pattern, plain)
    if not m:
        return None
    url = m.group(0)
    # Strip trailing punctuation that isn't part of the URL
    url = url.rstrip(",;:!?）】)\"")  # strip trailing punctuation/quotes
    return url


def _parse_datetime(val) -> Optional[datetime]:
    if not val:
        return None
    try:
        if isinstance(val, str):
            return datetime.fromisoformat(val.replace("Z", "+00:00"))
        return val
    except (ValueError, TypeError):
        return None


def _extract_tags_from_desc(desc: str) -> str:
    """Extract #tag keywords from a product description string.
    Returns comma-separated tags, e.g. '全国产,双V7,PCIe卡'."""
    if not desc:
        return ""
    tags = re.findall(r'#([\w一-鿿]+)', desc)
    return ",".join(tags) if tags else ""


def _log_sync(db: Session, entity_type: str) -> SyncLog:
    log = SyncLog(
        started_at=datetime.now(timezone.utc),
        status="running",
        entity_type=entity_type,
    )
    db.add(log)
    db.commit()
    return log


def _finish_log(db: Session, log: SyncLog, status: str, items_fetched: int = 0,
                items_created: int = 0, items_updated: int = 0, error: Optional[str] = None):
    log.finished_at = datetime.now(timezone.utc)
    log.status = status
    log.items_fetched = items_fetched
    log.items_created = items_created
    log.items_updated = items_updated
    log.error_message = error
    db.commit()


# Auto-sync notification state — per-source results, each source notifies independently
_auto_sync_notify = {
    "completed": False, "time": "",
    "zentao": {"status": "pending", "notified": False},
    "gitlab": {"status": "pending", "notified": False},
    "nas": {"status": "pending", "notified": False},
    "svn": {"status": "pending", "notified": False},
    "wecom": {"status": "pending", "notified": False},
    # "notified" flag: set to True after frontend has consumed the notification.
    # Reset to False at the start of each new sync.
}


# Global sync progress state
_sync_progress = {
    "running": False, "paused": False, "cancelled": False,
    "phase": "", "current": 0, "total": 0,
    "projects_total": 0, "projects_done": 0,
    "current_item": "",
}


def get_sync_progress() -> dict:
    return dict(_sync_progress)


async def _check_pause_cancel():
    """Wait if paused; raise if cancelled. Call at safe points in sync loops."""
    import asyncio
    while _sync_progress.get("paused") and not _sync_progress.get("cancelled"):
        await asyncio.sleep(0.5)
    if _sync_progress.get("cancelled"):
        raise RuntimeError("Sync cancelled by user")


class SyncService:

    async def full_sync(self) -> dict:
        """Run a full sync from Zentao to local SQLite. Returns summary dict."""
        global _sync_progress
        _sync_progress = {
            "running": True, "phase": "认证", "current": 0, "total": 0,
            "projects_total": 0, "projects_done": 0,
            "current_item": "",
        }
        db = SessionLocal()
        results = {}
        timings = {}
        t_start = time.time()
        self.client = ZentaoClient()
        from backend.config import settings

        try:
            # ── Source 1: Zentao ──
            zentao_skip = not os.environ.get("ZENTAO_ENABLED", "true").lower() in ("1", "true", "yes")
            try:
                if zentao_skip: raise RuntimeError("skip")
                t0 = time.time(); await self.client.authenticate(); timings["auth"] = round(time.time() - t0, 1)
                logger.info("[禅道] 认证成功，开始同步...")
                _sync_progress["phase"] = "用户"; t0 = time.time(); results["users"] = await self._sync_users(db); timings["users"] = round(time.time() - t0, 1)
                logger.info(f"[禅道] 用户同步完成: {results['users']}")
                # Product sync disabled — all products managed via PMA local
                results["products"] = {"fetched": 0, "created": 0, "updated": 0, "deleted": 0}
                logger.info("[禅道] 产品同步已禁用（产品由PMA本地维护）")
                _sync_progress["phase"] = "项目"; t0 = time.time(); results["projects"] = await self._sync_projects(db); timings["projects"] = round(time.time() - t0, 1)
                logger.info(f"[禅道] 项目同步完成: {results['projects']}")
                _sync_progress["phase"] = "Bug"; t0 = time.time(); results["bugs"] = await self._sync_bugs(db); timings["bugs"] = round(time.time() - t0, 1)
                logger.info(f"[禅道] Bug同步完成: {results['bugs']}")

                zentao_summary = {
                    "status": "success",
                    "summary": f"用户{results.get('users',{}).get('fetched',0)} / 产品{results.get('products',{}).get('fetched',0)} / 项目{results.get('projects',{}).get('fetched',0)} / Bug{results.get('bugs',{}).get('fetched',0)}",
                }
                _auto_sync_notify["zentao"] = zentao_summary
            except Exception as e:
                if str(e) == "skip":
                    zentao_summary = {"status": "skipped", "summary": "已禁用（数据源配置）"}
                    logger.info("[禅道] 同步已跳过（数据源配置禁用）")
                else:
                    logger.error(f"[禅道] 同步失败: {e}")
                    zentao_summary = {"status": "failed", "summary": str(e)[:100]}
                _auto_sync_notify["zentao"] = zentao_summary

            # ── Source 2: GitLab (product document scanning) ──
            gitlab_summary = {}
            gitlab_enabled = os.environ.get("GITLAB_ENABLED", "true").lower() in ("1", "true", "yes")
            if gitlab_enabled and settings.GITLAB_TOKEN:
                try:
                    _sync_progress["phase"] = "GitLab文档扫描"
                    from backend.services.doc_scanner import check_all_product_docs
                    r = await check_all_product_docs(db)
                    timings["gitlab"] = r.get("elapsed", 0)
                    gl_checked = r.get("gl_checked", 0)
                    gl_matched = r.get("gl_matched", 0)
                    gl_valid = r.get("gl_valid", 0)
                    gl_new = r.get("gl_new", 0)
                    summary = f"检查{gl_checked}个 / 匹配{gl_matched}个 / 有效{gl_valid}个"
                    if gl_new: summary += f" / 新提交{gl_new}个"
                    gitlab_summary = {
                        "status": "success", "summary": summary,
                        "gl_checked": gl_checked, "gl_matched": gl_matched,
                        "gl_valid": gl_valid, "gl_new": gl_new,
                    }
                    _auto_sync_notify["gitlab"] = gitlab_summary
                    gl_log = SyncLog(started_at=datetime.now(timezone.utc), finished_at=datetime.now(timezone.utc),
                                     entity_type="gitlab", status="success",
                                     items_fetched=gl_checked, items_created=gl_matched,
                                     items_updated=gl_valid)
                    db.add(gl_log); db.commit()
                except Exception as e:
                    logger.error(f"[GitLab] 文档扫描失败: {e}")
                    gitlab_summary = {"status": "failed", "summary": str(e)[:100]}
                    _auto_sync_notify["gitlab"] = gitlab_summary
                    gl_log = SyncLog(started_at=datetime.now(timezone.utc), finished_at=datetime.now(timezone.utc),
                                     entity_type="gitlab", status="failed", error_message=str(e)[:200])
                    db.add(gl_log); db.commit()
            else:
                if not gitlab_enabled:
                    logger.info("[GitLab] 同步已跳过（数据源配置禁用）")
                    gitlab_summary = {"status": "skipped", "summary": "已禁用（数据源配置）"}
                else:
                    logger.warning("[GitLab] 未配置Token，跳过")
                    gitlab_summary = {"status": "skipped", "summary": "未配置Token"}
                _auto_sync_notify["gitlab"] = gitlab_summary

            # ── Source 3: NAS ──
            nas_summary = {"status": "skipped", "summary": "未配置NAS路径"}
            _auto_sync_notify["nas"] = nas_summary

            # ── Source 4: SVN (product document scanning) ──
            svn_summary = {}
            svn_url = os.environ.get("SVN_BASE_URL", "")
            svn_enabled = os.environ.get("SVN_ENABLED", "true").lower() in ("1", "true", "yes")
            if svn_url and svn_enabled:
                try:
                    _sync_progress["phase"] = "SVN文档扫描"
                    t0 = time.time()
                    from backend.services.doc_scanner import check_product_docs
                    from backend.models.zentao import PmaProduct
                    products = db.query(PmaProduct).all()
                    # Full-overwrite: reset location+status before re-scan (keep svn metadata for rev comparison)
                    from backend.models.document import ProductDocument
                    db.query(ProductDocument).filter(
                        ProductDocument.doc_type == "svn"
                    ).update({ProductDocument.location: None, ProductDocument.status: "pending"})
                    db.commit()
                    total_scanned = 0
                    total_submitted = 0
                    total_reverted = 0
                    total_location = 0
                    total_matched = 0
                    failed = 0
                    prod_results = {}
                    for prod in products:
                        try:
                            r = await check_product_docs(db, prod.id)
                            total_scanned += r.get("scanned", 0)
                            total_submitted += r.get("auto_submitted", 0)
                            total_reverted += r.get("reverted", 0)
                            total_location += r.get("location_filled", 0)
                            total_matched += r.get("total_matched", 0)
                            prod_results[prod.id] = r
                        except Exception:
                            failed += 1
                    timings["svn"] = round(time.time() - t0, 1)
                    parts = [f"总匹配{total_matched}个", f"新匹配{total_submitted}个"]
                    if total_reverted > 0:
                        parts.append(f"回退{total_reverted}个")
                    if total_location > 0:
                        parts.append(f"补填路径{total_location}个")
                    svn_summary = {
                        "status": "success",
                        "summary": " / ".join(parts),
                        "scanned": total_scanned,
                        "auto_submitted": total_submitted,
                        "reverted": total_reverted,
                        "products": len(products),
                        "failed_products": failed,
                    }
                    logger.info(f"[SVN] 文档扫描完成: {svn_summary['summary']}（{len(products)}个产品）")
                    # Per-product detail: separate SVN vs non-SVN, matched vs unmatched
                    for prod in products:
                        r = prod_results.get(prod.id, {})
                        if not r.get("scanned"): continue
                        results_list = r.get("results", [])
                        svn_docs = [d for d in results_list if d.get("doc_type") == "svn"]
                        svn_found = [d for d in svn_docs if d.get("found")]
                        svn_miss = [d for d in svn_docs if not d.get("found")]
                        svn_total = len(svn_docs)
                        if svn_total:
                            logger.info(f"  [SVN] 产品 {prod.name}(#{prod.id}): "
                                f"模板{svn_total}个 | 匹配{len(svn_found)}个 | 未匹配{len(svn_miss)}个")
                    svn_log = SyncLog(started_at=datetime.now(timezone.utc), finished_at=datetime.now(timezone.utc),
                                      entity_type="svn", status="success",
                                      items_fetched=total_scanned, items_created=total_submitted)
                    db.add(svn_log); db.commit()
                    _auto_sync_notify["svn"] = svn_summary
                except Exception as e:
                    logger.error(f"[SVN] 文档扫描失败: {e}")
                    svn_summary = {"status": "failed", "summary": str(e)[:100]}
                    svn_log = SyncLog(started_at=datetime.now(timezone.utc), finished_at=datetime.now(timezone.utc),
                                      entity_type="svn", status="failed", error_message=str(e)[:200])
                    db.add(svn_log); db.commit()
                    _auto_sync_notify["svn"] = svn_summary
            else:
                svn_summary = {"status": "skipped", "summary": "未配置SVN地址"}
                _auto_sync_notify["svn"] = svn_summary

            # ── Source 5: WeCom (企业微信打卡数据) ──
            wecom_summary = {}
            wecom_enabled = os.environ.get("WECOM_ENABLED", "true").lower() in ("1", "true", "yes")
            if settings.WECOM_CORP_ID and settings.WECOM_SECRET and wecom_enabled:
                try:
                    _sync_progress["phase"] = "企业微信打卡数据"
                    from backend.services import wecom_service as _wecom_svc
                    t0 = time.time()
                    wc_result = await _wecom_svc.sync_wecom_data(db)
                    timings["wecom"] = round(time.time() - t0, 1)
                    wecom_summary = {
                        "status": "success",
                        "summary": f"打卡{wc_result.get('fetched',0)}条 / 新增{wc_result.get('created',0)} / 更新{wc_result.get('updated',0)}",
                    }
                    logger.info(f"[企业微信] 同步完成: {wecom_summary['summary']}")
                    wc_log = SyncLog(started_at=datetime.now(timezone.utc), finished_at=datetime.now(timezone.utc),
                                     entity_type="wecom_checkins", status="success",
                                     items_fetched=wc_result.get("fetched", 0),
                                     items_created=wc_result.get("created", 0),
                                     items_updated=wc_result.get("updated", 0))
                    db.add(wc_log); db.commit()
                    _auto_sync_notify["wecom"] = wecom_summary
                except Exception as e:
                    logger.error(f"[企业微信] 同步失败: {e}")
                    wecom_summary = {"status": "failed", "summary": str(e)[:100]}
                    wc_log = SyncLog(started_at=datetime.now(timezone.utc), finished_at=datetime.now(timezone.utc),
                                     entity_type="wecom_checkins", status="failed", error_message=str(e)[:200])
                    db.add(wc_log); db.commit()
                    _auto_sync_notify["wecom"] = wecom_summary
            else:
                wecom_summary = {"status": "skipped", "summary": "未配置企业微信"}
                _auto_sync_notify["wecom"] = wecom_summary

            timings["total"] = round(time.time() - t_start, 1)

            logger.info(f"Sync completed in {timings['total']}s | 禅道:{zentao_summary.get('status','?')} GitLab:{gitlab_summary.get('status','?')} NAS:{nas_summary.get('status','?')} SVN:{svn_summary.get('status','?')} WeCom:{wecom_summary.get('status','?')}")
            results["timings"] = timings
            results["zentao_summary"] = zentao_summary
            results["gitlab_summary"] = gitlab_summary
            results["nas_summary"] = nas_summary
            results["svn_summary"] = svn_summary
            results["wecom_summary"] = wecom_summary

            _auto_sync_notify["completed"] = True
            _auto_sync_notify["time"] = time.strftime("%H:%M:%S")

            return {"code": 0, "data": results, "message": f"sync completed in {timings['total']}s"}
        except Exception as e:
            logger.exception("Full sync failed")
            return {"code": 1, "data": results, "message": f"sync failed: {e}"}
        finally:
            _sync_progress["running"] = False
            _sync_progress["phase"] = "完成" if not _sync_progress.get("error") else "失败"
            db.close()
            await self.client.close()

    async def _sync_users(self, db: Session) -> dict:
        log = _log_sync(db, "users")
        try:
            users = await self.client.get_users()
            created, updated = 0, 0
            for u in users:
                existing = db.query(CachedUser).filter(CachedUser.id == u["id"]).first()
                if existing:
                    updated += self._update_user(existing, u)
                else:
                    db.add(self._build_user(u))
                    created += 1
            db.commit()
            _finish_log(db, log, "success", len(users), created, updated)
            return {"fetched": len(users), "created": created, "updated": updated}
        except Exception as e:
            _finish_log(db, log, "failed", error=str(e))
            raise

    async def _sync_products(self, db: Session) -> dict:
        log = _log_sync(db, "products")
        try:
            # Fetch product lines (programs) for categorization
            programs = await self.client.get_programs()
            prog_names = {p["id"]: p.get("name", "") for p in programs}

            products = await self.client.get_products()
            api_ids = {p["id"] for p in products}
            created, updated, deleted = 0, 0, 0

            # Cleanup stale products first (Zentao-synced = is_local IS NOT TRUE)
            stale = db.query(PmaProduct).filter(
                ~PmaProduct.id.in_(api_ids),
                PmaProduct.is_local != True,
            ).all()
            for sp in stale:
                db.query(ProductProjectLink).filter(ProductProjectLink.product_id == sp.id).delete()
                from backend.services.product_management_service import _remove_product_from_favorites
                _remove_product_from_favorites(db, sp.id)
                db.delete(sp)
                deleted += 1
            if deleted:
                db.commit()

            for p in products:
                pid = p.get("program", 0)
                prog_name = prog_names.get(pid, "")
                existing = db.query(PmaProduct).filter(PmaProduct.id == p["id"]).first()
                if existing:
                    # Update core fields but preserve PMA enrichments
                    desc = p.get("desc", "") or ""
                    existing.code = p.get("code", "")
                    existing.name = p.get("name", "")
                    existing.type = p.get("type", "")
                    existing.status = p.get("status", "")
                    existing.program_id = pid
                    existing.program_name = prog_name
                    existing.total_stories = p.get("totalStories", 0)
                    existing.total_bugs = p.get("totalBugs", 0)
                    existing.releases = p.get("releases", 0)
                    existing.description = desc
                    existing.tags = _extract_tags_from_desc(desc)
                    existing.raw_json = json.dumps(p, ensure_ascii=False)
                    existing.synced_at = datetime.now(timezone.utc)
                    updated += 1
                else:
                    obj = self._build_product(p)
                    obj.program_name = prog_name
                    db.add(obj)
                    created += 1
            db.commit()

            # Auto-link synced products to product tree nodes by program_name matching
            try:
                from backend.models.zentao import ProductNodeLink
                from backend.models.document import ProductLine
                synced_products = db.query(PmaProduct).filter(
                    PmaProduct.is_local == False,
                    PmaProduct.program_name.isnot(None),
                    PmaProduct.program_name != "",
                ).all()
                tree_nodes = db.query(ProductLine).all()
                linked_count = 0
                for sp in synced_products:
                    # Find matching tree node by name (case-insensitive)
                    match = next((n for n in tree_nodes if n.name.lower() == (sp.program_name or "").lower()), None)
                    if match:
                        existing_link = db.query(ProductNodeLink).filter(
                            ProductNodeLink.product_id == sp.id,
                            ProductNodeLink.product_node_id == match.id,
                        ).first()
                        if not existing_link:
                            db.add(ProductNodeLink(product_id=sp.id, product_node_id=match.id))
                            linked_count += 1
                if linked_count:
                    db.commit()
                    logger.info(f"Auto-linked {linked_count} products to tree nodes")
            except Exception as e:
                logger.warning(f"Auto-link products failed (non-fatal): {e}")

            _finish_log(db, log, "success", len(products), created + deleted, updated)
            return {"fetched": len(products), "created": created, "updated": updated, "deleted": deleted}
        except Exception as e:
            _finish_log(db, log, "failed", error=str(e))
            raise

    async def _sync_projects(self, db: Session) -> dict:
        log = _log_sync(db, "projects")
        try:
            projects = await self.client.get_projects()
            # Fetch all programs to resolve parent→program name
            programs = await self.client.get_programs()
            prog_map = {pr["id"]: pr.get("name", "") for pr in programs}
            # Filter by code prefix if configured
            from backend.config import settings
            from backend.models.local import PmaSetting
            pf = (PmaSetting.get(db, "project_filter", "") or
                  getattr(settings, "ZENTAO_PROJECT_FILTER", "") or
                  os.environ.get("ZENTAO_PROJECT_FILTER", ""))
            if pf:
                prefixes = [x.strip() for x in pf.split(",") if x.strip()]
                projects = [p for p in projects if any(p.get("code", "").startswith(px) for px in prefixes)]
                logger.info(f"Project filter applied: {pf} -> {len(projects)} projects matched")
            _sync_progress["projects_total"] = len(projects)
            _sync_progress["total"] = len(projects)
            api_ids = {p["id"] for p in projects}
            created, updated, deleted = 0, 0, 0

            # Cleanup: delete Zentao-synced projects not matching current filter or stale in Zentao
            all_synced = db.query(CachedProject).filter(CachedProject.is_local != True).all()
            to_delete = []
            for sp in all_synced:
                keep = sp.id in api_ids
                if pf and sp.code and not any(sp.code.startswith(px) for px in prefixes):
                    keep = False  # doesn't match filter → delete
                if not keep:
                    to_delete.append(sp)
            for sp in to_delete:
                db.query(ProductProjectLink).filter(ProductProjectLink.project_id == sp.id).delete()
                db.query(CustomerProjectLink).filter(CustomerProjectLink.project_id == sp.id).delete()
                db.delete(sp)
                deleted += 1
            if deleted:
                db.commit()
                logger.info(f"Cleaned up {deleted} projects (filter={pf or 'none'})")

            for idx, p in enumerate(projects):
                _sync_progress["current"] = idx + 1
                _sync_progress["current_item"] = p.get("name", str(p["id"]))
                existing = db.query(CachedProject).filter(CachedProject.id == p["id"]).first()
                pm = self._resolve_pm(db, p)
                parent_id = p.get("parent")
                prog_name = prog_map.get(parent_id, "") if parent_id else ""
                if existing:
                    updated += self._update_project(existing, p, pm, prog_name)
                else:
                    db.add(self._build_project(p, pm, prog_name))
                    created += 1
            db.commit()

            _finish_log(db, log, "success", len(projects), created + deleted, updated)
            return {"fetched": len(projects), "created": created, "updated": updated, "deleted": deleted}
        except Exception as e:
            _finish_log(db, log, "failed", error=str(e))
            raise

    async def _sync_bugs(self, db: Session) -> dict:
        log = _log_sync(db, "bugs")
        created, updated = 0, 0
        try:
            # Only sync bugs for products linked to filtered projects
            from backend.config import settings
            pf = getattr(settings, "ZENTAO_PROJECT_FILTER", "") or os.environ.get("ZENTAO_PROJECT_FILTER", "")
            products = db.query(PmaProduct).all()
            if pf:
                prefixes = [x.strip() for x in pf.split(",") if x.strip()]
                filtered_project_ids = {
                    p.id for p in db.query(CachedProject).all()
                    if p.code and any(p.code.startswith(px) for px in prefixes)
                }
                linked_product_ids = {
                    l.product_id for l in db.query(ProductProjectLink).filter(
                        ProductProjectLink.project_id.in_(filtered_project_ids)
                    ).all()
                }
                products = [p for p in products if p.id in linked_product_ids]
            total_bugs = 0
            sem = asyncio.Semaphore(10)

            async def _sync_one_bug_prod(prod):
                try:
                    return await self.client.get_product_bugs(prod.id)
                except Exception:
                    logger.warning(f"Failed to fetch bugs for product {prod.id}")
                    return []

            results = await asyncio.gather(*[_sync_one_bug_prod(p) for p in products])

            for prod, bugs in zip(products, results):
                total_bugs += len(bugs)
                for b in bugs:
                    existing = db.query(CachedBug).filter(CachedBug.id == b["id"]).first()
                    if existing: self._update_bug(existing, b); updated += 1
                    else: db.add(self._build_bug(b, prod.id)); created += 1
                db.commit()

            _finish_log(db, log, "success", total_bugs, created, updated)
            return {"fetched": total_bugs, "created": created, "updated": updated}
        except Exception as e:
            _finish_log(db, log, "failed", error=str(e))
            raise

    def _build_bug(self, b: dict, product_id: int) -> CachedBug:
        opened = b.get("openedBy", {}) or {}
        assigned = b.get("assignedTo", {}) or {}
        resolved = b.get("resolvedBy", {}) or {}
        return CachedBug(
            id=b["id"], product_id=product_id,
            project_id=b.get("project", 0) or 0,
            title=b.get("title", ""),
            severity=b.get("severity", 3),
            priority=b.get("pri", 3),
            status=b.get("status", ""),
            type=b.get("type", ""),
            opened_by=opened.get("account", "") if isinstance(opened, dict) else str(opened),
            opened_date=_parse_date(b.get("openedDate")),
            assigned_to=assigned.get("account", "") if isinstance(assigned, dict) else str(assigned),
            resolved_by=resolved.get("account", "") if isinstance(resolved, dict) else str(resolved),
            resolved_date=_parse_datetime(b.get("resolvedDate")),
            closed_date=_parse_datetime(b.get("closedDate")),
            raw_json=json.dumps(b, ensure_ascii=False),
        )

    def _update_bug(self, existing: CachedBug, b: dict) -> int:
        assigned = b.get("assignedTo", {}) or {}
        resolved = b.get("resolvedBy", {}) or {}
        existing.title = b.get("title", existing.title)
        existing.severity = b.get("severity", existing.severity)
        existing.priority = b.get("pri", existing.priority)
        existing.status = b.get("status", existing.status)
        existing.type = b.get("type", existing.type)
        existing.assigned_to = assigned.get("account", "") if isinstance(assigned, dict) else str(assigned)
        existing.resolved_by = resolved.get("account", "") if isinstance(resolved, dict) else str(resolved)
        existing.resolved_date = _parse_datetime(b.get("resolvedDate")) or existing.resolved_date
        existing.closed_date = _parse_datetime(b.get("closedDate")) or existing.closed_date
        existing.raw_json = json.dumps(b, ensure_ascii=False)
        existing.synced_at = datetime.now(timezone.utc)
        return 1

    async def _sync_releases(self, db: Session) -> dict:
        """Sync Zentao product releases/versions (for GitLab URL validation).
        Releases are product-level data — sync ALL products, not just filtered ones."""
        from backend.models.zentao import CachedRelease, PmaProduct
        log = _log_sync(db, "releases")
        created, updated, deleted, failed_products = 0, 0, 0, 0
        total = 0
        try:
            products = db.query(PmaProduct).filter(PmaProduct.is_local != True).all()

            import asyncio
            sem = asyncio.Semaphore(10)
            all_api_ids = set()

            async def _fetch_one(prod):
                nonlocal failed_products
                async with sem:
                    try:
                        return (prod.id, await self.client.get_product_releases(prod.id))
                    except Exception:
                        logger.warning(f"Failed to fetch releases for product {prod.id}")
                        failed_products += 1
                        return (prod.id, [])

            results = await asyncio.gather(*[_fetch_one(p) for p in products])

            for prod_id, releases in results:
                prod = next((p for p in products if p.id == prod_id), None)
                total += len(releases)
                for r in releases:
                    r_id = r["id"]
                    all_api_ids.add(r_id)
                    desc = r.get("desc", "") or ""
                    gitlab_url = _extract_gitlab_url(desc)
                    existing = db.query(CachedRelease).filter(CachedRelease.id == r_id).first()
                    if existing:
                        existing.name = r.get("name", "")
                        existing.marker = r.get("marker", 0)
                        existing.status = r.get("status", "normal")
                        existing.date = _parse_date(r.get("date"))
                        existing.desc = desc
                        existing.gitlab_url = gitlab_url
                        existing.raw_json = json.dumps(r, ensure_ascii=False)
                        existing.synced_at = datetime.now(timezone.utc)
                        updated += 1
                    else:
                        db.add(CachedRelease(
                            id=r_id,
                            product_id=prod_id,
                            name=r.get("name", ""),
                            marker=r.get("marker", 0),
                            status=r.get("status", "normal"),
                            date=_parse_date(r.get("date")),
                            desc=desc,
                            gitlab_url=gitlab_url,
                            raw_json=json.dumps(r, ensure_ascii=False),
                        ))
                        created += 1
                db.commit()

            # Cleanup stale releases
            if all_api_ids:
                stale = db.query(CachedRelease).filter(~CachedRelease.id.in_(all_api_ids)).all()
                for sr in stale:
                    db.delete(sr)
                    deleted += 1
                db.commit()

            _finish_log(db, log, "success", total, created + deleted, updated)
            return {"fetched": total, "created": created, "updated": updated, "deleted": deleted, "failed_products": failed_products}
        except Exception as e:
            _finish_log(db, log, "failed", error=str(e))
            raise

    # --- Build helpers ---

    def _build_user(self, u: dict) -> CachedUser:
        return CachedUser(
            id=u["id"], account=u.get("account", ""),
            realname=u.get("realname", ""), role=u.get("role", ""),
            email=u.get("email"), dept=u.get("dept", 0),
            raw_json=json.dumps(u, ensure_ascii=False),
        )

    def _update_user(self, existing: CachedUser, u: dict) -> int:
        existing.account = u.get("account", existing.account)
        existing.realname = u.get("realname", existing.realname)
        existing.role = u.get("role", existing.role)
        existing.email = u.get("email", existing.email)
        existing.raw_json = json.dumps(u, ensure_ascii=False)
        existing.synced_at = datetime.now(timezone.utc)
        return 1

    def _build_product(self, p: dict) -> PmaProduct:
        desc = p.get("desc", "") or ""
        return PmaProduct(
            id=p["id"], code=p.get("code", ""),
            name=p.get("name", ""), type=p.get("type", ""),
            status=p.get("status", ""), program_id=p.get("program", 0),
            total_stories=p.get("totalStories", 0), total_bugs=p.get("totalBugs", 0),
            releases=p.get("releases", 0),
            description=desc,
            tags=_extract_tags_from_desc(desc),
            raw_json=json.dumps(p, ensure_ascii=False),
        )

    def _resolve_pm(self, db: Session, p: dict) -> dict:
        """Resolve PM info from PM field or PMUserID via cached users."""
        pm = p.get("PM", {}) or {}
        if not pm:
            pm_uid = p.get("PMUserID")
            if pm_uid:
                pm_user = db.query(CachedUser).filter(CachedUser.id == pm_uid).first()
                if pm_user:
                    pm = {"account": pm_user.account, "realname": pm_user.realname}
        return pm

    def _build_project(self, p: dict, pm: dict = None, prog_name: str = "") -> CachedProject:
        if pm is None:
            pm = p.get("PM", {}) or {}
        name = p.get("name", "")
        desc = p.get("desc", "") or ""
        parent_id = p.get("parent")
        return CachedProject(
            id=p["id"], code=p.get("code", ""), name=name,
            model=p.get("model", ""), status=p.get("status", ""),
            begin=_parse_date(p.get("begin")), end=_parse_date(p.get("end")),
            real_began=_parse_date(p.get("realBegan")),
            real_end=_parse_date(p.get("realEnd")),
            progress=p.get("progress", "0"), estimate=_parse_float(p.get("estimate")) or 0.0,
            consumed=_parse_float(p.get("consumed")) or 0.0,
            program_id=parent_id if parent_id else None,
            program_name=prog_name or None,
            pm_name=pm.get("realname") or pm.get("account", ""),
            customer_name="",
            description=desc,
            tags=_extract_tags_from_desc(desc),
            raw_json=json.dumps(p, ensure_ascii=False),
        )

    def _update_project(self, existing: CachedProject, p: dict, pm: dict = None, prog_name: str = "") -> int:
        if pm is None:
            pm = p.get("PM", {}) or {}
        name = p.get("name", existing.name)
        desc = p.get("desc", "") or ""
        existing.code = p.get("code", existing.code)
        existing.name = name
        existing.model = p.get("model", existing.model)
        # Preserve PMA-local 'abolished' status — not a Zentao concept (#231)
        if existing.status != "abolished":
            existing.status = p.get("status", existing.status)
        existing.begin = _parse_date(p.get("begin")) or existing.begin
        existing.end = _parse_date(p.get("end")) or existing.end
        parent_id = p.get("parent")
        existing.program_id = parent_id if parent_id else None
        existing.program_name = prog_name or None
        existing.real_began = _parse_date(p.get("realBegan")) or existing.real_began
        existing.real_end = _parse_date(p.get("realEnd")) or existing.real_end
        existing.progress = p.get("progress", existing.progress)
        existing.estimate = _parse_float(p.get("estimate")) or existing.estimate
        existing.consumed = _parse_float(p.get("consumed")) or existing.consumed
        existing.pm_name = pm.get("realname") or pm.get("account", existing.pm_name)
        # customer_name is managed via PMA manual association only
        existing.description = desc
        existing.tags = _extract_tags_from_desc(desc)
        existing.raw_json = json.dumps(p, ensure_ascii=False)
        existing.synced_at = datetime.now(timezone.utc)
        return 1

