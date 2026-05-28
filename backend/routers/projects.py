from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.middleware.auth import get_current_user
from backend.services import project_service

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.get("", response_model=dict)
def list_projects(db: Session = Depends(get_db), _=Depends(get_current_user)):
    items = project_service.get_projects(db)
    return {"code": 0, "data": items, "message": "ok"}


@router.get("/{project_id}", response_model=dict)
def get_project(project_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    detail = project_service.get_project_detail(db, project_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Project not found")
    products = project_service.get_project_products(db, project_id)
    detail["products"] = products
    return {"code": 0, "data": detail, "message": "ok"}


@router.get("/{project_id}/stages", response_model=dict)
def get_stages(project_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    stages = project_service.get_project_stages(db, project_id)
    return {"code": 0, "data": stages, "message": "ok"}


@router.get("/{project_id}/documents", response_model=dict)
def get_documents(project_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    docs = project_service.get_project_documents(db, project_id)
    return {"code": 0, "data": docs, "message": "ok"}


@router.get("/{project_id}/gantt", response_model=dict)
def get_gantt(project_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    stages = project_service.get_project_gantt(db, project_id)
    return {"code": 0, "data": stages, "message": "ok"}


@router.get("/{project_id}/delivery", response_model=dict)
def get_delivery(project_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    delivery = project_service.get_project_delivery(db, project_id)
    return {"code": 0, "data": delivery, "message": "ok"}


@router.get("/{project_id}/resources", response_model=dict)
def get_resources(project_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    resources = project_service.get_project_resources(db, project_id)
    return {"code": 0, "data": resources, "message": "ok"}
