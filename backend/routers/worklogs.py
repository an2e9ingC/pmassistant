"""WorkLog and TaskComment API routes."""
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.middleware.auth import get_current_user, has_perm
from backend.models.task import TaskComment
from backend.services import worklog_service
from backend.audit_categories import AUDIT_CAT_TASK
from backend.routers.logs import log_audit

router = APIRouter(prefix="/api/worklogs", tags=["worklogs"])
comment_router = APIRouter(prefix="/api/task-comments", tags=["task-comments"])


class WorkLogCreate(BaseModel):
    task_id: int
    percentage: float
    date: Optional[str] = None
    description: Optional[str] = None


class WorkLogUpdate(BaseModel):
    percentage: Optional[float] = None
    date: Optional[str] = None
    description: Optional[str] = None


class WorkLogBatchEntry(BaseModel):
    date: str
    percentage: float
    description: Optional[str] = None
    progress: Optional[int] = None


class WorkLogBatchCreate(BaseModel):
    task_id: int
    entries: List[WorkLogBatchEntry]


class CommentCreate(BaseModel):
    task_id: int
    content: str


class CommentUpdate(BaseModel):
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
    user=Depends(get_current_user),
):
    try:
        w = worklog_service.create_worklog(db, payload.model_dump(), user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"code": 0, "data": w, "message": "ok"}


@router.put("/{worklog_id}", response_model=dict)
def update_worklog(
    worklog_id: int,
    payload: WorkLogUpdate,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    try:
        w = worklog_service.update_worklog(db, worklog_id, payload.model_dump(exclude_unset=True))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not w:
        raise HTTPException(status_code=404, detail="WorkLog not found")
    return {"code": 0, "data": w, "message": "ok"}


@router.delete("/{worklog_id}", response_model=dict)
def delete_worklog(
    worklog_id: int,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    ok = worklog_service.delete_worklog(db, worklog_id)
    if not ok:
        raise HTTPException(status_code=404, detail="WorkLog not found")
    return {"code": 0, "data": None, "message": "ok"}


@router.post("/batch", response_model=dict)
def create_worklog_batch(
    payload: WorkLogBatchCreate,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    try:
        created = worklog_service.create_worklog_batch(
            db, payload.task_id,
            [e.model_dump() for e in payload.entries],
            user.id,
        )
        return {"code": 0, "data": created, "message": f"已创建 {len(created)} 条工时记录"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/daily-usage", response_model=dict)
def daily_usage(
    user_id: Optional[int] = Query(None),
    date: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    uid = user_id or current_user.id
    d = worklog_service._parse_date(date) if date else date.today()
    data = worklog_service.get_daily_usage(db, uid, d)
    return {"code": 0, "data": data, "message": "ok"}


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
            "is_deleted": c.is_deleted or 0,
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
            "is_deleted": c.is_deleted or 0,
            "created_at": to_local_str(c.created_at) if c.created_at else None,
        },
        "message": "ok",
    }


@comment_router.delete("/{comment_id}", response_model=dict)
def delete_comment(
    comment_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Soft-delete a task comment — author or admin only."""
    c = db.query(TaskComment).filter(TaskComment.id == comment_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Comment not found")
    if c.user_id != user.id and not has_perm(user, "admin"):
        raise HTTPException(status_code=403, detail="只能删除自己添加的评论")
    if not c.is_deleted:
        c.is_deleted = 1  # 软删除：保留内容，时间线显示删除线
        db.commit()
    log_audit(db, user, "task_comment_delete", f"任务 #{c.task_id} 删除评论 #{comment_id}", AUDIT_CAT_TASK, "high")
    return {"code": 0, "data": None, "message": "ok"}


@comment_router.put("/{comment_id}", response_model=dict)
def update_comment(
    comment_id: int,
    body: CommentUpdate,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Update a task comment — only the author may edit it."""
    from backend.database import to_local_str
    c = db.query(TaskComment).filter(TaskComment.id == comment_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Comment not found")
    if c.is_deleted:
        raise HTTPException(status_code=400, detail="评论已删除，无法编辑")
    if c.user_id != user.id:
        raise HTTPException(status_code=403, detail="只能修改自己添加的评论")
    if not body.content or not body.content.strip():
        raise HTTPException(status_code=400, detail="评论内容不能为空")
    c.content = body.content
    db.commit()
    db.refresh(c)
    log_audit(db, user, "task_comment_edit", f"任务 #{c.task_id} 编辑评论 #{c.id}", AUDIT_CAT_TASK, "medium")
    return {
        "code": 0,
        "data": {
            "id": c.id,
            "task_id": c.task_id,
            "user_id": c.user_id,
            "content": c.content,
            "is_deleted": c.is_deleted or 0,
            "created_at": to_local_str(c.created_at) if c.created_at else None,
        },
        "message": "ok",
    }
