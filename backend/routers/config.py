"""Data source configuration management."""

import json
import os
import re
import base64
import hashlib
from pathlib import Path
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.config import settings
from backend.middleware.auth import require_admin, require_perm, get_current_user
from backend.audit_categories import AUDIT_CAT_SYSTEM
from backend.routers.logs import log_audit

router = APIRouter(prefix="/api/admin", tags=["admin"])

_port = os.environ.get("PMA_PORT", "8800")
CONFIG_FILE = Path(f"data/source_config-{_port}.json")
ENV_FILE = Path(".env")

# ── 密码加密落盘 ──
# source_config JSON 中的密码字段用 Fernet 对称加密后落盘，密钥由 JWT_SECRET_KEY 派生。
# 注意：JWT_SECRET_KEY 必须配置为强随机值，否则加密形同虚设。
_SECRET_FIELDS = {
    "zentao": ["password"],
    "gitlab": ["token", "app_secret"],
    "nas": ["password"],
    "svn": ["password"],
    "pdm": ["password", "ssh_password"],
    "wecom": ["secret"],
}


def _fernet() -> Fernet:
    key = hashlib.sha256(settings.JWT_SECRET_KEY.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def _encrypt_secret_fields(cfg: dict) -> dict:
    """Return a copy of cfg with secret fields encrypted (prefix 'enc:')."""
    f = _fernet()
    out = {s: dict(fields) for s, fields in cfg.items()}
    for section, fields in _SECRET_FIELDS.items():
        if section not in out:
            continue
        for field in fields:
            val = out[section].get(field)
            if val:
                out[section][field] = "enc:" + f.encrypt(val.encode()).decode()
    return out


def _decrypt_secret_fields(cfg: dict) -> dict:
    """Decrypt 'enc:'-prefixed secret fields in-place (backward-compatible with plaintext)."""
    f = _fernet()
    for section, fields in _SECRET_FIELDS.items():
        if section not in cfg:
            continue
        for field in fields:
            val = cfg[section].get(field)
            if isinstance(val, str) and val.startswith("enc:"):
                try:
                    cfg[section][field] = f.decrypt(val[4:].encode()).decode()
                except InvalidToken:
                    cfg[section][field] = ""  # 密钥变更导致无法解密，回退为空
    return cfg


# ── Models ──

class ZentaoConfig(BaseModel):
    base_url: str = ""
    account: str = ""
    password: str = ""
    project_filter: str = ""  # comma-separated project code prefixes
    sync_interval: str = "30"  # auto-sync interval in minutes, 0=disabled
    sync_releases: bool = True  # 同步禅道发布版本（GitLab URL校验数据源）
    enabled: bool = True


class GitLabConfig(BaseModel):
    base_url: str = ""
    token: str = ""
    project_path: str = ""         # PMA project path on GitLab (e.g. group/subgroup/pma)
    app_id: str = ""              # GitLab OAuth Application ID
    app_secret: str = ""          # GitLab OAuth Application Secret
    oauth_enabled: bool = False   # Enable GitLab OAuth login
    oauth_redirect_uri: str = ""  # OAuth callback URL
    enabled: bool = True


class NasConfig(BaseModel):
    host: str = ""
    username: str = ""
    password: str = ""
    enabled: bool = True


class SvnConfig(BaseModel):
    base_url: str = ""
    username: str = ""
    password: str = ""
    enabled: bool = True


class PdmConfig(BaseModel):
    base_url: str = ""
    username: str = ""
    password: str = ""
    ssh_host: str = ""
    ssh_username: str = ""
    ssh_password: str = ""
    base_path: str = ""
    enabled: bool = True


class WeComConfig(BaseModel):
    corp_id: str = ""
    secret: str = ""
    sync_interval: str = "60"
    lunch_hours: str = "1.5"
    enabled: bool = True


class DataSourceConfig(BaseModel):
    zentao: ZentaoConfig = ZentaoConfig()
    gitlab: GitLabConfig = GitLabConfig()
    nas: NasConfig = NasConfig()
    svn: SvnConfig = SvnConfig()
    pdm: PdmConfig = PdmConfig()
    wecom: WeComConfig = WeComConfig()


# ── Persistence ──

def _load_config() -> dict:
    """Load config: JSON (UI-saved, 单一配置源) 覆盖 env（仅作初始 seed）。

    优先级：data/source_config-{PORT}.json > 环境变量/.env。
    UI 保存时写 JSON（密码加密）并同步到 .env 供后端 settings 读取，保证两处一致。
    """
    cfg = {
        "zentao": {
            "base_url": os.environ.get("ZENTAO_BASE_URL", ""),
            "account": os.environ.get("ZENTAO_AUTH_ACCOUNT", ""),
            "password": os.environ.get("ZENTAO_AUTH_PASSWORD", ""),
            "project_filter": os.environ.get("ZENTAO_PROJECT_FILTER", ""),
            "sync_interval": os.environ.get("SYNC_INTERVAL_MINUTES", "30"),
            "sync_releases": os.environ.get("ZENTAO_SYNC_RELEASES", "true").lower() in ("1", "true", "yes"),
            "enabled": os.environ.get("ZENTAO_ENABLED", "true").lower() in ("1", "true", "yes"),
        },
        "gitlab": {
            "base_url": os.environ.get("GITLAB_BASE_URL", ""),
            "token": os.environ.get("GITLAB_TOKEN", ""),
            "app_id": os.environ.get("GITLAB_APP_ID", ""),
            "app_secret": os.environ.get("GITLAB_APP_SECRET", ""),
            "oauth_enabled": os.environ.get("GITLAB_OAUTH_ENABLED", "").lower() in ("1", "true", "yes"),
            "oauth_redirect_uri": os.environ.get("GITLAB_OAUTH_REDIRECT_URI", ""),
            "project_path": os.environ.get("GITLAB_PROJECT_PATH", ""),
            "enabled": os.environ.get("GITLAB_ENABLED", "true").lower() in ("1", "true", "yes"),
        },
        "nas": {
            "host": os.environ.get("NAS_HOST", ""),
            "username": os.environ.get("NAS_USERNAME", ""),
            "password": os.environ.get("NAS_PASSWORD", ""),
            "enabled": os.environ.get("NAS_ENABLED", "true").lower() in ("1", "true", "yes"),
        },
        "svn": {
            "base_url": os.environ.get("SVN_BASE_URL", ""),
            "username": os.environ.get("SVN_USERNAME", ""),
            "password": os.environ.get("SVN_PASSWORD", ""),
            "enabled": os.environ.get("SVN_ENABLED", "true").lower() in ("1", "true", "yes"),
        },
        "pdm": {
            "base_url": os.environ.get("PDM_BASE_URL", ""),
            "username": os.environ.get("PDM_USERNAME", ""),
            "password": os.environ.get("PDM_PASSWORD", ""),
            "ssh_host": os.environ.get("PDM_SSH_HOST", ""),
            "ssh_username": os.environ.get("PDM_SSH_USERNAME", ""),
            "ssh_password": os.environ.get("PDM_SSH_PASSWORD", ""),
            "base_path": os.environ.get("PDM_BASE_PATH", ""),
            "enabled": os.environ.get("PDM_ENABLED", "true").lower() in ("1", "true", "yes"),
        },
        "wecom": {
            "corp_id": os.environ.get("WECOM_CORP_ID", ""),
            "secret": os.environ.get("WECOM_SECRET", ""),
            "sync_interval": os.environ.get("WECOM_SYNC_INTERVAL", "60"),
            "lunch_hours": os.environ.get("WECOM_LUNCH_HOURS", "1.5"),
            "enabled": os.environ.get("WECOM_ENABLED", "true").lower() in ("1", "true", "yes"),
        },
    }
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE) as f:
                saved = json.load(f)
            saved = _decrypt_secret_fields(saved)
            for section in cfg:
                if section in saved:
                    cfg[section].update(saved[section])
        except (json.JSONDecodeError, KeyError):
            pass
    return cfg


