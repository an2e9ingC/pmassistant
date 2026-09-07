"""Board (板卡) lifecycle service.

Status catalog + per-status form schema are centralized here (data-driven):
the frontend renders the manual-switch dialog dynamically from this config, and
event fields are stored generically in DeliveryBoardEvent.data JSON — so future
statuses can be added (e.g. via 模板管理>项目模板配置状态) without schema changes.

Repair statuses (维修中/已维修) are NOT manual-switch targets: they are reached
only through 维修 (repair) Bugs via repair_start/repair_finish.
"""
from __future__ import annotations

from datetime import date, datetime, time
from typing import Optional

from sqlalchemy.orm import Session

from backend.config import to_iso_str, BEIJING_OFFSET
from backend.middleware.auth import has_perm
from backend.models.delivery import DeliveryBoard, DeliveryBoardEvent
from backend.models.zentao import CachedProject  # noqa: F401 — 确保 FK 目标表在 metadata 中

# ─────────────────────────── 状态目录（可扩展） ───────────────────────────
# 全量状态目录：含维修中/已维修（Bug 驱动，非手动目标）
BOARD_STATUSES = [
    "在库", "生产中", "硬件上电", "研发调试", "客户联调", "测试", "三防", "装配",
    "维修中", "已维修", "已报废", "已交付",
]
BOARD_REPAIR_STATUSES = {"维修中", "已维修"}  # 仅 Bug 到达
_PRODUCTION_STATUSES = {"生产中", "硬件上电", "研发调试", "客户联调", "测试", "三防", "装配"}
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
    "硬件上电": _PROD_FIELDS,
    "研发调试": _PROD_FIELDS,
    "客户联调": _PROD_FIELDS,
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
    evs = db.query(DeliveryBoardEvent).filter(
        DeliveryBoardEvent.board_id.in_(ids)
    ).all()
    by_board: dict[int, list] = {}
    for e in evs:
        by_board.setdefault(e.board_id, []).append(e)
    for b in boards:
        # 业务时间线排序（先业务日期、同日按插入 id）——补录/反填日期的事件正确归位
        ev_list = sorted(by_board.get(b.id) or [], key=_event_sort_key)
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


def board_overview(db: Session) -> dict:
    """跨所有项目的板卡总览（总览页数据源）：行=每块板卡(附项目代号/名称)，
    附交付口径汇总。只读聚合，不改写任何数据。
    交付口径与 delivery_service 一致：已交付 ∪ 已维修 计入已交付。"""
    boards = (db.query(DeliveryBoard)
              .order_by(DeliveryBoard.project_id,
                        DeliveryBoard.product_code,
                        DeliveryBoard.serial_no)
              .all())
    if not boards:
        return {
            "summary": {"total": 0, "delivered": 0,
                        "by_status": {s: 0 for s in BOARD_STATUSES}},
            "boards": [],
            "meta": board_meta(),
        }
    ids = {b.project_id for b in boards}
    from backend.models.zentao import CachedProject  # 局部 import 防循环
    pmap = {p.id: p for p in db.query(CachedProject)
            .filter(CachedProject.id.in_(ids)).all()}
    attach_prev_status(db, boards)  # 每行回填 prev_status/prev_owner
    rows = []
    for b in boards:
        d = board_dict(b)
        p = pmap.get(b.project_id)
        d["project_code"] = p.code if p else ""
        d["project_name"] = p.name if p else ""
        rows.append(d)
    from collections import Counter
    by_status = Counter(b.status for b in boards)
    summary = {
        "total": len(boards),
        "delivered": by_status.get("已交付", 0) + by_status.get("已维修", 0),
        "by_status": {s: by_status.get(s, 0) for s in BOARD_STATUSES},
    }
    return {"summary": summary, "boards": rows, "meta": board_meta()}


def update_board(db: Session, board_id: int, data: dict, user) -> Optional[DeliveryBoard]:
    """编辑基本信息（不含 status）。需具板卡管理权限（admin/board_manage）。"""
    board = _get_board(db, board_id)
    if not board:
        return None
    if not has_perm(user, "board_manage"):
        raise PermissionError("编辑板卡需板卡管理权限")
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


def _event_sort_key(e: DeliveryBoardEvent):
    """事件排序键：先按业务日期（event_time 的日期部分）、同日再按插入 id。

    event_time 语义 = 业务发生时间（交付事件取 delivery_date、维修/建档取真实时刻），
    故跨天按业务日期排序让补录/反填日期的交付事件正确归位，不再被"晚录入→新 id"顶到最前；
    date-only 事件存成午夜、与同日真实时刻歧义，同日内退回插入序（id）避免乱序。"""
    t = e.event_time or e.created_at
    return (t.date() if t else date.min, e.id)


