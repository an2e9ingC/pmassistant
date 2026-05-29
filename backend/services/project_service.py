from __future__ import annotations
from typing import Optional

from sqlalchemy.orm import Session

import re

from backend.config import settings
from backend.models.zentao import (
    CachedProject, CachedExecution, CachedTask, CachedProduct, ProductProjectLink,
)


def get_projects(db: Session) -> list[dict]:
    projects = db.query(CachedProject).order_by(CachedProject.id).all()
    return [_project_brief(p) for p in projects]


def get_project_detail(db: Session, project_id: int) -> Optional[dict]:
    p = db.query(CachedProject).filter(CachedProject.id == project_id).first()
    if not p:
        return None
    return _project_detail(p)


def get_project_stages(db: Session, project_id: int) -> list[dict]:
    executions = (
        db.query(CachedExecution)
        .filter(CachedExecution.project_id == project_id)
        .order_by(CachedExecution.id)
        .all()
    )
    stages = []
    for e in executions:
        tasks = (
            db.query(CachedTask)
            .filter(CachedTask.execution_id == e.id)
            .order_by(CachedTask.id)
            .all()
        )
        # TODO: 根据阶段类型返回固定的文档清单（非禅道任务名）
        # 不同阶段对应不同的文档模板，例如：
        #   售前 → 技术需求书、技术可行性报告、商务可行性报告、立项决议书、项目交付节点
        #   硬件开发 → 硬件方案设计、原理图、PCB Layout、BOM、硬件测试报告
        #   软件开发 → 软件需求规格、概要设计、详细设计、测试用例、测试报告
        #   结构设计 → 结构设计报告、热设计报告
        # 当前阶段名: e.stage_name or e.name
        deliverables = [
            {"name": "TODO: 根据阶段配置文档清单", "done": False, "warn": False, "completed_at": None, "location": None},
        ]
        who = _get_who(tasks) or e.name
        stages.append({
            "id": e.id,
            "name": e.stage_name or e.name,
            "status": _map_status(e.status),
            "who": who,
            "start": str(e.begin) if e.begin else None,
            "end": str(e.end) if e.end else None,
            "completed_date": str(e.end) if e.status in ("done", "closed") else None,
            "progress": e.progress,
            "blocker": _find_blocker(tasks),
            "deliverables": deliverables,
        })
    return stages


def get_project_documents(db: Session, project_id: int) -> list[dict]:
    stages = get_project_stages(db, project_id)
    docs = []
    for s in stages:
        for d in s.get("deliverables", []):
            docs.append({
                "stage_name": s["name"],
                "stage_completed_date": s["completed_date"],
                "name": d["name"],
                "done": d["done"],
                "warn": d["warn"],
                "completed_at": d["completed_at"],
                "location": d["location"],
            })
    return docs


def get_project_gantt(db: Session, project_id: int) -> list[dict]:
    executions = (
        db.query(CachedExecution)
        .filter(CachedExecution.project_id == project_id)
        .order_by(CachedExecution.id)
        .all()
    )
    gantt_stages = []
    for e in executions:
        tasks = (
            db.query(CachedTask)
            .filter(CachedTask.execution_id == e.id)
            .all()
        )
        who = _get_who(tasks) or e.name
        gantt_stages.append({
            "name": e.stage_name or e.name,
            "who": who,
            "start": str(e.begin) if e.begin else None,
            "end": str(e.end) if e.end else None,
            "status": _map_status(e.status),
            "progress": e.progress,
            "completed_date": str(e.end) if e.status in ("done", "closed") else None,
            "blocker": _find_blocker(tasks),
        })
    return gantt_stages


def get_project_delivery(db: Session, project_id: int) -> dict:
    from backend.services.delivery_service import get_delivery_summary
    return get_delivery_summary(db, project_id)


