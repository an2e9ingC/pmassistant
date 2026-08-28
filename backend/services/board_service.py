"""Board (板卡) lifecycle service.

Status catalog + per-status form schema are centralized here (data-driven):
the frontend renders the manual-switch dialog dynamically from this config, and
event fields are stored generically in DeliveryBoardEvent.data JSON — so future
statuses can be added (e.g. via 模板管理>项目模板配置状态) without schema changes.

Repair statuses (维修中/已维修) are NOT manual-switch targets: they are reached
only through 维修 (repair) Bugs via repair_start/repair_finish.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from sqlalchemy.orm import Session

from backend.config import to_iso_str
from backend.middleware.auth import has_perm
from backend.models.delivery import DeliveryBoard, DeliveryBoardEvent
from backend.models.zentao import CachedProject  # noqa: F401 — 确保 FK 目标表在 metadata 中

# ─────────────────────────── 状态目录（可扩展） ───────────────────────────
# 全量状态目录：含维修中/已维修（Bug 驱动，非手动目标）
BOARD_STATUSES = [
    "在库", "生产中", "研发调试", "硬件上电", "测试", "三防", "装配",
    "已交付", "维修中", "已维修", "已报废",
]
BOARD_REPAIR_STATUSES = {"维修中", "已维修"}  # 仅 Bug 到达
_PRODUCTION_STATUSES = {"生产中", "研发调试", "硬件上电", "测试", "三防", "装配"}
_MANUAL_TARGETS = [s for s in BOARD_STATUSES if s not in BOARD_REPAIR_STATUSES]

# 手动切换弹窗：每目标状态字段 schema（key/label/type/required）
# type: date=日期 | text=文本框 | textarea=多行 | select=下拉 | user_select=PMA 用户下拉
# 特殊 key：event_time→event_time 列；operator→actor 列；note→note 列；其余→data JSON
_PROD_FIELDS = [
    {"key": "event_time", "label": "操作时间", "type": "date", "required": True},
    {"key": "operator", "label": "操作人", "type": "user_select", "required": True},
    {"key": "to_holder", "label": "转交给谁", "type": "user_select", "required": True},
    {"key": "note", "label": "说明", "type": "textarea", "required": False},
]

BOARD_STATUS_SCHEMA = {
    "生产中": _PROD_FIELDS,
    "研发调试": _PROD_FIELDS,
    "硬件上电": _PROD_FIELDS,
    "测试": _PROD_FIELDS,
    "三防": _PROD_FIELDS,
    "装配": _PROD_FIELDS,
    "已交付": [
        {"key": "event_time", "label": "交付时间", "type": "date", "required": True},
        {"key": "delivery_method", "label": "交付方式", "type": "select", "required": True, "options": ["快递", "人工携带"]},
        {"key": "receiver", "label": "收货方", "type": "text", "required": True},
        {"key": "responsible_person", "label": "交付责任人", "type": "user_select", "required": True},
    ],
    "在库": [
        {"key": "event_time", "label": "操作时间", "type": "date", "required": True},
        {"key": "operator", "label": "操作人", "type": "user_select", "required": True},
        {"key": "owner", "label": "归属人", "type": "user_select", "required": True},
        {"key": "note", "label": "说明", "type": "textarea", "required": False},
    ],
    "已报废": [
        {"key": "event_time", "label": "报废时间", "type": "date", "required": True},
        {"key": "operator", "label": "操作人", "type": "user_select", "required": True},
        {"key": "scrap_reason", "label": "报废原因", "type": "textarea", "required": True},
        {"key": "scrap_method", "label": "报废处理方法", "type": "textarea", "required": True},
        {"key": "owner", "label": "归属人", "type": "user_select", "required": True},
    ],
}

# 这些 key 不进入 data JSON，直接映射到事件列
_COLUMN_KEYS = {"event_time", "operator", "note"}

# 批量录入上限
BATCH_LIMIT = 50


def _clean_str(val) -> str:
    """Legacy delivery records may store junk like '[object Object]' — normalize."""
    if not val:
        return ""
    s = str(val).strip()
    if s == "[object Object]":
        return ""
    return s


# ─────────────────────────── 配置 / 元数据 ───────────────────────────

def board_meta() -> dict:
    """Status catalog + manual-switch schema — for dynamic frontend rendering."""
    return {
        "statuses": BOARD_STATUSES,
        "manual_targets": _MANUAL_TARGETS,
        "schema": {s: f for s, f in BOARD_STATUS_SCHEMA.items()},
        "repair_statuses": sorted(BOARD_REPAIR_STATUSES),
    }


def _user_display(db: Session, username: Optional[str]) -> str:
    """Resolve username → display_name (fallback username)."""
    if not username:
        return ""
    from backend.models.local import LocalUser
    u = db.query(LocalUser).filter(LocalUser.username == username).first()
    return (u.display_name or u.username) if u else username


def _can_manage(user, board: DeliveryBoard) -> bool:
    """仅板卡归属人本人或具 project_edit 者可操作状态切换/编辑。"""
    if board.owner and user.username == board.owner:
        return True
    return has_perm(user, "project_edit")


# ─────────────────────────── 序列化 ───────────────────────────

def board_dict(b: DeliveryBoard) -> dict:
    return {
        "id": b.id,
        "project_id": b.project_id,
        "serial_no": b.serial_no,
        "product_code": b.product_code,
        "product_name": b.product_name,
        "status": b.status,
        "prev_status": getattr(b, "prev_status", None),
        "prev_owner": getattr(b, "prev_owner", None),
        "owner": b.owner,
        "current_holder": b.current_holder,
        "note": b.note,
        "created_by": b.created_by,
        "created_at": to_iso_str(b.created_at),
        "updated_at": to_iso_str(b.updated_at),
    }


# 事件 data 中记录"责任归属人"的字段（按优先级），用于上一状态责任人展示
# 手动切换事件存英文键（to_holder/owner/responsible_person），维修 Bug 事件存中文键，两者都覆盖
_PREV_OWNER_KEYS = ("转交给谁", "to_holder", "交付责任人", "responsible_person",
                    "归属人", "owner", "返修处理人", "责任人", "报修人")


def _event_responsible(e: DeliveryBoardEvent) -> Optional[str]:
    data = e.data or {}
    for k in _PREV_OWNER_KEYS:
        if data.get(k):
            return data[k]
    return None


def attach_prev_status(db: Session, boards: list[DeliveryBoard]) -> None:
    """为每个板卡附加 prev_status/prev_owner（供表格"上一状态"列展示）：
    上一状态 = 板卡进入当前状态那条事件的 from_status（对异常时间序也稳健）；
    上一状态责任人 = 板卡进入该上一状态的那条事件记录的责任归属人（username）。"""
    if not boards:
        return
    ids = [b.id for b in boards]
    evs = (db.query(DeliveryBoardEvent)
             .filter(DeliveryBoardEvent.board_id.in_(ids))
             .order_by(DeliveryBoardEvent.board_id.asc(),
                       DeliveryBoardEvent.id.asc())  # 按插入顺序=真实时序（event_time 可能 date-only 午夜导致乱序）
             .all())
    by_board: dict[int, list] = {}
    for e in evs:
        by_board.setdefault(e.board_id, []).append(e)
    for b in boards:
        ev_list = by_board.get(b.id) or []
        prev_status, prev_owner = None, None
        # 找到进入当前状态的事件 → 其 from_status 即上一状态
        enter_event = None
        for e in ev_list:
            if e.to_status == b.status:
                enter_event = e
        if enter_event and enter_event.from_status:
            prev_status = enter_event.from_status
            # 上一状态责任人 = 板卡进入该上一状态的事件记录的责任归属人
            for e in reversed(ev_list):
                if e.to_status == prev_status:
                    prev_owner = _event_responsible(e)
                    break
        b.prev_status = prev_status
        b.prev_owner = prev_owner


def boards_with_prev(db: Session, boards: list[DeliveryBoard]) -> list[dict]:
    attach_prev_status(db, boards)
    return [board_dict(b) for b in boards]


def event_dict(e: DeliveryBoardEvent) -> dict:
    return {
        "id": e.id,
        "board_id": e.board_id,
        "from_status": e.from_status,
        "to_status": e.to_status,
        "event_time": to_iso_str(e.event_time),
        "actor": e.actor,
        "note": e.note,
        "data": e.data or {},
        "delivery_record_id": e.delivery_record_id,
        "bug_id": e.bug_id,
        "created_by": e.created_by,
        "created_at": to_iso_str(e.created_at),
    }


def _parse_event_time(val) -> datetime:
    if val:
        if isinstance(val, str):
            val = val.strip()
            if val:
                try:
                    if "T" in val:
                        return datetime.fromisoformat(val[:19])
                    return datetime.fromisoformat(val[:10] + "T00:00:00")
                except ValueError:
                    pass
        elif isinstance(val, date):
            return datetime(val.year, val.month, val.day)
    return datetime.utcnow()  # naive UTC


# ─────────────────────────── 建档 / 查询 ───────────────────────────

def _get_board(db: Session, board_id: int) -> Optional[DeliveryBoard]:
    return db.query(DeliveryBoard).filter(DeliveryBoard.id == board_id).first()


def _board_exists(db: Session, project_id: int, serial_no: str) -> bool:
    return db.query(DeliveryBoard).filter(
        DeliveryBoard.project_id == project_id,
        DeliveryBoard.serial_no == serial_no,
    ).first() is not None


def create_board(db: Session, project_id: int, serial_no: str, product_code: str = "",
                 product_name: str = "", note: str = "", creator: str = "") -> DeliveryBoard:
    """建档单块板卡：owner=录入者，状态=在库，自动写建档事件。冲突→ValueError。"""
    serial_no = (serial_no or "").strip()
    if not serial_no:
        raise ValueError("产品编号不能为空")
    if _board_exists(db, project_id, serial_no):
        raise ValueError("产品编号已存在")
    board = DeliveryBoard(
        project_id=project_id,
        serial_no=serial_no,
        product_code=product_code or "",
        product_name=product_name or "",
        status="在库",
        owner=creator or None,
        current_holder=None,
        note=note or "",
        created_by=creator or None,
    )
    db.add(board)
    db.flush()
    db.add(DeliveryBoardEvent(
        board_id=board.id,
        from_status=None,
        to_status="在库",
        actor=creator,
        note="建档",
        created_by=creator,
    ))
    db.commit()
    db.refresh(board)
    return board


def create_boards_batch(db: Session, project_id: int, serial_numbers: list[str],
                        product_code: str = "", product_name: str = "",
                        creator: str = "") -> dict:
    """批量建档：上限 BATCH_LIMIT，逐个去重，汇报 created/duplicated。"""
    seen = []
    for sn in serial_numbers:
        sn = (sn or "").strip()
        if sn and sn not in seen:
            seen.append(sn)
    if len(seen) > BATCH_LIMIT:
        raise ValueError(f"单次批量录入不能超过 {BATCH_LIMIT} 块")
    created, duplicated = [], []
    for sn in seen:
        if _board_exists(db, project_id, sn):
            duplicated.append(sn)
            continue
        created.append(create_board(db, project_id, sn, product_code, product_name, "", creator))
    return {"created": [board_dict(b) for b in created], "duplicated": duplicated}


def list_boards(db: Session, project_id: int) -> list[DeliveryBoard]:
    return db.query(DeliveryBoard).filter(
        DeliveryBoard.project_id == project_id
    ).order_by(DeliveryBoard.serial_no.asc()).all()


def update_board(db: Session, board_id: int, data: dict, user) -> Optional[DeliveryBoard]:
    """编辑基本信息（不含 status）。仅归属人本人或 project_edit。"""
    board = _get_board(db, board_id)
    if not board:
        return None
    if not _can_manage(user, board):
        raise PermissionError("仅板卡归属人或项目管理者可操作")
    serial_no = (data.get("serial_no") or "").strip()
    if serial_no and serial_no != board.serial_no:
        if _board_exists(db, board.project_id, serial_no):
            raise ValueError("产品编号已存在")
        board.serial_no = serial_no
    for field in ("product_code", "product_name", "note"):
        if field in data and data[field] is not None:
            setattr(board, field, data[field])
    db.commit()
    db.refresh(board)
    return board


def delete_board(db: Session, board_id: int) -> bool:
    board = _get_board(db, board_id)
    if not board:
        return False
    db.delete(board)  # 事件级联删除
    db.commit()
    return True


def board_timeline(db: Session, board_id: int, order: str = "asc") -> list[DeliveryBoardEvent]:
    q = db.query(DeliveryBoardEvent).filter(DeliveryBoardEvent.board_id == board_id)
    # 按插入顺序（id）排列=真实时序：event_time 可能因 date-only 录入存成午夜 UTC 导致乱序
    q = q.order_by(DeliveryBoardEvent.id.asc() if order != "desc"
                   else DeliveryBoardEvent.id.desc())
    return q.all()


# ─────────────────────────── 手动状态切换 ───────────────────────────

def _validate_required(schema: list, data: dict) -> None:
    for f in schema:
        if f.get("required"):
            key = f["key"]
            val = data.get(key)
            if val is None or (isinstance(val, str) and not val.strip()):
                raise ValueError(f"{f['label']}为必填项")


def switch_status(db: Session, board_id: int, to_status: str, data: dict, user):
    """手动状态切换：目标=目录内、≠当前、非维修中/已维修；当前非维修中。
    按目标 schema 校验必填 → 写事件 → 更新 status/current_holder/owner。
    返回 board；None=板卡不存在。"""
    board = _get_board(db, board_id)
    if not board:
        return None
    if not _can_manage(user, board):
        raise PermissionError("仅板卡归属人或项目管理者可操作")
    if to_status not in BOARD_STATUSES:
        raise ValueError("未知状态")
    if to_status in BOARD_REPAIR_STATUSES:
        raise ValueError("维修状态需通过维修 Bug 流转")
    if board.status == "维修中":
        raise ValueError("维修中的板卡需通过维修 Bug 解决后流转")

    schema = BOARD_STATUS_SCHEMA.get(to_status, [])
    _validate_required(schema, data)

    # 归属人 / 当前持有人 流转规则
    owner, holder = None, None
    if to_status in _PRODUCTION_STATUSES:
        owner = data.get("to_holder") or None
        holder = owner
    elif to_status == "已交付":
        owner = data.get("responsible_person") or None
        holder = data.get("receiver") or None
    elif to_status in ("在库", "已报废"):
        owner = data.get("owner") or None
        holder = owner or None

    # 同状态切换仅用于归属人变更（如生产阶段内转交）；状态+归属人均未变化视为无效操作
    if to_status == board.status and owner == board.owner:
        raise ValueError("目标状态与归属人均未变化，无需切换")

    event_data = {k: v for k, v in data.items() if k not in _COLUMN_KEYS and v is not None}
    db.add(DeliveryBoardEvent(
        board_id=board.id,
        from_status=board.status,
        to_status=to_status,
        event_time=_parse_event_time(data.get("event_time")),
        actor=data.get("operator") or user.username,
        note=data.get("note") or "",
        data=event_data,
        created_by=user.username,
    ))
    board.status = to_status
    board.owner = owner
    board.current_holder = holder
    db.commit()
    db.refresh(board)
    return board


# ─────────────────────────── 维修 Bug 联动（系统动作） ───────────────────────────

def _resolve_assignee(db: Session, bug) -> tuple[Optional[str], str]:
    """返回 (assignee_username, assignee_display_name)，缺省→Bug 创建人。"""
    from backend.models.local import LocalUser
    uid = bug.assignee_id or bug.reporter_id
    u = db.query(LocalUser).filter(LocalUser.id == uid).first() if uid else None
    if u:
        return u.username, (u.display_name or u.username)
    return None, ""


def repair_start(db: Session, board_id: int, bug, reporter_name: str) -> Optional[DeliveryBoardEvent]:
    """创建维修 Bug 时：板卡→维修中，owner=Bug 责任人（缺省创建人），写事件（含 bug_id）。
    绕过 _can_manage（系统联动）。已维修中仅补事件（多个 Bug 可关联同一板卡）。"""
    board = _get_board(db, board_id)
    if not board:
        return None
    prev = board.status
    owner_username, owner_display = _resolve_assignee(db, bug)
    if owner_username:
        board.owner = owner_username
    board.current_holder = owner_display
    board.status = "维修中"
    event = DeliveryBoardEvent(
        board_id=board.id,
        from_status=prev,
        to_status="维修中",
        actor=reporter_name or "",
        note=(bug.description or "")[:500],
        data={
            "报修人": reporter_name or "",
            "责任人": owner_display,
            "问题原因": (bug.description or ""),
            "bug_title": bug.title,
        },
        bug_id=bug.id,
        created_by=reporter_name or "system",
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def repair_finish(db: Session, board_id: int, bug, actor_name: str) -> Optional[DeliveryBoardEvent]:
    """维修 Bug 解决/关闭时：维修中→已维修（owner 保持），写事件（含 bug_id）。"""
    board = _get_board(db, board_id)
    if not board or board.status != "维修中":
        return None
    from backend.models.local import LocalUser
    resolver = db.query(LocalUser).filter(LocalUser.id == bug.resolved_by_id).first() if bug.resolved_by_id else None
    resolver_display = (resolver.display_name or resolver.username) if resolver else ""
    if not resolver_display:
        _, resolver_display = _resolve_assignee(db, bug)
    board.status = "已维修"
    event = DeliveryBoardEvent(
        board_id=board.id,
        from_status="维修中",
        to_status="已维修",
        actor=actor_name or resolver_display,
        data={
            "返修处理人": resolver_display,
            "返修结果": bug.resolution or "",
            "bug_title": bug.title,
        },
        bug_id=bug.id,
        created_by=actor_name or "system",
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


# ─────────────────────────── 交付记录联动 ───────────────────────────

def sync_delivery_record(db: Session, project_id: int, record, material_codes: list[str],
                         actor: str = "") -> list[DeliveryBoard]:
    """交付记录联动：对每个物料编码建档（无则建档→已交付）+ 写交付事件。
    幂等：已有该记录交付事件的板卡跳过。owner=交付责任人。"""
    boards = []
    receiver = _clean_str(record.receiver)
    responsible = _clean_str(record.responsible_person)
    for mc in material_codes:
        mc = (mc or "").strip()
        if not mc:
            continue
        board = db.query(DeliveryBoard).filter(
            DeliveryBoard.project_id == project_id,
            DeliveryBoard.serial_no == mc,
        ).first()
        if not board:
            board = DeliveryBoard(
                project_id=project_id,
                serial_no=mc,
                product_code=record.product_code or "",
                product_name=record.product_name or "",
                status="在库",
                owner=responsible or None,
                created_by=actor or "system",
            )
            db.add(board)
            db.flush()
            db.add(DeliveryBoardEvent(
                board_id=board.id, from_status=None, to_status="在库",
                actor=actor, note="交付记录自动建档", created_by=actor or "system",
            ))
        # 幂等：同一交付记录已写事件则跳过
        dup = db.query(DeliveryBoardEvent).filter(
            DeliveryBoardEvent.board_id == board.id,
            DeliveryBoardEvent.delivery_record_id == record.id,
        ).first()
        if dup:
            boards.append(board)
            continue
        db.add(DeliveryBoardEvent(
            board_id=board.id,
            from_status=board.status,
            to_status="已交付",
            event_time=record.delivery_date or datetime.utcnow(),
            actor=actor,
            note=f"交付:{record.product_name} x{record.quantity}",
            data={
                "delivery_method": _clean_str(record.delivery_method),
                "receiver": receiver,
                "responsible_person": responsible,
            },
            delivery_record_id=record.id,
            created_by=actor or "system",
        ))
        board.status = "已交付"
        board.owner = responsible or board.owner
        board.current_holder = receiver
        boards.append(board)
    db.commit()
    for b in boards:
        db.refresh(b)
    return boards


def remove_delivery_events(db: Session, record_id: int) -> None:
    """删除交付记录时回滚：删除该记录关联的交付事件；板卡若无剩余交付事件→回退在库。
    owner 不自动还原。"""
    events = db.query(DeliveryBoardEvent).filter(
        DeliveryBoardEvent.delivery_record_id == record_id
    ).all()
    affected_ids = {e.board_id for e in events}
    for e in events:
        db.delete(e)
    db.flush()
    for bid in affected_ids:
        board = _get_board(db, bid)
        if not board:
            continue
        remaining_delivery = db.query(DeliveryBoardEvent).filter(
            DeliveryBoardEvent.board_id == bid,
            DeliveryBoardEvent.delivery_record_id.isnot(None),
        ).first()
        if not remaining_delivery:
            board.status = "在库"
            board.current_holder = None
    db.commit()
