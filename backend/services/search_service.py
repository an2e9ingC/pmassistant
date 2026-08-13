"""Unified cross-entity fuzzy search — projects, bugs, tasks."""
from typing import Dict, List, Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from backend.models.bug import PmaBug
from backend.models.task import Task
from backend.services import topology_service
from backend.services.bug_service import _bug_dict
from backend.services.task_service import _task_dict


def _parse_id(query: str) -> Optional[int]:
    """Parse a bare numeric id or '#N' from the search keyword, else None."""
    s = (query or "").strip()
    if s.startswith("#"):
        s = s[1:]
    if s.isdigit():
        return int(s)
    return None


def search_all(db: Session, query: str, limit: int = 20) -> Dict[str, List[dict]]:
    """Fuzzy search across projects, bugs, and tasks.

    - projects: reuse topology fuzzy search (code/name/customer/product/customer)
    - bugs: title ILIKE keyword OR id match (bare number / #N)
    - tasks: title ILIKE keyword OR id match, soft-deleted excluded
    """
    projects = topology_service.search_topology(db, query=query)[:limit]

    qid = _parse_id(query)
    pattern = f"%{query}%"

    bug_q = db.query(PmaBug)
    if qid is not None:
        bug_q = bug_q.filter(or_(PmaBug.title.ilike(pattern), PmaBug.id == qid))
    else:
        bug_q = bug_q.filter(PmaBug.title.ilike(pattern))
    bugs = [_bug_dict(b, db) for b in bug_q.order_by(PmaBug.id.desc()).limit(limit).all()]

    task_q = db.query(Task).filter(or_(Task.is_deleted == 0, Task.is_deleted.is_(None)))
    if qid is not None:
        task_q = task_q.filter(or_(Task.title.ilike(pattern), Task.id == qid))
    else:
        task_q = task_q.filter(Task.title.ilike(pattern))
    tasks = [_task_dict(t, db) for t in task_q.order_by(Task.id.desc()).limit(limit).all()]

    return {"projects": projects, "bugs": bugs, "tasks": tasks}
