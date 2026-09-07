"""结构件物料编码平台 — REST API。

前缀 /api/matcode。
读写分别用 matcode_view / matcode_issue 权限收敛；管理员级能力（人工改号 override_code、
查重特批 force_duplicate）在 service 内按 is_admin_user 单独判定，普通发码人不可用。
返回统一 {"code":0,"data":...,"message":"ok"}。
"""

from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.audit_categories import AUDIT_CAT_MATCODE
from backend.database import get_db
from backend.middleware.auth import get_current_user, require_perm
from backend.models.matcode import MatcodeMaterial, MatcodeSegment
from backend.routers.logs import log_audit
from backend.services import matcode_catalog as catalog
from backend.services import matcode_service as svc

router = APIRouter(prefix="/api/matcode", tags=["matcode"])


# ────────────────────────── 数据模型 ──────────────────────────

class IssueBody(BaseModel):
    segment_key: str
    name: str
    spec: Optional[str] = None
    drawing: Optional[str] = None          # 显式图号（优先于自动联号）
    auto_drawing: bool = False             # 未显式给图号时，按码段联号规则自动生成
    project: Optional[str] = None
    unit: Optional[str] = None
    remark: Optional[str] = None
    override_code: Optional[str] = None    # 人工改号 — 仅系统管理员
    force_duplicate: bool = False          # 精确查重特批 — 仅系统管理员


class MaterialUpdateBody(BaseModel):
    name: Optional[str] = None
    spec: Optional[str] = None
    drawing: Optional[str] = None       # 显式传参才改；'' = 清除
    project: Optional[str] = None
    unit: Optional[str] = None
    remark: Optional[str] = None


class StatusBody(BaseModel):
    status: str  # active / stopped / void


class SegmentCloseBody(BaseModel):
    closed: bool


# ────────────────────────── 读接口（matcode_view） ──────────────────────────

@router.get("/tree", response_model=dict)
def get_tree(db: Session = Depends(get_db), _=Depends(require_perm("matcode_view"))):
    segs = db.query(MatcodeSegment).order_by(MatcodeSegment.sort_order).all()
    counts = dict(
        db.query(MatcodeMaterial.segment_id, func.count(MatcodeMaterial.id))
        .group_by(MatcodeMaterial.segment_id)
        .all()
    )
    active_counts = dict(
        db.query(MatcodeMaterial.segment_id, func.count(MatcodeMaterial.id))
        .filter(MatcodeMaterial.status.in_(("active", "stopped")))
        .group_by(MatcodeMaterial.segment_id)
        .all()
    )
    data = []
    for s in segs:
        data.append({
            "key": s.key, "parent_key": s.parent_key, "label": s.label,
            "prefix": s.prefix, "suffix_width": s.suffix_width,
            "is_group": bool(s.is_group), "issueable": bool(s.issueable),
            "closed": bool(s.closed),
            "drawing_series": s.drawing_series, "drawing_width": s.drawing_width,
            "sort_order": s.sort_order,
            "count": counts.get(s.id, 0),
            "active_count": active_counts.get(s.id, 0),
        })
    return {"code": 0, "data": data, "message": "ok"}


