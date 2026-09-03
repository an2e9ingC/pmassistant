from __future__ import annotations
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.middleware.auth import get_current_user, require_perm
from backend.services import delivery_service, board_service
from backend.services.entity_resolver import resolve_project
from backend.services.project_service import log_project_activity
from backend.routers.logs import log_audit
from backend.audit_categories import AUDIT_CAT_PROJECT
from backend.models.delivery import DeliveryBoard

router = APIRouter(prefix="/api/delivery", tags=["delivery"])


class DeliveryRecordCreate(BaseModel):
    product_name: str
    product_code: Optional[str] = None
    material_codes: Optional[List[str]] = None
    quantity: int = 0
    delivery_date: Optional[str] = None
    receiver: Optional[str] = None
    responsible_person: Optional[str] = None
    delivery_method: Optional[str] = None
    note: Optional[str] = None


class DeliveryRecordUpdate(BaseModel):
    product_name: Optional[str] = None
    product_code: Optional[str] = None
    material_codes: Optional[List[str]] = None
    quantity: Optional[int] = None
    delivery_date: Optional[str] = None
    receiver: Optional[str] = None
    responsible_person: Optional[str] = None
    delivery_method: Optional[str] = None
    note: Optional[str] = None


@router.get("/projects/{identifier}", response_model=dict)
def get_delivery(identifier: str, db: Session = Depends(get_db), _=Depends(get_current_user)):
    project = resolve_project(db, identifier)
    data = delivery_service.get_delivery_summary(db, project.id)
    return {"code": 0, "data": data, "message": "ok"}


@router.get("/projects/{identifier}/records", response_model=dict)
def list_records(identifier: str, db: Session = Depends(get_db), _=Depends(get_current_user)):
    project = resolve_project(db, identifier)
    records = delivery_service.list_delivery_records(db, project.id)
    return {"code": 0, "data": records, "message": "ok"}


@router.post("/projects/{identifier}/records", response_model=dict)
def create_record(
    identifier: str,
    body: DeliveryRecordCreate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("project_edit")),
):
    project = resolve_project(db, identifier)
    data = body.model_dump()
    data["material_codes"] = body.material_codes or []
    record = delivery_service.create_delivery_record(db, project.id, data, actor=user.username)
    log_audit(db, user, "delivery_record_create",
              f"项目={project.code} 新增:{body.product_name} x{body.quantity}",
              AUDIT_CAT_PROJECT, "medium")
    log_project_activity(db, project.id, user.username, "交付记录",
        f"新增:{body.product_name} x{body.quantity}")
    return {"code": 0, "data": delivery_service.record_dict(record), "message": "ok"}


@router.put("/records/{record_id}", response_model=dict)
def update_record(
    record_id: int,
    body: DeliveryRecordUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("project_edit")),
):
    from backend.models.delivery import DeliveryRecord as _DR
    from backend.models.zentao import CachedProject
    old_record = db.query(_DR).filter(_DR.id == record_id).first()
    if not old_record:
        raise HTTPException(status_code=404, detail="Record not found")
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    if not data:
        raise HTTPException(status_code=400, detail="No fields to update")
    del_changes = []
    for k, v in data.items():
        if k == "material_codes":
            continue  # handled separately in update
        old_val = getattr(old_record, k, None)
        if str(old_val) != str(v):
            del_changes.append(f"{k}:'{old_val}'->'{v}'")
    record = delivery_service.update_delivery_record(db, record_id, data, actor=user.username)
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")
    proj = db.query(CachedProject).filter(CachedProject.id == record.project_id).first()
    proj_code = proj.code if proj else str(record.project_id)
    log_audit(db, user, "delivery_record_update",
              f"项目={proj_code} {'; '.join(del_changes) if del_changes else '无变更'}",
              AUDIT_CAT_PROJECT, "medium")
    log_project_activity(db, record.project_id, user.username, "交付记录编辑",
        "; ".join(del_changes) if del_changes else "无变更")
    return {"code": 0, "data": delivery_service.record_dict(record), "message": "ok"}


