from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from backend.config import settings
from backend.database import get_db
from backend.models.local import LocalUser

security = HTTPBearer()


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
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    user = db.query(LocalUser).filter(LocalUser.id == user_id).first()
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")
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
