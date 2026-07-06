"""Bug tracking API routes."""
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from pydantic import BaseModel
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.middleware.auth import get_current_user, require_perm, require_any_perm
from backend.services import bug_service
from backend.routers.logs import log_audit
from fastapi.responses import StreamingResponse

router = APIRouter(prefix="/api/bugs", tags=["bugs"])


class BugCreate(BaseModel):
    title: str
    description: Optional[str] = ""
    product_id: int
    project_id: Optional[int] = None
    component_id: Optional[int] = None
    severity: int = 3
    priority: str = "medium"
    type: str = "codeerror"
    assignee_id: Optional[int] = None
    estimate_hours: float = 0


class BugUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
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


class WorklogCreate(BaseModel):
    bug_id: int
    hours: float
    date: Optional[str] = None
    description: Optional[str] = ""


class WorklogUpdate(BaseModel):
    hours: Optional[float] = None
    date: Optional[str] = None
    description: Optional[str] = None


class AnalysisCreate(BaseModel):
    bug_id: int
    content: str
    attachments: Optional[list] = None


class AnalysisUpdate(BaseModel):
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


# ── Bug CRUD ──

@router.get("", response_model=dict)
def list_bugs(product_id: Optional[int] = Query(None), project_id: Optional[int] = Query(None),
              status: Optional[str] = Query(None), assignee_id: Optional[int] = Query(None),
              component_id: Optional[int] = Query(None), search: Optional[str] = Query(None),
              db: Session = Depends(get_db), _=Depends(get_current_user)):
    bugs = bug_service.get_bugs(db, product_id, project_id, status, assignee_id, component_id, search)
    return {"code": 0, "data": bugs, "message": "ok"}


@router.get("/my", response_model=dict)
def my_bugs(db: Session = Depends(get_db), user=Depends(get_current_user)):
    bugs = bug_service.get_my_bugs(db, user.id)
    return {"code": 0, "data": bugs, "message": "ok"}


