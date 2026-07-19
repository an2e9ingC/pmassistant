"""Admin user management — list/create/update/delete users (admin only)."""

import logging
logger = logging.getLogger(__name__)

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import case
from sqlalchemy.orm import Session

from backend.database import get_db, to_local_str
from backend.middleware.auth import require_admin, get_current_user
from backend.models.local import LocalUser, Role, UserRole
from backend.audit_categories import AUDIT_CAT_USER
from backend.routers.logs import log_audit
from backend.services.auth_service import hash_password

router = APIRouter(prefix="/api/admin/users", tags=["admin"])


class UserCreate(BaseModel):
    username: str
    password: str
    role: str = "viewer"
    permissions: str = ""


class UserUpdate(BaseModel):
    role: str = None
    password: str = None
    is_active: bool = None
    permissions: str = None
    wecom_userid: str = None


class PasswordReset(BaseModel):
    password: str


# All company roles
ROLES = [
    "public",
    "admin", "ceo", "cto", "pm",
    "sales", "hw_dev", "structure", "hw_test",
    "bsp_dev", "sw_dev", "test_delivery",
    "procurement", "quality", "warehouse", "viewer",
]

# Available permissions
ALL_PERMISSIONS = ["admin", "sync", "project_edit", "product_link", "customer_link", "doc_template", "stage_mapping", "task_edit"]

ROLE_LABELS = {
    "public": "普通用户",
    "admin": "管理员", "ceo": "CEO", "cto": "CTO", "pm": "项目经理",
    "sales": "销售及售前", "hw_dev": "硬件开发", "structure": "结构设计及装配",
    "hw_test": "硬件测试", "bsp_dev": "BSP开发", "sw_dev": "业务软件开发",
    "test_delivery": "测试交付", "procurement": "采购", "quality": "质检",
    "warehouse": "库房管理", "viewer": "只读用户",
}

PERM_LABELS = {
    "admin": "系统管理", "sync": "数据同步", "project_edit": "项目维护",
    "product_link": "产品维护", "customer_link": "客户维护",
    "doc_template": "文档模板配置", "stage_mapping": "阶段映射",
    "task_edit": "任务管理",
}


@router.get("/permissions", response_model=dict)
def get_permissions_meta(_=Depends(require_admin)):
    """Return available roles and permissions metadata."""
    return {
        "code": 0,
        "data": {
            "roles": [{"key": k, "label": v} for k, v in ROLE_LABELS.items()],
            "permissions": [{"key": k, "label": v} for k, v in PERM_LABELS.items()],
        },
        "message": "ok",
    }


# ── Role Management ──

@router.get("/roles", response_model=dict)
def list_roles(db: Session = Depends(get_db), _=Depends(require_admin)):
    roles = db.query(Role).order_by(
        case((Role.key == "public", 0), else_=1), Role.id
    ).all()
    return {
        "code": 0,
        "data": [
            {
                "id": r.id, "key": r.key, "label": r.label,
                "permissions": [p for p in (r.permissions or "").split(",") if p],
                "description": r.description or "",
            }
            for r in roles
        ],
        "message": "ok",
    }


@router.put("/roles/{role_id}", response_model=dict)
def update_role(role_id: int, payload: dict, db: Session = Depends(get_db), user=Depends(require_admin)):
    role = db.query(Role).filter(Role.id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="角色不存在")
    if role.key == "admin":
        raise HTTPException(status_code=403, detail="admin角色不可修改")
    if "permissions" in payload:
        perms = payload["permissions"]
        role.permissions = ",".join(p for p in perms if p in ALL_PERMISSIONS) if isinstance(perms, list) else perms
    if "label" in payload:
        role.label = payload["label"]
    if "description" in payload:
        role.description = payload["description"]
    db.commit()
    log_audit(db, user, "role_update", f"{role.key}: {role.permissions}", AUDIT_CAT_USER, "high")
    return {"code": 0, "message": "角色已更新"}


class RoleCreate(BaseModel):
    key: str
    label: str
    permissions: str = ""
    description: str = ""


