from __future__ import annotations
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
from jose import jwt
from sqlalchemy.orm import Session

from backend.config import settings
from backend.models.local import LocalUser


def verify_password(plain_password: str, hashed_password: str) -> bool:
    if not hashed_password:
        return False  # GitLab users have no local password
    try:
        return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
    except Exception:
        return False


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")


def authenticate_user(db: Session, username: str, password: str) -> Optional[LocalUser]:
    user = db.query(LocalUser).filter(
        LocalUser.username == username,
        LocalUser.is_active == True,
    ).first()
    if not user or not verify_password(password, user.password_hash):
        return None
    return user


def create_access_token(user_id: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.JWT_EXPIRE_MINUTES)
    payload = {
        "sub": str(user_id),
        "exp": expire,
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
