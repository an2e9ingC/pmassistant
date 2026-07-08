import time
from typing import Dict

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from backend.config import settings, SERVER_START_TIME
from backend.database import get_db
from backend.models.local import LocalUser

security = HTTPBearer()

# In-memory last-seen tracker: {user_id: timestamp}
# Updated on every authenticated request — used for real-time online detection
_user_last_seen: Dict[int, float] = {}
_ONLINE_WINDOW = 60  # seconds — user is "online" if seen within this window


def is_user_online(user_id: int) -> bool:
    """Check if a user has been active within the online window."""
    ts = _user_last_seen.get(user_id)
    return ts is not None and (time.time() - ts) < _ONLINE_WINDOW


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
) -> LocalUser:
    token = credentials.credentials
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        user_id = int(payload.get("sub", 0))
        if user_id is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
        # Reject tokens issued before the current server process started (restart detection)
        iat = payload.get("iat")
        if iat and iat < SERVER_START_TIME:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Server restarted, please login again")
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    user = db.query(LocalUser).filter(LocalUser.id == user_id).first()
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")

    # Record activity timestamp for real-time online status (no DB write)
    global _user_last_seen
    _user_last_seen[user.id] = time.time()

    # Periodically purge stale entries (keep dict small)
    if len(_user_last_seen) > 1000:
        now = time.time()
        _user_last_seen = {uid: ts for uid, ts in _user_last_seen.items() if now - ts < 3600}

    return user


def require_admin(user: LocalUser = Depends(get_current_user)) -> LocalUser:
    if not has_perm(user, "admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return user


def has_perm(user: LocalUser, perm: str) -> bool:
    """Check if user has a specific permission."""
    perms = _get_perms(user)
    return perm in perms


def require_perm(perm: str):
    """Dependency factory: check specific permission."""
    def checker(user: LocalUser = Depends(get_current_user)) -> LocalUser:
        if not has_perm(user, perm):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Permission '{perm}' required")
        return user
    return checker


def require_any_perm(*perms: str):
    """Dependency factory: allow access if user has ANY of the given permissions."""
    def checker(user: LocalUser = Depends(get_current_user)) -> LocalUser:
        user_perms = _get_perms(user)
        if not any(p in user_perms for p in perms):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Requires one of: {', '.join(perms)}")
        return user
    return checker


def _get_perms(user: LocalUser) -> set:
    """Aggregate permissions from all user's roles."""
    perms = set()
    for ur in getattr(user, "user_roles", []) or []:
        role = ur.role
        if role and role.permissions:
            for p in role.permissions.split(","):
                p = p.strip()
                if p:
                    perms.add(p)
    return perms


def get_user_perms(user: LocalUser) -> list:
    """Get user's effective permissions as a sorted list."""
    return sorted(_get_perms(user))