@router.post("/roles", response_model=dict)
def create_role(payload: RoleCreate, db: Session = Depends(get_db), user=Depends(require_admin)):
    if db.query(Role).filter(Role.key == payload.key).first():
        raise HTTPException(status_code=400, detail="角色key已存在")
    role = Role(key=payload.key, label=payload.label, permissions=payload.permissions, description=payload.description)
    db.add(role)
    db.commit()
    db.refresh(role)
    log_audit(db, user, "role_create", f"{role.key}: {role.permissions}", AUDIT_CAT_USER, "medium")
    return {"code": 0, "data": {"id": role.id, "key": role.key, "label": role.label}, "message": "角色已创建"}


@router.delete("/roles/{role_id}", response_model=dict)
def delete_role(role_id: int, db: Session = Depends(get_db), user=Depends(require_admin)):
    role = db.query(Role).filter(Role.id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="角色不存在")
    if role.key == "admin":
        raise HTTPException(status_code=403, detail="admin角色不可删除")
    # Remove all user-role assignments for this role
    db.query(UserRole).filter(UserRole.role_id == role_id).delete()
    db.delete(role)
    db.commit()
    log_audit(db, user, "role_delete", f"{role.key}: {role.permissions}", AUDIT_CAT_USER, "high")
    return {"code": 0, "message": "角色已删除"}


# ── User-Role Assignment ──

