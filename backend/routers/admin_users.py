"""Admin user management — list/create/update/delete users (admin only)."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.middleware.auth import require_admin
from backend.models.local import LocalUser
from backend.services.auth_service import hash_password

router = APIRouter(prefix="/api/admin/users", tags=["admin"])


class UserCreate(BaseModel):
    username: str
    password: str
    role: str = "viewer"


class UserUpdate(BaseModel):
    role: str = None
    password: str = None
    is_active: bool = None


class PasswordReset(BaseModel):
    password: str


VALID_ROLES = ["admin", "manager", "viewer"]


@router.get("", response_model=dict)
def list_users(db: Session = Depends(get_db), _=Depends(require_admin)):
    users = db.query(LocalUser).order_by(LocalUser.id).all()
    return {
        "code": 0,
        "data": [
            {
                "id": u.id,
                "username": u.username,
                "role": u.role,
                "is_active": u.is_active,
                "created_at": str(u.created_at)[:19] if u.created_at else "",
            }
            for u in users
        ],
        "message": "ok",
    }


@router.post("", response_model=dict)
def create_user(payload: UserCreate, db: Session = Depends(get_db), _=Depends(require_admin)):
    if payload.role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"无效角色，可选: {', '.join(VALID_ROLES)}")
    existing = db.query(LocalUser).filter(LocalUser.username == payload.username).first()
    if existing:
        raise HTTPException(status_code=400, detail="用户名已存在")
    user = LocalUser(
        username=payload.username,
        display_name=payload.username,
        password_hash=hash_password(payload.password),
        role=payload.role,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"code": 0, "data": {"id": user.id, "username": user.username}, "message": "用户已创建"}


@router.put("/{user_id}", response_model=dict)
def update_user(user_id: int, payload: UserUpdate, db: Session = Depends(get_db), _=Depends(require_admin)):
    user = db.query(LocalUser).filter(LocalUser.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    if payload.role is not None:
        if payload.role not in VALID_ROLES:
            raise HTTPException(status_code=400, detail=f"无效角色，可选: {', '.join(VALID_ROLES)}")
        user.role = payload.role
    if payload.password:
        user.password_hash = hash_password(payload.password)
    if payload.is_active is not None:
        user.is_active = payload.is_active
    db.commit()
    return {"code": 0, "message": "用户已更新"}


@router.put("/{user_id}/password", response_model=dict)
def reset_user_password(user_id: int, payload: PasswordReset, db: Session = Depends(get_db), _=Depends(require_admin)):
    user = db.query(LocalUser).filter(LocalUser.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    user.password_hash = hash_password(payload.password)
    db.commit()
    return {"code": 0, "message": "密码已重置"}


@router.delete("/{user_id}", response_model=dict)
def delete_user(user_id: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    user = db.query(LocalUser).filter(LocalUser.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    db.delete(user)
    db.commit()
    return {"code": 0, "message": "用户已删除"}
