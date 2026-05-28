from __future__ import annotations
import json
import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from backend.database import SessionLocal
from backend.models.zentao import (
    CachedProject, CachedExecution, CachedTask,
    CachedUser, CachedProduct,
)
from backend.models.local import SyncLog
from backend.services.zentao_client import ZentaoClient

logger = logging.getLogger(__name__)


def _parse_date(val) -> Optional[str]:
    if not val:
        return None
    if isinstance(val, str):
        return val[:10] if "T" in val else val
    return str(val)


def _parse_datetime(val) -> Optional[datetime]:
    if not val:
        return None
    try:
        if isinstance(val, str):
            return datetime.fromisoformat(val.replace("Z", "+00:00"))
        return val
    except (ValueError, TypeError):
        return None


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

    def __init__(self):
        self.client = ZentaoClient()

    async def full_sync(self) -> dict:
        """Run a full sync from Zentao to local SQLite. Returns summary dict."""
        db = SessionLocal()
        results = {}
        try:
            await self.client.authenticate()

            results["users"] = await self._sync_users(db)
            results["products"] = await self._sync_products(db)
            results["projects"] = await self._sync_projects(db)
            results["executions_tasks"] = await self._sync_executions_and_tasks(db)

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
            products = await self.client.get_products()
            created, updated = 0, 0
            for p in products:
                existing = db.query(CachedProduct).filter(CachedProduct.id == p["id"]).first()
                if existing:
                    # Update core fields but preserve PMA enrichments
                    existing.code = p.get("code", "")
                    existing.name = p.get("name", "")
                    existing.type = p.get("type", "")
                    existing.status = p.get("status", "")
                    existing.program_id = p.get("program", 0)
                    existing.total_stories = p.get("totalStories", 0)
                    existing.total_bugs = p.get("totalBugs", 0)
                    existing.releases = p.get("releases", 0)
                    existing.raw_json = json.dumps(p, ensure_ascii=False)
                    existing.synced_at = datetime.now(timezone.utc)
                    updated += 1
                else:
                    db.add(self._build_product(p))
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
            created, updated = 0, 0
            for p in projects:
                existing = db.query(CachedProject).filter(CachedProject.id == p["id"]).first()
                if existing:
                    updated += self._update_project(existing, p)
                else:
                    db.add(self._build_project(p))
                    created += 1
            db.commit()
            _finish_log(db, log, "success", len(projects), created, updated)
            return {"fetched": len(projects), "created": created, "updated": updated}
        except Exception as e:
            _finish_log(db, log, "failed", error=str(e))
            raise

    async def _sync_executions_and_tasks(self, db: Session) -> dict:
        log = _log_sync(db, "executions_tasks")
        total_execs, total_tasks = 0, 0
        created_e, updated_e = 0, 0
        created_t, updated_t = 0, 0
        try:
            projects = db.query(CachedProject).all()

            for proj in projects:
                try:
                    executions = await self.client.get_executions(project_id=proj.id)
                except Exception:
                    logger.warning(f"Failed to fetch executions for project {proj.id}")
                    continue

                total_execs += len(executions)
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
                    for t in tasks:
                        texisting = db.query(CachedTask).filter(
                            CachedTask.id == t["id"]
                        ).first()
                        if texisting:
                            updated_t += self._update_task(texisting, t)
                        else:
                            db.add(self._build_task(t, proj.id, e["id"]))
                            created_t += 1

                db.commit()

            _finish_log(db, log, "success", total_execs + total_tasks,
                        created_e + created_t, updated_e + updated_t)
            return {
                "executions_fetched": total_execs, "executions_created": created_e,
                "executions_updated": updated_e,
                "tasks_fetched": total_tasks, "tasks_created": created_t,
                "tasks_updated": updated_t,
            }
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
        return CachedProduct(
            id=p["id"], code=p.get("code", ""),
            name=p.get("name", ""), type=p.get("type", ""),
            status=p.get("status", ""), program_id=p.get("program", 0),
            total_stories=p.get("totalStories", 0), total_bugs=p.get("totalBugs", 0),
            releases=p.get("releases", 0),
            raw_json=json.dumps(p, ensure_ascii=False),
        )

    def _build_project(self, p: dict) -> CachedProject:
        pm = p.get("PM", {}) or {}
        return CachedProject(
            id=p["id"], code=p.get("code", ""), name=p.get("name", ""),
            model=p.get("model", ""), status=p.get("status", ""),
            begin=_parse_date(p.get("begin")), end=_parse_date(p.get("end")),
            real_began=_parse_date(p.get("realBegan")),
            real_end=_parse_date(p.get("realEnd")),
            progress=p.get("progress", "0"), estimate=p.get("estimate", 0.0),
            consumed=p.get("consumed", 0.0),
            pm_name=pm.get("realname") or pm.get("account", ""),
            pm_account=pm.get("account", ""),
            raw_json=json.dumps(p, ensure_ascii=False),
        )

    def _update_project(self, existing: CachedProject, p: dict) -> int:
        pm = p.get("PM", {}) or {}
        existing.code = p.get("code", existing.code)
        existing.name = p.get("name", existing.name)
        existing.model = p.get("model", existing.model)
        existing.status = p.get("status", existing.status)
        existing.begin = _parse_date(p.get("begin")) or existing.begin
        existing.end = _parse_date(p.get("end")) or existing.end
        existing.real_began = _parse_date(p.get("realBegan")) or existing.real_began
        existing.real_end = _parse_date(p.get("realEnd")) or existing.real_end
        existing.progress = p.get("progress", existing.progress)
        existing.estimate = p.get("estimate", existing.estimate)
        existing.consumed = p.get("consumed", existing.consumed)
        existing.pm_name = pm.get("realname") or pm.get("account", existing.pm_name)
        existing.pm_account = pm.get("account", existing.pm_account)
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
            estimate=t.get("estimate", 0.0), consumed=t.get("consumed", 0.0),
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
        existing.estimate = t.get("estimate", existing.estimate)
        existing.consumed = t.get("consumed", existing.consumed)
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
