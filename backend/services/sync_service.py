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
    CachedProject, CachedExecution, CachedTask,
    CachedUser, CachedProduct, ProductProjectLink,
    CachedCustomer, CustomerProjectLink,
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
      - Plain text: http://192.168.0.128/rd/product/-/releases/v1.0
      - HTML links: <a href="http://192.168.0.128/rd/product/-/releases/v1.0">text</a>
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


def _extract_customer(name: str, desc: str) -> str:
    """Extract customer abbreviation from project name or description.
    Project name format: PE0406-CDLY-xxx  ->  CDLY
    Description format: 【CDLY】xxx       ->  CDLY
    Returns the extracted customer name or empty string."""
    # Try project name pattern: PE0406-CDLY-xxx -> CDLY
    if name:
        parts = name.split("-")
        if len(parts) >= 2:
            second = parts[1].strip()
            # Customer abbreviations are typically 2-4 uppercase letters
            if re.match(r"^[A-Z]{2,6}$", second):
                return second
    # Fallback to 【...】 in description (strip HTML tags first)
    if desc:
        plain = re.sub(r"<[^>]+>", "", desc)
        m = re.search(r"【([A-Z]{2,6})】", plain)
        if m:
            return m.group(1).strip()
    return ""


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


# Auto-sync notification state — per-source results
_auto_sync_notify = {
    "completed": False, "time": "", "mismatches": None,
    "zentao": {"status": "pending"},   # status: pending|success|failed|skipped
    "gitlab": {"status": "pending"},
    "nas": {"status": "pending"},
}


def _check_stage_mismatches(db) -> dict:
    """After sync, count executions with non-standard stage names."""
    from backend.models.zentao import CachedProject, CachedExecution
    from backend.services.document_service import _match_stage_type, get_stage_types_for_project

    projects = db.query(CachedProject).all()
    total_unmatched = 0
    total_fuzzy = 0
    affected_projects = []

    for p in projects:
        standard_stages = get_stage_types_for_project(p.project_type or "RD")
        executions = db.query(CachedExecution).filter(
            CachedExecution.project_id == p.id
        ).all()
        proj_unmatched = 0
        proj_fuzzy = 0
        for e in executions:
            actual_name = (e.name or "").strip()
            if not actual_name:
                continue
            result = _match_stage_type(actual_name, standard_stages)
            if not result:
                proj_unmatched += 1
                total_unmatched += 1
            elif result[1] == "fuzzy":
                proj_fuzzy += 1
                total_fuzzy += 1

        if proj_unmatched > 0 or proj_fuzzy > 0:
            affected_projects.append({
                "project_id": p.id,
                "code": p.code or "",
                "name": (p.name or "")[:40],
                "unmatched": proj_unmatched,
                "fuzzy": proj_fuzzy,
            })

    return {
        "total_unmatched": total_unmatched,
        "total_fuzzy": total_fuzzy,
        "affected_projects": affected_projects[:20],  # top 20
    }