def _save_config(cfg: dict) -> None:
    """Save config to JSON file (secret fields encrypted) and sync env vars to .env file."""
    CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    encrypted = _encrypt_secret_fields(cfg)
    with open(CONFIG_FILE, "w") as f:
        json.dump(encrypted, f, indent=2, ensure_ascii=False)

    # Sync to .env file
    env_map = {
        "zentao.base_url": "ZENTAO_BASE_URL",
        "zentao.account": "ZENTAO_AUTH_ACCOUNT",
        "zentao.password": "ZENTAO_AUTH_PASSWORD",
        "zentao.project_filter": "ZENTAO_PROJECT_FILTER",
        "zentao.sync_interval": "SYNC_INTERVAL_MINUTES",
        "zentao.sync_releases": "ZENTAO_SYNC_RELEASES",
        "zentao.enabled": "ZENTAO_ENABLED",
        "gitlab.base_url": "GITLAB_BASE_URL",
        "gitlab.token": "GITLAB_TOKEN",
        "gitlab.app_id": "GITLAB_APP_ID",
        "gitlab.app_secret": "GITLAB_APP_SECRET",
        "gitlab.oauth_enabled": "GITLAB_OAUTH_ENABLED",
        "gitlab.oauth_redirect_uri": "GITLAB_OAUTH_REDIRECT_URI",
        "gitlab.project_path": "GITLAB_PROJECT_PATH",
        "gitlab.enabled": "GITLAB_ENABLED",
        "nas.host": "NAS_HOST",
        "nas.username": "NAS_USERNAME",
        "nas.password": "NAS_PASSWORD",
        "nas.enabled": "NAS_ENABLED",
        "svn.base_url": "SVN_BASE_URL",
        "svn.username": "SVN_USERNAME",
        "svn.password": "SVN_PASSWORD",
        "svn.enabled": "SVN_ENABLED",
        "pdm.base_url": "PDM_BASE_URL",
        "pdm.username": "PDM_USERNAME",
        "pdm.password": "PDM_PASSWORD",
        "pdm.ssh_host": "PDM_SSH_HOST",
        "pdm.ssh_username": "PDM_SSH_USERNAME",
        "pdm.ssh_password": "PDM_SSH_PASSWORD",
        "pdm.base_path": "PDM_BASE_PATH",
        "pdm.enabled": "PDM_ENABLED",
        "wecom.corp_id": "WECOM_CORP_ID",
        "wecom.secret": "WECOM_SECRET",
        "wecom.sync_interval": "WECOM_SYNC_INTERVAL",
        "wecom.lunch_hours": "WECOM_LUNCH_HOURS",
        "wecom.enabled": "WECOM_ENABLED",
    }

    if ENV_FILE.exists():
        with open(ENV_FILE) as f:
            lines = f.readlines()
    else:
        lines = []

    for key_path, env_key in env_map.items():
        section, field = key_path.split(".")
        val = cfg.get(section, {}).get(field, "")
        if isinstance(val, bool):
            val = "true" if val else "false"
        _set_env_line(lines, env_key, val)

    with open(ENV_FILE, "w") as f:
        f.writelines(lines)

    # Update current process env
    for key_path, env_key in env_map.items():
        section, field = key_path.split(".")
        val = cfg.get(section, {}).get(field, "")
        if isinstance(val, bool):
            val = "true" if val else "false"
        if val:
            os.environ[env_key] = str(val)
        elif env_key in os.environ:
            del os.environ[env_key]