def board_timeline(db: Session, board_id: int, order: str = "asc") -> list[DeliveryBoardEvent]:
    """板卡时间线 = 业务时间线（事件按业务日期+插入序排列）。"""
    events = db.query(DeliveryBoardEvent).filter(
        DeliveryBoardEvent.board_id == board_id
    ).all()
    events.sort(key=_event_sort_key, reverse=(order != "asc"))
    return events


def latest_event(db: Session, board_id: int) -> Optional[DeliveryBoardEvent]:
    """业务时间线上的最新事件（决定板卡当前状态）。无事件返回 None。"""
    events = db.query(DeliveryBoardEvent).filter(
        DeliveryBoardEvent.board_id == board_id
    ).all()
    if not events:
        return None
    return max(events, key=_event_sort_key)


def refresh_board_state(db: Session, board_id: int) -> None:
    """板卡当前状态对齐到业务时间线最新事件（交付记录反填日期/删除后重算）。
    只重算状态，不动归属/持有人（避免历史 display/username 语义漂移）。"""
    board = _get_board(db, board_id)
    if not board:
        return
    latest = latest_event(db, board_id)
    if latest is None:
        board.status = "在库"
    else:
        board.status = latest.to_status
    db.commit()


# ─────────────────────────── 手动状态切换 ───────────────────────────

def _validate_required(schema: list, data: dict) -> None:
    for f in schema:
        if f.get("required"):
            key = f["key"]
            val = data.get(key)
            if val is None or (isinstance(val, str) and not val.strip()):
                raise ValueError(f"{f['label']}为必填项")


