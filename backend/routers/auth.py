import secrets
import time
from typing import Dict
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.config import settings
from backend.database import get_db
from backend.middleware.auth import get_current_user, get_user_perms, _get_perms
from backend.models.local import LocalUser, Role, UserRole
from backend.schemas.auth import LoginRequest, LoginResponse, UserInfo
from backend.services.auth_service import authenticate_user, create_access_token, hash_password, verify_password

# In-memory CSRF state storage: state -> expiry_timestamp
_oauth_states: Dict[str, float] = {}
_OAUTH_STATE_TTL = 600  # 10 minutes

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=dict)
def login(body: LoginRequest, db: Session = Depends(get_db)):
    user = authenticate_user(db, body.username, body.password)
    if not user:
        raise HTTPException(status_code=401, detail="用户名或密码错误")

    token = create_access_token(user.id)
    user_info = UserInfo.model_validate(user).model_dump()
    user_info["permissions"] = ",".join(get_user_perms(user))
    return {
        "code": 0,
        "data": {
            "access_token": token,
            "token_type": "bearer",
            "user": user_info,
        },
        "message": "ok",
    }


@router.get("/me", response_model=dict)
def me(user: LocalUser = Depends(get_current_user)):
    user_info = UserInfo.model_validate(user).model_dump()
    user_info["permissions"] = ",".join(get_user_perms(user))
    return {
        "code": 0,
        "data": user_info,
        "message": "ok",
    }


class PasswordUpdate(BaseModel):
    old_password: str
    new_password: str


@router.put("/password", response_model=dict)
def update_password(
    payload: PasswordUpdate,
    db: Session = Depends(get_db),
    user: LocalUser = Depends(get_current_user),
):
    if not user.password_hash:
        raise HTTPException(status_code=400, detail="GitLab 用户请前往 GitLab 管理密码")
    if not verify_password(payload.old_password, user.password_hash):
        raise HTTPException(status_code=400, detail="原密码错误")
    user.password_hash = hash_password(payload.new_password)
    db.commit()
    return {"code": 0, "message": "密码已更新"}


# ── GitLab OAuth endpoints ──


def _cleanup_oauth_states():
    """Remove expired OAuth state entries."""
    now = time.time()
    expired = [s for s, exp in _oauth_states.items() if exp < now]
    for s in expired:
        del _oauth_states[s]


@router.get("/gitlab/config", response_model=dict)
def gitlab_oauth_config():
    """Return GitLab OAuth configuration status for the login page."""
    enabled = settings.GITLAB_OAUTH_ENABLED and bool(settings.GITLAB_APP_ID)
    return {
        "code": 0,
        "data": {
            "enabled": enabled,
            "authorize_url": "",  # frontend calls /gitlab/authorize to get the full URL
        },
        "message": "ok",
    }


@router.get("/gitlab/authorize", response_model=dict)
def gitlab_oauth_authorize():
    """Generate the GitLab OAuth authorization URL."""
    if not settings.GITLAB_OAUTH_ENABLED:
        return {"code": 1, "message": "GitLab OAuth 登录未启用"}
    if not settings.GITLAB_APP_ID:
        return {"code": 1, "message": "GitLab OAuth Application ID 未配置"}

    _cleanup_oauth_states()

    # Generate CSRF state
    state = secrets.token_urlsafe(32)
    _oauth_states[state] = time.time() + _OAUTH_STATE_TTL

    # Derive GitLab web root from API base URL
    gitlab_root = settings.GITLAB_BASE_URL.rsplit("/api", 1)[0]
    authorize_url = (
        f"{gitlab_root}/oauth/authorize"
        f"?client_id={settings.GITLAB_APP_ID}"
        f"&redirect_uri={settings.GITLAB_OAUTH_REDIRECT_URI}"
        f"&response_type=code"
        f"&scope=read_user"
        f"&state={state}"
    )

    return {
        "code": 0,
        "data": {
            "authorize_url": authorize_url,
            "state": state,
        },
        "message": "ok",
    }