def _set_env_line(lines: list, key: str, value: str) -> None:
    """Update or append a KEY=VALUE line in a list of .env lines."""
    new_line = f'{key}={value}\n'
    for i, line in enumerate(lines):
        if line.strip().startswith(f"{key}=") or line.strip().startswith(f"# {key}="):
            lines[i] = new_line
            return
    # Append if not found
    if lines and not lines[-1].endswith("\n"):
        lines.append("\n")
    lines.append(new_line)


# ── Endpoints ──

@router.get("/config", response_model=dict)
def get_config(_=Depends(require_admin)):
    cfg = _load_config()
    return {"code": 0, "data": cfg, "message": "ok"}


@router.put("/config", response_model=dict)
def update_config(payload: DataSourceConfig, _=Depends(require_admin)):
    cfg = _load_config()
    data = payload.model_dump()

    for section in cfg:
        if section in data:
            for field in cfg[section]:
                if field in data[section]:
                    new_val = data[section][field]
                    # Keep existing password if masked value sent
                    if field in ("password", "token") and new_val and "•" in new_val:
                        continue
                    cfg[section][field] = new_val

    _save_config(cfg)
    settings.reload()  # Reload in-memory settings from updated os.environ
    return {"code": 0, "data": cfg, "message": "配置已保存"}


# ── Config Export / Import ──

@router.get("/config/export", response_model=dict)
def export_config(_=Depends(require_admin)):
    """Download current data-source config as JSON."""
    cfg = _load_config()
    return {"code": 0, "data": cfg, "message": "ok"}


class ConfigImportPayload(BaseModel):
    """Wrapper for import — accepts the full config dict."""
    zentao: ZentaoConfig = ZentaoConfig()
    gitlab: GitLabConfig = GitLabConfig()
    nas: NasConfig = NasConfig()
    svn: SvnConfig = SvnConfig()
    pdm: PdmConfig = PdmConfig()
    wecom: WeComConfig = WeComConfig()