# Global sync progress state
_sync_progress = {
    "running": False, "paused": False, "cancelled": False,
    "phase": "", "current": 0, "total": 0,
    "projects_total": 0, "execs_total": 0, "tasks_total": 0,
    "projects_done": 0, "execs_done": 0, "tasks_done": 0,
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
            "projects_total": 0, "execs_total": 0, "tasks_total": 0,
            "projects_done": 0, "execs_done": 0, "tasks_done": 0,
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
            zentao_summary = {}
            try:
                t0 = time.time(); await self.client.authenticate(); timings["auth"] = round(time.time() - t0, 1)
                logger.info("[禅道] 认证成功，开始同步...")
                _sync_progress["phase"] = "用户"; t0 = time.time(); results["users"] = await self._sync_users(db); timings["users"] = round(time.time() - t0, 1)
                logger.info(f"[禅道] 用户同步完成: {results['users']}")
                _sync_progress["phase"] = "产品"; t0 = time.time(); results["products"] = await self._sync_products(db); timings["products"] = round(time.time() - t0, 1)
                logger.info(f"[禅道] 产品同步完成: {results['products']}")
                _sync_progress["phase"] = "项目"; t0 = time.time(); results["projects"] = await self._sync_projects(db); timings["projects"] = round(time.time() - t0, 1)
                logger.info(f"[禅道] 项目同步完成: {results['projects']}")
                _sync_progress["phase"] = "执行与任务"; t0 = time.time(); results["executions_tasks"] = await self._sync_executions_and_tasks(db); timings["execs_tasks"] = round(time.time() - t0, 1)
                logger.info(f"[禅道] 执行与任务同步完成: {results['executions_tasks']}")
                _sync_progress["phase"] = "Bug"; t0 = time.time(); results["bugs"] = await self._sync_bugs(db); timings["bugs"] = round(time.time() - t0, 1)
                logger.info(f"[禅道] Bug同步完成: {results['bugs']}")

                zs = {k: v for k, v in results.items() if k in ("users", "products", "projects", "executions_tasks", "bugs")}
                z_total = sum(v.get("fetched", v.get("executions_fetched", 0)) + v.get("tasks_fetched", 0) for v in zs.values() if isinstance(v, dict))
                zentao_summary = {
                    "status": "success",
                    "summary": f"用户{results.get('users',{}).get('fetched',0)} / 产品{results.get('products',{}).get('fetched',0)} / 项目{results.get('projects',{}).get('fetched',0)} / 执行{results.get('executions_tasks',{}).get('executions_fetched',0)} / 任务{results.get('executions_tasks',{}).get('tasks_fetched',0)} / Bug{results.get('bugs',{}).get('fetched',0)}",
                }
                _auto_sync_notify["zentao"] = zentao_summary
            except Exception as e:
                logger.error(f"[禅道] 同步失败: {e}")
                zentao_summary = {"status": "failed", "summary": str(e)[:100]}
                _auto_sync_notify["zentao"] = zentao_summary

            # ── Source 2: GitLab (releases sync + URL validation) ──
            gitlab_summary = {}
            if settings.GITLAB_TOKEN:
                try:
                    _sync_progress["phase"] = "发布版本"
                    t0 = time.time()
                    results["releases"] = await self._sync_releases(db)
                    timings["releases"] = round(time.time() - t0, 1)
                    logger.info(f"[GitLab] 禅道发布版本同步完成: {results['releases']}")

                    _sync_progress["phase"] = "GitLab校验"
                    from backend.services.gitlab_service import validate_all_releases
                    t0 = time.time()
                    vresult = await validate_all_releases(db, concurrency=5)
                    results["gitlab_validation"] = vresult
                    timings["gitlab_validation"] = round(time.time() - t0, 1)
                    logger.info(f"[GitLab] URL校验完成: {vresult}")

                    r = results["releases"]
                    gitlab_summary = {
                        "status": "success",
                        "summary": f"发布版本{r.get('fetched',0)}个 / 有效{vresult.get('valid',0)} / 无效{vresult.get('invalid',0)}",
                    }
                    _auto_sync_notify["gitlab"] = gitlab_summary
                except Exception as e:
                    logger.error(f"[GitLab] 同步或校验失败: {e}")
                    gitlab_summary = {"status": "failed", "summary": str(e)[:100]}
                    _auto_sync_notify["gitlab"] = gitlab_summary
            else:
                logger.warning("[GitLab] 未配置Token，跳过")
                gitlab_summary = {"status": "skipped", "summary": "未配置Token"}
                _auto_sync_notify["gitlab"] = gitlab_summary

            # ── Source 3: NAS ──
            nas_summary = {"status": "skipped", "summary": "未配置NAS路径"}
            _auto_sync_notify["nas"] = nas_summary

            timings["total"] = round(time.time() - t_start, 1)

            logger.info(f"Sync completed in {timings['total']}s | 禅道:{zentao_summary.get('status','?')} GitLab:{gitlab_summary.get('status','?')} NAS:{nas_summary.get('status','?')}")
            results["timings"] = timings
            results["zentao_summary"] = zentao_summary
            results["gitlab_summary"] = gitlab_summary
            results["nas_summary"] = nas_summary

            # Post-sync: check stage name mismatches
            mismatch = _check_stage_mismatches(db)
            results["stage_mismatches"] = mismatch
            _auto_sync_notify["completed"] = True
            _auto_sync_notify["time"] = time.strftime("%H:%M:%S")
            _auto_sync_notify["mismatches"] = mismatch

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
            for p in products:
                pid = p.get("program", 0)
                prog_name = prog_names.get(pid, "")
                existing = db.query(CachedProduct).filter(CachedProduct.id == p["id"]).first()
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
            # Cleanup stale products
            if api_ids:
                stale = db.query(CachedProduct).filter(~CachedProduct.id.in_(api_ids)).all()
                for sp in stale:
                    db.query(ProductProjectLink).filter(ProductProjectLink.product_id == sp.id).delete()
                    db.delete(sp)
                    deleted += 1
            db.commit()
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
            pf = getattr(settings, "ZENTAO_PROJECT_FILTER", "") or os.environ.get("ZENTAO_PROJECT_FILTER", "")
            if pf:
                prefixes = [x.strip() for x in pf.split(",") if x.strip()]
                projects = [p for p in projects if any(p.get("code", "").startswith(px) for px in prefixes)]
                logger.info(f"Project filter applied: {pf} -> {len(projects)} projects matched")
            _sync_progress["projects_total"] = len(projects)
            _sync_progress["total"] = len(projects)
            api_ids = {p["id"] for p in projects}
            created, updated, deleted = 0, 0, 0
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
            # Cleanup: delete projects no longer in Zentao (skip if API returned none)
            if api_ids:
                stale = db.query(CachedProject).filter(~CachedProject.id.in_(api_ids)).all()
                for sp in stale:
                    # Cascade: delete related executions, tasks, and links
                    db.query(CachedTask).filter(CachedTask.project_id == sp.id).delete()
                    db.query(CachedExecution).filter(CachedExecution.project_id == sp.id).delete()
                    db.query(ProductProjectLink).filter(ProductProjectLink.project_id == sp.id).delete()
                    db.query(CustomerProjectLink).filter(CustomerProjectLink.project_id == sp.id).delete()
                    db.delete(sp)
                    deleted += 1
            db.commit()

            # Sync customer links from project customer_name
            self._sync_customer_links(db)

            _finish_log(db, log, "success", len(projects), created + deleted, updated)
            return {"fetched": len(projects), "created": created, "updated": updated, "deleted": deleted}
        except Exception as e:
            _finish_log(db, log, "failed", error=str(e))
            raise

    def _sync_customer_links(self, db: Session):
        """Ensure Customer records and CustomerProjectLinks exist for all cached projects."""
        projects = db.query(CachedProject).all()
        for p in projects:
            cname = (p.customer_name or "").strip()
            if not cname:
                continue
            # Find or create customer
            cust = db.query(CachedCustomer).filter(CachedCustomer.name == cname).first()
            if not cust:
                cust = CachedCustomer(name=cname)
                db.add(cust)
                db.flush()
            # Ensure link exists
            link = db.query(CustomerProjectLink).filter(
                CustomerProjectLink.customer_id == cust.id,
                CustomerProjectLink.project_id == p.id,
            ).first()
            if not link:
                db.add(CustomerProjectLink(customer_id=cust.id, project_id=p.id))
        db.commit()

    async def _sync_executions_and_tasks(self, db: Session) -> dict:
        log = _log_sync(db, "executions_tasks")
        total_execs, total_tasks = 0, 0
        created_e, updated_e, deleted_e = 0, 0, 0
        created_t, updated_t, deleted_t = 0, 0, 0
        try:
            projects = db.query(CachedProject).all()
            # Apply project filter
            from backend.config import settings
            pf = getattr(settings, "ZENTAO_PROJECT_FILTER", "") or os.environ.get("ZENTAO_PROJECT_FILTER", "")
            if pf:
                prefixes = [x.strip() for x in pf.split(",") if x.strip()]
                projects = [p for p in projects if p.code and any(p.code.startswith(px) for px in prefixes)]
            _sync_progress["total"] = len(projects)

            # Phase 1: fetch all executions
            all_executions = []  # [(exec_data, project_id), ...]
            _sync_progress["phase"] = "获取执行列表"
            filtered_project_ids = {p.id for p in projects}

            # Try fetching all executions at once (much faster if API supports it)
            try:
                all_execs_raw = await self.client.get_executions()
                # Filter to only keep executions belonging to synced projects
                kept = 0; skipped = 0
                for e in all_execs_raw:
                    proj_id = e.get("project", 0)
                    if proj_id and proj_id in filtered_project_ids:
                        all_executions.append((e, proj_id))
                        kept += 1
                    else:
                        skipped += 1
                logger.info(f"Fetched {len(all_execs_raw)} execs total, kept {kept} (filtered), skipped {skipped}")
            except Exception:
                logger.warning("Failed to fetch all executions, falling back to per-project")
                # Fallback: per-project fetching
                for idx, proj in enumerate(projects):
                    _sync_progress["current"] = idx + 1
                    try:
                        executions = await self.client.get_executions(project_id=proj.id)
                    except Exception:
                        logger.warning(f"Failed to fetch executions for project {proj.id}")
                        continue
                    if len(executions) > 10:
                        logger.info(f"Project {proj.code or proj.id}: {len(executions)} executions")
                    for e in executions:
                        all_executions.append((e, proj.id))

            # Log execution distribution
            proj_exec_counts = {}
            for e, pid in all_executions:
                proj_exec_counts[pid] = proj_exec_counts.get(pid, 0) + 1
            logger.info(f"Execution distribution: {len(all_executions)} total across {len(proj_exec_counts)} projects")
            for pid, cnt in sorted(proj_exec_counts.items(), key=lambda x: -x[1])[:10]:
                proj_info = next((p for p in projects if p.id == pid), None)
                code = proj_info.code if proj_info else f"id={pid}"
                logger.info(f"  {code}: {cnt} executions")

            # Phase 2: save all executions first, then fetch tasks concurrently
            _sync_progress["phase"] = "保存执行"
            for e, proj_id in all_executions:
                existing = db.query(CachedExecution).filter(CachedExecution.id == e["id"]).first()
                if existing: updated_e += self._update_execution(existing, e)
                else: db.add(self._build_execution(e, proj_id)); created_e += 1
                total_execs += 1
            db.commit()

            # Phase 3: fetch tasks concurrently (20 at a time), skip unchanged
            import asyncio
            total = len(all_executions)
            _sync_progress["execs_total"] = total
            _sync_progress["total"] = total
            _sync_progress["execs_done"] = 0
            _sync_progress["tasks_total"] = 0
            _sync_progress["tasks_done"] = 0
            exec_task_ids = {}
            _sync_progress["phase"] = "执行与任务"

            # Pre-load existing executions for change detection
            all_exec_ids = [e[0]["id"] for e in all_executions]
            existing_execs = {
                ex.id: ex for ex in db.query(CachedExecution).filter(
                    CachedExecution.id.in_(all_exec_ids)
                ).all()
            }
            # Pre-count existing tasks per execution (skip unchanged only if already has tasks)
            from backend.models.zentao import CachedTask as CT
            from sqlalchemy import func as sa_func
            task_counts = dict(
                db.query(CT.execution_id, sa_func.count(CT.id))
                .filter(CT.execution_id.in_(all_exec_ids))
                .group_by(CT.execution_id)
                .all()
            )

            sem = asyncio.Semaphore(20)
            skipped_count = 0

            async def _sync_one_exec(idx, e, proj_id):
                nonlocal skipped_count
                async with sem:
                    await _check_pause_cancel()
                    existing = existing_execs.get(e["id"])
                    has_tasks = task_counts.get(e["id"], 0) > 0
                    # Skip only if execution unchanged AND already has tasks cached
                    if existing and existing.raw_json == json.dumps(e, ensure_ascii=False) and existing.synced_at and has_tasks:
                        skipped_count += 1
                        return None  # signal to skip
                    try:
                        tasks = await self.client.get_tasks(e["id"])
                        return tasks
                    except Exception:
                        return []

            # Process in batches for progress
            batch_size = 20
            for batch_start in range(0, total, batch_size):
                batch_end = min(batch_start + batch_size, total)
                batch = [(idx, all_executions[idx][0], all_executions[idx][1]) for idx in range(batch_start, batch_end)]
                results = await asyncio.gather(*[_sync_one_exec(idx, e, pid) for idx, e, pid in batch])

                for (idx, e, proj_id), tasks in zip(batch, results):
                    _sync_progress["execs_done"] = idx + 1
                    _sync_progress["current"] = idx + 1
                    _sync_progress["current_item"] = e.get("name", str(e["id"]))
                    if tasks is None:
                        continue  # skip unchanged execution
                    total_tasks += len(tasks)
                    _sync_progress["tasks_total"] = total_tasks
                    _sync_progress["tasks_done"] += len(tasks)
                    task_ids = set()
                    for t in tasks:
                        task_ids.add(t["id"])
                        texisting = db.query(CachedTask).filter(CachedTask.id == t["id"]).first()
                        if texisting: updated_t += self._update_task(texisting, t)
                        else: db.add(self._build_task(t, proj_id, e["id"])); created_t += 1
                    exec_task_ids[e["id"]] = task_ids
                db.commit()

                if total_tasks:
                    pct = round(_sync_progress["execs_done"] / total * 100)
                    logger.info(f"Sync: {_sync_progress['execs_done']}/{total} ({pct}%) | 任务 {total_tasks} | 跳过 {skipped_count}")

            # Cleanup stale executions per project
            for proj in projects:
                proj_exec_ids = {e[0]["id"] for e in all_executions if e[1] == proj.id}
                if proj_exec_ids:
                    stale_execs = db.query(CachedExecution).filter(
                        CachedExecution.project_id == proj.id,
                        ~CachedExecution.id.in_(proj_exec_ids)
                    ).all()
                    for se in stale_execs:
                        db.query(CachedTask).filter(CachedTask.execution_id == se.id).delete()
                        db.delete(se)
                        deleted_e += 1

                # Cleanup stale tasks using cached task IDs
                for exec_id, task_api_ids in exec_task_ids.items():
                    if task_api_ids:
                        stale_tasks = db.query(CachedTask).filter(
                            CachedTask.execution_id == exec_id,
                            ~CachedTask.id.in_(task_api_ids)
                        ).delete()
                        deleted_t += stale_tasks

                db.commit()

            _finish_log(db, log, "success", total_execs + total_tasks,
                        created_e + created_t + deleted_e + deleted_t,
                        updated_e + updated_t)
            return {
                "executions_fetched": total_execs, "executions_created": created_e,
                "executions_updated": updated_e, "executions_deleted": deleted_e,
                "tasks_fetched": total_tasks, "tasks_created": created_t,
                "tasks_updated": updated_t, "tasks_deleted": deleted_t,
            }
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
            products = db.query(CachedProduct).all()
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
        from backend.models.zentao import CachedRelease, CachedProduct
        log = _log_sync(db, "releases")
        created, updated, deleted = 0, 0, 0
        total = 0
        try:
            products = db.query(CachedProduct).all()

            import asyncio
            sem = asyncio.Semaphore(10)
            all_releases = []
            all_api_ids = set()

            async def _fetch_one(prod):
                async with sem:
                    try:
                        return await self.client.get_product_releases(prod.id)
                    except Exception:
                        logger.warning(f"Failed to fetch releases for product {prod.id}")
                        return []

            results = await asyncio.gather(*[_fetch_one(p) for p in products])

            for prod, releases in zip(products, results):
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
                            product_id=prod.id,
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
            return {"fetched": total, "created": created, "updated": updated, "deleted": deleted}
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

    def _build_product(self, p: dict) -> CachedProduct:
        desc = p.get("desc", "") or ""
        return CachedProduct(
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
            pm_account=pm.get("account", ""),
            customer_name=_extract_customer(name, desc),
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
        existing.pm_account = pm.get("account", existing.pm_account)
        existing.customer_name = _extract_customer(name, desc) or existing.customer_name
        existing.description = desc
        existing.tags = _extract_tags_from_desc(desc)
        existing.raw_json = json.dumps(p, ensure_ascii=False)
        existing.synced_at = datetime.now(timezone.utc)
        return 1

    def _build_execution(self, e: dict, project_id: int) -> CachedExecution:
        return CachedExecution(
            id=e["id"], project_id=project_id,
            name=e.get("name", ""), type=e.get("type", ""),
            status=e.get("status", ""),
            begin=_parse_date(e.get("begin")), end=_parse_date(e.get("end")),
            progress=e.get("progress", "0"),
            raw_json=json.dumps(e, ensure_ascii=False),
        )

    def _update_execution(self, existing: CachedExecution, e: dict) -> int:
        existing.name = e.get("name", existing.name)
        existing.type = e.get("type", existing.type)
        existing.status = e.get("status", existing.status)
        existing.begin = _parse_date(e.get("begin")) or existing.begin
        existing.end = _parse_date(e.get("end")) or existing.end
        existing.progress = e.get("progress", existing.progress)
        existing.raw_json = json.dumps(e, ensure_ascii=False)
        existing.synced_at = datetime.now(timezone.utc)
        return 1

    def _build_task(self, t: dict, project_id: int, execution_id: int) -> CachedTask:
        assigned = t.get("assignedTo", {}) or {}
        has_files = bool(t.get("files"))
        return CachedTask(
            id=t["id"], execution_id=execution_id, project_id=project_id,
            parent_id=t.get("parent", 0) or 0,
            name=t.get("name", ""), type=t.get("type", ""),
            status=t.get("status", ""), priority=t.get("pri", 3),
            estimate=_parse_float(t.get("estimate")) or 0.0, consumed=_parse_float(t.get("consumed")) or 0.0,
            deadline=_parse_date(t.get("deadline")),
            assigned_to=assigned.get("account", ""),
            assigned_realname=assigned.get("realname", ""),
            real_started=_parse_datetime(t.get("realStarted")),
            finished_date=_parse_datetime(t.get("finishedDate")),
            has_files=has_files,
            description=t.get("desc", ""),
            raw_json=json.dumps(t, ensure_ascii=False),
        )

    def _update_task(self, existing: CachedTask, t: dict) -> int:
        assigned = t.get("assignedTo", {}) or {}
        existing.name = t.get("name", existing.name)
        existing.status = t.get("status", existing.status)
        existing.priority = t.get("pri", existing.priority)
        existing.estimate = _parse_float(t.get("estimate")) or existing.estimate
        existing.consumed = _parse_float(t.get("consumed")) or existing.consumed
        existing.deadline = _parse_date(t.get("deadline")) or existing.deadline
        existing.assigned_to = assigned.get("account", existing.assigned_to)
        existing.assigned_realname = assigned.get("realname", existing.assigned_realname)
        existing.real_started = _parse_datetime(t.get("realStarted")) or existing.real_started
        existing.finished_date = _parse_datetime(t.get("finishedDate")) or existing.finished_date
        existing.has_files = bool(t.get("files"))
        existing.description = t.get("desc", existing.description)
        existing.raw_json = json.dumps(t, ensure_ascii=False)
        existing.synced_at = datetime.now(timezone.utc)
        return 1
