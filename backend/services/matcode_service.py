"""物料编码业务：查重、建议下一号、发放、编辑/停用作废、搜索。

并发正确性：suggest = MAX(suffix)+1 只是建议号；真正的兜底是 code 唯一索引。
插入遇 IntegrityError → rollback → 重算 max+1 重试（有限 5 次）。人工改号同样走 INSERT，
号码被占用即唯一冲突。

查重规则：
- 精确命中（同 name+spec，status∈active/stopped）：
    · 管理员（role=admin 或权限含 admin）带 force_duplicate=True → 放行（仍取新空号）
    · 其余发码人 → 拒绝落库，返回 require_confirm(admin_required=True)
- 仅相似命中 → 提示不拦截。
作废( void )行不参与查重、号码也不回填。
"""

from __future__ import annotations

import re
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError

from backend.database import to_iso_str
from backend.models.matcode import MatcodeMaterial, MatcodeSegment
from backend.services import matcode_catalog as catalog

# 参与查重/占用计数的状态（作废行除外）
_DUP_STATUSES = ("active", "stopped")


# ────────────────────────── 工具 ──────────────────────────

def _norm(s: Optional[str]) -> str:
    if not s:
        return ""
    return re.sub(r"\s+", "", str(s)).strip().lower()


# 名称形如 "PE0141-1326UA…" / "PE0375…" 的 PE+数字 即项目编号；EPE4751 等整词不计
_PROJECT_RE = re.compile(r"(?:^|[^A-Za-z0-9])(PE\d{3,4})", re.IGNORECASE)


def extract_project_from_name(name: Optional[str]) -> Optional[str]:
    """从物料名称中提取项目编号（PE 后 3~4 位，前后不得连着字母数字）。"""
    if not name:
        return None
    m = _PROJECT_RE.search(str(name))
    return m.group(1).upper() if m else None


def material_to_dict(db, m: MatcodeMaterial) -> dict:
    seg = m.segment or db.query(MatcodeSegment).filter(MatcodeSegment.id == m.segment_id).first()
    return {
        "id": m.id,
        "code": m.code,
        "name": m.name,
        "spec": m.spec,
        "manufacturer": m.manufacturer,
        "drawing": m.drawing,
        "project": m.project,
        "unit": m.unit,
        "remark": m.remark,
        "status": m.status,
        "legacy_prefix": m.legacy_prefix,
        "segment_id": m.segment_id,
        "segment_key": seg.key if seg else None,
        "segment_label": seg.label if seg else None,
        "prefix": seg.prefix if seg else None,
        "created_by": m.created_by,
        "source": m.source,
        "created_at": to_iso_str(m.created_at),
        "updated_at": to_iso_str(m.updated_at),
    }


def _find_material(db, material_id: int) -> MatcodeMaterial:
    m = db.query(MatcodeMaterial).filter(MatcodeMaterial.id == material_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="物料编码记录不存在")
    return m


def _get_issuable(db, segment_key: str) -> MatcodeSegment:
    seg = catalog.get_segment(db, segment_key)
    if not seg:
        raise HTTPException(status_code=404, detail=f"编码段 {segment_key} 不存在")
    if seg.is_group or seg.closed or not seg.issueable:
        raise HTTPException(status_code=400, detail=f"编码段「{seg.label}」不可发放")
    return seg


def _capacity(seg: MatcodeSegment) -> int:
    """段内序号上限（含），如 4 位 → 9999；3 位 → 999。序号从 1 起。"""
    return 10 ** seg.suffix_width - 1


def _segment_full(db, seg: MatcodeSegment) -> bool:
    return catalog.max_suffix_of_segment(db, seg) >= _capacity(seg)


# ────────────────────────── 查重 ──────────────────────────

def dup_candidates(db, name: str, spec: Optional[str] = None, limit: int = 8):
    """精确 + 相似候选（返回非 void 行）。"""
    name = _norm(name)
    spec = _norm(spec)
    if not name:
        return {"exact": [], "similar": []}
    rows = (
        db.query(MatcodeMaterial)
        .filter(MatcodeMaterial.status.in_(_DUP_STATUSES))
        .all()
    )
    exact, similar = [], []
    for m in rows:
        mname = _norm(m.name)
        mspec = _norm(m.spec)
        if mname == name and mspec == spec:
            exact.append(material_to_dict(db, m))
        elif mname == name and not spec:  # 同名无规格可比 → 视为精确（一物一码）
            exact.append(material_to_dict(db, m))
        elif mname and (name in mname or mname in name):
            similar.append(material_to_dict(db, m))
    # 相似太多只给前几条提示
    return {
        "exact": exact[:limit],
        "similar": similar[:limit],
        "exact_count": len(exact),
        "similar_count": len(similar),
    }


