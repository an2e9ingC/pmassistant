"""WorkLog and TaskComment API routes."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.middleware.auth import get_current_user, require_perm
from backend.models.task import TaskComment
from backend.services import worklog_service

router = APIRouter(prefix="/api/worklogs", tags=["worklogs"])
comment_router = APIRouter(prefix="/api/task-comments", tags=["task-comments"])


class WorkLogCreate(BaseModel):
    task_id: int
    hours: float
    date: Optional[str] = None
    description: Optional[str] = None


class WorkLogUpdate(BaseModel):
    hours: Optional[float] = None
    date: Optional[str] = None
    description: Optional[str] = None


class CommentCreate(BaseModel):
    task_id: int
    content: str


# ── Worklogs ──

@router.get("", response_model=dict)
def list_worklogs(
    task_id: Optional[int] = Query(None),
    user_id: Optional[int] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    logs = worklog_service.get_worklogs(db, task_id, user_id, date_from, date_to)
    return {"code": 0, "data": logs, "message": "ok"}


@router.get("/calendar", response_model=dict)
def worklog_calendar(
    user_id: Optional[int] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    data = worklog_service.get_calendar(db, user_id, date_from, date_to)
    return {"code": 0, "data": data, "message": "ok"}


@router.get("/summary", response_model=dict)
def worklog_summary(
    user_id: Optional[int] = Query(None),
    project_id: Optional[int] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    data = worklog_service.get_summary(db, user_id, project_id, date_from, date_to)
    return {"code": 0, "data": data, "message": "ok"}


@router.post("", response_model=dict)
def create_worklog(
    payload: WorkLogCreate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("worklog_edit")),
):
    w = worklog_service.create_worklog(db, payload.model_dump(), user.id)
    return {"code": 0, "data": w, "message": "ok"}


@router.put("/{worklog_id}", response_model=dict)
def update_worklog(
    worklog_id: int,
    payload: WorkLogUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_perm("worklog_edit")),
):
    w = worklog_service.update_worklog(db, worklog_id, payload.model_dump(exclude_unset=True))
    if not w:
        raise HTTPException(status_code=404, detail="WorkLog not found")
    return {"code": 0, "data": w, "message": "ok"}


@router.delete("/{worklog_id}", response_model=dict)
def delete_worklog(
    worklog_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_perm("worklog_edit")),
):
    ok = worklog_service.delete_worklog(db, worklog_id)
    if not ok:
        raise HTTPException(status_code=404, detail="WorkLog not found")
    return {"code": 0, "data": None, "message": "ok"}


# ── Comments ──

@comment_router.get("", response_model=dict)
def list_comments(
    task_id: int = Query(...),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    from backend.database import to_local_str
    comments = db.query(TaskComment).filter(
        TaskComment.task_id == task_id
    ).order_by(TaskComment.created_at.asc()).all()
    from backend.models.local import LocalUser

    result = []
    for c in comments:
        user = db.query(LocalUser).filter(LocalUser.id == c.user_id).first()
        result.append({
            "id": c.id,
            "task_id": c.task_id,
            "user_id": c.user_id,
            "username": user.username if user else "?",
            "display_name": user.display_name if user else "?",
            "content": c.content,
            "created_at": to_local_str(c.created_at) if c.created_at else None,
        })
    return {"code": 0, "data": result, "message": "ok"}


@comment_router.post("", response_model=dict)
def create_comment(
    payload: CommentCreate,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    from backend.database import to_local_str
    c = TaskComment(
        task_id=payload.task_id,
        user_id=user.id,
        content=payload.content,
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return {
        "code": 0,
        "data": {
            "id": c.id,
            "task_id": c.task_id,
            "user_id": c.user_id,
            "username": user.username,
            "display_name": user.display_name,
            "content": c.content,
            "created_at": to_local_str(c.created_at) if c.created_at else None,
        },
        "message": "ok",
    }


@comment_router.delete("/{comment_id}", response_model=dict)
def delete_comment(
    comment_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_perm("task_edit")),
):
    c = db.query(TaskComment).filter(TaskComment.id == comment_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Comment not found")
    db.delete(c)
    db.commit()
    return {"code": 0, "data": None, "message": "ok"}
