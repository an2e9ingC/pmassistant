"""Bug tracking API routes."""
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from pydantic import BaseModel
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.middleware.auth import get_current_user, require_perm, require_any_perm, has_perm
from backend.models.bug import PmaBug, BugAnalysis, BugComment
from backend.models.delivery import DeliveryBoard
from backend.services import bug_service
from backend.services.bug_service import BUG_TYPE_REPAIR
from backend.services.entity_resolver import resolve_project
from backend.audit_categories import AUDIT_CAT_BUG, AUDIT_CAT_PROJECT
from backend.routers.logs import log_audit
from fastapi.responses import StreamingResponse

router = APIRouter(prefix="/api/bugs", tags=["bugs"])


def _can_edit_bug(db, user, bug_id):
    """Only admin users, or the bug's reporter/assignee, may edit a bug."""
    if has_perm(user, "admin"):
        return True
    bug = db.query(PmaBug).filter(PmaBug.id == bug_id).first()
    if not bug:
        return False
    return bug.reporter_id == user.id or bug.assignee_id == user.id


def _filter_editable_bug_ids(db, user, bug_ids):
    """Return only the bug ids the user is allowed to edit."""
    if has_perm(user, "admin"):
        return list(bug_ids)
    result = []
    for bid in bug_ids:
        bug = db.query(PmaBug).filter(PmaBug.id == bid).first()
        if bug and (bug.reporter_id == user.id or bug.assignee_id == user.id):
            result.append(bid)
    return result


def _validate_repair_boards(db, project_id, board_ids):
    """维修 Bug 关联的板卡必须属于 bug 所在项目。"""
    if not board_ids:
        return
    cnt = db.query(DeliveryBoard).filter(
        DeliveryBoard.id.in_(board_ids),
        DeliveryBoard.project_id == project_id,
    ).count()
    if cnt != len(set(board_ids)):
        raise HTTPException(status_code=400, detail="板卡不属于该项目")


class BugCreate(BaseModel):
    title: str
    description: Optional[str] = ""
    product_id: int
    project_id: int
    component_id: Optional[int] = None
    severity: int = 3
    priority: str = "medium"
    type: str = "codeerror"
    assignee_id: Optional[int] = None
    estimate_hours: float = 0
    cc_user_ids: Optional[List[int]] = None
    progress: Optional[int] = 0
    board_ids: Optional[List[int]] = None


class BugUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    product_id: Optional[int] = None
    project_id: Optional[int] = None
    component_id: Optional[int] = None
    status: Optional[str] = None
    resolution: Optional[str] = None
    severity: Optional[int] = None
    priority: Optional[str] = None
    type: Optional[str] = None
    assignee_id: Optional[int] = None
    estimate_hours: Optional[float] = None
    resolved_by_id: Optional[int] = None
    cc_user_ids: Optional[List[int]] = None
    progress: Optional[int] = None
    board_ids: Optional[List[int]] = None


class WorklogCreate(BaseModel):
    bug_id: int
    percentage: float
    date: Optional[str] = None
    description: Optional[str] = ""
    progress: Optional[int] = None


class WorklogBatchEntry(BaseModel):
    date: str
    percentage: float
    description: Optional[str] = None
    progress: Optional[int] = None


class WorklogBatchCreate(BaseModel):
    entries: List[WorklogBatchEntry]


class WorklogUpdate(BaseModel):
    percentage: Optional[float] = None
    date: Optional[str] = None
    description: Optional[str] = None


class AnalysisCreate(BaseModel):
    bug_id: int
    title: Optional[str] = None
    content: str = ""  # 正文可选，默认空字符串（DB 列非空，存 "" 不违反）
    attachments: Optional[list] = None


class AnalysisUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    attachments: Optional[list] = None


class TransferCreate(BaseModel):
    to_project_id: int
    transfer_type: str  # move / copy


class ImportRequest(BaseModel):
    zentao_bug_id: int
    product_id: int
    project_id: Optional[int] = None


class BatchImportRequest(BaseModel):
    zentao_bug_ids: List[int]
    product_id: int