def has_exact_dup(db, name: str, spec: Optional[str]) -> bool:
    return dup_candidates(db, name, spec)["exact_count"] > 0


# ────────────────────────── 建议号 ──────────────────────────

def preview_next(db, segment_key: str, name: str, spec: Optional[str] = None,
                 with_drawing: bool = False) -> dict:
    """只读预览：建议码 + 联号图号 + 查重。不落库。"""
    seg = _get_issuable(db, segment_key)
    if _segment_full(db, seg):
        raise HTTPException(status_code=409, detail=f"编码段「{seg.label}」已用满，无可用号码")
    next_suffix = catalog.max_suffix_of_segment(db, seg) + 1
    code = catalog.code_from_suffix(seg, next_suffix)
    dup = dup_candidates(db, name, spec)
    return {
        "segment_key": seg.key,
        "segment_label": seg.label,
        "code": code,
        "suffix": next_suffix,
        "drawing": catalog.drawing_from_suffix(seg, next_suffix) if with_drawing else None,
        "dup": dup,
        "segment_full": False,
    }


# ────────────────────────── 发放 ──────────────────────────

def _build_issue_record(db, seg: MatcodeSegment, *, code: str, suffix: int,
                        name: str, spec, manufacturer, drawing, project, unit, remark,
                        source: str, created_by: str, legacy_prefix: Optional[str] = None):
    return MatcodeMaterial(
        code=code,
        segment_id=seg.id,
        legacy_prefix=legacy_prefix,
        name=name,
        spec=spec or None,
        manufacturer=manufacturer or None,
        drawing=drawing or None,
        project=project or None,
        unit=unit or None,
        remark=remark or None,
        source=source,
        status="active",
        suffix=suffix,
        created_by=created_by,
    )


def issue_single(db, user, *, segment_key: str, name: str, spec=None, manufacturer=None,
                 drawing=None, project=None, unit=None, remark=None,
                 override_code: Optional[str] = None, force_duplicate: bool = False,
                 admin: bool = False, source: Optional[str] = None, auto_drawing: bool = False):
    """单发一条。返回 dict（material）或 require_confirm 结构。

    返回 {"action": "issued", "material": {...}} 表示成功；
    返回 {"action": "require_confirm", "candidates":[...], "admin_required": True} 表示需管理员特批。
    """
    seg = _get_issuable(db, segment_key)
    is_admin = admin or catalog.is_admin_user(user)

    # 名称含 PE 项目号且未显式给项目 → 自动提取记录
    if not project:
        project = extract_project_from_name(name)

    # 人工改号仅管理员
    if override_code and not is_admin:
        raise HTTPException(status_code=403, detail="改号仅系统管理员可操作")

    # 查重：精确命中需管理员特批
    dup = dup_candidates(db, name, spec)
    if dup["exact_count"] > 0 and not (is_admin and force_duplicate):
        return {
            "action": "require_confirm",
            "candidates": dup["exact"],
            "admin_required": True,
        }

    # 确定码 + 序号
    if override_code:
        code = override_code
        if not re.fullmatch(r"\d{8}", code):
            raise HTTPException(status_code=400, detail="料号必须为 8 位数字")
        if not code.startswith(seg.prefix):
            raise HTTPException(status_code=400, detail=f"料号 {code} 不属于编码段「{seg.label}」({seg.prefix})")
        suffix = int(code[len(seg.prefix):])
        if suffix < 1 or suffix > _capacity(seg):
            raise HTTPException(status_code=400, detail=f"料号序号超出段容量（1~{_capacity(seg)}）")
    else:
        if _segment_full(db, seg):
            raise HTTPException(status_code=409, detail=f"编码段「{seg.label}」已用满，无可用号码")
        suffix = catalog.max_suffix_of_segment(db, seg) + 1
        code = catalog.code_from_suffix(seg, suffix)

    # 联号图号：仅勾选「随编码自动联号」(auto_drawing) 且未显式给图号时按段规则取号；
    # 默认不生成图号（用户可手动填写 drawing）
    if auto_drawing and not drawing:
        drawing = catalog.drawing_from_suffix(seg, suffix)

    source = source or f"manual:{user.username if user else '?'}"
    m = _build_issue_record(
        db, seg, code=code, suffix=suffix, name=name, spec=spec, manufacturer=manufacturer,
        drawing=drawing, project=project, unit=unit, remark=remark, source=source,
        created_by=user.username if user else "system",
        legacy_prefix="11723" if seg.key == "legacy11723" else None,
    )
    # 唯一冲突兜底：重算后重试（并发下两个请求取到同一 max+1）
    for attempt in range(5):
        db.add(m)
        try:
            db.commit()
            db.refresh(m)
            return {"action": "issued", "material": material_to_dict(db, m)}
        except IntegrityError:
            db.rollback()
            if override_code:
                raise HTTPException(status_code=409, detail=f"料号 {code} 已被占用")
            suffix = catalog.max_suffix_of_segment(db, seg) + 1
            code = catalog.code_from_suffix(seg, suffix)
            if auto_drawing and not drawing:
                drawing = catalog.drawing_from_suffix(seg, suffix)
            m = _build_issue_record(
                db, seg, code=code, suffix=suffix, name=name, spec=spec, manufacturer=manufacturer,
                drawing=drawing, project=project, unit=unit, remark=remark, source=source,
                created_by=user.username if user else "system",
                legacy_prefix="11723" if seg.key == "legacy11723" else None,
            )
    raise HTTPException(status_code=409, detail="发放冲突，请重试")