@router.post("/config/import", response_model=dict)
async def import_config(
    file: UploadFile = File(...),
    _=Depends(require_admin),
    cu=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Import data-source config from a JSON file. Merges with existing — empty/masked secrets preserved."""
    import json as _json

    # Read and parse uploaded file
    try:
        content = await file.read()
        imported = _json.loads(content.decode("utf-8"))
    except (_json.JSONDecodeError, UnicodeDecodeError) as e:
        return {"code": 1, "message": f"JSON 解析失败: {e}"}

    # Validate structure against DataSourceConfig
    try:
        DataSourceConfig(**imported)
    except Exception as e:
        return {"code": 1, "message": f"配置格式校验失败: {e}"}

    # Merge with existing config
    cfg = _load_config()
    merged_count = 0
    skipped_count = 0

    for section in cfg:
        if section not in imported:
            continue
        for field in cfg[section]:
            if field not in imported[section]:
                continue
            new_val = imported[section][field]
            # Preserve existing secrets when imported value is empty or masked
            if field in ("password", "token", "app_secret", "secret") and (
                not new_val or "•" in str(new_val) or new_val == "****"
            ):
                skipped_count += 1
                continue
            cfg[section][field] = new_val
            merged_count += 1

    _save_config(cfg)
    settings.reload()
    log_audit(db, cu, "config_import", f"merged={merged_count} skipped={skipped_count}", AUDIT_CAT_SYSTEM)
    return {"code": 0, "data": {"merged": merged_count, "skipped": skipped_count}, "message": f"配置已导入（更新 {merged_count} 项，保留 {skipped_count} 项敏感信息不变）"}


# ── System Parameters (.env-level settings not covered by data-source config) ──

_SENSITIVE_PARAMS = {"jwt_secret_key"}

_SYSTEM_PARAM_META = {
    "jwt_secret_key":   {"label": "JWT 密钥",        "type": "password", "ph": "至少 32 字符随机字符串", "sensitive": True},
    "jwt_algorithm":    {"label": "JWT 算法",        "type": "select",   "ph": "", "options": ["HS256", "HS384", "HS512", "RS256"], "sensitive": False},
    "jwt_expire_minutes":{"label": "Token 过期(分)",  "type": "number",   "ph": "480（8小时）", "sensitive": False},
    "log_level":        {"label": "日志级别",         "type": "select",   "ph": "", "options": ["DEBUG", "INFO", "WARNING", "ERROR"], "sensitive": False},
    "CONVERT_CACHE_MAX_SIZE_MB": {
        "label": "文件转换缓存上限 (MB)", "type": "number",
        "default": "1024", "options": None, "sensitive": False,
        "info": "0 表示不限制；达到上限后按最近最少使用淘汰旧缓存文件",
    },
}

_ENV_TO_PARAM = {
    "JWT_SECRET_KEY":    "jwt_secret_key",
    "JWT_ALGORITHM":     "jwt_algorithm",
    "JWT_EXPIRE_MINUTES":"jwt_expire_minutes",
    "LOG_LEVEL":         "log_level",
    "CONVERT_CACHE_MAX_SIZE_MB": "CONVERT_CACHE_MAX_SIZE_MB",
}

_PARAM_TO_ENV = {v: k for k, v in _ENV_TO_PARAM.items()}


@router.get("/system-params", response_model=dict)
def get_system_params(_=Depends(require_admin)):
    """Return .env-level system parameters (sensitive values masked)."""
    # Read from settings object to get defaults, fall back to os.environ for values not in Settings
    defaults = settings._defaults()
    params = {}
    for env_key, param_key in _ENV_TO_PARAM.items():
        # Prefer os.environ (actual .env value), fall back to Settings default
        raw = os.environ.get(env_key)
        if raw is None and env_key in defaults:
            raw = str(defaults[env_key])
        # Fall back to _SYSTEM_PARAM_META default
        if raw is None:
            raw = _SYSTEM_PARAM_META.get(param_key, {}).get("default", "")
        if raw is None:
            raw = ""
        if param_key in _SENSITIVE_PARAMS and raw:
            params[param_key] = "••••••••"
        else:
            params[param_key] = raw
    return {"code": 0, "data": params, "message": "ok"}


class SystemParamsUpdate(BaseModel):
    jwt_secret_key: str = ""
    jwt_algorithm: str = ""
    jwt_expire_minutes: str = ""
    log_level: str = ""
    CONVERT_CACHE_MAX_SIZE_MB: str = ""


@router.put("/system-params", response_model=dict)
def update_system_params(
    payload: SystemParamsUpdate,
    _=Depends(require_admin),
    cu=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update .env-level system parameters. Masked sensitive values are preserved."""
    data = payload.model_dump()
    changed = []

    for param_key, env_key in _PARAM_TO_ENV.items():
        new_val = data.get(param_key, "")
        if not new_val:
            continue
        # Preserve existing value when masked
        if param_key in _SENSITIVE_PARAMS and "•" in new_val:
            continue
        # Validate
        meta = _SYSTEM_PARAM_META.get(param_key, {})
        if meta.get("type") == "select" and new_val not in meta.get("options", []):
            return {"code": 1, "message": f"{meta['label']}: 无效值 '{new_val}'，可选: {meta['options']}"}
        if meta.get("type") == "number":
            try:
                int(new_val)
            except ValueError:
                return {"code": 1, "message": f"{meta['label']}: 必须是整数"}

        old_val = os.environ.get(env_key, "")
        if str(new_val) != str(old_val):
            _set_env_line_all(env_key, str(new_val))
            os.environ[env_key] = str(new_val)
            changed.append(meta.get("label", param_key))
            # Apply LOG_LEVEL change to running logger
            if env_key == "LOG_LEVEL":
                import logging
                _new_level = getattr(logging, str(new_val), logging.INFO)
                logging.getLogger().setLevel(_new_level)
                logging.getLogger("backend").setLevel(_new_level)

    if changed:
        settings.reload()
        log_audit(db, cu, "system_params", f"updated: {', '.join(changed)}", AUDIT_CAT_SYSTEM)
        if "jwt_secret_key" in data and data["jwt_secret_key"] and "•" not in data["jwt_secret_key"]:
            return {"code": 0, "data": {"changed": changed}, "message": f"已更新 {len(changed)} 项。JWT 密钥已变更，所有用户需要重新登录。"}
        return {"code": 0, "data": {"changed": changed}, "message": f"已更新 {len(changed)} 项"}
    return {"code": 0, "data": {"changed": []}, "message": "无变更"}


def _set_env_line_all(key: str, value: str) -> None:
    """Update or append a single KEY=VALUE line in .env file."""
    env_path = Path(ENV_FILE)
    if env_path.exists():
        with open(env_path) as f:
            lines = f.readlines()
    else:
        lines = []
    new_line = f'{key}={value}\n'
    found = False
    for i, line in enumerate(lines):
        if line.strip().startswith(f"{key}=") or line.strip().startswith(f"# {key}="):
            lines[i] = new_line
            found = True
            break
    if not found:
        if lines and not lines[-1].endswith("\n"):
            lines.append("\n")
        lines.append(new_line)
    with open(env_path, "w") as f:
        f.writelines(lines)


# ── Project Filter (sync permission, not full admin) ──

class ProjectFilterUpdate(BaseModel):
    project_filter: str = ""


@router.get("/project-filter", response_model=dict)
def get_project_filter(_=Depends(require_perm("sync"))):
    """Get current project filter value (sync-level access)."""
    cfg = _load_config()
    pf = cfg.get("zentao", {}).get("project_filter", "")
    return {"code": 0, "data": {"project_filter": pf}, "message": "ok"}


@router.put("/project-filter", response_model=dict)
def update_project_filter(payload: ProjectFilterUpdate, _=Depends(require_perm("sync"))):
    """Update project filter value (sync-level access)."""
    cfg = _load_config()
    cfg["zentao"]["project_filter"] = payload.project_filter
    _save_config(cfg)
    settings.reload()
    return {"code": 0, "data": {"project_filter": payload.project_filter}, "message": "项目筛选已更新"}


@router.post("/clear-db", response_model=dict)
def clear_database(_=Depends(require_admin), cu = Depends(get_current_user)):
    """Clear all cached Zentao data (keep config and users)."""
    from backend.database import SessionLocal
    from backend.models.zentao import (
        CachedProject, CachedUser,
        PmaProduct, ProductProjectLink, PmaCustomer, CustomerProjectLink,
    )
    from backend.models.bug import CachedBug
    from backend.models.delivery import DeliveryRecord

    db = SessionLocal()
    try:
        # PmaProduct: only delete synced products (is_local != True)
        count = db.query(PmaProduct).filter(PmaProduct.is_local != True).delete()
        # CachedProject: only delete synced projects (is_local != True)
        count += db.query(CachedProject).filter(CachedProject.is_local != True).delete()
        # Remaining Zentao-only cached tables (all rows are synced)
        tables = [
            CachedUser,
            ProductProjectLink, PmaCustomer, CustomerProjectLink,
            CachedBug, DeliveryRecord,
        ]
        for t in tables:
            count += db.query(t).delete()
        db.commit()
        from backend.database import clean_orphan_favorites
        clean_orphan_favorites(db)
        log_audit(db, cu, "clear_database", f"deleted={count} records", AUDIT_CAT_SYSTEM)
        return {"code": 0, "data": {"deleted": count}, "message": f"已清除 {count} 条缓存数据"}
    except Exception as e:
        db.rollback()
        return {"code": 1, "message": f"清除失败: {e}"}
    finally:
        db.close()


# ── PMA App Settings ──

PMA_SETTINGS = {
    "pw_verify_delete_user": ("删除用户操作确认", "1"),
    "pw_verify_delete_cust": ("删除客户操作确认", "1"),
    "pw_verify_delete_delivery": ("删除交付记录操作确认", "1"),
    "pw_verify_clear_logs": ("清除日志操作确认", "1"),
    "pw_verify_clear_db": ("清除数据库操作确认", "1"),
    "pw_verify_maint_remove": ("维护页移除关联操作确认", "1"),
    "pw_verify_product_node_del": ("产品节点删除操作确认", "1"),
    "pw_verify_product_node_edit": ("产品节点编辑操作确认", "1"),
    "pw_verify_db_delete_backup": ("备份删除操作确认", "1"),
    "debug_perm": ("权限调试信息显示", "0"),
    "approval_enabled": ("任务审批流程", "1"),
}


@router.get("/settings", response_model=dict)
def get_pma_settings(db: Session = Depends(get_db), _=Depends(require_admin)):
    from backend.models.local import PmaSetting
    data = {}
    for key, (label, default) in PMA_SETTINGS.items():
        data[key] = {"label": label, "value": PmaSetting.get(db, key, default) == "1"}
    return {"code": 0, "data": data, "message": "ok"}


@router.get("/settings/public", response_model=dict)
def get_public_settings(db: Session = Depends(get_db)):
    """Public settings + role-permission mapping (no admin required)."""
    from backend.models.local import PmaSetting
    from backend.routers.admin_users import ROLE_LABELS, ALL_PERMISSIONS
    from backend.models.local import Role, LocalUser

    roles = db.query(Role).all()
    # Merge ROLE_LABELS (built-in defaults) with DB roles — custom roles added via
    # admin panel (e.g. FPGA) are only in the DB, not in the hardcoded dict.
    role_labels = dict(ROLE_LABELS)
    for r in roles:
        role_labels[r.key] = r.label
    perm_roles = {}
    for p in ALL_PERMISSIONS:
        perm_roles[p] = [role_labels.get(r.key, r.key) for r in roles if p in (r.permissions or "").split(",")]

    # Role leader map: {label: {leader_id, leader_name}}
    leader_ids = [r.leader_id for r in roles if r.leader_id]
    leader_name_map = {}
    if leader_ids:
        leaders = db.query(LocalUser).filter(LocalUser.id.in_(leader_ids)).all()
        leader_name_map = {u.id: u.display_name or u.username for u in leaders}
    role_leaders = {}
    for r in roles:
        role_leaders[r.label] = {
            "leader_id": r.leader_id,
            "leader_name": leader_name_map.get(r.leader_id, "") if r.leader_id else "",
        }

    return {
        "code": 0,
        "data": {
            "debug_perm": PmaSetting.get(db, "debug_perm", "0") == "1",
            "approval_enabled": PmaSetting.get(db, "approval_enabled", "1") == "1",
            "perm_roles": perm_roles,
            "role_labels": role_labels,
            "role_leaders": role_leaders,
        },
        "message": "ok",
    }


@router.put("/settings", response_model=dict)
def update_pma_settings(payload: dict, db: Session = Depends(get_db), _=Depends(require_admin)):
    from backend.models.local import PmaSetting
    for key in PMA_SETTINGS:
        if key in payload:
            PmaSetting.set(db, key, "1" if payload[key] else "0")

    # When approval is disabled, auto-complete all tasks currently in review
    if "approval_enabled" in payload and not payload["approval_enabled"]:
        from backend.models.task import Task, TaskComment
        from datetime import timezone, datetime as dt
        from backend.audit_categories import AUDIT_CAT_TASK
        review_tasks = db.query(Task).filter(Task.status == "review").all()
        now = dt.now(timezone.utc)
        for t in review_tasks:
            t.status = "done"
            t.completed_at = now
            db.add(TaskComment(task_id=t.id, user_id=0, content="审批功能已关闭，任务自动完成"))
            log_audit(db, None, "task_auto_complete",
                      f"审批关闭, task_id={t.id}, title={t.title[:60]}",
                      AUDIT_CAT_TASK, "medium")
        if review_tasks:
            db.commit()
            return {"code": 0, "message": f"设置已保存，已将 {len(review_tasks)} 个评审中任务自动完成"}
    return {"code": 0, "message": "设置已保存"}


# ── Template Task Creator Config ──

@router.get("/template-task-creator", response_model=dict)
def get_template_task_creator(db: Session = Depends(get_db), _=Depends(require_admin)):
    from backend.models.local import PmaSetting
    value = PmaSetting.get(db, "template_task_creator", "system")
    return {"code": 0, "data": {"value": value}, "message": "ok"}


class TemplateTaskCreatorUpdate(BaseModel):
    value: str  # "system" or "leader"


@router.put("/template-task-creator", response_model=dict)
def update_template_task_creator(
    payload: TemplateTaskCreatorUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
    cu=Depends(get_current_user),
):
    if payload.value not in ("system", "leader"):
        raise HTTPException(status_code=400, detail="值必须是 system 或 leader")
    from backend.models.local import PmaSetting
    old_value = PmaSetting.get(db, "template_task_creator", "system")
    PmaSetting.set(db, "template_task_creator", payload.value)
    log_audit(db, cu, "config_update",
              f"template_task_creator: {old_value} → {payload.value}",
              AUDIT_CAT_SYSTEM, "medium")
    return {"code": 0, "data": {"value": payload.value}, "message": "ok"}


# ── System Info ──

@router.get("/system-info", response_model=dict)
def get_system_info():
    """Return current git branch, version, and latest commit hash."""
    import subprocess
    try:
        branch = subprocess.check_output(
            ["git", "branch", "--show-current"],
            stderr=subprocess.DEVNULL,
            text=True
        ).strip()
    except Exception:
        branch = "unknown"
    try:
        commit = subprocess.check_output(
            ["git", "log", "-1", "--format=%h"],
            stderr=subprocess.DEVNULL,
            text=True
        ).strip()
    except Exception:
        commit = "unknown"
    try:
        commit_full = subprocess.check_output(
            ["git", "log", "-1", "--format=%H"],
            stderr=subprocess.DEVNULL,
            text=True
        ).strip()
    except Exception:
        commit_full = "unknown"
    # Read version from index.html
    import re
    version = "unknown"
    try:
        idx_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "frontend", "index.html")
        with open(idx_path) as f:
            content = f.read()
        m = re.search(r'id="app-version">([^<]+)<', content)
        if m:
            version = m.group(1)
    except Exception:
        pass
    return {
        "code": 0,
        "data": {
            "branch": branch,
            "version": version,
            "commit": commit,
            "commit_full": commit_full,
        },
        "message": "ok",
    }


