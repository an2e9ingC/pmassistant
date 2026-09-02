"""工时派生核心 — 数据库只存 percentage，小时数一律实时按企微口径推导。

Issue #9 架构决策（用户拍板）：
- `pma_worklogs` / `pma_bug_worklogs` 只保存用户填写的 `percentage`（0-100）。
  `calculated_hours` / `hours` 列已休眠（停写停读；新行 `hours` 写 0.0 占位满足 NOT NULL，
  历史行保留旧值仅兜底，当前 0 条百分比为 NULL 的行）。
- 所有需要"小时"的地方调用本模块实时推导：
      round(percentage/100 × 当日企微权威工时)   （status=ok）
      round(percentage/100 × DEFAULT_HOURS)      （status=pending/absent → 按 8h 暂计，标"待核正"）
  由于读路径实时推导、不落任何派生值，企微数据到位后**天然自动核正**，无需重算作业。

无基准日三态（由 wecom_service.day_baselines_for_dates 原始 resolved 映射）：
- ok      ：企微有行且权威解析 ≥ MIN_REAL_HOURS（0.1h = 6 分钟）—— 权威口径
- pending  ：企微有行但解析 < MIN_REAL_HOURS（今天下班卡未打 / 0 小时审批占位 / 子秒噪音）—— 按 8h 暂计待核正
- absent   ：无任何企微派生条目（忘打卡 / 补卡 / 外出·出差公文未提交或未审批完成）—— 按 8h 暂计待核正

本模块只 import models（无服务依赖）；对 wecom_service 的函数一律**函数内 lazy import**，
避免与 worklog/bug/task 等服务的循环导入（与仓库既有护栏一致）。
"""
from __future__ import annotations

from datetime import date
from typing import Dict, List, Optional, Sequence, Tuple

from sqlalchemy.orm import Session

from backend.models.local import LocalUser
from backend.models.task import WorkLog
from backend.models.bug import BugWorkLog

# 无企微基准日的暂计标准工时（schedule 表实际 work_days=0 已死，默认即 8h）
DEFAULT_HOURS = 8.0
# 低于此阈值的"打卡时长"视为噪音（子秒杂讯/占位 0），不算已定型的当日口径
MIN_REAL_HOURS = 0.1  # 6 分钟

# (local_user_id, date) → 基准；date 为 datetime.date
_Baseline = Dict[Tuple[int, date], dict]


def baselines_for(db: Session, user_dates: Sequence[Tuple[int, Optional[date]]]) -> _Baseline:
    """批量解析 (local_user_id, date) 的当日企微口径基准（单次 SQL，含 local→wecom 映射）。

    Returns {(local_user_id, date): {"resolved": float|None, "status": "ok"|"pending"|"absent"}}。

    解析口径与用户中心日历 / 人力报表完全一致（走 wecom_service 同一 _resolve_daily_hours，
    含出差工作日 8h / 外出 max(审批,打卡) / 请假实卡等全部规则）。
    """
    pairs = [(uid, d) for (uid, d) in user_dates if uid and d]
    if not pairs:
        return {}
    user_ids = {uid for uid, _ in pairs}
    date_set = {d for _, d in pairs}
    users = db.query(LocalUser).filter(LocalUser.id.in_(user_ids)).all()
    wid_by_local = {u.id: u.wecom_userid for u in users}

    from backend.services.wecom_service import day_baselines_for_dates
    wanted = [(wid, d) for (uid, d) in pairs if (wid := wid_by_local.get(uid))]
    resolved_map = day_baselines_for_dates(db, [wid for wid, _ in wanted], date_set)

    out = {}
    for (uid, d) in pairs:
        wid = wid_by_local.get(uid)
        v = resolved_map.get((wid, d)) if wid else None
        if v is None:
            # 无企微条目 或 该用户未绑定企微：无从核正 → 按 8h 暂计待核正
            out[(uid, d)] = {"resolved": None, "status": "absent"}
        elif v >= MIN_REAL_HOURS:
            out[(uid, d)] = {"resolved": v, "status": "ok"}
        else:
            # 有条目但口径未定型（如今天下班卡未打 / 0 小时审批占位）
            out[(uid, d)] = {"resolved": v, "status": "pending"}
    return out


def collect_baselines(db: Session, rows: Sequence) -> _Baseline:
    """对一组工时行（WorkLog / BugWorkLog）批量取基准，key=(user_id, date)。

    单次批量查询，供日历/报表/聚合等一次取 N 行的场景复用。
    """
    return baselines_for(db, [(r.user_id, r.date) for r in rows if r.date is not None])


def effective_hours_for(percentage: Optional[float], baseline: Optional[dict]) -> float:
    """percentage(0-100) × 当日有效工时 → 派生小时（读路径展示/聚合统一走这里）。

    baseline 为空/absent/pending → 按 DEFAULT_HOURS 暂计（待核正，企微到位自动核正）。
    """
    day_h = DEFAULT_HOURS
    if baseline and baseline.get("status") == "ok" and (baseline.get("resolved") or 0) >= MIN_REAL_HOURS:
        day_h = float(baseline["resolved"])
    return round(float(percentage or 0) / 100.0 * day_h, 2)


def row_derived_hours(row, baseline: Optional[dict]) -> float:
    """一行工时的展示小时：percentage 有值 → 实时派生；percentage NULL 史前行（0 条兜底）→ 旧 hours 列。"""
    if row.percentage is None:
        return row.hours or 0.0
    return effective_hours_for(row.percentage, baseline)


def row_basis(baseline: Optional[dict]) -> str:
    """一行工时的基准态：'ok'（权威）/ 'pending'（今日未定型）/ 'absent'（无基准日，按 8h 暂计待核正）。"""
    if baseline is None:
        return "absent"
    return baseline.get("status", "absent")


def derived_task_hours(db: Session, task_id: int) -> float:
    """Task.consumed_hours 的派生口径：SUM(该任务所有工时的 percentage×当日有效工时)。

    与整表"百分比即权威、小时实时推导"一致；由工时增删改 / 企微同步刷新调用，观测等价实时。
    """
    rows = db.query(WorkLog).filter(WorkLog.task_id == task_id).all()
    if not rows:
        return 0.0
    bm = collect_baselines(db, rows)
    return round(sum(row_derived_hours(r, bm.get((r.user_id, r.date))) for r in rows), 2)


def derived_bug_hours(db: Session, bug_id: int) -> float:
    """PmaBug.consumed_hours 的派生口径（同 derived_task_hours）。"""
    rows = db.query(BugWorkLog).filter(BugWorkLog.bug_id == bug_id).all()
    if not rows:
        return 0.0
    bm = collect_baselines(db, rows)
    return round(sum(row_derived_hours(r, bm.get((r.user_id, r.date))) for r in rows), 2)
