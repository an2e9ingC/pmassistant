from typing import Optional
from pydantic import BaseModel


class LoginRequest(BaseModel):
    username: str
    password: str


class UserInfo(BaseModel):
    id: int
    username: str
    display_name: Optional[str] = ""
    role: str
    permissions: str = ""  # comma-separated permission keys
    auth_source: Optional[str] = "local"  # 'local' or 'gitlab'
    gitlab_user_id: Optional[int] = None
    gitlab_token_valid: bool = False  # OAuth token present and usable
    seen_version: Optional[str] = None  # last seen changelog version
    need_guide: bool = True  # whether to show new user guide
    must_change_password: Optional[bool] = False  # force password change on next login
    wecom_userid: Optional[str] = None   # 企业微信关联账号
    preferences: Optional[str] = None     # JSON user preferences
    favorites: Optional[str] = None       # JSON favorites {products,projects,tasks,bugs}

    model_config = {"from_attributes": True}


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserInfo


class GitLabAuthConfig(BaseModel):
    """GitLab OAuth configuration status for the login page."""
    enabled: bool = False
    authorize_url: str = ""
