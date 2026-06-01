"""Topology API — unified project-product-customer search."""

from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.middleware.auth import get_current_user
from backend.services import topology_service

router = APIRouter(prefix="/api/topology", tags=["topology"])


@router.get("", response_model=dict)
def get_topology(
    project: Optional[str] = Query(None),
    product: Optional[str] = Query(None),
    customer: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    items = topology_service.search_topology(
        db, project=project, product=product, customer=customer
    )
    return {
        "code": 0,
        "data": {"items": items, "total": len(items)},
        "message": "ok",
    }