def switch_status(db: Session, board_id: int, to_status: str, data: dict, user):
    """手动状态切换：所有登录用户可操作（权限开放）。目标=目录内、≠当前、
    非维修中/已维修；当前非维修中（维修中仅经维修 Bug 流转）。
    按目标 schema 校验必填 → 写事件 → 更新 status/current_holder/owner。
    返回 board；None=板卡不存在。"""
    board = _get_board(db, board_id)
    if not board:
        return None
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
    系统联动，无需板卡管理权限。已维修中仅补事件（多个 Bug 可关联同一板卡）。"""
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
    """维修 Bug 解决/关闭时：维修中→已维修，写事件（含 bug_id）。

    归属人随 Bug 责任人流转：无论 Bug 是否中途转派，结束维修时把归属/持有人
    收敛为 Bug 现任责任人（username→owner，display→持有人），保证交付状态
    中的人员与 Bug 责任人一致。"""
    board = _get_board(db, board_id)
    if not board or board.status != "维修中":
        return None
    from backend.models.local import LocalUser
    resolver = db.query(LocalUser).filter(LocalUser.id == bug.resolved_by_id).first() if bug.resolved_by_id else None
    resolver_display = (resolver.display_name or resolver.username) if resolver else ""
    if not resolver_display:
        _, resolver_display = _resolve_assignee(db, bug)
    owner_username, owner_display = _resolve_assignee(db, bug)
    if owner_username:
        board.owner = owner_username
        board.current_holder = owner_display
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


def repair_sync_assignee(db: Session, bug, board_ids: Optional[list[int]] = None) -> int:
    """维修 Bug 责任人变更 → 关联板卡归属/持有人同步为 Bug 现任责任人。

    人员流转跟随 Bug：处于维修流（维修中/已维修）的板卡，归属人 = Bug assignee
    （username→owner，display→持有人）。已离开维修流（如重新交付）的板卡不改写，
    避免覆盖交付责任人的归属语义。返回更新的板卡数。"""
    from backend.models.delivery import DeliveryBoard
    owner_username, owner_display = _resolve_assignee(db, bug)
    if not owner_username:
        return 0
    ids = board_ids if board_ids is not None \
        else [int(x) for x in (bug.board_ids or []) if x is not None]
    if not ids:
        return 0
    boards = db.query(DeliveryBoard).filter(DeliveryBoard.id.in_(ids)).all()
    n = 0
    for bd in boards:
        if bd.status not in ("维修中", "已维修"):
            continue
        bd.owner = owner_username
        bd.current_holder = owner_display
        n += 1
    if n:
        db.commit()
    return n


# ─────────────────────────── 交付记录联动 ───────────────────────────

def _apply_delivery_state(db: Session, board, record_id: int,
                          responsible: str, receiver: str) -> None:
    """本次交付事件写完后收敛板卡状态：
    该交付事件是业务时间线最新 → 置 已交付 + 归属/持有人为交付责任人/收货方；
    存在更晚业务事件（如返修 Bug 已置 维修中、后续交付）→ 状态跟随最新事件，不再覆盖。"""
    latest = latest_event(db, board.id)
    if latest is None:
        return
    if latest.delivery_record_id == record_id and latest.to_status == "已交付":
        board.status = "已交付"
        board.owner = responsible or board.owner
        board.current_holder = receiver
    else:
        board.status = latest.to_status
        # 最新事件若为另一条交付（data 存 responsible/receiver），补齐归属/持有人
        if latest.to_status == "已交付" and latest.data:
            if latest.data.get("responsible_person"):
                board.owner = latest.data["responsible_person"]
            if latest.data.get("receiver"):
                board.current_holder = latest.data["receiver"]


def _parse_clock_time(val) -> Optional[time]:
    """解析 delivery_time 字符串（HH:MM / HH:MM:SS）→ time；无效/空返回 None。"""
    if not val:
        return None
    s = str(val).strip()
    if not s:
        return None
    try:
        return time.fromisoformat(s[:8])
    except ValueError:
        return None


def delivery_event_ts(record) -> datetime:
    """交付记录的业务时间戳（建档 + 交付事件共用，保证同源归位）。

    - 带 delivery_time：视为北京时间墙面时刻 → 减 8h 存 naive UTC，前端 +8 还原显示
      (与 DateTime 列统一 naive-UTC 存储约定一致)。08:00-23:59 时 date() 仍落在
      delivery_date 当天，业务日期排序不受影响。
    - 无 delivery_time（历史记录/仅补日期）：沿用 date-only 午夜语义，时间线按日期归位。"""
    if record.delivery_date:
        t = _parse_clock_time(record.delivery_time)
        if t is not None:
            return datetime.combine(record.delivery_date, t) - BEIJING_OFFSET
        return datetime.combine(record.delivery_date, time.min)
    return datetime.utcnow()  # naive UTC


def sync_delivery_record(db: Session, project_id: int, record, material_codes: list[str],
                         actor: str = "") -> list[DeliveryBoard]:
    """交付记录联动：对每个物料编码建档（无则建档→已交付）+ 写交付事件。
    幂等：已有该记录交付事件的板卡跳过。owner=交付责任人。
    状态收敛见 _apply_delivery_state：仅当本次交付是业务时间线最新时才置 已交付，
    补录/反填日期时不会覆盖更晚的返修等状态。"""
    boards = []
    receiver = _clean_str(record.receiver)
    responsible = _clean_str(record.responsible_person)
    # 建档与交付事件时间同源：避免反填日期时"自动建档"(now) 反超交付成为最新
    event_base = delivery_event_ts(record)
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
                event_time=event_base, actor=actor, note="交付记录自动建档",
                # 记录建档来源：交付记录反填日期时该建档事件随交付一起归位，
                # 避免"建档(新日期反超) 顶掉 已交付"重演（见 _sync_delivery_event_times）
                data={"source_delivery_record_id": record.id},
                created_by=actor or "system",
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
            event_time=event_base,
            actor=actor,
            note=f"交付:{record.product_name} x{record.quantity}",
            data={
                "delivery_method": _clean_str(record.delivery_method),
                "receiver": receiver,
                "responsible_person": responsible,
                "qty": record.quantity,  # 数量快照：时间线交付行渲染高亮（免解析 note）
                "delivery_time": record.delivery_time,  # 用户录入的交付时刻（北京时间墙面）：时间线据此显示完整时刻而非 date-only
            },
            delivery_record_id=record.id,
            created_by=actor or "system",
        ))
        boards.append(board)
    db.flush()
    for b in boards:
        _apply_delivery_state(db, b, record.id, responsible, receiver)
    db.commit()
    for b in boards:
        db.refresh(b)
    return boards


def remove_delivery_events(db: Session, record_id: int) -> None:
    """删除交付记录时回滚：删除该记录关联的交付事件；受影响板卡状态对齐到
    剩余事件的最新一条（无任何事件→回退在库、清持有人）。owner 不自动还原。"""
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
        remaining = db.query(DeliveryBoardEvent).filter(
            DeliveryBoardEvent.board_id == bid
        ).all()
        if not remaining:
            board.status = "在库"
            board.current_holder = None
            continue
        # 状态对齐业务时间线最新事件（可能为返修→维修中，而非一刀切回退在库）；
        # owner 不自动还原；交付事件全删且最新为在库时清持有人
        latest = max(remaining, key=_event_sort_key)
        board.status = latest.to_status
        remaining_delivery = any(e.delivery_record_id is not None for e in remaining)
        if not remaining_delivery and latest.to_status == "在库":
            board.current_holder = None
    db.commit()
