from typing import Optional
from pydantic import BaseModel


class KpiData(BaseModel):
    active_projects: int = 0
    rd_count: int = 0
    sc_count: int = 0
    pending_alerts: int = 0
    delivered_this_month: int = 0
    avg_progress: float = 0.0


class ProjectListItem(BaseModel):
    id: int
    code: str
    name: str
    type: str  # RD or SC
    status: str
    progress: str
    begin: Optional[str] = None
    end: Optional[str] = None
    pm_name: Optional[str] = None
    current_stage: Optional[str] = None
    customer_name: Optional[str] = None

    model_config = {"from_attributes": True}


class AlertItem(BaseModel):
    id: int
    severity: str  # red, yellow
    message: str
    sub_message: Optional[str] = None
    project_id: Optional[int] = None
    project_code: Optional[str] = None
    stage_name: Optional[str] = None
