from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.middleware.auth import get_current_user
from backend.models.local import LocalUser
from backend.middleware.auth import get_user_perms
from backend.schemas.auth import LoginRequest, LoginResponse, UserInfo
from backend.services.auth_service import authenticate_user, create_access_token, hash_password, verify_password

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
    if not verify_password(payload.old_password, user.password_hash):
        raise HTTPException(status_code=400, detail="原密码错误")
    user.password_hash = hash_password(payload.new_password)
    db.commit()
    return {"code": 0, "message": "密码已更新"}