class BugBatchIds(BaseModel):
    bug_ids: List[int]


class BugBatchStatus(BaseModel):
    bug_ids: List[int]
    status: str


class BugBatchAssign(BaseModel):
    bug_ids: List[int]
    assignee_id: int


class BugBatchTransfer(BaseModel):
    bug_ids: List[int]
    to_project_id: int
    transfer_type: str = "move"  # move / copy


# ── Bug CRUD ──

@router.get("", response_model=dict)
def list_bugs(product_id: Optional[int] = Query(None), project_id: Optional[str] = Query(None),
              status: Optional[str] = Query(None), assignee_id: Optional[int] = Query(None),
              component_id: Optional[int] = Query(None), search: Optional[str] = Query(None),
              reporter_id: Optional[int] = Query(None), severity: Optional[int] = Query(None),
              priority: Optional[str] = Query(None), type: Optional[str] = Query(None),
              created_from: Optional[str] = Query(None), created_to: Optional[str] = Query(None),
              limit: Optional[int] = Query(500),
              db: Session = Depends(get_db), _=Depends(get_current_user)):
    pid = None
    if project_id:
        p = resolve_project(db, project_id)
        pid = p.id
    bugs = bug_service.get_bugs(db, product_id, pid, status, assignee_id, component_id, search,
                                reporter_id=reporter_id, severity=severity, priority=priority,
                                type=type, created_from=created_from, created_to=created_to,
                                limit=limit)
    return {"code": 0, "data": bugs, "message": "ok"}


@router.get("/my", response_model=dict)
def my_bugs(db: Session = Depends(get_db), user=Depends(get_current_user)):
    bugs = bug_service.get_my_bugs(db, user.id)
    return {"code": 0, "data": bugs, "message": "ok"}