# ── Debug: Clear SVN data ──

@router.post("/clear-svn", response_model=dict)
def clear_svn_data(db: Session = Depends(get_db), user=Depends(require_perm("sync"))):
    """Clear all SVN-synced data for debugging."""
    from backend.models.document import ProductDocument
    cleared = db.query(ProductDocument).filter(
        ProductDocument.doc_type == "svn"
    ).update({ProductDocument.location: None, ProductDocument.status: "pending",
              ProductDocument.uploaded_at: None, ProductDocument.completed_at: None,
              ProductDocument.svn_author: None, ProductDocument.svn_last_modified: None,
              ProductDocument.svn_rev: None}, synchronize_session=False)
    db.commit()
    log_audit(db, user, "clear_svn", f"清除SVN同步数据: {cleared}条", AUDIT_CAT_SYSTEM, "high")
    return {"code": 0, "data": {"cleared": cleared}, "message": f"已清除{cleared}条SVN数据"}


@router.post("/clear-solidworks", response_model=dict)
def clear_solidworks_data(db: Session = Depends(get_db), user=Depends(require_perm("sync"))):
    """Clear all SOLIDWORKS PDM-synced data for debugging."""
    from backend.models.document import ProductDocument
    cleared = db.query(ProductDocument).filter(
        ProductDocument.doc_type == "solidworks"
    ).update({ProductDocument.location: None, ProductDocument.status: "pending",
              ProductDocument.uploaded_at: None, ProductDocument.completed_at: None,
              ProductDocument.svn_author: None, ProductDocument.svn_last_modified: None,
              ProductDocument.svn_rev: None}, synchronize_session=False)
    db.commit()
    log_audit(db, user, "clear_solidworks", f"清除PDM同步数据: {cleared}条", AUDIT_CAT_SYSTEM, "high")
    return {"code": 0, "data": {"cleared": cleared}, "message": f"已清除{cleared}条PDM数据"}


