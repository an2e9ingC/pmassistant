"""Task CRUD API routes."""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.middleware.auth import get_current_user, require_perm
from backend.services import task_service

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


class TaskCreate(BaseModel):
    project_id: int
    execution_id: Optional[int] = None
    stage_name: Optional[str] = None
    title: str
    description: Optional[str] = None
    status: Optional[str] = "todo"
    priority: Optional[str] = "medium"
    type: Optional[str] = "development"
    assignee_id: Optional[int] = None
    parent_id: Optional[int] = None
    blocked_by_id: Optional[int] = None
    estimate_hours: Optional[float] = 0.0
    start_date: Optional[str] = None
    due_date: Optional[str] = None
    output_items: Optional[List] = None


class TaskBatchCreate(BaseModel):
    tasks: List[dict]
    project_id: int


class TaskImport(BaseModel):
    task_ids: List[int]
    target_project_id: int
    execution_mapping: Optional[dict] = None  # {source_exec_id: target_exec_id}


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    type: Optional[str] = None
    execution_id: Optional[int] = None
    stage_name: Optional[str] = None
    assignee_id: Optional[int] = None
    parent_id: Optional[int] = None
    blocked_by_id: Optional[int] = None
    estimate_hours: Optional[float] = None
    start_date: Optional[str] = None
    due_date: Optional[str] = None
    output_items: Optional[List] = None
    sort_order: Optional[int] = None


@router.get("", response_model=dict)
def list_tasks(
    project_id: Optional[int] = Query(None),
    execution_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    assignee_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    tasks = task_service.get_tasks(db, project_id, execution_id, status, assignee_id)
    return {"code": 0, "data": tasks, "message": "ok"}


@router.get("/my", response_model=dict)
def my_tasks(
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    tasks = task_service.get_my_tasks(db, user.id)
    return {"code": 0, "data": tasks, "message": "ok"}


@router.get("/stats", response_model=dict)
def task_stats(
    project_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    stats = task_service.get_task_stats(db, project_id)
    return {"code": 0, "data": stats, "message": "ok"}


@router.get("/{task_id}", response_model=dict)
def get_task(
    task_id: int,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    t = task_service.get_task(db, task_id)
    if not t:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"code": 0, "data": t, "message": "ok"}


@router.post("", response_model=dict)
def create_task(
    payload: TaskCreate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("task_edit")),
):
    t = task_service.create_task(db, payload.model_dump(), user)
    return {"code": 0, "data": t, "message": "ok"}


@router.post("/batch", response_model=dict)
def create_tasks_batch(
    payload: TaskBatchCreate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("task_edit")),
):
    for d in payload.tasks:
        d["project_id"] = payload.project_id
    tasks = task_service.create_tasks_batch(db, payload.tasks, user)
    return {"code": 0, "data": tasks, "message": "ok"}


@router.post("/import", response_model=dict)
def import_tasks(
    payload: TaskImport,
    db: Session = Depends(get_db),
    user=Depends(require_perm("task_edit")),
):
    tasks = task_service.import_tasks(
        db, payload.task_ids, payload.target_project_id,
        payload.execution_mapping or {}, user
    )
    return {"code": 0, "data": tasks, "message": "ok"}


@router.put("/{task_id}", response_model=dict)
def update_task(
    task_id: int,
    payload: TaskUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("task_edit")),
):
    t = task_service.update_task(db, task_id, payload.model_dump(exclude_unset=True), user)
    if not t:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"code": 0, "data": t, "message": "ok"}


@router.delete("/{task_id}", response_model=dict)
def delete_task(
    task_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_perm("task_edit")),
):
    ok = task_service.delete_task(db, task_id, user)
    if not ok:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"code": 0, "data": None, "message": "ok"}