@router.get("/user/{user_id}", response_model=dict)
def get_user_bugs(user_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    """返回某用户的所有相关 Bug：负责人 + 创建人 + 被抄送"""
    bugs = bug_service.get_user_bugs(db, user_id)
    return {"code": 0, "data": bugs, "message": "ok"}


@router.get("/stats", response_model=dict)
def bug_stats(product_id: Optional[int] = Query(None), project_id: Optional[str] = Query(None),
              status: Optional[str] = Query(None), assignee_id: Optional[int] = Query(None),
              component_id: Optional[int] = Query(None), search: Optional[str] = Query(None),
              reporter_id: Optional[int] = Query(None), severity: Optional[int] = Query(None),
              priority: Optional[str] = Query(None), type: Optional[str] = Query(None),
              created_from: Optional[str] = Query(None), created_to: Optional[str] = Query(None),
              db: Session = Depends(get_db), _=Depends(get_current_user)):
    pid = None
    if project_id:
        p = resolve_project(db, project_id)
        pid = p.id
    stats = bug_service.get_bug_stats(db, project_id=pid, product_id=product_id, status=status,
                                      assignee_id=assignee_id, component_id=component_id,
                                      search=search, reporter_id=reporter_id, severity=severity,
                                      priority=priority, type=type, created_from=created_from,
                                      created_to=created_to)
    return {"code": 0, "data": stats, "message": "ok"}


@router.get("/zentao-candidates", response_model=dict)
def zentao_candidates(product_id: int = Query(...), search: Optional[str] = Query(None),
                      db: Session = Depends(get_db), _=Depends(require_perm("sync"))):
    items = bug_service.get_zentao_candidates(db, product_id, search=search)
    return {"code": 0, "data": items, "message": "ok"}


@router.post("/batch-status", response_model=dict)
def batch_update_status(body: BugBatchStatus, db: Session = Depends(get_db), user=Depends(get_current_user)):
    ids = _filter_editable_bug_ids(db, user, body.bug_ids)
    updated = bug_service.batch_update_status(db, ids, body.status, user.id)
    log_audit(db, user, "bug_batch_status", f"批量更新 {updated} 个Bug状态为 {body.status}", AUDIT_CAT_BUG, "medium")
    return {"code": 0, "data": {"updated": updated}, "message": "ok"}


@router.post("/batch-assign", response_model=dict)
def batch_assign_bugs(body: BugBatchAssign, db: Session = Depends(get_db), user=Depends(get_current_user)):
    ids = _filter_editable_bug_ids(db, user, body.bug_ids)
    updated = bug_service.batch_assign(db, ids, body.assignee_id, user.id)
    log_audit(db, user, "bug_batch_assign", f"批量指派 {updated} 个Bug给用户#{body.assignee_id}", AUDIT_CAT_BUG, "medium")
    return {"code": 0, "data": {"updated": updated}, "message": "ok"}


@router.post("/batch-transfer", response_model=dict)
def batch_transfer_bugs(body: BugBatchTransfer, db: Session = Depends(get_db), user=Depends(get_current_user)):
    ids = _filter_editable_bug_ids(db, user, body.bug_ids)
    processed = bug_service.batch_transfer(db, ids, body.to_project_id, body.transfer_type, user.id)
    log_audit(db, user, "bug_batch_transfer", f"批量{'移动' if body.transfer_type == 'move' else '复制'} {processed} 个Bug到项目#{body.to_project_id}", AUDIT_CAT_BUG, "medium")
    return {"code": 0, "data": {"processed": processed}, "message": "ok"}


@router.delete("/batch", response_model=dict)
def batch_delete_bugs(body: BugBatchIds, db: Session = Depends(get_db), user=Depends(require_perm("task_edit"))):
    deleted = bug_service.batch_delete(db, body.bug_ids)
    log_audit(db, user, "bug_batch_delete", f"批量删除 {deleted} 个Bug", AUDIT_CAT_BUG, "high")
    return {"code": 0, "data": {"deleted": deleted}, "message": "ok"}


@router.get("/{bug_id}", response_model=dict)
def get_bug(bug_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    b = bug_service.get_bug(db, bug_id)
    if not b: raise HTTPException(status_code=404, detail="Bug not found")
    return {"code": 0, "data": b, "message": "ok"}


@router.post("", response_model=dict)
def create_bug(body: BugCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    if body.type == BUG_TYPE_REPAIR:
        if not body.board_ids:
            raise HTTPException(status_code=400, detail="维修类 Bug 必须关联板卡")
        _validate_repair_boards(db, body.project_id, body.board_ids)
    b = bug_service.create_bug(db, {**body.model_dump(), "reporter_id": user.id})
    if body.type == BUG_TYPE_REPAIR and body.board_ids:
        for bid in body.board_ids:
            log_audit(db, user, "delivery_board_repair",
                      f"板卡#{bid} →维修中（维修Bug#{b['id']}）", AUDIT_CAT_PROJECT, "medium")
    log_audit(db, user, "bug_create", f"创建Bug「{body.title}」", AUDIT_CAT_BUG, "medium")
    return {"code": 0, "data": b, "message": "ok"}


@router.put("/{bug_id}", response_model=dict)
def update_bug(bug_id: int, body: BugUpdate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    if not _can_edit_bug(db, user, bug_id):
        raise HTTPException(status_code=403, detail="无权修改该Bug：仅创建人或负责人可修改")
    existing = db.query(PmaBug).filter(PmaBug.id == bug_id).first()
    if not existing:
        raise HTTPException(status_code=404, detail="Bug not found")
    # 维修 Bug 校验：类型为维修时板卡必填且属于项目
    eff_type = body.type or existing.type
    eff_board_ids = body.board_ids if body.board_ids is not None else (existing.board_ids or [])
    if eff_type == BUG_TYPE_REPAIR and not eff_board_ids:
        raise HTTPException(status_code=400, detail="维修类 Bug 必须关联板卡")
    if body.board_ids is not None:
        _validate_repair_boards(db, body.project_id or existing.project_id, body.board_ids)
    old_status = existing.status
    old_board_ids = [int(x) for x in (existing.board_ids or []) if x is not None]
    b = bug_service.update_bug(db, bug_id, body.model_dump(exclude_none=True), user.id)
    if not b: raise HTTPException(status_code=404, detail="Bug not found")
    # 板卡联动审计（与 bug_service 实际联动条件对齐，避免记录未发生的迁移）
    new_board_ids = [int(x) for x in (b.get("board_ids") or []) if x is not None]
    added = [x for x in new_board_ids if x not in old_board_ids]
    if b.get("type") == BUG_TYPE_REPAIR and b.get("status") not in ("resolved", "closed"):
        for bid in added:
            log_audit(db, user, "delivery_board_repair",
                      f"板卡#{bid} →维修中（维修Bug#{bug_id}）", AUDIT_CAT_PROJECT, "medium")
    if body.status in ("resolved", "closed") and old_status not in ("resolved", "closed"):
        repairing_ids = {br.id for br in db.query(DeliveryBoard).filter(
            DeliveryBoard.id.in_(old_board_ids), DeliveryBoard.status == "维修中").all()} if old_board_ids else set()
        for bid in new_board_ids:
            if bid in repairing_ids:
                log_audit(db, user, "delivery_board_repair_finish",
                          f"板卡#{bid} →已维修（维修Bug#{bug_id} 解决）", AUDIT_CAT_PROJECT, "medium")
    log_audit(db, user, "bug_update", f"更新Bug #{bug_id}", AUDIT_CAT_BUG, "medium")
    return {"code": 0, "data": b, "message": "ok"}


@router.delete("/{bug_id}", response_model=dict)
def delete_bug(bug_id: int, db: Session = Depends(get_db), user=Depends(require_perm("task_edit"))):
    ok = bug_service.delete_bug(db, bug_id)
    if not ok: raise HTTPException(status_code=404, detail="Bug not found")
    log_audit(db, user, "bug_delete", f"删除Bug #{bug_id}", AUDIT_CAT_BUG, "high")
    return {"code": 0, "message": "ok"}


# ── Worklogs ──

@router.get("/{bug_id}/worklogs", response_model=dict)
def list_worklogs(bug_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    return {"code": 0, "data": bug_service.get_worklogs(db, bug_id), "message": "ok"}


@router.post("/{bug_id}/worklogs", response_model=dict)
def create_worklog(bug_id: int, body: WorklogCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    body.bug_id = bug_id
    w = bug_service.create_worklog(db, body.model_dump(), user.id)
    log_audit(db, user, "bug_worklog_add", f"Bug #{bug_id} 记录工时 {body.percentage}%", AUDIT_CAT_BUG, "low")
    return {"code": 0, "data": w, "message": "ok"}


@router.post("/{bug_id}/worklogs/batch", response_model=dict)
def create_worklog_batch(bug_id: int, body: WorklogBatchCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    try:
        created = bug_service.create_worklog_batch(
            db, bug_id,
            [e.model_dump() for e in body.entries],
            user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    log_audit(db, user, "bug_worklog_add", f"Bug #{bug_id} 批量记录 {len(created)} 条工时", AUDIT_CAT_BUG, "low")
    return {"code": 0, "data": created, "message": f"已创建 {len(created)} 条工时记录"}


@router.put("/{bug_id}/worklogs/{wl_id}", response_model=dict)
def update_worklog(bug_id: int, wl_id: int, body: WorklogUpdate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    try:
        w = bug_service.update_worklog(db, wl_id, body.model_dump(exclude_none=True))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not w: raise HTTPException(status_code=404, detail="Worklog not found")
    log_audit(db, user, "bug_worklog_edit", f"Bug #{bug_id} 编辑工时", AUDIT_CAT_BUG, "low")
    return {"code": 0, "data": w, "message": "ok"}


@router.delete("/{bug_id}/worklogs/{wl_id}", response_model=dict)
def delete_worklog(bug_id: int, wl_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    ok = bug_service.delete_worklog(db, wl_id)
    if not ok: raise HTTPException(status_code=404, detail="Worklog not found")
    log_audit(db, user, "bug_worklog_delete", f"Bug #{bug_id} 删除工时", AUDIT_CAT_BUG, "high")
    return {"code": 0, "message": "ok"}


# ── Analysis ──

@router.post("/{bug_id}/analysis", response_model=dict)
def create_analysis(bug_id: int, body: AnalysisCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    body.bug_id = bug_id
    a = bug_service.create_analysis(db, body.model_dump(), user.id)
    log_audit(db, user, "bug_analysis_add", f"Bug #{bug_id} 添加分析", AUDIT_CAT_BUG, "medium")
    return {"code": 0, "data": a, "message": "ok"}


@router.put("/{bug_id}/analysis/{aid}", response_model=dict)
def update_analysis(bug_id: int, aid: int, body: AnalysisUpdate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    a = db.query(BugAnalysis).filter(BugAnalysis.id == aid, BugAnalysis.bug_id == bug_id).first()
    if not a: raise HTTPException(status_code=404, detail="Analysis not found")
    if a.is_deleted:
        raise HTTPException(status_code=400, detail="分析记录已删除，无法编辑")
    if a.user_id != user.id:
        raise HTTPException(status_code=403, detail="只能修改自己添加的分析记录")
    a = bug_service.update_analysis(db, aid, body.model_dump(exclude_none=True))
    if not a: raise HTTPException(status_code=404, detail="Analysis not found")
    log_audit(db, user, "bug_analysis_edit", f"Bug #{bug_id} 编辑分析", AUDIT_CAT_BUG, "medium")
    return {"code": 0, "data": a, "message": "ok"}


@router.delete("/{bug_id}/analysis/{aid}", response_model=dict)
def delete_analysis(bug_id: int, aid: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    a = db.query(BugAnalysis).filter(BugAnalysis.id == aid, BugAnalysis.bug_id == bug_id).first()
    if not a: raise HTTPException(status_code=404, detail="Analysis not found")
    if a.user_id != user.id and not has_perm(user, "admin"):
        raise HTTPException(status_code=403, detail="只能删除自己添加的分析记录")
    bug_service.delete_analysis(db, aid)  # 软删除
    log_audit(db, user, "bug_analysis_delete", f"Bug #{bug_id} 删除分析", AUDIT_CAT_BUG, "high")
    return {"code": 0, "message": "ok"}


# ── Attachments ──

@router.post("/{bug_id}/attachments", response_model=dict)
async def upload_attachment(bug_id: int, file: UploadFile = File(...), analysis_id: Optional[int] = Form(None),
                            db: Session = Depends(get_db), user=Depends(get_current_user)):
    data = await file.read()
    a = bug_service.save_attachment(db, bug_id, analysis_id, file.filename, file.content_type or "application/octet-stream", data, user.id)
    log_audit(db, user, "bug_attachment_add", f"Bug #{bug_id} 上传附件: {file.filename}", AUDIT_CAT_BUG, "low")
    return {"code": 0, "data": a, "message": "ok"}


# ── Import ──

@router.post("/import-from-zentao", response_model=dict)
def import_one(body: ImportRequest, db: Session = Depends(get_db), user=Depends(require_perm("sync"))):
    b = bug_service.import_from_zentao(db, body.zentao_bug_id, body.product_id, user.id, body.project_id)
    if not b: raise HTTPException(status_code=404, detail="Zentao bug not found")
    log_audit(db, user, "bug_import", f"导入禅道Bug #{body.zentao_bug_id}", AUDIT_CAT_BUG, "medium")
    return {"code": 0, "data": b, "message": "ok"}


@router.post("/import-batch", response_model=dict)
def import_batch(body: BatchImportRequest, db: Session = Depends(get_db), user=Depends(require_perm("sync"))):
    r = bug_service.import_batch(db, body.zentao_bug_ids, body.product_id, user.id)
    log_audit(db, user, "bug_import_batch", f"批量导入禅道Bug {len(body.zentao_bug_ids)}条", AUDIT_CAT_BUG, "medium")
    return {"code": 0, "data": r, "message": "ok"}


# ── Transfer ──

@router.post("/{bug_id}/transfer", response_model=dict)
def transfer_bug(bug_id: int, body: TransferCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    if not _can_edit_bug(db, user, bug_id):
        raise HTTPException(status_code=403, detail="无权转移该Bug：仅创建人或负责人可操作")
    b = bug_service.transfer_bug(db, bug_id, body.to_project_id, body.transfer_type, user.id)
    if not b: raise HTTPException(status_code=404, detail="Bug not found")
    log_audit(db, user, "bug_transfer", f"Bug #{bug_id} {body.transfer_type}→项目{body.to_project_id}", AUDIT_CAT_BUG, "medium")
    return {"code": 0, "data": b, "message": "ok"}


# ── Comments ──

class CommentCreate(BaseModel):
    content: str
    is_system: Optional[int] = 0


class CommentUpdate(BaseModel):
    content: str


@router.get("/{bug_id}/comments", response_model=dict)
def list_comments(bug_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    comments = bug_service.get_comments(db, bug_id)
    return {"code": 0, "data": comments, "message": "ok"}


@router.post("/{bug_id}/comments", response_model=dict)
def create_comment(bug_id: int, body: CommentCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    c = bug_service.create_comment(db, bug_id, body.content, user.id, body.is_system)
    return {"code": 0, "data": c, "message": "ok"}


@router.put("/{bug_id}/comments/{cid}", response_model=dict)
def update_comment(bug_id: int, cid: int, body: CommentUpdate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Update a bug comment — only the author may edit it."""
    c = db.query(BugComment).filter(BugComment.id == cid, BugComment.bug_id == bug_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Comment not found")
    if c.is_deleted:
        raise HTTPException(status_code=400, detail="评论已删除，无法编辑")
    if c.user_id != user.id:
        raise HTTPException(status_code=403, detail="只能修改自己添加的评论")
    if not body.content or not body.content.strip():
        raise HTTPException(status_code=400, detail="评论内容不能为空")
    updated = bug_service.update_comment(db, cid, body.content)
    log_audit(db, user, "bug_comment_edit", f"Bug #{bug_id} 编辑评论 #{cid}", AUDIT_CAT_BUG, "medium")
    return {"code": 0, "data": updated, "message": "ok"}


@router.delete("/{bug_id}/comments/{cid}", response_model=dict)
def delete_comment(bug_id: int, cid: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Delete a bug comment — author or admin only."""
    c = db.query(BugComment).filter(BugComment.id == cid, BugComment.bug_id == bug_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Comment not found")
    if c.user_id != user.id and not has_perm(user, "admin"):
        raise HTTPException(status_code=403, detail="只能删除自己添加的评论")
    bug_service.delete_comment(db, cid)
    log_audit(db, user, "bug_comment_delete", f"Bug #{bug_id} 删除评论 #{cid}", AUDIT_CAT_BUG, "high")
    return {"code": 0, "data": None, "message": "ok"}


# ── GitLab Integration ──

@router.post("/{bug_id}/gitlab-submit", response_model=dict)
async def submit_to_gitlab(bug_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Submit bug as GitLab issue using the component's doc_path."""
    if not _can_edit_bug(db, user, bug_id):
        raise HTTPException(status_code=403, detail="无权提交该Bug：仅创建人或负责人可操作")
    b = bug_service.get_bug(db, bug_id)
    if not b: raise HTTPException(status_code=404, detail="Bug not found")
    if not b.get("component_id"):
        raise HTTPException(status_code=400, detail="Bug 未选择组件，无法确定 GitLab 仓库")

    # Get component's doc_path to determine gitlab project
    from backend.models.document import ProductDocTemplate
    tpl = db.query(ProductDocTemplate).filter(ProductDocTemplate.id == b["component_id"]).first()
    if not tpl or not tpl.doc_path:
        raise HTTPException(status_code=400, detail="组件未配置文档路径")
    if tpl.doc_type != "gitlab":
        raise HTTPException(status_code=400, detail="组件文档类型非 GitLab（当前: " + (tpl.doc_type or "未设置") + "）")

    # Parse gitlab project path from doc_path
    import re as _re
    m = _re.search(r'https?://[^/]+/(.+?)(?:/-)?(?:/releases|/tags)?$|https?://[^/]+/(.+)', tpl.doc_path)
    if not m:
        raise HTTPException(status_code=400, detail="无法从组件路径解析 GitLab 项目: " + tpl.doc_path)
    proj_path = (m.group(1) or m.group(2)).rstrip("/")

    try:
        from backend.services.gitlab_client import GitLabClient
        import logging as _logging
        _logger = _logging.getLogger(__name__)

        # Token selection: OAuth user → own token; admin → PAT fallback; others → reject
        if user.auth_source == "gitlab":
            if not user.gitlab_access_token:
                raise HTTPException(status_code=400, detail="GitLab 授权已过期，请重新登录后再提交")
            effective_token = user.gitlab_access_token
        elif user.role == "admin":
            effective_token = settings.GITLAB_TOKEN
            if not effective_token:
                raise HTTPException(status_code=400, detail="GitLab Token 未配置，请联系管理员")
        else:
            raise HTTPException(status_code=400, detail="请使用 GitLab 账号登录后再提交 Issue")

        client = GitLabClient(token=effective_token)
        title = f"[PMA Bug #{bug_id}] {b['title']}"
        desc = b.get("description", "") + f"\n\n---\nPMA Bug: {b.get('product_name','')} / {b.get('component_name','')}"
        assignee = user.gitlab_user_id if user.auth_source == "gitlab" else None
        _logger.info(f"[bug-gitlab] submit bug#{bug_id} user={user.username} role={user.role} auth_source={user.auth_source} "
                     f"gitlab_user_id={user.gitlab_user_id} assignee_id={assignee}"
                     f" using_token={'oauth' if user.auth_source == 'gitlab' else 'pat'}")
        result = await client.create_issue(proj_path, title, desc, assignee_id=assignee)
        await client.close()

        gitlab_url = result.get("web_url", "")
        gitlab_iid = result.get("iid")
        bug_service.update_bug(db, bug_id, {"gitlab_url": gitlab_url, "gitlab_iid": gitlab_iid, "status": "in_progress"})
        bug_service.create_analysis(db, {"bug_id": bug_id, "content": f"已提交到 GitLab: {gitlab_url}"}, user.id)

        log_audit(db, user, "bug_gitlab_submit", f"Bug #{bug_id} → GitLab Issue {proj_path}#{gitlab_iid}", AUDIT_CAT_BUG, "medium")
        return {"code": 0, "data": {"gitlab_url": gitlab_url, "gitlab_iid": gitlab_iid}, "message": "已提交到 GitLab"}
    except Exception as e:
        msg = str(e)[:200]
        if "403" in msg or "Forbidden" in msg:
            raise HTTPException(status_code=400, detail="GitLab 权限不足，需要仓库的 Reporter 权限。请联系管理员为你添加权限后重试。")
        raise HTTPException(status_code=500, detail=f"GitLab 提交失败: {msg}")


@router.post("/gitlab-sync", response_model=dict)
async def sync_gitlab_issues(db: Session = Depends(get_db), _=Depends(require_perm("sync"))):
    """Auto-sync: check all gitlab-submitted bugs, update if issues are closed."""
    from backend.models.bug import PmaBug
    bugs = db.query(PmaBug).filter(PmaBug.gitlab_url.isnot(None), PmaBug.gitlab_url != "",
                                    PmaBug.status == "in_progress").all()
    synced = 0
    for b in bugs:
        try:
            from backend.services.gitlab_client import GitLabClient
            client = GitLabClient()
            # Extract project path + iid from gitlab_url
            import re as _re
            m = _re.search(r'https?://[^/]+/(.+?)/-/issues/(\d+)', b.gitlab_url or "")
            if not m: continue
            proj_path, issue_iid = m.group(1), m.group(2)
            issue = await client.get_issue(proj_path, int(issue_iid))
            await client.close()
            if issue and issue.get("state") == "closed":
                b.status = "gitlab_submitted"
                bug_service.create_analysis(db, {"bug_id": b.id,
                    "content": f"GitLab Issue 已关闭 (state=closed)"}, None)
                synced += 1
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"[gitlab-sync] Bug #{b.id} sync failed: {e}")
            continue
    db.commit()
    return {"code": 0, "data": {"synced": synced}, "message": "ok"}
