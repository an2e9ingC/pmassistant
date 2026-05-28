from __future__ import annotations
from typing import Optional

from sqlalchemy.orm import Session

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
        deliverables = []
        for t in tasks:
            dn = t.name or ""
            deliverables.append({
                "name": dn,
                "done": t.status == "done",
                "warn": (t.status == "done" and not t.has_files),
                "completed_at": t.finished_date.strftime("%Y-%m-%d") if t.finished_date else None,
                "location": "禅道任务附件" if t.has_files else None,
            })
        stages.append({
            "id": e.id,
            "name": e.stage_name or e.name,
            "status": _map_exec_status(e.status),
            "who": e.name,
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
        gantt_stages.append({
            "name": e.stage_name or e.name,
            "who": _extract_who(e.name),
            "start": str(e.begin) if e.begin else None,
            "end": str(e.end) if e.end else None,
            "status": _map_exec_status(e.status),
            "progress": e.progress,
            "completed_date": str(e.end) if e.status in ("done", "closed") else None,
            "blocker": _find_blocker(tasks),
        })
    return gantt_stages


def get_project_delivery(db: Session, project_id: int) -> dict:
    return {
        "total": 0,
        "done": 0,
        "remaining": 0,
        "progress": 0,
        "records": [],
    }


def get_project_resources(db: Session, project_id: int) -> list[dict]:
    links = [
        {"label": "禅道项目页面", "url": f"http://192.168.0.124:8800/project-index-{project_id}.html", "description": "查看禅道项目详情"},
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
                "category": prod.category,
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
        "status": p.status,
    }


def _project_detail(p: CachedProject) -> dict:
    return {
        "id": p.id,
        "code": p.code,
        "name": p.name,
        "model": p.model,
        "project_type": p.project_type,
        "status": p.status,
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
    }


def _map_exec_status(status: str) -> str:
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


def _extract_who(name: str) -> str:
    """Extract a short who description from execution name."""
    # In Phase 1, use the execution name as the who
    return name or ""