# ── Changelog ──

@router.get("/changelog", response_model=dict)
def get_changelog():
    """Return recent version changelog entries from dev-plan.md."""
    import re as _re
    devplan_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
                                 "docs", "dev-plan.md")
    entries = []
    try:
        with open(devplan_path) as f:
            content = f.read()
        # Parse version history table: | date | version | description |
        pattern = _re.compile(r'\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*(v[\d.]+-beta\d+)\s*\|\s*(.+?)\s*\|')
        for m in pattern.finditer(content):
            entries.append({"date": m.group(1), "version": m.group(2), "description": m.group(3)})
    except Exception:
        pass
    return {"code": 0, "data": entries, "message": "ok"}


# ── Connection Test ──

def _encode_url(url: str) -> str:
    """Percent-encode non-ASCII characters in a URL path/query."""
    import urllib.parse
    scheme, netloc, path, query, fragment = urllib.parse.urlsplit(url)
    path = urllib.parse.quote(path, safe="/:@%")
    query = urllib.parse.quote(query, safe="=&%")
    return urllib.parse.urlunsplit((scheme, netloc, path, query, fragment))


@router.post("/test-connection/{source}", response_model=dict)
def test_connection(source: str, _=Depends(require_admin)):
    """Test connectivity for a given data source using saved config."""
    import urllib.request
    import urllib.error

    cfg = _load_config()
    section = cfg.get(source)
    if not section:
        return {"code": 1, "message": f"未知数据源: {source}"}

    if not section.get("enabled", True):
        return {"code": 0, "data": {"ok": False, "detail": "数据源已禁用"}, "message": "ok"}

    try:
        if source == "zentao":
            url = section.get("base_url", "")
            if not url:
                return {"code": 0, "data": {"ok": False, "detail": "未配置 API 地址"}, "message": "ok"}
            req = urllib.request.Request(url, method="GET")
            resp = urllib.request.urlopen(req, timeout=10)
            return {"code": 0, "data": {"ok": True, "detail": f"HTTP {resp.status} — 连接成功"}, "message": "ok"}

        elif source == "gitlab":
            token = section.get("token", "")
            base_url = section.get("base_url", "")
            if not token or not base_url:
                return {"code": 0, "data": {"ok": False, "detail": "未配置 Token 或 API 地址"}, "message": "ok"}
            url = base_url.rstrip("/") + "/version"
            req = urllib.request.Request(url, headers={"PRIVATE-TOKEN": token})
            resp = urllib.request.urlopen(req, timeout=10)
            body = json.loads(resp.read().decode())
            ver = body.get("version", "unknown")
            return {"code": 0, "data": {"ok": True, "detail": f"GitLab {ver} — 连接成功"}, "message": "ok"}

        elif source == "nas":
            host = section.get("host", "")
            if not host:
                return {"code": 0, "data": {"ok": False, "detail": "未配置主机地址"}, "message": "ok"}
            return {"code": 0, "data": {"ok": True, "detail": f"主机 {host} 已配置"}, "message": "ok"}

        elif source == "svn":
            url = section.get("base_url", "")
            username = section.get("username", "")
            password = section.get("password", "")
            if not url:
                return {"code": 0, "data": {"ok": False, "detail": "未配置 SVN 地址"}, "message": "ok"}
            # Percent-encode non-ASCII characters in URL
            url = _encode_url(url)
            data = '<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><prop><resourcetype/></prop></propfind>'
            req = urllib.request.Request(url, data=data.encode(), method="PROPFIND",
                                          headers={"Depth": "0", "Content-Type": "application/xml"})
            if username and password:
                import base64
                cred = base64.b64encode(f"{username}:{password}".encode()).decode()
                req.add_header("Authorization", f"Basic {cred}")
            resp = urllib.request.urlopen(req, timeout=10)
            return {"code": 0, "data": {"ok": True, "detail": f"HTTP {resp.status} — SVN 连接成功"}, "message": "ok"}

        elif source == "pdm":
            ssh_host = section.get("ssh_host", "")
            ssh_user = section.get("ssh_username", "")
            ssh_pass = section.get("ssh_password", "")
            base_path = section.get("base_path", "")
            if not ssh_host or not ssh_user:
                return {"code": 0, "data": {"ok": False, "detail": "未配置 SSH 主机或用户名"}, "message": "ok"}
            import paramiko
            ssh = paramiko.SSHClient()
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            try:
                ssh.connect(ssh_host, username=ssh_user, password=ssh_pass,
                             look_for_keys=False, allow_agent=False, timeout=10)
                # Test: run dir on base_path
                cmd = f'dir /b "{base_path}"' if base_path else "echo PDM SSH OK"
                _, stdout, _ = ssh.exec_command(cmd, timeout=10)
                output = stdout.read().decode("gbk", errors="replace").strip()
                ssh.close()
                lines = output.split("\n")[:5] if output else []
                detail = f"SSH 连接成功 — {base_path or 'PDM'} ({len(lines)} 项)"
                return {"code": 0, "data": {"ok": True, "detail": detail}, "message": "ok"}
            except Exception as e:
                try:
                    ssh.close()
                except Exception:
                    pass
                return {"code": 0, "data": {"ok": False, "detail": f"SSH 连接失败: {str(e)[:120]}"}, "message": "ok"}

        elif source == "wecom":
            corp_id = section.get("corp_id", "")
            secret = section.get("secret", "")
            if not corp_id or not secret:
                return {"code": 0, "data": {"ok": False, "detail": "未配置 CorpID 或 Secret"}, "message": "ok"}
            url = f"https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid={corp_id}&corpsecret={secret}"
            req = urllib.request.Request(url, method="GET")
            resp = urllib.request.urlopen(req, timeout=10)
            body = json.loads(resp.read().decode())
            if body.get("errcode") == 0:
                return {"code": 0, "data": {"ok": True, "detail": "企业微信 Token 获取成功"}, "message": "ok"}
            else:
                return {"code": 0, "data": {"ok": False, "detail": f"企业微信错误: {body.get('errmsg', '未知')}"}, "message": "ok"}

        else:
            return {"code": 1, "message": f"不支持的数据源: {source}"}

    except urllib.error.HTTPError as e:
        return {"code": 0, "data": {"ok": False, "detail": f"HTTP {e.code} — {e.reason}"}, "message": "ok"}
    except urllib.error.URLError as e:
        return {"code": 0, "data": {"ok": False, "detail": f"连接失败: {e.reason}"}, "message": "ok"}
    except Exception as e:
        return {"code": 0, "data": {"ok": False, "detail": f"测试异常: {str(e)[:120]}"}, "message": "ok"}