@router.get("/{bug_id}", response_model=dict)
def get_bug(bug_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    b = bug_service.get_bug(db, bug_id)
    if not b: raise HTTPException(status_code=404, detail="Bug not found")
    return {"code": 0, "data": b, "message": "ok"}


@router.post("", response_model=dict)
def create_bug(body: BugCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    b = bug_service.create_bug(db, {**body.model_dump(), "reporter_id": user.id})
    log_audit(db, user, "bug_create", f"创建Bug「{body.title}」", "Bug", "medium")
    return {"code": 0, "data": b, "message": "ok"}


@router.put("/{bug_id}", response_model=dict)
def update_bug(bug_id: int, body: BugUpdate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    b = bug_service.update_bug(db, bug_id, body.model_dump(exclude_none=True))
    if not b: raise HTTPException(status_code=404, detail="Bug not found")
    log_audit(db, user, "bug_update", f"更新Bug #{bug_id}", "Bug", "medium")
    return {"code": 0, "data": b, "message": "ok"}


@router.delete("/{bug_id}", response_model=dict)
def delete_bug(bug_id: int, db: Session = Depends(get_db), user=Depends(require_perm("task_edit"))):
    ok = bug_service.delete_bug(db, bug_id)
    if not ok: raise HTTPException(status_code=404, detail="Bug not found")
    log_audit(db, user, "bug_delete", f"删除Bug #{bug_id}", "Bug", "high")
    return {"code": 0, "message": "ok"}


# ── Worklogs ──

@router.get("/{bug_id}/worklogs", response_model=dict)
def list_worklogs(bug_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    return {"code": 0, "data": bug_service.get_worklogs(db, bug_id), "message": "ok"}


@router.post("/{bug_id}/worklogs", response_model=dict)
def create_worklog(bug_id: int, body: WorklogCreate, db: Session = Depends(get_db), user=Depends(require_perm("worklog_edit"))):
    body.bug_id = bug_id
    w = bug_service.create_worklog(db, body.model_dump(), user.id)
    log_audit(db, user, "bug_worklog_add", f"Bug #{bug_id} 记录工时 {body.hours}h", "Bug", "low")
    return {"code": 0, "data": w, "message": "ok"}


@router.put("/{bug_id}/worklogs/{wl_id}", response_model=dict)
def update_worklog(bug_id: int, wl_id: int, body: WorklogUpdate, db: Session = Depends(get_db), user=Depends(require_perm("worklog_edit"))):
    w = bug_service.update_worklog(db, wl_id, body.model_dump(exclude_none=True))
    if not w: raise HTTPException(status_code=404, detail="Worklog not found")
    log_audit(db, user, "bug_worklog_edit", f"Bug #{bug_id} 编辑工时", "Bug", "low")
    return {"code": 0, "data": w, "message": "ok"}


@router.delete("/{bug_id}/worklogs/{wl_id}", response_model=dict)
def delete_worklog(bug_id: int, wl_id: int, db: Session = Depends(get_db), user=Depends(require_perm("worklog_edit"))):
    ok = bug_service.delete_worklog(db, wl_id)
    if not ok: raise HTTPException(status_code=404, detail="Worklog not found")
    log_audit(db, user, "bug_worklog_delete", f"Bug #{bug_id} 删除工时", "Bug", "high")
    return {"code": 0, "message": "ok"}


# ── Analysis ──

@router.post("/{bug_id}/analysis", response_model=dict)
def create_analysis(bug_id: int, body: AnalysisCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    body.bug_id = bug_id
    a = bug_service.create_analysis(db, body.model_dump(), user.id)
    log_audit(db, user, "bug_analysis_add", f"Bug #{bug_id} 添加分析", "Bug", "medium")
    return {"code": 0, "data": a, "message": "ok"}


@router.put("/{bug_id}/analysis/{aid}", response_model=dict)
def update_analysis(bug_id: int, aid: int, body: AnalysisUpdate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    a = bug_service.update_analysis(db, aid, body.model_dump(exclude_none=True))
    if not a: raise HTTPException(status_code=404, detail="Analysis not found")
    log_audit(db, user, "bug_analysis_edit", f"Bug #{bug_id} 编辑分析", "Bug", "medium")
    return {"code": 0, "data": a, "message": "ok"}


@router.delete("/{bug_id}/analysis/{aid}", response_model=dict)
def delete_analysis(bug_id: int, aid: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    ok = bug_service.delete_analysis(db, aid)
    if not ok: raise HTTPException(status_code=404, detail="Analysis not found")
    log_audit(db, user, "bug_analysis_delete", f"Bug #{bug_id} 删除分析", "Bug", "high")
    return {"code": 0, "message": "ok"}


# ── Attachments ──

@router.post("/{bug_id}/attachments", response_model=dict)
async def upload_attachment(bug_id: int, file: UploadFile = File(...), analysis_id: Optional[int] = Form(None),
                            db: Session = Depends(get_db), user=Depends(get_current_user)):
    data = await file.read()
    a = bug_service.save_attachment(db, bug_id, analysis_id, file.filename, file.content_type or "application/octet-stream", data, user.id)
    log_audit(db, user, "bug_attachment_add", f"Bug #{bug_id} 上传附件: {file.filename}", "Bug", "low")
    return {"code": 0, "data": a, "message": "ok"}


# ── Import ──

@router.post("/import-from-zentao", response_model=dict)
def import_one(body: ImportRequest, db: Session = Depends(get_db), user=Depends(require_perm("sync"))):
    b = bug_service.import_from_zentao(db, body.zentao_bug_id, body.product_id, user.id, body.project_id)
    if not b: raise HTTPException(status_code=404, detail="Zentao bug not found")
    log_audit(db, user, "bug_import", f"导入禅道Bug #{body.zentao_bug_id}", "Bug", "medium")
    return {"code": 0, "data": b, "message": "ok"}


@router.post("/import-batch", response_model=dict)
def import_batch(body: BatchImportRequest, db: Session = Depends(get_db), user=Depends(require_perm("sync"))):
    r = bug_service.import_batch(db, body.zentao_bug_ids, body.product_id, user.id)
    log_audit(db, user, "bug_import_batch", f"批量导入禅道Bug {len(body.zentao_bug_ids)}条", "Bug", "medium")
    return {"code": 0, "data": r, "message": "ok"}


# ── Transfer ──

@router.post("/{bug_id}/transfer", response_model=dict)
def transfer_bug(bug_id: int, body: TransferCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    b = bug_service.transfer_bug(db, bug_id, body.to_project_id, body.transfer_type, user.id)
    if not b: raise HTTPException(status_code=404, detail="Bug not found")
    log_audit(db, user, "bug_transfer", f"Bug #{bug_id} {body.transfer_type}→项目{body.to_project_id}", "Bug", "medium")
    return {"code": 0, "data": b, "message": "ok"}


# ── GitLab Integration ──

@router.post("/{bug_id}/gitlab-submit", response_model=dict)
async def submit_to_gitlab(bug_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Submit bug as GitLab issue using the component's doc_path."""
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
        client = GitLabClient()
        title = f"[PMA Bug #{bug_id}] {b['title']}"
        desc = b.get("description", "") + f"\n\n---\nPMA Bug: {b.get('product_name','')} / {b.get('component_name','')}"
        result = await client.create_issue(proj_path, title, desc)
        await client.close()

        gitlab_url = result.get("web_url", "")
        gitlab_iid = result.get("iid")
        bug_service.update_bug(db, bug_id, {"gitlab_url": gitlab_url, "gitlab_iid": gitlab_iid, "status": "in_progress"})
        bug_service.create_analysis(db, {"bug_id": bug_id, "content": f"已提交到 GitLab: {gitlab_url}"}, user.id)

        log_audit(db, user, "bug_gitlab_submit", f"Bug #{bug_id} → GitLab Issue {proj_path}#{gitlab_iid}", "Bug", "medium")
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
        except Exception:
            continue
    db.commit()
    return {"code": 0, "data": {"synced": synced}, "message": "ok"}
