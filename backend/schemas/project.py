from __future__ import annotations
from typing import Optional
from pydantic import BaseModel


class ProjectBrief(BaseModel):
    id: int
    code: str
    name: str
    project_type: Optional[str] = None
    customer_name: Optional[str] = None
    status: Optional[str] = None

    model_config = {"from_attributes": True}


class ProjectDetail(BaseModel):
    id: int
    code: str
    name: str
    model: Optional[str] = None
    project_type: Optional[str] = "RD"
    status: Optional[str] = None
    begin: Optional[str] = None
    end: Optional[str] = None
    real_began: Optional[str] = None
    real_end: Optional[str] = None
    progress: Optional[str] = None
    estimate: Optional[float] = None
    consumed: Optional[float] = None
    pm_name: Optional[str] = None
    pm_account: Optional[str] = None
    customer_name: Optional[str] = None
    alias_name: Optional[str] = None


class GanttStage(BaseModel):
    name: str
    who: Optional[str] = None
    start: Optional[str] = None
    end: Optional[str] = None
    status: str
    progress: Optional[str] = None
    completed_date: Optional[str] = None
    blocker: Optional[str] = None


class StageItem(BaseModel):
    id: Optional[int] = None
    name: str
    status: str
    who: Optional[str] = None
    start: Optional[str] = None
    end: Optional[str] = None
    completed_date: Optional[str] = None
    progress: Optional[str] = None
    blocker: Optional[str] = None
    deliverables: list["DeliverableItem"] = []


class DeliverableItem(BaseModel):
    name: str
    done: bool = False
    warn: bool = False
    completed_at: Optional[str] = None
    location: Optional[str] = None


class DocumentItem(BaseModel):
    stage_name: str
    stage_completed_date: Optional[str] = None
    name: str
    done: bool = False
    warn: bool = False
    completed_at: Optional[str] = None
    location: Optional[str] = None


class DeliveryRecord(BaseModel):
    date: Optional[str] = None
    qty: int = 0
    items: Optional[str] = None
    receiver: Optional[str] = None
    note: Optional[str] = None


class DeliveryInfo(BaseModel):
    total: int = 0
    done: int = 0
    remaining: int = 0
    progress: int = 0
    records: list[DeliveryRecord] = []


class ResourceLink(BaseModel):
    label: str
    url: str
    description: Optional[str] = None


class SyncStatusItem(BaseModel):
    entity_type: str
    status: str
    items_fetched: int
    items_created: int
    items_updated: int
    finished_at: Optional[str] = None
    error_message: Optional[str] = None
