"""Data source configuration management."""

import json
import os
import re
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.config import settings
from backend.middleware.auth import require_admin

router = APIRouter(prefix="/api/admin", tags=["admin"])

CONFIG_FILE = Path("data/source_config.json")
ENV_FILE = Path(".env")


# ── Models ──

class ZentaoConfig(BaseModel):
    base_url: str = ""
    account: str = ""
    password: str = ""
    project_filter: str = ""  # comma-separated project code prefixes
    sync_interval: str = "30"  # auto-sync interval in minutes, 0=disabled


class GitLabConfig(BaseModel):
    base_url: str = ""
    token: str = ""


class NasConfig(BaseModel):
    host: str = ""
    path: str = ""
    username: str = ""
    password: str = ""


class DataSourceConfig(BaseModel):
    zentao: ZentaoConfig = ZentaoConfig()
    gitlab: GitLabConfig = GitLabConfig()
    nas: NasConfig = NasConfig()


# ── Persistence ──

def _load_config() -> dict:
    """Load config from JSON file, fall back to env vars."""
    cfg = {
        "zentao": {
            "base_url": os.environ.get("ZENTAO_BASE_URL", ""),
            "account": os.environ.get("ZENTAO_AUTH_ACCOUNT", ""),
            "password": os.environ.get("ZENTAO_AUTH_PASSWORD", ""),
            "project_filter": os.environ.get("ZENTAO_PROJECT_FILTER", ""),
            "sync_interval": os.environ.get("SYNC_INTERVAL_MINUTES", "30"),
        },
        "gitlab": {
            "base_url": os.environ.get("GITLAB_BASE_URL", ""),
            "token": os.environ.get("GITLAB_TOKEN", ""),
        },
        "nas": {
            "host": os.environ.get("NAS_HOST", ""),
            "path": os.environ.get("NAS_PATH", ""),
            "username": os.environ.get("NAS_USERNAME", ""),
            "password": os.environ.get("NAS_PASSWORD", ""),
        },
    }
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE) as f:
                saved = json.load(f)
            for section in cfg:
                if section in saved:
                    cfg[section].update(saved[section])
        except (json.JSONDecodeError, KeyError):
            pass
    return cfg


def _save_config(cfg: dict) -> None:
    """Save config to JSON file and sync env vars to .env file."""
    CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_FILE, "w") as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)

    # Sync to .env file
    env_map = {
        "zentao.base_url": "ZENTAO_BASE_URL",
        "zentao.account": "ZENTAO_AUTH_ACCOUNT",
        "zentao.password": "ZENTAO_AUTH_PASSWORD",
        "zentao.project_filter": "ZENTAO_PROJECT_FILTER",
        "zentao.sync_interval": "SYNC_INTERVAL_MINUTES",
        "gitlab.base_url": "GITLAB_BASE_URL",
        "gitlab.token": "GITLAB_TOKEN",
        "nas.host": "NAS_HOST",
        "nas.path": "NAS_PATH",
        "nas.username": "NAS_USERNAME",
        "nas.password": "NAS_PASSWORD",
    }

    if ENV_FILE.exists():
        with open(ENV_FILE) as f:
            lines = f.readlines()
    else:
        lines = []

    for key_path, env_key in env_map.items():
        section, field = key_path.split(".")
        val = cfg.get(section, {}).get(field, "")
        _set_env_line(lines, env_key, val)

    with open(ENV_FILE, "w") as f:
        f.writelines(lines)

    # Update current process env
    for key_path, env_key in env_map.items():
        section, field = key_path.split(".")
        val = cfg.get(section, {}).get(field, "")
        if val:
            os.environ[env_key] = val
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


@router.post("/clear-db", response_model=dict)
def clear_database(_=Depends(require_admin)):
    """Clear all cached Zentao data (keep config and users)."""
    from backend.database import SessionLocal
    from backend.models.zentao import (
        CachedProject, CachedExecution, CachedTask, CachedUser,
        CachedProduct, ProductProjectLink, CachedCustomer, CustomerProjectLink,
    )
    from backend.models.bug import CachedBug
    from backend.models.delivery import DeliveryRecord

    db = SessionLocal()
    try:
        tables = [
            CachedTask, CachedExecution, CachedProject, CachedUser,
            ProductProjectLink, CachedCustomer, CustomerProjectLink,
            CachedBug, DeliveryRecord, CachedProduct,
        ]
        count = 0
        for t in tables:
            count += db.query(t).delete()
        db.commit()
        return {"code": 0, "data": {"deleted": count}, "message": f"已清除 {count} 条缓存数据"}
    except Exception as e:
        db.rollback()
        return {"code": 1, "message": f"清除失败: {e}"}
    finally:
        db.close()