@router.get("/materials", response_model=dict)
def list_materials(
    q: Optional[str] = Query(None, description="名称/规格/料号/图号 模糊"),
    segment: Optional[str] = Query(None, description="段 key"),
    status: Optional[str] = Query(None, description="active/stopped/void；空=不含作废"),
    project: Optional[str] = Query(None),
    include_legacy: bool = Query(True, description="是否包含 legacy11723 旧前缀段"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=1000),
    db: Session = Depends(get_db),
    _=Depends(require_perm("matcode_view")),
):
    query = db.query(MatcodeMaterial).join(
        MatcodeSegment, MatcodeMaterial.segment_id == MatcodeSegment.id
    )
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(
            (MatcodeMaterial.name.like(like)) |
            (MatcodeMaterial.spec.like(like)) |
            (MatcodeMaterial.code.like(like)) |
            (MatcodeMaterial.drawing.like(like)) |
            (MatcodeMaterial.remark.like(like))
        )
    if segment:
        query = query.filter(MatcodeSegment.key == segment)
    if status:
        query = query.filter(MatcodeMaterial.status == status)
    else:
        query = query.filter(MatcodeMaterial.status != "void")
    if project:
        query = query.filter(MatcodeMaterial.project.like(f"%{project.strip()}%"))
    if not include_legacy:
        query = query.filter(MatcodeSegment.key != "legacy11723")

    total = query.count()
    items = (
        query.order_by(MatcodeMaterial.code.asc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return {"code": 0, "data": {
        "items": [svc.material_to_dict(db, m) for m in items],
        "total": total, "page": page, "page_size": page_size,
    }, "message": "ok"}


@router.get("/exports/materials", response_model=dict)
def export_materials(
    q: Optional[str] = Query(None),
    segment: Optional[str] = Query(None),
    include_legacy: bool = Query(True),
    db: Session = Depends(get_db),
    _=Depends(require_perm("matcode_view")),
):
    """CSV 导出（前端用 ﻿ BOM + 逗号转义，方便 Excel 直接打开）。"""
    import csv
    import io
    query = db.query(MatcodeMaterial).join(
        MatcodeSegment, MatcodeMaterial.segment_id == MatcodeSegment.id
    )
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(
            (MatcodeMaterial.name.like(like)) |
            (MatcodeMaterial.spec.like(like)) |
            (MatcodeMaterial.code.like(like)) |
            (MatcodeMaterial.drawing.like(like)) |
            (MatcodeMaterial.remark.like(like))
        )
    if segment:
        query = query.filter(MatcodeSegment.key == segment)
    if not include_legacy:
        query = query.filter(MatcodeSegment.key != "legacy11723")
    items = query.order_by(MatcodeMaterial.code.asc()).all()

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["料号", "段", "名称", "规格型号", "图号", "使用项目", "单位", "状态", "创建人", "创建时间"])
    for m in items:
        seg = m.segment
        writer.writerow([
            m.code, seg.label if seg else "", m.name or "", m.spec or "", m.drawing or "",
            m.project or "", m.unit or "", m.status, m.created_by or "",
            (m.created_at + timedelta(hours=8)).strftime("%Y-%m-%d %H:%M") if m.created_at else "",
        ])
    content = "﻿" + buf.getvalue()
    return {"code": 0, "data": {"filename": "matcode-materials.csv", "content": content},
            "message": "ok"}


# ────────────────────────── 发放辅助（matcode_issue） ──────────────────────────

@router.get("/dup-check", response_model=dict)
def dup_check(
    name: str = Query(..., min_length=1),
    spec: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(require_perm("matcode_issue")),
):
    return {"code": 0, "data": svc.dup_candidates(db, name, spec), "message": "ok"}


@router.get("/next-code", response_model=dict)
def next_code(
    segment_key: str = Query(...),
    name: str = Query(..., min_length=1),
    spec: Optional[str] = Query(None),
    with_drawing: bool = Query(True),
    db: Session = Depends(get_db),
    _=Depends(require_perm("matcode_issue")),
):
    return {"code": 0, "data": svc.preview_next(db, segment_key, name, spec, with_drawing),
            "message": "ok"}


# ────────────────────────── 发放（matcode_issue） ──────────────────────────

@router.post("/issue", response_model=dict)
def issue_material(body: IssueBody, db: Session = Depends(get_db),
                   user=Depends(require_perm("matcode_issue"))):
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="物料名称必填")
    result = svc.issue_single(
        db, user,
        segment_key=body.segment_key, name=name, spec=body.spec,
        drawing=body.drawing, auto_drawing=body.auto_drawing, project=body.project,
        unit=body.unit, remark=body.remark, override_code=body.override_code,
        force_duplicate=body.force_duplicate,
    )
    if result["action"] == "require_confirm":
        codes = ", ".join(c["code"] for c in result["candidates"][:5])
        raise HTTPException(
            status_code=409,
            detail=f"该物料已存在（同名+同规格），需系统管理员特批；现存料号: {codes}",
        )
    m = result["material"]
    log_audit(db, user, "matcode_issue",
              f"发码 {m['code']} 段={m['segment_label']} 名称={m['name']} 规格={m.get('spec') or ''}",
              AUDIT_CAT_MATCODE, "medium")
    return {"code": 0, "data": m, "message": "ok"}


# ────────────────────────── 维护（matcode_issue） ──────────────────────────

@router.put("/materials/{material_id}", response_model=dict)
def update_material(material_id: int, body: MaterialUpdateBody,
                    db: Session = Depends(get_db), user=Depends(require_perm("matcode_issue"))):
    m, changes = svc.update_material(
        db, user, material_id,
        name=body.name, spec=body.spec, drawing=body.drawing, project=body.project,
        unit=body.unit, remark=body.remark,
    )
    if changes:
        log_audit(db, user, "matcode_edit", f"料号 {m.code} {'; '.join(changes)}",
                  AUDIT_CAT_MATCODE, "medium")
    return {"code": 0, "data": svc.material_to_dict(db, m), "message": "ok"}


@router.put("/materials/{material_id}/status", response_model=dict)
def update_status(material_id: int, body: StatusBody,
                  db: Session = Depends(get_db), user=Depends(require_perm("matcode_issue"))):
    m, old = svc.set_material_status(db, user, material_id, body.status)
    level = "high" if body.status == "void" else "medium"
    log_audit(db, user, "matcode_status", f"料号 {m.code} 状态 {old}→{m.status}",
              AUDIT_CAT_MATCODE, level)
    return {"code": 0, "data": svc.material_to_dict(db, m), "message": "ok"}


@router.put("/segments/{segment_key}/closed", response_model=dict)
def close_segment(segment_key: str, body: SegmentCloseBody,
                  db: Session = Depends(get_db), user=Depends(require_perm("matcode_issue"))):
    seg, old = svc.set_segment_closed(db, user, segment_key, body.closed)
    log_audit(db, user, "matcode_segment_close",
              f"段 {seg.key}({seg.label}) 冻结 {'是' if seg.closed else '否'}",
              AUDIT_CAT_MATCODE, "high")
    return {"code": 0, "data": {"key": seg.key, "closed": bool(seg.closed)}, "message": "ok"}