# ────────────────────────── 编辑 / 状态 / 段冻结 ──────────────────────────

def update_material(db, user, material_id: int, *, name=None, spec=None, manufacturer=None,
                    drawing=None, project=None, unit=None, remark=None):
    """编辑描述字段；code/segment 不可改（护编码不变量）。drawing 可改/可生成，需全局不重复。"""
    m = _find_material(db, material_id)
    if name is not None and not (name or "").strip():
        raise HTTPException(status_code=400, detail="物料名称不能为空")
    changes = []
    # 图号：显式传参才改；同值跳过；非空需全局唯一（排除自身），空串=清除
    if drawing is not None:
        d = (drawing or "").strip()
        if d:
            clash = (
                db.query(MatcodeMaterial)
                .filter(MatcodeMaterial.drawing == d, MatcodeMaterial.id != material_id)
                .first()
            )
            if clash:
                raise HTTPException(status_code=409,
                                    detail=f"图号 {d} 已被料号 {clash.code} 使用")
        old, new = m.drawing, d or None
        if (old or "") != (new or ""):
            m.drawing = new
            changes.append(f"drawing:{old!r}->{new!r}")
    for field, val in (("name", name), ("spec", spec), ("manufacturer", manufacturer),
                       ("project", project), ("unit", unit), ("remark", remark)):
        if val is None:
            continue
        old = getattr(m, field)
        if str(old or "") != str(val or ""):
            setattr(m, field, val or None)
            changes.append(f"{field}:{old!r}->{val!r}")
    # 项目被清空/未填但名称含 PE 项目号 → 自动补（与发码规则一致）
    if not (m.project or "").strip():
        derived = extract_project_from_name(name if name is not None else m.name)
        if derived:
            m.project = derived
            changes.append(f"project:None->{derived!r}")
    if changes:
        db.commit()
        db.refresh(m)
    return m, changes


def set_material_status(db, user, material_id: int, status: str):
    if status not in ("active", "stopped", "void"):
        raise HTTPException(status_code=400, detail="状态仅支持 active/stopped/void")
    m = _find_material(db, material_id)
    old = m.status
    m.status = status
    db.commit()
    db.refresh(m)
    return m, old


def set_segment_closed(db, user, segment_key: str, closed: bool):
    seg = catalog.get_segment(db, segment_key)
    if not seg:
        raise HTTPException(status_code=404, detail=f"编码段 {segment_key} 不存在")
    old = seg.closed
    seg.closed = 1 if closed else 0
    db.commit()
    db.refresh(seg)
    return seg, old
