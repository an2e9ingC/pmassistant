from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.middleware.auth import get_current_user
from backend.models.local import LocalUser
from backend.schemas.auth import LoginRequest, LoginResponse, UserInfo
from backend.services.auth_service import authenticate_user, create_access_token

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=dict)
def login(body: LoginRequest, db: Session = Depends(get_db)):
    user = authenticate_user(db, body.username, body.password)
    if not user:
        raise HTTPException(status_code=401, detail="用户名或密码错误")

    token = create_access_token(user.id)
    return {
        "code": 0,
        "data": {
            "access_token": token,
            "token_type": "bearer",
            "user": UserInfo.model_validate(user).model_dump(),
        },
        "message": "ok",
    }


@router.get("/me", response_model=dict)
def me(user: LocalUser = Depends(get_current_user)):
    return {
        "code": 0,
        "data": UserInfo.model_validate(user).model_dump(),
        "message": "ok",
    }