@router.get("/{user_id}/roles", response_model=dict)
def get_user_roles(user_id: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    user_roles = db.query(UserRole).filter(UserRole.user_id == user_id).all()
    return {
        "code": 0,
        "data": [ur.role_id for ur in user_roles],
        "message": "ok",
    }


@router.put("/{user_id}/roles", response_model=dict)
def set_user_roles(user_id: int, payload: dict, db: Session = Depends(get_db), user=Depends(require_admin)):
    """Set user's role memberships. payload: { role_ids: [1, 2, 3] }"""
    target = db.query(LocalUser).filter(LocalUser.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="用户不存在")
    role_ids = payload.get("role_ids", [])
    if not isinstance(role_ids, list):
        raise HTTPException(status_code=400, detail="role_ids must be a list")
    try:
        # Remove existing
        db.query(UserRole).filter(UserRole.user_id == user_id).delete()
        # Add new
        for rid in role_ids:
            role = db.query(Role).filter(Role.id == rid).first()
            if role:
                db.add(UserRole(user_id=user_id, role_id=rid))
        db.commit()
        log_audit(db, user, "user_role_assign", f"用户 {target.username} 角色更新为: {role_ids}", AUDIT_CAT_USER, "high")
        logger.info(f"User roles updated: user_id={user_id} roles={role_ids}")
        return {"code": 0, "data": role_ids, "message": "用户角色已更新"}
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to update user roles: user_id={user_id} roles={role_ids}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/roles/{role_id}/users", response_model=dict)
def get_role_users(role_id: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    user_roles = db.query(UserRole).filter(UserRole.role_id == role_id).all()
    user_ids = [ur.user_id for ur in user_roles]
    users = db.query(LocalUser).filter(LocalUser.id.in_(user_ids)).all() if user_ids else []
    return {
        "code": 0,
        "data": [{"id": u.id, "username": u.username, "is_active": u.is_active} for u in users],
        "message": "ok",
    }


@router.get("", response_model=dict)
def list_users(db: Session = Depends(get_db), _=Depends(require_admin)):
    from backend.middleware.auth import _get_perms, is_user_online
    users = db.query(LocalUser).order_by(LocalUser.id).all()
    return {
        "code": 0,
        "data": [
            {
                "id": u.id,
                "username": u.username,
                "display_name": u.display_name or u.username,
                "role": u.role,
                "role_label": ROLE_LABELS.get(u.role, u.role),
                "role_ids": [ur.role_id for ur in (u.user_roles or [])],
                "permissions": sorted(_get_perms(u)),
                "is_active": u.is_active,
                "auth_source": u.auth_source or "local",
                "created_at": to_local_str(u.created_at),
                "last_login_at": to_local_str(u.last_login_at) if u.last_login_at else None,
                "last_login_ip": u.last_login_ip or None,
                "last_login_ua": u.last_login_ua or None,
                "is_online": is_user_online(u.id),
            }
            for u in users
        ],
        "message": "ok",
    }


@router.post("", response_model=dict)
def create_user(payload: UserCreate, db: Session = Depends(get_db), _=Depends(require_admin)):
    # Only admin uses local password auth; all other users come from GitLab OAuth
    raise HTTPException(status_code=403, detail="请通过 GitLab 登录自动创建用户")


@router.put("/{user_id}", response_model=dict)
def update_user(user_id: int, payload: UserUpdate, db: Session = Depends(get_db), cu=Depends(require_admin)):
    user = db.query(LocalUser).filter(LocalUser.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    changes = []
    if payload.role is not None:
        if payload.role not in ROLES:
            raise HTTPException(status_code=400, detail=f"无效角色，可选: {', '.join(ROLES)}")
        user.role = payload.role
        changes.append(f"role={payload.role}")
    if payload.password:
        if user.auth_source == "gitlab":
            raise HTTPException(status_code=400, detail="GitLab 用户无需本地密码")
        user.password_hash = hash_password(payload.password)
        changes.append("password_changed")
    if payload.is_active is not None:
        user.is_active = payload.is_active
        changes.append(f"active={payload.is_active}")
    if payload.permissions is not None:
        user.permissions = payload.permissions
        changes.append(f"permissions={payload.permissions}")
    if payload.wecom_userid is not None:
        user.wecom_userid = payload.wecom_userid if payload.wecom_userid != "" else None
        changes.append(f"wecom_userid={payload.wecom_userid}")
    db.commit()
    if changes:
        log_audit(db, cu, "user_update", f"用户 {user.username}: {'; '.join(changes)}", AUDIT_CAT_USER, "medium")
    return {"code": 0, "message": "用户已更新"}


@router.put("/{user_id}/permissions", response_model=dict)
def update_user_permissions(user_id: int, payload: dict, db: Session = Depends(get_db), cu=Depends(require_admin)):
    """Bulk update user permissions."""
    user = db.query(LocalUser).filter(LocalUser.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    perms = payload.get("permissions", [])
    if not isinstance(perms, list):
        raise HTTPException(status_code=400, detail="permissions must be a list")
    valid = [p for p in perms if p in ALL_PERMISSIONS]
    user.permissions = ",".join(valid)
    db.commit()
    log_audit(db, cu, "user_permissions_update", f"用户 {user.username} 权限更新为: {sorted(valid)}", AUDIT_CAT_USER, "high")
    return {"code": 0, "data": {"permissions": sorted(valid)}, "message": "权限已更新"}


@router.put("/{user_id}/password", response_model=dict)
def reset_user_password(user_id: int, payload: PasswordReset, db: Session = Depends(get_db), cu=Depends(require_admin)):
    user = db.query(LocalUser).filter(LocalUser.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    if user.auth_source == "gitlab":
        raise HTTPException(status_code=400, detail="GitLab 用户无需本地密码")
    user.password_hash = hash_password(payload.password)
    db.commit()
    log_audit(db, cu, "user_password_reset", f"用户 {user.username} 密码已重置", AUDIT_CAT_USER, "high")
    return {"code": 0, "message": "密码已重置"}


@router.delete("/{user_id}", response_model=dict)
def delete_user(user_id: int, db: Session = Depends(get_db), _=Depends(require_admin), cu: LocalUser = Depends(get_current_user)):
    user = db.query(LocalUser).filter(LocalUser.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    try:
        uname = user.username
        db.query(UserRole).filter(UserRole.user_id == user_id).delete()
        db.delete(user)
        db.commit()
        log_audit(db, cu, "delete_user", f"username={uname!r}", AUDIT_CAT_USER, "high")
        logger.info(f"User deleted: id={user_id} username={uname!r}")
        return {"code": 0, "message": "用户已删除"}
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to delete user id={user_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
