from __future__ import annotations
import json
import logging
import re
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


class SyncService:

    async def full_sync(self) -> dict:
        """Run a full sync from Zentao to local SQLite. Returns summary dict.

        TODO: GitLab sync — commit统计、release验证（Phase 2/3，需GITLAB_TOKEN配置）
        TODO: NAS sync — 售前项目检测、交付文档扫描（Phase 2/3，需NAS路径配置）
        """
        db = SessionLocal()
        results = {}
        self.client = ZentaoClient()  # Recreate to pick up latest settings
        try:
            await self.client.authenticate()

            results["users"] = await self._sync_users(db)
            results["products"] = await self._sync_products(db)
            results["projects"] = await self._sync_projects(db)
            results["executions_tasks"] = await self._sync_executions_and_tasks(db)
            results["bugs"] = await self._sync_bugs(db)

            return {"code": 0, "data": results, "message": "sync completed"}
        except Exception as e:
            logger.exception("Full sync failed")
            return {"code": 1, "data": results, "message": f"sync failed: {e}"}
        finally:
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
            created, updated = 0, 0
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
            db.commit()
            _finish_log(db, log, "success", len(products), created, updated)
            return {"fetched": len(products), "created": created, "updated": updated}
        except Exception as e:
            _finish_log(db, log, "failed", error=str(e))
            raise

    async def _sync_projects(self, db: Session) -> dict:
        log = _log_sync(db, "projects")
        try:
            projects = await self.client.get_projects()
            api_ids = {p["id"] for p in projects}
            created, updated, deleted = 0, 0, 0
            for p in projects:
                existing = db.query(CachedProject).filter(CachedProject.id == p["id"]).first()
                if existing:
                    updated += self._update_project(existing, p)
                else:
                    db.add(self._build_project(p))
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

            for proj in projects:
                try:
                    executions = await self.client.get_executions(project_id=proj.id)
                except Exception:
                    logger.warning(f"Failed to fetch executions for project {proj.id}")
                    continue

                exec_api_ids = {e["id"] for e in executions}
                total_execs += len(executions)
                # Cache task IDs per execution to avoid double-fetching
                exec_task_ids = {}

                for e in executions:
                    existing = db.query(CachedExecution).filter(
                        CachedExecution.id == e["id"]
                    ).first()
                    if existing:
                        updated_e += self._update_execution(existing, e)
                    else:
                        db.add(self._build_execution(e, proj.id))
                        created_e += 1

                    # Sync tasks for this execution
                    try:
                        tasks = await self.client.get_tasks(e["id"])
                    except Exception:
                        logger.warning(f"Failed to fetch tasks for execution {e['id']}")
                        continue

                    total_tasks += len(tasks)
                    task_ids = set()
                    for t in tasks:
                        task_ids.add(t["id"])
                        texisting = db.query(CachedTask).filter(
                            CachedTask.id == t["id"]
                        ).first()
                        if texisting:
                            updated_t += self._update_task(texisting, t)
                        else:
                            db.add(self._build_task(t, proj.id, e["id"]))
                            created_t += 1
                    exec_task_ids[e["id"]] = task_ids

                # Cleanup stale executions for this project (skip if API returned none)
                if exec_api_ids:
                    stale_execs = db.query(CachedExecution).filter(
                        CachedExecution.project_id == proj.id,
                        ~CachedExecution.id.in_(exec_api_ids)
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
            products = db.query(CachedProduct).all()
            total_bugs = 0

            for prod in products:
                try:
                    bugs = await self.client.get_product_bugs(prod.id)
                except Exception:
                    logger.warning(f"Failed to fetch bugs for product {prod.id}")
                    continue

                total_bugs += len(bugs)
                for b in bugs:
                    existing = db.query(CachedBug).filter(CachedBug.id == b["id"]).first()
                    if existing:
                        self._update_bug(existing, b)
                        updated += 1
                    else:
                        db.add(self._build_bug(b, prod.id))
                        created += 1
                db.commit()

            _finish_log(db, log, "success", total_bugs, created, updated)
            return {"fetched": total_bugs, "created": created, "updated": updated}
        except Exception as e:
            _finish_log(db, log, "failed", error=str(e))
            raise

    def _build_bug(self, b: dict, product_id: int) -> CachedBug:
        return CachedBug(
            id=b["id"], product_id=product_id,
            project_id=b.get("project", 0) or 0,
            title=b.get("title", ""),
            severity=b.get("severity", 3),
            priority=b.get("pri", 3),
            status=b.get("status", ""),
            type=b.get("type", ""),
            opened_by=b.get("openedBy", ""),
            opened_date=_parse_date(b.get("openedDate")),
            assigned_to=b.get("assignedTo", ""),
            resolved_by=b.get("resolvedBy", ""),
            resolved_date=_parse_datetime(b.get("resolvedDate")),
            closed_date=_parse_datetime(b.get("closedDate")),
            raw_json=json.dumps(b, ensure_ascii=False),
        )

    def _update_bug(self, existing: CachedBug, b: dict) -> int:
        existing.title = b.get("title", existing.title)
        existing.severity = b.get("severity", existing.severity)
        existing.priority = b.get("pri", existing.priority)
        existing.status = b.get("status", existing.status)
        existing.type = b.get("type", existing.type)
        existing.assigned_to = b.get("assignedTo", existing.assigned_to)
        existing.resolved_by = b.get("resolvedBy", existing.resolved_by)
        existing.resolved_date = _parse_datetime(b.get("resolvedDate")) or existing.resolved_date
        existing.closed_date = _parse_datetime(b.get("closedDate")) or existing.closed_date
        existing.raw_json = json.dumps(b, ensure_ascii=False)
        existing.synced_at = datetime.now(timezone.utc)
        return 1

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

    def _build_project(self, p: dict) -> CachedProject:
        pm = p.get("PM", {}) or {}
        name = p.get("name", "")
        desc = p.get("desc", "") or ""
        return CachedProject(
            id=p["id"], code=p.get("code", ""), name=name,
            model=p.get("model", ""), status=p.get("status", ""),
            begin=_parse_date(p.get("begin")), end=_parse_date(p.get("end")),
            real_began=_parse_date(p.get("realBegan")),
            real_end=_parse_date(p.get("realEnd")),
            progress=p.get("progress", "0"), estimate=_parse_float(p.get("estimate")) or 0.0,
            consumed=_parse_float(p.get("consumed")) or 0.0,
            pm_name=pm.get("realname") or pm.get("account", ""),
            pm_account=pm.get("account", ""),
            customer_name=_extract_customer(name, desc),
            description=desc,
            tags=_extract_tags_from_desc(desc),
            raw_json=json.dumps(p, ensure_ascii=False),
        )

    def _update_project(self, existing: CachedProject, p: dict) -> int:
        pm = p.get("PM", {}) or {}
        name = p.get("name", existing.name)
        desc = p.get("desc", "") or ""
        existing.code = p.get("code", existing.code)
        existing.name = name
        existing.model = p.get("model", existing.model)
        existing.status = p.get("status", existing.status)
        existing.begin = _parse_date(p.get("begin")) or existing.begin
        existing.end = _parse_date(p.get("end")) or existing.end
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