def get_project_resources(db: Session, project_id: int) -> list[dict]:
    # Build web UI base URL from API base URL (strip /api.php/v1 suffix)
    zentao_web_base = re.sub(r"/api\.php/v1$", "", settings.ZENTAO_BASE_URL)
    links = [
        {"label": "禅道项目页面", "url": f"{zentao_web_base}/project-index-{project_id}.html", "description": "查看禅道项目详情"},
        {"label": "GitLab 仓库", "url": "http://192.168.0.128/", "description": "代码仓库和发布管理"},
    ]
    # Add product NAS/Git links
    link_records = (
        db.query(ProductProjectLink)
        .filter(ProductProjectLink.project_id == project_id)
        .all()
    )
    for lr in link_records:
        prod = db.query(CachedProduct).filter(CachedProduct.id == lr.product_id).first()
        if prod:
            if prod.nas_path:
                links.append({"label": f"NAS - {prod.name}", "url": prod.nas_path, "description": f"{prod.name} 硬件资料"})
            if prod.git_url:
                links.append({"label": f"Git - {prod.name}", "url": prod.git_url, "description": f"{prod.name} 代码仓库"})
    return links


def get_project_products(db: Session, project_id: int) -> list[dict]:
    link_records = (
        db.query(ProductProjectLink)
        .filter(ProductProjectLink.project_id == project_id)
        .all()
    )
    products = []
    for lr in link_records:
        prod = db.query(CachedProduct).filter(CachedProduct.id == lr.product_id).first()
        if prod:
            products.append({
                "id": prod.id,
                "name": prod.name,
                "code": prod.code,
                "category": prod.program_name or prod.category,
                "program_name": prod.program_name,
                "nas_path": prod.nas_path,
                "git_url": prod.git_url,
            })
    return products


# --- helpers ---

def _project_brief(p: CachedProject) -> dict:
    return {
        "id": p.id,
        "code": p.code,
        "name": p.name,
        "project_type": p.project_type,
        "customer_name": p.customer_name,
        "status": _map_status(p.status),
    }


def _project_detail(p: CachedProject) -> dict:
    # Extract description and customer【...】from raw_json
    desc = ""
    customer_from_desc = ""
    if p.raw_json:
        try:
            import json as _json
            import re as _re
            data = _json.loads(p.raw_json)
            desc = data.get("desc", "") or ""
            # Extract first 【...】 as customer name
            m = _re.search(r"【(.+?)】", desc)
            if m:
                customer_from_desc = m.group(1).strip()
        except Exception:
            pass

    return {
        "id": p.id,
        "code": p.code,
        "name": p.name,
        "model": p.model,
        "project_type": p.project_type,
        "status": _map_status(p.status),
        "begin": str(p.begin) if p.begin else None,
        "end": str(p.end) if p.end else None,
        "real_began": str(p.real_began) if p.real_began else None,
        "real_end": str(p.real_end) if p.real_end else None,
        "progress": p.progress,
        "estimate": p.estimate,
        "consumed": p.consumed,
        "pm_name": p.pm_name,
        "pm_account": p.pm_account,
        "customer_name": p.customer_name,
        "alias_name": p.alias_name,
        "description": desc,
        "customer_from_desc": customer_from_desc,
    }


def _map_status(status: str) -> str:
    """Map Zentao raw status (wait/doing/done/closed/suspended) to PMA display status."""
    mapping = {
        "wait": "pending",
        "doing": "active",
        "done": "completed",
        "closed": "completed",
        "suspended": "blocked",
        "canceled": "canceled",
    }
    return mapping.get(status, "pending")


def _find_blocker(tasks: list[CachedTask]) -> Optional[str]:
    for t in tasks:
        if t.is_blocker and t.blocker_note:
            return t.blocker_note
        if t.is_blocker:
            return f"任务被标记为卡点: {t.name}"
    return None


def _get_who(tasks: list[CachedTask]) -> str:
    """Get responsible persons from task assignees, deduplicated."""
    names = []
    seen = set()
    for t in tasks:
        name = (t.assigned_realname or "").strip()
        if name and name not in seen:
            names.append(name)
            seen.add(name)
    return "、".join(names) if names else ""