@router.delete("/records/{record_id}", response_model=dict)
def delete_record(
    record_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_perm("project_edit")),
):
    from backend.models.delivery import DeliveryRecord
    from backend.models.zentao import CachedProject
    r = db.query(DeliveryRecord).filter(DeliveryRecord.id == record_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Record not found")
    proj = db.query(CachedProject).filter(CachedProject.id == r.project_id).first()
    proj_code = proj.code if proj else str(r.project_id)
    detail = f"{r.product_name} x{r.quantity} ({r.delivery_date})"
    project_id = r.project_id
    delivery_service.delete_delivery_record(db, record_id)
    log_audit(db, user, "delivery_record_delete",
              f"项目={proj_code} 删除: {detail}",
              AUDIT_CAT_PROJECT, "medium")
    log_project_activity(db, project_id, user.username, "交付记录删除",
        f"删除: {detail}")
    return {"code": 0, "data": {"deleted": True}, "message": "ok"}


# ═══════════════════════ 板卡 (DeliveryBoard) ═══════════════════════

class BoardCreate(BaseModel):
    serial_no: str
    product_code: Optional[str] = None
    product_name: Optional[str] = None
    note: Optional[str] = None


class BoardBatchCreate(BaseModel):
    serial_numbers: List[str]
    product_code: Optional[str] = None
    product_name: Optional[str] = None


class BoardUpdate(BaseModel):
    serial_no: Optional[str] = None
    product_code: Optional[str] = None
    product_name: Optional[str] = None
    note: Optional[str] = None


class BoardStatusChange(BaseModel):
    to_status: str
    data: dict = {}


@router.get("/projects/{identifier}/boards", response_model=dict)
def list_boards(identifier: str, db: Session = Depends(get_db), _=Depends(get_current_user)):
    project = resolve_project(db, identifier)
    boards = board_service.list_boards(db, project.id)
    return {
        "code": 0,
        "data": {
            "boards": board_service.boards_with_prev(db, boards),
            "meta": board_service.board_meta(),
        },
        "message": "ok",
    }


@router.post("/projects/{identifier}/boards", response_model=dict)
def create_board(
    identifier: str,
    body: BoardCreate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("board_manage")),
):
    project = resolve_project(db, identifier)
    try:
        board = board_service.create_board(
            db, project.id, body.serial_no, body.product_code or "",
            body.product_name or "", body.note or "", creator=user.username)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    log_audit(db, user, "delivery_board_create",
              f"项目={project.code} 建档板卡:{board.serial_no}",
              AUDIT_CAT_PROJECT, "medium")
    return {"code": 0, "data": board_service.board_dict(board), "message": "ok"}


@router.post("/projects/{identifier}/boards/batch", response_model=dict)
def create_boards_batch(
    identifier: str,
    body: BoardBatchCreate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("board_manage")),
):
    project = resolve_project(db, identifier)
    try:
        res = board_service.create_boards_batch(
            db, project.id, body.serial_numbers or [], body.product_code or "",
            body.product_name or "", creator=user.username)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    log_audit(db, user, "delivery_board_batch_create",
              f"项目={project.code} 批量建档:{len(res['created'])} 冲突:{len(res['duplicated'])}",
              AUDIT_CAT_PROJECT, "medium")
    return {"code": 0, "data": res, "message": "ok"}


@router.put("/boards/{board_id}", response_model=dict)
def update_board(
    board_id: int,
    body: BoardUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("board_manage")),
):
    try:
        board = board_service.update_board(db, board_id, body.model_dump(exclude_none=True), user)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    log_audit(db, user, "delivery_board_update",
              f"板卡:{board.serial_no} 编辑基本信息",
              AUDIT_CAT_PROJECT, "medium")
    return {"code": 0, "data": board_service.board_dict(board), "message": "ok"}


@router.delete("/boards/{board_id}", response_model=dict)
def delete_board(
    board_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_perm("board_manage")),
):
    board = db.query(DeliveryBoard).filter(DeliveryBoard.id == board_id).first()
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    serial = board.serial_no
    ok = board_service.delete_board(db, board_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Board not found")
    log_audit(db, user, "delivery_board_delete",
              f"删除板卡:{serial}",
              AUDIT_CAT_PROJECT, "medium")
    return {"code": 0, "data": {"deleted": True}, "message": "ok"}


@router.post("/boards/{board_id}/status", response_model=dict)
def change_board_status(
    board_id: int,
    body: BoardStatusChange,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    prev = db.query(DeliveryBoard).filter(DeliveryBoard.id == board_id).first()
    prev_status = prev.status if prev else None
    try:
        board = board_service.switch_status(db, board_id, body.to_status, body.data or {}, user)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    log_audit(db, user, "delivery_board_status",
              f"板卡:{board.serial_no} {prev_status}->{board.status}",
              AUDIT_CAT_PROJECT, "medium")
    return {"code": 0, "data": board_service.board_dict(board), "message": "ok"}


@router.get("/boards/{board_id}/timeline", response_model=dict)
def get_board_timeline(
    board_id: int,
    order: str = Query("asc"),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    board = db.query(DeliveryBoard).filter(DeliveryBoard.id == board_id).first()
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    events = board_service.board_timeline(db, board_id, order)
    return {
        "code": 0,
        "data": {
            "board": board_service.board_dict(board),
            "events": [board_service.event_dict(e) for e in events],
        },
        "message": "ok",
    }


# ═══════════════════════ 跨项目板卡总览（只读聚合） ═══════════════════════

@router.get("/overview", response_model=dict)
def get_board_overview(db: Session = Depends(get_db), _=Depends(get_current_user)):
    """跨所有项目的板卡总览：行=板卡(带项目代号/名)，附交付口径汇总。"""
    return {"code": 0, "data": board_service.board_overview(db), "message": "ok"}
