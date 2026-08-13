"""Unified cross-entity fuzzy search API — projects, bugs, tasks."""

from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.middleware.auth import get_current_user
from backend.services import search_service

router = APIRouter(prefix="/api/search", tags=["search"])


@router.get("", response_model=dict)
def search(
    q: Optional[str] = Query(None, description="Fuzzy keyword across projects/bugs/tasks"),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    empty = {"projects": [], "bugs": [], "tasks": []}
    if not q or not q.strip():
        return {"code": 0, "data": empty, "message": "ok"}
    data = search_service.search_all(db, q.strip())
    return {"code": 0, "data": data, "message": "ok"}