@router.get("/gitlab/callback", response_class=RedirectResponse)
async def gitlab_oauth_callback(code: str, state: str, db: Session = Depends(get_db)):
    """Handle GitLab OAuth callback: exchange code for token, fetch user info,
    provision/update local user, and redirect to frontend with PMA JWT."""
    from backend.services.gitlab_client import GitLabClient

    _cleanup_oauth_states()

    # Validate CSRF state
    if state not in _oauth_states:
        return RedirectResponse(url="/login?error=invalid_state")

    # Remove state after validation (one-time use)
    del _oauth_states[state]

    redirect_uri = settings.GITLAB_OAUTH_REDIRECT_URI
    client = GitLabClient()

    try:
        # Exchange authorization code for access token
        try:
            token_data = await client.exchange_code_for_token(code, redirect_uri)
        except RuntimeError as e:
            return RedirectResponse(url=f"/login?error=gitlab_unreachable")

        access_token = token_data.get("access_token")
        if not access_token:
            return RedirectResponse(url="/login?error=gitlab_token_error")

        # Get GitLab user info
        try:
            gitlab_user = await client.get_oauth_user(access_token)
        except RuntimeError as e:
            return RedirectResponse(url="/login?error=gitlab_unreachable")
    except Exception as e:
        return RedirectResponse(url=f"/login?error=gitlab_unreachable")
    finally:
        await client.close()

    gitlab_user_id = gitlab_user.get("id")
    gitlab_username = gitlab_user.get("username", "")
    gitlab_name = gitlab_user.get("name", gitlab_username)
    gitlab_state = gitlab_user.get("state", "active")

    if not gitlab_user_id:
        return RedirectResponse(url="/login?error=gitlab_user_info_incomplete")

    # Match or create local user
    local_user = db.query(LocalUser).filter(
        LocalUser.gitlab_user_id == gitlab_user_id
    ).first()

    if not local_user:
        # Try to match by username
        local_user = db.query(LocalUser).filter(
            LocalUser.username == gitlab_username
        ).first()

        if local_user:
            # Existing local user with matching username
            if local_user.auth_source == "local":
                perms = _get_perms(local_user)
                if "admin" in perms:
                    return RedirectResponse(url="/login?error=admin_must_use_local_login")
                # Non-admin: link to GitLab
                local_user.auth_source = "gitlab"
                local_user.gitlab_user_id = gitlab_user_id
                local_user.password_hash = None
                local_user.display_name = gitlab_name
                local_user.is_active = (gitlab_state == "active")
            else:
                # Already linked to a different GitLab user — conflict
                return RedirectResponse(url="/login?error=username_conflict")

    is_new_user = False

    if local_user:
        # Update user info from GitLab on each login
        local_user.display_name = gitlab_name
        local_user.is_active = (gitlab_state == "active")
    else:
        # Create new user
        is_new_user = True
        local_user = LocalUser(
            username=gitlab_username,
            display_name=gitlab_name,
            password_hash=None,
            role="viewer",
            auth_source="gitlab",
            gitlab_user_id=gitlab_user_id,
            is_active=(gitlab_state == "active"),
        )
        db.add(local_user)
        db.flush()  # Get the new user ID

        # Auto-assign 'public' role
        public_role = db.query(Role).filter(Role.key == "public").first()
        if public_role:
            db.add(UserRole(user_id=local_user.id, role_id=public_role.id))

    db.commit()

    # Generate PMA JWT
    token = create_access_token(local_user.id)

    new_user_param = "&new_user=1" if is_new_user else ""
    return RedirectResponse(url=f"/login?gitlab_auth=1&token={token}{new_user_param}")


@router.get("/gitlab/admin-contacts", response_model=dict)
def gitlab_admin_contacts(db: Session = Depends(get_db)):
    """Return a list of users with admin or user-management permissions,
    so new GitLab users know who to contact for additional permissions.
    Public endpoint — no authentication required.
    """
    # Find roles that have 'admin' permission
    admin_roles = db.query(Role).filter(
        Role.permissions.contains("admin")
    ).all()
    admin_role_ids = [r.id for r in admin_roles]

    if not admin_role_ids:
        return {"code": 0, "data": {"contacts": []}, "message": "ok"}

    # Find users who have admin roles
    admin_user_ids = db.query(UserRole.user_id).filter(
        UserRole.role_id.in_(admin_role_ids)
    ).distinct().all()
    admin_user_ids = [row[0] for row in admin_user_ids]

    if not admin_user_ids:
        return {"code": 0, "data": {"contacts": []}, "message": "ok"}

    contacts = db.query(LocalUser).filter(
        LocalUser.id.in_(admin_user_ids),
        LocalUser.is_active == True,
    ).order_by(LocalUser.username).all()

    return {
        "code": 0,
        "data": {
            "contacts": [
                {
                    "username": u.username,
                    "display_name": u.display_name or u.username,
                }
                for u in contacts
            ],
        },
        "message": "ok",
    }

