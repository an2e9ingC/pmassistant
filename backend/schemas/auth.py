from pydantic import BaseModel


class LoginRequest(BaseModel):
    username: str
    password: str


class UserInfo(BaseModel):
    id: int
    username: str
    display_name: str = ""
    role: str
    permissions: str = ""  # comma-separated permission keys
    auth_source: str = "local"  # 'local' or 'gitlab'
    gitlab_user_id: int = None

    model_config = {"from_attributes": True}


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserInfo


class GitLabAuthConfig(BaseModel):
    """GitLab OAuth configuration status for the login page."""
    enabled: bool = False
    authorize_url: str = ""
