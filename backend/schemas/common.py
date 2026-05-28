from typing import Optional, Any
from pydantic import BaseModel


class ApiResponse(BaseModel):
    code: int = 0
    data: Any = None
    message: str = "ok"


class PaginationParams:
    def __init__(self, page: int = 1, limit: int = 50):
        self.page = max(1, page)
        self.limit = min(max(1, limit), 200)
