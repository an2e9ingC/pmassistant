from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.middleware.auth import get_current_user, require_perm
from backend.audit_categories import AUDIT_CAT_TEMPLATE
from backend.routers.logs import log_audit
from backend.models.standard import ProcessStandard

router = APIRouter(prefix="/api/standards", tags=["standards"])

# Seed defaults (inserted on first access if table is empty)
SEED_STANDARDS = [
    {"category": "产品编号", "key": "serial_format", "value": "", "description": "产品序列号格式规范（正则表达式），如 ^SN\\d{8}$"},
    {"category": "GitLab发布", "key": "title_pattern", "value": "", "description": "GitLab Release 标题命名规范，如 v{version}-{date}"},
    {"category": "GitLab发布", "key": "tag_pattern", "value": "", "description": "GitLab Tag 命名规范"},
    {"category": "交付检查", "key": "required_docs", "value": "", "description": "交付时必须提交的文档清单（JSON数组）"},
    {"category": "阶段命名", "key": "name_standard", "value": "", "description": "阶段命名规范说明"},
]


def seed_standards(db: Session):
    if db.query(ProcessStandard).count() == 0:
        for s in SEED_STANDARDS:
            db.add(ProcessStandard(**s))
        db.commit()


class StandardUpdate(BaseModel):
    value: Optional[str] = None
    description: Optional[str] = None


@router.get("", response_model=dict)
def list_standards(db: Session = Depends(get_db), _=Depends(get_current_user)):
    seed_standards(db)
    rows = db.query(ProcessStandard).order_by(ProcessStandard.category, ProcessStandard.key).all()
    # Group by category
    grouped: dict = {}
    for r in rows:
        grouped.setdefault(r.category, []).append({
            "id": r.id, "key": r.key, "value": r.value or "",
            "description": r.description or "",
        })
    return {"code": 0, "data": grouped, "message": "ok"}


@router.put("/{standard_id}", response_model=dict)
def update_standard(
    standard_id: int,
    body: StandardUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_perm("doc_template")),
):
    s = db.query(ProcessStandard).filter(ProcessStandard.id == standard_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Standard not found")
    if body.value is not None:
        s.value = body.value
    if body.description is not None:
        s.description = body.description
    db.commit()
    log_audit(db, user, "standard_edit", f"{s.category}/{s.key}: {s.value}", AUDIT_CAT_TEMPLATE, "medium")
    return {"code": 0, "data": {"id": s.id, "key": s.key, "value": s.value, "description": s.description}, "message": "ok"}
