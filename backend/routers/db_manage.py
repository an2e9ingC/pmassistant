"""Database management — export/import/backup/rekey (admin only)."""

import hashlib
import os
import shlex
import shutil
import subprocess
import time
import glob
import logging
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, UploadFile, File
from fastapi.responses import FileResponse
from typing import List, Optional

from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.config import settings, beijing_now
from backend.database import get_db, _db_path, _is_sqlcipher_enabled, _HAS_SQLCIPHER
from backend.middleware.auth import require_admin, get_current_user
from backend.models.local import LocalUser, PmaSetting
from backend.audit_categories import AUDIT_CAT_SYSTEM
from backend.routers.logs import log_audit

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/db", tags=["db-manage"])

BACKUP_DIR = Path(_db_path).parent / "backups"
HOTBACK_DIR = BACKUP_DIR / "hotback"                   # rolling backups
PERMANENT_BACKUP_DIR = BACKUP_DIR / "permanent"         # permanent backups (remote sync source)

# Lazy migration flag
_migration_done = False

# Shared with gen-sqlcipher-key.py — keep in sync
_SQLCIPHER_SALT = b"pma-sqlcipher-salt-v1"
_SQLCIPHER_ITERATIONS = 1_000_000
_SQLCIPHER_KEY_LENGTH = 32


def _derive_sqlcipher_key(passphrase: str) -> str:
    """Derive 64-char hex key from passphrase using PBKDF2."""
    dk = hashlib.pbkdf2_hmac(
        "sha512",
        passphrase.encode("utf-8"),
        _SQLCIPHER_SALT,
        _SQLCIPHER_ITERATIONS,
        dklen=_SQLCIPHER_KEY_LENGTH,
    )
    return dk.hex()

# ── Backup Config ──

class BackupConfig(BaseModel):
    interval_minutes: int = 0      # 0 = disabled
    retention_count: int = 5       # max rolling backups to keep
    keep_interval_hours: int = 0   # 0 = never keep; >0 = keep permanent copy every N hours
    max_permanent_count: int = 10  # max permanent backups to keep (oldest removed when exceeded)


# ── Remote Backup Config ──

class RemoteBackupConfig(BaseModel):
    enabled: bool = False
    remote_type: str = "nas"       # "nas" | "svn"
    remote_path: str = ""          # local mount path (/mnt/nas-backup) or SMB URL (//192.168.0.180/PMABackup)
    remote_username: str = ""      # SMB username (optional, for SMB auth)
    remote_password: str = ""      # SMB password (optional, for SMB auth)


def _get_env_path() -> Path:
    """Resolve the .env file path relative to the project root."""
    db_dir = Path(_db_path).parent  # data/
    project_root = db_dir.parent    # project root
    env_path = project_root / ".env"
    if not env_path.exists():
        # Fallback: try relative to CWD
        env_path = Path(".env")
    return env_path


def _get_remote_config(db: Session) -> RemoteBackupConfig:
    """Read remote backup config from PmaSetting."""
    return RemoteBackupConfig(
        enabled=PmaSetting.get(db, "db_backup_remote_enabled", "0") == "1",
        remote_type=PmaSetting.get(db, "db_backup_remote_type", "nas"),
        remote_path=PmaSetting.get(db, "db_backup_remote_path", ""),
        remote_username=PmaSetting.get(db, "db_backup_remote_username", ""),
        remote_password=PmaSetting.get(db, "db_backup_remote_password", ""),
    )


# ── Tree-structure helpers ──

def _hotback_folder(t: str) -> Path:
    """Create and return HOTBACK_DIR / t."""
    p = HOTBACK_DIR / t
    p.mkdir(parents=True, exist_ok=True)
    return p


def _perm_folder(t: str) -> Path:
    """Create and return PERMANENT_BACKUP_DIR / t."""
    p = PERMANENT_BACKUP_DIR / t
    p.mkdir(parents=True, exist_ok=True)
    return p


def _backup_file_path(folder: Path, sub: str, filename: str) -> Path:
    """Create subfolder and return full path to a backup file."""
    dest = folder / sub
    dest.mkdir(parents=True, exist_ok=True)
    return dest / filename


def _find_backup_file(name: str):
    """Find a backup file in the tree structure.

    Searches PERMANENT_BACKUP_DIR first, then HOTBACK_DIR (recursively).
    Returns (Path, is_permanent) or (None, False).
    """
    safe_name = os.path.basename(name)
    for d, is_perm in [(PERMANENT_BACKUP_DIR, True), (HOTBACK_DIR, False)]:
        if not d.exists():
            continue
        for f in d.rglob(safe_name):
            if f.is_file():
                return f, is_perm
    return None, False


def _find_companion_files(file_path: Path) -> list:
    """Find companion files (env, uploads) in the same timestamp folder as file_path."""
    companions = []
    # file_path is like .../hotback/20260802-120000/db/pma-backup-xxx.db
    # or .../permanent/20260802-120000/db/pma-backup-xxx-keep.db
    ts_folder = file_path.parent.parent  # go up from db/ to timestamp/
    for sub in ("env", "uploads"):
        sub_dir = ts_folder / sub
        if sub_dir.exists() and sub_dir.is_dir():
            for f in sub_dir.iterdir():
                if f.is_file():
                    companions.append(f)
    return companions


def _clean_empty_parents(file_path: Path):
    """Remove empty sub/ and timestamp/ parent directories after deleting a backup file."""
    # Remove the sub folder (db/, env/, or uploads/) if empty
    sub_dir = file_path.parent
    try:
        if sub_dir.exists() and not any(sub_dir.iterdir()):
            sub_dir.rmdir()
    except OSError:
        pass
    # Remove the timestamp folder if empty
    ts_dir = sub_dir.parent
    try:
        if ts_dir.exists() and ts_dir != HOTBACK_DIR and ts_dir != PERMANENT_BACKUP_DIR:
            if not any(ts_dir.iterdir()):
                shutil.rmtree(ts_dir)
    except OSError:
        pass


def _collect_backup_items(remote_names: set) -> list:
    """Walk HOTBACK_DIR and PERMANENT_BACKUP_DIR trees and build backup item dicts."""
    items = []
    for d, is_perm in [(HOTBACK_DIR, False), (PERMANENT_BACKUP_DIR, True)]:
        if not d.exists():
            continue
        for f in sorted(d.rglob("*"), key=lambda p: p.stat().st_mtime, reverse=True):
            if not f.is_file():
                continue
            if "-before-" in f.name:
                continue
            items.append(_build_backup_item(f, is_perm, remote_names))
    return items


def _remote_subdir_for(file_path: Path, base_dir: Path) -> str:
    """Calculate the relative subdirectory path from base_dir to file_path's parent.

    e.g., for permanent/20260802-120000/db/xxx.db relative to permanent/
    returns 'permanent/20260802-120000/db'
    """
    try:
        rel = file_path.parent.relative_to(base_dir.parent)  # relative to data/backups/
        return str(rel).replace("\\", "/")
    except ValueError:
        return ""


def _sync_permanent_backups(db: Session) -> dict:
    """Sync all permanent backup files not yet on remote, preserving tree structure."""
    config = _get_remote_config(db)
    if not config.enabled or not config.remote_path or config.remote_type == "svn":
        return {"synced": [], "failed": [], "skipped": []}

    remote_names = _remote_file_names(db)
    synced, failed, skipped = [], [], []

    if not PERMANENT_BACKUP_DIR.exists():
        return {"synced": [], "failed": [], "skipped": []}

    for f in sorted(PERMANENT_BACKUP_DIR.rglob("*"), key=lambda p: p.stat().st_mtime, reverse=True):
        if not f.is_file():
            continue
        name = f.name
        if name in remote_names:
            skipped.append(name)
            continue
        subdir = _remote_subdir_for(f, PERMANENT_BACKUP_DIR)
        if _sync_file_to_nas(f, config.remote_path, config, subdir):
            synced.append(name)
            remote_names.add(name)
        else:
            failed.append(name)

    if synced:
        logger.info(f"Permanent backup sync complete: {len(synced)} synced, {len(skipped)} skipped")
    return {"synced": synced, "failed": failed, "skipped": skipped}


def _sync_file_to_nas(src: Path, dest_dir: str, config: RemoteBackupConfig, remote_subdir: str = "") -> bool:
    """Copy a single file to NAS remote, preserving directory structure.

    Supports two modes:
    1. Local mount path (starts with '/'): direct shutil.copy2
    2. SMB URL (//server/share or \\\\server\\share): uses smbclient subprocess

    If remote_subdir is provided (e.g., 'permanent/20260802-120000/db'),
    the file is placed in that subdirectory on the remote.

    Returns True on success, False on failure.
    """
    # Normalize: convert Windows UNC backslashes to forward slashes
    normalized = dest_dir.replace("\\", "/")

    # Mode 1: Local mount path
    if normalized.startswith("/") and not normalized.startswith("//"):
        try:
            dest = Path(normalized)
            if remote_subdir:
                dest = dest / remote_subdir
            dest.mkdir(parents=True, exist_ok=True)
            dest_file = dest / src.name
            shutil.copy2(str(src), str(dest_file))
            logger.info(f"Synced to NAS (local): {src.name} -> {dest_file}")
            return True
        except Exception as e:
            logger.error(f"Failed to sync to NAS (local): {src.name} -> {dest_dir}: {e}")
            return False

    # Mode 2: SMB URL — use smbclient
    # Accept both //server/share (Unix) and \\\\server\\share (Windows UNC)
    if normalized.startswith("//"):
        # Parse //server/share[/subdir]
        parts = normalized.strip("/").split("/")
        if len(parts) < 2:
            logger.error(f"Invalid SMB path: {dest_dir}")
            return False
        server = parts[0]
        share = parts[1]
        base_subdir = "/".join(parts[2:]) if len(parts) > 2 else ""

        try:
            cmd = ["smbclient", f"//{server}/{share}"]
            if config.remote_password:
                cmd.extend(["-U", f"{config.remote_username}%{config.remote_password}"])
            elif config.remote_username:
                cmd.extend(["-U", config.remote_username])
            else:
                cmd.append("-N")

            put_cmds = []
            # Build the full remote directory path
            full_subdir = "/".join(filter(None, [base_subdir, remote_subdir]))
            if full_subdir:
                # Create intermediate directories
                for part in full_subdir.split("/"):
                    if part:
                        put_cmds.append(f"mkdir {part}")
                        put_cmds.append(f"cd {part}")
            put_cmds.append(f"put {shlex.quote(str(src))} {src.name}")
            put_cmds.append("exit")

            input_str = "\n".join(put_cmds)
            result = subprocess.run(
                cmd,
                input=input_str,
                capture_output=True, text=True,
                timeout=30,
            )
            if result.returncode == 0:
                logger.info(f"Synced to NAS (SMB): {src.name} -> {dest_dir}/{remote_subdir or ''}")
                return True
            else:
                logger.error(f"smbclient failed for {src.name}: {result.stderr.strip()}")
                return False
        except FileNotFoundError:
            logger.error("smbclient not installed — cannot sync to SMB NAS")
            return False
        except subprocess.TimeoutExpired:
            logger.error(f"smbclient timed out for {src.name}")
            return False
        except Exception as e:
            logger.error(f"Failed to sync to NAS (SMB): {src.name} -> {dest_dir}: {e}")
            return False

    logger.error(f"Unsupported remote path format: {dest_dir}")
    return False


def _sync_to_remote(db_path: Path, env_backup_path: Path, db: Session, upload_path: Path = None) -> dict:
    """Sync backup files (.db + .env + uploads) to remote.

    Returns a dict with sync results: {ok: bool, synced: [str], failed: [str]}
    """
    config = _get_remote_config(db)
    if not config.enabled or not config.remote_path:
        return {"ok": True, "synced": [], "failed": [], "message": "远端备份未启用"}

    if config.remote_type == "svn":
        logger.info("Remote backup: SVN support not yet implemented")
        return {"ok": False, "synced": [], "failed": [], "message": "SVN 远端备份暂未支持"}

    synced = []
    failed = []

    # Collect all files to sync
    files_to_sync = []
    if db_path and db_path.exists():
        files_to_sync.append(db_path)
    if env_backup_path and env_backup_path.exists():
        files_to_sync.append(env_backup_path)
    if upload_path and upload_path.exists():
        files_to_sync.append(upload_path)

    for f in files_to_sync:
        if _sync_file_to_nas(f, config.remote_path, config):
            synced.append(f.name)
        else:
            failed.append(f.name)

    ok = len(failed) == 0
    if ok and synced:
        logger.info(f"Remote sync complete: {len(synced)} files synced")
    return {
        "ok": ok,
        "synced": synced,
        "failed": failed,
        "message": f"已同步 {len(synced)} 个文件" + (f"，{len(failed)} 个失败" if failed else ""),
    }


@router.get("/sqlcipher-status", response_model=dict)
def get_sqlcipher_status(_=Depends(require_admin)):
    """Check if SQLCipher encryption is available and enabled."""
    return {
        "code": 0,
        "data": {
            "enabled": _is_sqlcipher_enabled(),
            "library_available": _HAS_SQLCIPHER,
            "key_configured": bool(settings.SQLCIPHER_KEY),
        },
        "message": "ok",
    }


# Migration map: old keep_interval strings → hours
_KEEP_INTERVAL_MAP = {"none": 0, "daily": 24, "weekly": 168, "monthly": 720}


def _parse_keep_hours(db, raw: str) -> int:
    """Parse keep_interval value, migrating old string values to int hours."""
    try:
        return int(raw)
    except (ValueError, TypeError):
        hours = _KEEP_INTERVAL_MAP.get(raw, 0)
        # Auto-migrate: update the setting to the new int format
        PmaSetting.set(db, "db_backup_keep_interval", str(hours))
        return hours


@router.get("/backup-config", response_model=dict)
def get_backup_config(_=Depends(require_admin), db: Session = Depends(get_db)):
    """Get auto-backup configuration."""
    interval = PmaSetting.get(db, "db_backup_interval", "0")
    retention = PmaSetting.get(db, "db_backup_retention", "5")
    keep_raw = PmaSetting.get(db, "db_backup_keep_interval", "0")
    keep_hours = _parse_keep_hours(db, keep_raw)
    max_perm = PmaSetting.get(db, "db_backup_max_permanent", "10")
    return {
        "code": 0,
        "data": {
            "interval_minutes": int(interval),
            "retention_count": int(retention),
            "keep_interval_hours": keep_hours,
            "max_permanent_count": int(max_perm),
        },
        "message": "ok",
    }


@router.put("/backup-config", response_model=dict)
def update_backup_config(payload: BackupConfig, _=Depends(require_admin), db: Session = Depends(get_db)):
    """Update auto-backup configuration."""
    PmaSetting.set(db, "db_backup_interval", str(max(0, payload.interval_minutes)))
    PmaSetting.set(db, "db_backup_retention", str(max(1, payload.retention_count)))
    PmaSetting.set(db, "db_backup_keep_interval", str(max(0, payload.keep_interval_hours)))
    PmaSetting.set(db, "db_backup_max_permanent", str(max(1, payload.max_permanent_count)))
    return {"code": 0, "message": "备份配置已更新"}


# ── Remote Backup Config ──

@router.get("/remote-backup-config", response_model=dict)
def get_remote_backup_config(_=Depends(require_admin), db: Session = Depends(get_db)):
    """Get remote backup configuration."""
    config = _get_remote_config(db)
    return {
        "code": 0,
        "data": {
            "enabled": config.enabled,
            "remote_type": config.remote_type,
            "remote_path": config.remote_path,
            "remote_username": config.remote_username,
            # Password is masked in response
            "remote_password": "****" if config.remote_password else "",
            "has_password": bool(config.remote_password),
        },
        "message": "ok",
    }


@router.put("/remote-backup-config", response_model=dict)
def update_remote_backup_config(
    payload: RemoteBackupConfig,
    _=Depends(require_admin),
    cu=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update remote backup configuration."""
    if payload.remote_type not in ("nas", "svn"):
        return {"code": 1, "message": "远端类型无效，仅支持 nas 或 svn"}

    PmaSetting.set(db, "db_backup_remote_enabled", "1" if payload.enabled else "0")
    PmaSetting.set(db, "db_backup_remote_type", payload.remote_type)
    PmaSetting.set(db, "db_backup_remote_path", payload.remote_path.strip())
    PmaSetting.set(db, "db_backup_remote_username", payload.remote_username.strip())

    # Only update password if a non-masked value is provided
    if payload.remote_password and payload.remote_password != "****":
        PmaSetting.set(db, "db_backup_remote_password", payload.remote_password)

    log_audit(db, cu, "db_remote_backup_config",
              f"更新远端备份配置: enabled={payload.enabled}, type={payload.remote_type}, path={payload.remote_path}",
              AUDIT_CAT_SYSTEM)
    return {"code": 0, "message": "远端备份配置已更新"}


@router.post("/remote-backup/test", response_model=dict)
def test_remote_connection(
    _=Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Test connection to the remote backup server."""
    config = _get_remote_config(db)

    if not config.remote_path:
        return {"code": 1, "message": "请先配置远端路径"}

    if config.remote_type == "svn":
        return {"code": 1, "message": "SVN 远端备份暂未支持"}

    # Test by creating a temporary file and trying to sync it
    import tempfile
    tmp_file = None
    try:
        fd, tmp_path = tempfile.mkstemp(suffix=".txt", prefix="pma-conn-test-")
        os.write(fd, f"PMA connection test — {beijing_now().isoformat()}\n".encode())
        os.close(fd)
        tmp_file = Path(tmp_path)

        # Check if smbclient is available for SMB paths
        normalized = config.remote_path.replace("\\", "/")
        if normalized.startswith("//"):
            if not shutil.which("smbclient"):
                return {"code": 1, "message": "未安装 smbclient，无法直连 SMB 共享。请在服务器执行: sudo apt install smbclient，或先将 NAS 挂载到本地目录后使用本地路径（如 /mnt/nas-backup）"}

        success = _sync_file_to_nas(tmp_file, config.remote_path, config)
        if success:
            # Clean up the test file from remote
            try:
                _delete_remote_file(tmp_file.name, config)
            except Exception:
                pass
            return {"code": 0, "message": f"连接成功 — 已成功写入 {config.remote_path}"}
        else:
            return {"code": 1, "message": f"连接失败 — 无法写入 {config.remote_path}，请检查路径和凭据。SMB 路径（//开头）需安装 smbclient；如 NAS 已挂载到本地，请使用本地路径（/mnt/xxx）"}
    except Exception as e:
        return {"code": 1, "message": f"连接测试失败: {e}"}
    finally:
        if tmp_file and tmp_file.exists():
            try:
                tmp_file.unlink()
            except Exception:
                pass


def _delete_remote_file(filename: str, config: RemoteBackupConfig):
    """Delete a file from remote NAS (used to clean up test files)."""
    dest_dir = config.remote_path
    normalized = dest_dir.replace("\\", "/")

    if normalized.startswith("/") and not normalized.startswith("//"):
        remote_dir = Path(normalized)
        if remote_dir.exists():
            for f in remote_dir.rglob(filename):
                if f.is_file():
                    f.unlink()
                    # Clean empty parent dirs
                    try:
                        parent = f.parent
                        while parent != remote_dir and parent.exists():
                            if not any(parent.iterdir()):
                                parent.rmdir()
                                parent = parent.parent
                            else:
                                break
                    except OSError:
                        pass
                    return
        return

    if normalized.startswith("//"):
        parts = normalized.strip("/").split("/")
        if len(parts) < 2:
            return
        server, share = parts[0], parts[1]
        subdir = "/".join(parts[2:]) if len(parts) > 2 else ""

        cmd = ["smbclient", f"//{server}/{share}"]
        if config.remote_password:
            cmd.extend(["-U", f"{config.remote_username}%{config.remote_password}"])
        elif config.remote_username:
            cmd.extend(["-U", config.remote_username])
        else:
            cmd.append("-N")

        cmds = []
        if subdir:
            cmds.append(f"cd {subdir}")
        cmds.append(f"rm {filename}")
        cmds.append("exit")

        subprocess.run(cmd, input="\n".join(cmds), capture_output=True, text=True, timeout=15)


@router.post("/remote-backup/sync-now", response_model=dict)
def sync_to_remote_now(
    _=Depends(require_admin),
    cu=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Manually trigger a sync of the latest backup to remote."""
    config = _get_remote_config(db)

    if not config.enabled:
        return {"code": 1, "message": "远端备份未启用，请先配置并启用"}
    if not config.remote_path:
        return {"code": 1, "message": "请先配置远端路径"}

    if config.remote_type == "svn":
        return {"code": 1, "message": "SVN 远端备份暂未支持"}

    # Check smbclient for SMB paths
    normalized = config.remote_path.replace("\\", "/")
    if normalized.startswith("//") and not shutil.which("smbclient"):
        return {"code": 1, "message": "未安装 smbclient，无法直连 SMB 共享。请在服务器安装 smbclient 或先将 NAS 挂载到本地目录"}

    # Find the latest permanent backup folder
    PERMANENT_BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    perm_folders = sorted(
        [d for d in PERMANENT_BACKUP_DIR.iterdir() if d.is_dir()],
        key=lambda d: d.stat().st_mtime, reverse=True,
    )

    if not perm_folders:
        return {"code": 1, "message": "没有永久备份可同步，请先等待自动备份生成永久副本"}

    latest_perm = perm_folders[0]
    # Collect all files in this permanent folder
    files_to_sync = [f for f in latest_perm.rglob("*") if f.is_file()]
    if not files_to_sync:
        return {"code": 1, "message": "永久备份文件夹为空"}

    synced, failed = [], []
    for f in files_to_sync:
        subdir = _remote_subdir_for(f, PERMANENT_BACKUP_DIR)
        if _sync_file_to_nas(f, config.remote_path, config, subdir):
            synced.append(f.name)
        else:
            failed.append(f.name)

    ok = len(failed) == 0
    log_audit(db, cu, "db_remote_backup_sync",
              f"手动同步远端备份: permanent/{latest_perm.name} ({len(synced)} files)",
              AUDIT_CAT_SYSTEM)

    return {
        "code": 0 if ok else 1,
        "data": {"synced": synced, "failed": failed},
        "message": f"已同步 {len(synced)} 个文件" + (f"，{len(failed)} 个失败" if failed else ""),
    }


@router.post("/sync-all-to-remote", response_model=dict)
def sync_all_to_remote(
    _=Depends(require_admin),
    cu=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Sync all local backups that haven't been synced to remote yet."""
    config = _get_remote_config(db)
    if not config.enabled:
        return {"code": 1, "message": "远端备份未启用"}
    if config.remote_type == "svn":
        return {"code": 1, "message": "SVN 远端备份暂未支持"}

    # Only scan PERMANENT_BACKUP_DIR (not hotback)
    PERMANENT_BACKUP_DIR.mkdir(parents=True, exist_ok=True)

    # Gather all permanent backup files
    local_files = []
    if PERMANENT_BACKUP_DIR.exists():
        for f in PERMANENT_BACKUP_DIR.rglob("*"):
            if f.is_file() and "-before-" not in f.name:
                local_files.append(f)

    # Get remote file names
    remote_names = _remote_file_names(db)

    synced = []
    skipped = []
    failed = []

    for f in local_files:
        name = f.name
        if name in remote_names:
            skipped.append(name)
            continue
        subdir = _remote_subdir_for(f, PERMANENT_BACKUP_DIR)
        if _sync_file_to_nas(f, config.remote_path, config, subdir):
            synced.append(name)
            remote_names.add(name)
        else:
            failed.append(name)

    log_audit(db, cu, "db_remote_backup_sync_all",
              f"批量同步到远端: {len(synced)} 已同步, {len(skipped)} 跳过, {len(failed)} 失败",
              AUDIT_CAT_SYSTEM)

    return {
        "code": 0,
        "data": {"synced": synced, "skipped": skipped, "failed": failed},
        "message": f"已同步 {len(synced)} 个, 跳过 {len(skipped)} 个" + (f", {len(failed)} 个失败" if failed else ""),
    }


# ── Remote Backup List ──

def _list_remote_files(config: RemoteBackupConfig) -> List[dict]:
    """List backup files on the remote NAS.

    Returns a list of {name, size, size_display, created_at}.
    Returns empty list on failure or if remote is unreachable.
    """
    normalized = config.remote_path.replace("\\", "/")

    # Mode 1: Local mount path — recursive listing
    if normalized.startswith("/") and not normalized.startswith("//"):
        try:
            remote_dir = Path(normalized)
            if not remote_dir.exists() or not remote_dir.is_dir():
                return []
            items = []
            for f in sorted(remote_dir.rglob("*"), key=lambda p: p.stat().st_mtime, reverse=True):
                if not f.is_file():
                    continue
                st = f.stat()
                # Calculate relative path from remote_dir (for tree structure)
                try:
                    rel_path = str(f.relative_to(remote_dir))
                except ValueError:
                    rel_path = f.name
                items.append({
                    "name": f.name,
                    "size": st.st_size,
                    "size_display": _format_size(st.st_size),
                    "created_at": _backup_iso_time(st.st_mtime),
                    "rel_path": rel_path.replace("\\", "/"),
                })
            return items
        except Exception as e:
            logger.error(f"Failed to list remote files (local): {e}")
            return []

    # Mode 2: SMB URL — use smbclient with recursive ls
    if normalized.startswith("//"):
        if not shutil.which("smbclient"):
            return []

        parts = normalized.strip("/").split("/")
        if len(parts) < 2:
            return []
        server, share = parts[0], parts[1]
        base_subdir = "/".join(parts[2:]) if len(parts) > 2 else ""

        try:
            cmd = ["smbclient", f"//{server}/{share}"]
            if config.remote_password:
                cmd.extend(["-U", f"{config.remote_username}%{config.remote_password}"])
            elif config.remote_username:
                cmd.extend(["-U", config.remote_username])
            else:
                cmd.append("-N")

            # Build recursive listing commands
            cmds = []
            if base_subdir:
                cmds.append(f"cd {base_subdir}")
            # First list top-level to discover directories, then recurse
            cmds.append("recurse")
            cmds.append("ls")
            cmds.append("exit")

            result = subprocess.run(
                cmd, input="\n".join(cmds),
                capture_output=True, text=True, timeout=30,
            )
            if result.returncode != 0:
                logger.error(f"smbclient ls failed: {result.stderr.strip()}")
                return []

            # Parse smbclient recursive ls output
            # Each directory is prefixed with "\path\to\dir:" then files under it
            items = []
            current_dir = ""
            for line in result.stdout.split("\n"):
                line = line.strip()
                if not line:
                    continue
                # Skip dot entries
                if line == "." or line == "..":
                    continue
                # Directory header: "\path\to\dir\"
                if line.startswith("\\"):
                    current_dir = line.strip("\\").replace("\\", "/")
                    continue
                # File line
                parts_line = line.split()
                if len(parts_line) < 4:
                    continue
                # Find flag column: single uppercase letter (N, D, A, H, R, S) followed by a digit
                flag_idx = -1
                for i, t in enumerate(parts_line):
                    if len(t) == 1 and t.isupper() and t.isalpha():
                        if i + 1 < len(parts_line) and parts_line[i + 1].isdigit():
                            flag_idx = i
                            break
                if flag_idx < 0:
                    continue
                fname = " ".join(parts_line[:flag_idx])
                if not fname:
                    continue
                flags = parts_line[flag_idx]
                if "D" in flags:
                    continue  # skip directories
                size = int(parts_line[flag_idx + 1])
                date_str = " ".join(parts_line[flag_idx + 2:])
                # Calculate relative path from base
                rel_path = f"{current_dir}/{fname}" if current_dir else fname
                items.append({
                    "name": fname,
                    "size": size,
                    "size_display": _format_size(size),
                    "created_at": date_str,
                    "rel_path": rel_path,
                })
            return items
        except FileNotFoundError:
            return []
        except subprocess.TimeoutExpired:
            logger.error("smbclient ls timed out")
            return []
        except Exception as e:
            logger.error(f"Failed to list remote files (SMB): {e}")
            return []

    return []


@router.get("/remote-backups", response_model=dict)
def list_remote_backups(_=Depends(require_admin), db: Session = Depends(get_db)):
    """List backup files on the remote NAS server."""
    config = _get_remote_config(db)

    if not config.enabled:
        return {"code": 0, "data": {"files": [], "remote_path": "", "remote_type": ""}, "message": "远端备份未启用"}
    if not config.remote_path:
        return {"code": 0, "data": {"files": [], "remote_path": "", "remote_type": config.remote_type}, "message": "未配置远端路径"}
    if config.remote_type == "svn":
        return {"code": 0, "data": {"files": [], "remote_path": config.remote_path, "remote_type": "svn"}, "message": "SVN 暂不支持"}

    files = _list_remote_files(config)
    # Enrich each remote file: file_type and permanent flag derived from rel_path
    for f in files:
        f["file_type"] = _file_type(f["name"])
        rel = f.get("rel_path", "")
        f["permanent"] = rel.startswith("permanent/") if rel else False
    return {
        "code": 0,
        "data": {
            "files": files,
            "remote_path": config.remote_path,
            "remote_type": config.remote_type,
        },
        "message": f"共 {len(files)} 个远端备份文件",
    }


# ── Export ──

@router.get("/export", response_class=FileResponse)
def export_database(_=Depends(require_admin), cu=Depends(get_current_user), db: Session = Depends(get_db)):
    """Download current database file."""
    t = beijing_now().strftime("%Y%m%d-%H%M%S")
    filename = f"pma-backup-{t}.db"
    log_audit(db, cu, "db_export", f"导出数据库: {filename}", AUDIT_CAT_SYSTEM)
    return FileResponse(
        path=_db_path,
        filename=filename,
        media_type="application/octet-stream",
    )


# ── Import ──

@router.post("/import", response_model=dict)
async def import_database(
    file: UploadFile = File(...),
    _=Depends(require_admin),
    cu=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Import a database file — backs up current DB, then replaces."""
    if not file.filename or not file.filename.endswith(".db"):
        return {"code": 1, "message": "请上传 .db 格式的 SQLite 数据库文件"}

    # Validate uploaded file is a valid SQLite database
    import sqlite3
    content = await file.read()
    if len(content) < 64:
        return {"code": 1, "message": "文件太小，不是有效的 SQLite 数据库"}
    # SQLite header magic: "SQLite format 3\0"
    if content[:16] != b"SQLite format 3\x00":
        return {"code": 1, "message": "文件格式无效，不是 SQLite 数据库"}

    # Verify integrity by opening
    import tempfile
    tmp_path = None
    try:
        fd, tmp_path = tempfile.mkstemp(suffix=".db")
        os.write(fd, content)
        os.close(fd)
        test_conn = sqlite3.connect(tmp_path)
        test_conn.execute("PRAGMA integrity_check")
        test_conn.close()
    except Exception as e:
        if tmp_path:
            os.unlink(tmp_path)
        return {"code": 1, "message": f"数据库文件校验失败: {e}"}

    # Create backup of current database in hotback tree
    t = beijing_now().strftime("%Y%m%d-%H%M%S")
    backup_path = _backup_file_path(HOTBACK_DIR / t, "db", f"pma-backup-{t}-before-import.db")
    try:
        shutil.copy2(_db_path, backup_path)
    except Exception as e:
        os.unlink(tmp_path)
        return {"code": 1, "message": f"备份当前数据库失败: {e}"}

    # Replace current database with uploaded one
    try:
        # Close all connections by replacing the file atomically
        shutil.move(tmp_path, _db_path)
        # Ensure correct permissions
        os.chmod(_db_path, 0o666)
    except Exception as e:
        # Try to restore from backup
        shutil.copy2(backup_path, _db_path)
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)
        return {"code": 1, "message": f"替换数据库失败，已从备份恢复: {e}"}

    log_audit(db, cu, "db_import", f"导入数据库: {file.filename}（备份: {backup_path.name}）", AUDIT_CAT_SYSTEM)
    return {
        "code": 0,
        "data": {"backup": backup_path.name},
        "message": f"数据库已导入成功。旧数据库已备份为 {backup_path.name}。请刷新页面以加载新数据。",
    }


def _file_type(filename: str) -> str:
    """Determine backup file type from filename."""
    if filename.endswith("-env.txt"):
        return "env"
    if filename.endswith("-uploads.tar.gz"):
        return "uploads"
    if filename.endswith(".db"):
        return "db"
    return "other"


def _remote_file_names(db: Session) -> set:
    """Get set of filenames that exist on the remote NAS (for sync status)."""
    config = _get_remote_config(db)
    if not config.enabled or not config.remote_path:
        return set()
    try:
        remote_files = _list_remote_files(config)
    except Exception:
        return set()
    return {f["name"] for f in remote_files}


def _backup_iso_time(st_mtime: float) -> str:
    """Convert file mtime to ISO 8601 UTC string for frontend display."""
    return datetime.utcfromtimestamp(st_mtime).strftime("%Y-%m-%dT%H:%M:%SZ")


def _build_backup_item(f: Path, permanent: bool, remote_names: set) -> dict:
    """Build a single backup item dict from a file path."""
    st = f.stat()
    name = f.name
    return {
        "name": name,
        "size": st.st_size,
        "size_display": _format_size(st.st_size),
        "created_at": _backup_iso_time(st.st_mtime),
        "permanent": permanent,
        "file_type": _file_type(name),
        "sync_status": "synced" if name in remote_names else "not_synced",
    }


@router.get("/backups", response_model=dict)
def list_backups(_=Depends(require_admin), db: Session = Depends(get_db)):
    """List existing backup files (rolling + permanent) from tree structure."""
    _maybe_migrate()
    HOTBACK_DIR.mkdir(parents=True, exist_ok=True)
    PERMANENT_BACKUP_DIR.mkdir(parents=True, exist_ok=True)

    remote_names = _remote_file_names(db)
    items = _collect_backup_items(remote_names)
    return {"code": 0, "data": items, "message": "ok"}


@router.post("/backup-now", response_model=dict)
def backup_now(_=Depends(require_admin), cu=Depends(get_current_user), db: Session = Depends(get_db)):
    """Trigger an immediate backup (same as auto-backup but on-demand)."""
    retention_str = PmaSetting.get(db, "db_backup_retention", "5")
    keep_hours_raw = PmaSetting.get(db, "db_backup_keep_interval", "0")
    keep_hours = _parse_keep_hours(db, keep_hours_raw)
    max_perm_str = PmaSetting.get(db, "db_backup_max_permanent", "10")

    retention = int(retention_str) if retention_str else 5
    max_perm = int(max_perm_str) if max_perm_str else 10

    try:
        _do_backup(retention, keep_hours, max_perm, db=db)
        log_audit(db, cu, "db_backup_now", "手动触发立即备份", AUDIT_CAT_SYSTEM)
        return {"code": 0, "message": "备份完成"}
    except Exception as e:
        logger.error(f"Manual backup failed: {e}")
        return {"code": 1, "message": f"备份失败: {e}"}


def _is_valid_backup_name(name: str) -> bool:
    """Check if filename is a valid backup file (db, env, or uploads tar.gz)."""
    if not name.startswith("pma-backup-"):
        return False
    return name.endswith(".db") or name.endswith("-env.txt") or name.endswith("-uploads.tar.gz")


@router.delete("/backups/{name}", response_model=dict)
def delete_backup(name: str, _=Depends(require_admin), cu=Depends(get_current_user), db: Session = Depends(get_db)):
    """Delete a specific backup file (rolling or permanent)."""
    safe_name = os.path.basename(name)
    if not _is_valid_backup_name(safe_name):
        return {"code": 1, "message": "无效的备份文件名"}

    file_path, _ = _find_backup_file(safe_name)
    if not file_path:
        return {"code": 1, "message": "备份文件不存在"}
    file_path.unlink()
    _clean_empty_parents(file_path)
    log_audit(db, cu, "db_delete_backup", f"删除备份: {safe_name}", AUDIT_CAT_SYSTEM)
    return {"code": 0, "message": f"已删除 {safe_name}"}


def _restart_server():
    """Schedule a server restart via detached subprocess.

    Gives enough time for the HTTP response to be sent before shutdown.
    Safe to call multiple times — only the first one takes effect.
    """
    try:
        project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        port = os.environ.get("PMA_PORT", "8000")
        subprocess.Popen(
            ["/bin/bash", "-c",
             f"sleep 2 && cd {shlex.quote(project_root)} && ./server.sh -p {shlex.quote(port)} restart"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
    except Exception as e:
        logger.warning(f"Failed to spawn restart subprocess: {e}")


@router.post("/backups/{name}/restore", response_model=dict)
def restore_backup(
    name: str,
    _=Depends(require_admin),
    cu=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Restore a backup file (.db / .env / .tar.gz). All types trigger server restart."""
    safe_name = os.path.basename(name)
    if not _is_valid_backup_name(safe_name):
        return {"code": 1, "message": "无效的备份文件名"}

    backup_path, _ = _find_backup_file(safe_name)
    if not backup_path:
        return {"code": 1, "message": "备份文件不存在"}

    result = _do_restore(backup_path, cu, db)
    if not result["ok"]:
        return {"code": 1, "message": result["message"]}

    _restart_server()

    resp = {"code": 0, "message": result["message"] + "，服务器即将重启"}
    if result["pre_restore_backup"]:
        resp["data"] = {"pre_restore_backup": result["pre_restore_backup"]}
    return resp


@router.post("/backups/{name}/sync-to-remote", response_model=dict)
def sync_single_backup_to_remote(
    name: str,
    _=Depends(require_admin),
    cu=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Sync a single local backup file to the remote NAS."""
    config = _get_remote_config(db)
    if not config.enabled:
        return {"code": 1, "message": "远端备份未启用"}
    if config.remote_type == "svn":
        return {"code": 1, "message": "SVN 远端备份暂未支持"}

    safe_name = os.path.basename(name)
    # Find the file in the tree
    file_path, is_perm = _find_backup_file(safe_name)
    if not file_path:
        return {"code": 1, "message": "备份文件不存在: " + safe_name}

    # Determine base dir for relative path calculation
    base_dir = PERMANENT_BACKUP_DIR if is_perm else HOTBACK_DIR
    subdir = _remote_subdir_for(file_path, base_dir)

    synced = []
    failed = []

    if _sync_file_to_nas(file_path, config.remote_path, config, subdir):
        synced.append(safe_name)
    else:
        failed.append(safe_name)

    # If it's a .db backup, also sync companion files from same timestamp folder
    if safe_name.endswith(".db"):
        for companion in _find_companion_files(file_path):
            comp_subdir = _remote_subdir_for(companion, base_dir)
            if _sync_file_to_nas(companion, config.remote_path, config, comp_subdir):
                synced.append(companion.name)
            else:
                failed.append(companion.name)

    log_audit(db, cu, "db_remote_backup_sync_single",
              f"手动同步单个备份到远端: {safe_name}",
              AUDIT_CAT_SYSTEM)

    if synced and not failed:
        return {"code": 0, "message": f"已同步 {len(synced)} 个文件到远端"}
    elif synced:
        return {"code": 0, "message": f"部分成功: {len(synced)} 已同步, {len(failed)} 失败"}
    else:
        return {"code": 1, "message": f"同步失败: 无法写入远端"}


@router.delete("/remote-backups/{name}", response_model=dict)
def delete_remote_backup(
    name: str,
    _=Depends(require_admin),
    cu=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a backup file from the remote NAS."""
    config = _get_remote_config(db)
    if not config.enabled:
        return {"code": 1, "message": "远端备份未启用"}
    if config.remote_type == "svn":
        return {"code": 1, "message": "SVN 远端备份暂未支持"}

    safe_name = os.path.basename(name)
    try:
        _delete_remote_file(safe_name, config)
        log_audit(db, cu, "db_remote_backup_delete",
                  f"删除远端备份: {safe_name}",
                  AUDIT_CAT_SYSTEM)
        return {"code": 0, "message": f"已删除远端备份 {safe_name}"}
    except Exception as e:
        return {"code": 1, "message": f"删除远端备份失败: {e}"}


def _fetch_from_nas(filename: str, local_dest_dir: Path, config: RemoteBackupConfig) -> Optional[Path]:
    """Download a single file from remote NAS to a local directory.

    Returns the local file path on success, None on failure.
    """
    normalized = config.remote_path.replace("\\", "/")
    local_dest_dir.mkdir(parents=True, exist_ok=True)

    # Mode 1: Local mount path — search recursively
    if normalized.startswith("/") and not normalized.startswith("//"):
        try:
            remote_dir = Path(normalized)
            if not remote_dir.exists():
                return None
            # Search recursively for the file
            for f in remote_dir.rglob(filename):
                if f.is_file():
                    dest = local_dest_dir / filename
                    shutil.copy2(str(f), str(dest))
                    logger.info(f"Fetched from NAS (local): {filename}")
                    return dest
            return None
        except Exception as e:
            logger.error(f"Failed to fetch from NAS (local): {filename}: {e}")
            return None

    # Mode 2: SMB — use smbclient get
    if normalized.startswith("//"):
        if not shutil.which("smbclient"):
            return None
        parts = normalized.strip("/").split("/")
        if len(parts) < 2:
            return None
        server, share = parts[0], parts[1]
        subdir = "/".join(parts[2:]) if len(parts) > 2 else ""

        try:
            cmd = ["smbclient", f"//{server}/{share}"]
            if config.remote_password:
                cmd.extend(["-U", f"{config.remote_username}%{config.remote_password}"])
            elif config.remote_username:
                cmd.extend(["-U", config.remote_username])
            else:
                cmd.append("-N")

            cmds = []
            if subdir:
                cmds.append(f"cd {subdir}")
            cmds.append(f"lcd {shlex.quote(str(local_dest_dir))}")
            cmds.append(f"get {filename}")
            cmds.append("exit")

            result = subprocess.run(
                cmd, input="\n".join(cmds),
                capture_output=True, text=True, timeout=60,
            )
            if result.returncode == 0:
                dest = local_dest_dir / filename
                if dest.exists():
                    logger.info(f"Fetched from NAS (SMB): {filename}")
                    return dest
            logger.error(f"smbclient get failed for {filename}: {result.stderr.strip()}")
            return None
        except Exception as e:
            logger.error(f"Failed to fetch from NAS (SMB): {filename}: {e}")
            return None

    return None


def _do_restore(backup_path: Path, cu, db: Session) -> dict:
    """Execute full restore for any backup type (.db / .env / .tar.gz).

    Returns {"ok": bool, "message": str, "pre_restore_backup": str|None}
    Does NOT restart the server — caller should call _restart_server() if ok.
    """
    safe_name = backup_path.name
    pre_restore_path = None

    # ── .env restore ──
    if safe_name.endswith("-env.txt"):
        env_path = _get_env_path()
        try:
            shutil.copy2(str(backup_path), str(env_path))
        except Exception as e:
            return {"ok": False, "message": f"恢复 .env 失败: {e}", "pre_restore_backup": None}
        log_audit(db, cu, "db_restore_backup", f"恢复 .env: 从备份「{safe_name}」", AUDIT_CAT_SYSTEM, "high")
        return {"ok": True, "message": f".env 已从备份 {safe_name} 恢复", "pre_restore_backup": None}

    # ── uploads restore ──
    if safe_name.endswith("-uploads.tar.gz"):
        UPLOAD_DIR = Path(os.path.join(os.path.dirname(_db_path), "uploads"))
        try:
            UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
            subprocess.run(["tar", "-xzf", str(backup_path), "-C", str(UPLOAD_DIR.parent)],
                           check=True, capture_output=True)
        except Exception as e:
            return {"ok": False, "message": f"恢复上传附件失败: {e}", "pre_restore_backup": None}
        log_audit(db, cu, "db_restore_backup", f"恢复上传附件: 从备份「{safe_name}」", AUDIT_CAT_SYSTEM, "high")
        return {"ok": True, "message": f"上传附件已从备份 {safe_name} 恢复", "pre_restore_backup": None}

    # ── .db restore ──
    import sqlite3
    try:
        test_conn = sqlite3.connect(str(backup_path))
        test_conn.execute("PRAGMA integrity_check")
        test_conn.close()
    except Exception as e:
        return {"ok": False, "message": f"备份文件校验失败: {e}", "pre_restore_backup": None}

    # Create pre-restore backup of current DB in hotback tree
    t = beijing_now().strftime("%Y%m%d-%H%M%S")
    pre_restore_path = _backup_file_path(HOTBACK_DIR / t, "db", f"pma-backup-{t}-before-restore.db")
    try:
        shutil.copy2(_db_path, pre_restore_path)
    except Exception as e:
        return {"ok": False, "message": f"备份当前数据库失败: {e}", "pre_restore_backup": None}

    # Close all DB connections before replacing the file
    from backend.database import engine
    engine.dispose()

    try:
        shutil.copy2(str(backup_path), _db_path)
        os.chmod(_db_path, 0o666)
    except Exception as e:
        if pre_restore_path.exists():
            shutil.copy2(str(pre_restore_path), _db_path)
        return {"ok": False, "message": f"恢复失败，已回滚: {e}", "pre_restore_backup": None}

    # Write marker
    try:
        marker = Path(_db_path).parent / ".db-replaced"
        marker.write_text(beijing_now().isoformat())
    except Exception:
        pass

    log_audit(db, cu, "db_restore_backup", f"恢复数据库: 从备份「{safe_name}」", AUDIT_CAT_SYSTEM, "high")
    return {"ok": True, "message": f"数据库已从备份 {safe_name} 恢复", "pre_restore_backup": pre_restore_path.name}
@router.post("/remote-backups/{name}/restore", response_model=dict)
def restore_remote_backup(
    name: str,
    _=Depends(require_admin),
    cu=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Download a backup from remote NAS and execute full restore flow."""
    config = _get_remote_config(db)
    if not config.enabled:
        return {"code": 1, "message": "远端备份未启用"}
    if config.remote_type == "svn":
        return {"code": 1, "message": "SVN 远端备份暂未支持"}

    safe_name = os.path.basename(name)
    fetch_dir = BACKUP_DIR / "_fetched"
    fetch_dir.mkdir(parents=True, exist_ok=True)

    # Fetch file from remote to temp dir
    local_path = _fetch_from_nas(safe_name, fetch_dir, config)
    if not local_path:
        return {"code": 1, "message": f"无法从远端获取 {safe_name}，请检查远端连接"}

    # Run full restore flow (same as local restore)
    result = _do_restore(local_path, cu, db)
    if not result["ok"]:
        return {"code": 1, "message": result["message"]}

    _restart_server()

    resp = {"code": 0, "message": result["message"] + "，服务器即将重启"}
    if result["pre_restore_backup"]:
        resp["data"] = {"pre_restore_backup": result["pre_restore_backup"]}
    return resp


# ── Auto-backup task ──

_last_backup_time = 0  # epoch seconds, reset on startup


async def auto_backup_loop():
    """Background loop for scheduled database backups."""
    global _last_backup_time
    _last_backup_time = time.time()  # Don't backup immediately on startup
    # Use a simple import approach to access PmaSetting outside request context
    from backend.database import SessionLocal
    while True:
        import asyncio
        await asyncio.sleep(30)  # check every 30s
        try:
            db = SessionLocal()
            try:
                interval_str = PmaSetting.get(db, "db_backup_interval", "0")
                retention_str = PmaSetting.get(db, "db_backup_retention", "5")
                keep_hours_raw = PmaSetting.get(db, "db_backup_keep_interval", "0")
                keep_hours = _parse_keep_hours(db, keep_hours_raw)
                max_perm_str = PmaSetting.get(db, "db_backup_max_permanent", "10")
            finally:
                db.close()

            interval = int(interval_str) if interval_str else 0
            retention = int(retention_str) if retention_str else 5
            max_perm = int(max_perm_str) if max_perm_str else 10

            if interval <= 0:
                _last_backup_time = time.time()
                continue

            if time.time() - _last_backup_time >= interval * 60:
                _last_backup_time = time.time()
                # Re-open a fresh db session for the backup (remote sync needs it)
                backup_db = SessionLocal()
                try:
                    _do_backup(retention, keep_hours, max_perm, db=backup_db)
                finally:
                    backup_db.close()
        except Exception as e:
            logger.error(f"Auto-backup check failed: {e}")


def _backup_env_file(tag: str = "", dest_dir: Path = None) -> Path:
    """Backup the .env file alongside the database backup.

    Args:
        tag: timestamp prefix to match the .db backup filename (e.g., 'pma-backup-20260802-120000')
        dest_dir: target directory for the env backup file. If None, auto-creates in hotback tree.

    Returns the path to the created .env backup file.
    """
    env_path = _get_env_path()
    if not env_path.exists():
        logger.warning(f".env file not found at {env_path} — skipping env backup")
        return Path("/nonexistent")  # caller checks .exists()

    if dest_dir is None:
        t = tag.replace("pma-backup-", "") if tag.startswith("pma-backup-") else beijing_now().strftime("%Y%m%d-%H%M%S")
        dest_dir = _hotback_folder(t) / "env"

    dest_dir.mkdir(parents=True, exist_ok=True)
    if tag:
        env_backup_name = f"{tag}-env.txt"
    else:
        t = beijing_now().strftime("%Y%m%d-%H%M%S")
        env_backup_name = f"pma-backup-{t}-env.txt"
    env_backup_path = dest_dir / env_backup_name
    shutil.copy2(str(env_path), str(env_backup_path))
    logger.info(f".env backup created: {env_backup_name}")
    return env_backup_path


def _maybe_migrate():
    """Lazily migrate old flat backup structure to new tree structure."""
    global _migration_done
    if _migration_done:
        return
    if HOTBACK_DIR.exists():
        _migration_done = True
        return

    # Check if there are flat files to migrate
    flat_files = list(BACKUP_DIR.glob("pma-backup-*.db")) if BACKUP_DIR.exists() else []
    if not flat_files:
        _migration_done = True
        return

    logger.info("Migrating old flat backup structure to new tree structure...")
    migrated = 0
    try:
        # Migrate rolling backups
        for f in sorted(BACKUP_DIR.glob("pma-backup-*.db"), key=lambda p: p.stat().st_mtime):
            name = f.name
            if "-keep" in name:
                continue  # permanent files handled separately
            # Extract timestamp from filename: pma-backup-YYYYMMDD-HHMMSS.db
            ts = name.replace("pma-backup-", "").replace(".db", "")
            if "-before-" in ts:
                ts = ts.replace("-before-restore", "").replace("-before-import", "")
            folder = _hotback_folder(ts)
            _backup_file_path(folder, "db", name)
            shutil.move(str(f), str(folder / "db" / name))
            migrated += 1

        # Migrate .env files
        for f in sorted(BACKUP_DIR.glob("pma-backup-*-env.txt"), key=lambda p: p.stat().st_mtime):
            name = f.name
            ts = name.replace("pma-backup-", "").replace("-env.txt", "")
            folder = _hotback_folder(ts)
            _backup_file_path(folder, "env", name)
            shutil.move(str(f), str(folder / "env" / name))

        # Migrate uploads
        for f in sorted(BACKUP_DIR.glob("pma-backup-*-uploads.tar.gz"), key=lambda p: p.stat().st_mtime):
            name = f.name
            ts = name.replace("pma-backup-", "").replace("-uploads.tar.gz", "")
            folder = _hotback_folder(ts)
            _backup_file_path(folder, "uploads", name)
            shutil.move(str(f), str(folder / "uploads" / name))

        # Migrate permanent .db files
        for f in sorted(PERMANENT_BACKUP_DIR.glob("pma-backup-*-keep.db"), key=lambda p: p.stat().st_mtime):
            name = f.name
            ts = name.replace("pma-backup-", "").replace("-keep.db", "")
            folder = _perm_folder(ts)
            _backup_file_path(folder, "db", name)
            shutil.move(str(f), str(folder / "db" / name))
            migrated += 1

        logger.info(f"Backup structure migration complete: {migrated} files migrated")
    except Exception as e:
        logger.error(f"Backup structure migration failed: {e}")

    _migration_done = True


def _do_backup(retention: int, keep_hours: int = 0, max_perm: int = 10, db: Session = None):
    """Perform a database backup into hotback/ tree, save permanent copy if needed, rotate old ones."""
    _maybe_migrate()

    t = beijing_now().strftime("%Y%m%d-%H%M%S")
    hotback_folder = _hotback_folder(t)

    # ── Save .db to hotback tree ──
    db_dest = _backup_file_path(hotback_folder, "db", f"pma-backup-{t}.db")
    shutil.copy2(_db_path, db_dest)
    logger.info(f"Auto-backup created: {db_dest.name}")

    # ── Save uploads to hotback tree ──
    upload_dest = None
    UPLOAD_DIR = Path(os.path.join(os.path.dirname(_db_path), "uploads"))
    if UPLOAD_DIR.exists():
        upload_dest = _backup_file_path(hotback_folder, "uploads", f"pma-backup-{t}-uploads.tar.gz")
        import subprocess
        subprocess.run(["tar", "-czf", str(upload_dest), "-C", str(UPLOAD_DIR.parent), "uploads"],
                       check=False, capture_output=True)
        logger.info(f"Auto-backup uploads: {upload_dest.name}")

    # ── Save .env to hotback tree ──
    env_backup_path = _backup_env_file(f"pma-backup-{t}", dest_dir=hotback_folder / "env")

    # ── Permanent backup logic (returns True if a permanent copy was created) ──
    perm_saved = False
    if keep_hours > 0:
        perm_saved = _maybe_save_permanent_backup(hotback_folder, t, keep_hours, max_perm)

    # ── Rotate rolling backups (rmtree entire timestamp folders) ──
    if HOTBACK_DIR.exists():
        hotback_folders = sorted(
            [d for d in HOTBACK_DIR.iterdir() if d.is_dir()],
            key=lambda d: d.stat().st_mtime, reverse=True,
        )
        for old_folder in hotback_folders[retention:]:
            shutil.rmtree(old_folder)
            logger.info(f"Auto-backup removed folder (retention={retention}): {old_folder.name}")

    # ── Remote sync: only sync permanent backups, not hotback ──
    if perm_saved and db is not None:
        try:
            result = _sync_permanent_backups(db)
            if result["failed"]:
                logger.warning(f"Permanent backup sync had failures: {len(result['failed'])} files")
        except Exception as e:
            logger.error(f"Permanent backup sync failed: {e}")


def _maybe_save_permanent_backup(hotback_folder: Path, t: str, keep_hours: int, max_count: int = 10) -> bool:
    """Save a full 3-file permanent backup if the window allows.

    Checks the mtime of the youngest permanent backup timestamp folder.
    If it's newer than keep_hours ago, skip.
    Saves db, env, uploads from hotback into permanent/{t}/ tree.
    Enforces max_count by removing oldest timestamp folders.

    Returns True if a permanent copy was saved, False otherwise.
    """
    # Find the most recent permanent backup by checking timestamp folders
    newest_mtime = 0.0
    if PERMANENT_BACKUP_DIR.exists():
        for d in PERMANENT_BACKUP_DIR.iterdir():
            if not d.is_dir():
                continue
            # Check for a .db file inside the db/ subfolder
            db_dir = d / "db"
            if db_dir.exists():
                for db_file in db_dir.iterdir():
                    if db_file.is_file() and db_file.suffix == ".db":
                        newest_mtime = max(newest_mtime, db_file.stat().st_mtime)
                        break

    if newest_mtime > 0:
        age_seconds = time.time() - newest_mtime
        if age_seconds < keep_hours * 3600:
            return False  # Already have a permanent backup within this window

    # Create permanent backup with full 3-file set
    perm_folder = _perm_folder(t)

    # Copy .db
    db_src = hotback_folder / "db" / f"pma-backup-{t}.db"
    if db_src.exists():
        db_dest = _backup_file_path(perm_folder, "db", f"pma-backup-{t}-keep.db")
        shutil.copy2(str(db_src), str(db_dest))
        logger.info(f"Permanent db saved: {db_dest.name}")

    # Copy .env
    env_src = hotback_folder / "env" / f"pma-backup-{t}-env.txt"
    if env_src.exists():
        env_dest = _backup_file_path(perm_folder, "env", f"pma-backup-{t}-env.txt")
        shutil.copy2(str(env_src), str(env_dest))
    else:
        # Generate directly from source
        _backup_env_file(f"pma-backup-{t}", dest_dir=perm_folder / "env")

    # Copy uploads
    upload_src = hotback_folder / "uploads" / f"pma-backup-{t}-uploads.tar.gz"
    if upload_src.exists():
        upload_dest = _backup_file_path(perm_folder, "uploads", f"pma-backup-{t}-uploads.tar.gz")
        shutil.copy2(str(upload_src), str(upload_dest))

    logger.info(f"Permanent backup saved (every {keep_hours}h): {t}")

    # Enforce max permanent count: remove oldest timestamp folders
    if PERMANENT_BACKUP_DIR.exists():
        perm_folders = sorted(
            [d for d in PERMANENT_BACKUP_DIR.iterdir() if d.is_dir()],
            key=lambda d: d.stat().st_mtime, reverse=True,
        )
        for old in perm_folders[max_count:]:
            shutil.rmtree(old)
            logger.info(f"Permanent backup removed folder (max_count={max_count}): {old.name}")

    return True


# ── SQLCipher Rekey ──

class RekeyRequest(BaseModel):
    old_passphrase: str
    new_passphrase: str


@router.post("/rekey", response_model=dict)
def rekey_database(
    payload: RekeyRequest,
    cu=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Change the database passphrase (PRAGMA rekey)."""
    if not _is_sqlcipher_enabled():
        return {"code": 1, "message": "数据库未启用 SQLCipher 加密，无法更换密码。请先在 .env 中配置 SQLCIPHER_KEY。"}

    if len(payload.old_passphrase) < 1:
        return {"code": 1, "message": "请输入当前密码"}
    if len(payload.new_passphrase) < 8:
        return {"code": 1, "message": "新密码至少需要 8 个字符"}
    if payload.old_passphrase == payload.new_passphrase:
        return {"code": 1, "message": "新旧密码相同，无需更换"}

    old_key = _derive_sqlcipher_key(payload.old_passphrase)
    new_key = _derive_sqlcipher_key(payload.new_passphrase)

    try:
        import pysqlcipher3.dbapi2 as sqlcipher

        conn = sqlcipher.connect(_db_path)
        try:
            # Verify old key is correct
            conn.execute(f"PRAGMA key = \"{old_key}\"")
            conn.execute("SELECT count(*) FROM sqlite_master").fetchone()
            # Execute rekey
            conn.execute(f"PRAGMA rekey = \"{new_key}\"")
            conn.commit()
        finally:
            conn.close()

        # Update the .env or secrets file with the new derived key
        _update_sqlcipher_key_file(new_key)

        log_audit(db, cu, "db_rekey", "数据库加密密码已更换", AUDIT_CAT_SYSTEM, "high")
        logger.info("Database rekey completed successfully")
        return {"code": 0, "message": "数据库密码已更换成功。请妥善保管新密码。"}

    except ImportError:
        return {"code": 1, "message": "未安装 pysqlcipher3，无法执行 rekey。请安装: pip install pysqlcipher3"}
    except Exception as e:
        error_msg = str(e)
        if "file is not a database" in error_msg.lower():
            return {"code": 1, "message": "当前密码错误，无法打开数据库"}
        logger.error(f"Rekey failed: {e}")
        return {"code": 1, "message": f"更换密码失败: {error_msg}"}


def _update_sqlcipher_key_file(new_key: str):
    """Update the SQLCipher key file if it exists, so the server can restart with new key."""
    # Try Docker secrets file first
    if settings.SQLCIPHER_KEY_FILE and os.path.exists(settings.SQLCIPHER_KEY_FILE):
        with open(settings.SQLCIPHER_KEY_FILE, "w") as f:
            f.write(new_key + "\n")
        settings.reload()
        logger.info("Updated SQLCipher key in Docker secrets file")
        return

    # Try .env file
    env_path = os.path.join(os.path.dirname(_db_path), "..", ".env")
    if not os.path.exists(env_path):
        env_path = ".env"
    if os.path.exists(env_path):
        lines = []
        found = False
        with open(env_path) as f:
            for line in f:
                if line.startswith("SQLCIPHER_KEY="):
                    lines.append(f"SQLCIPHER_KEY={new_key}\n")
                    found = True
                else:
                    lines.append(line)
        if not found:
            lines.append(f"SQLCIPHER_KEY={new_key}\n")
        with open(env_path, "w") as f:
            f.writelines(lines)
        settings.reload()
        logger.info("Updated SQLCIPHER_KEY in .env file")
        return

    # No file to update — just update settings in memory
    settings.SQLCIPHER_KEY = new_key
    logger.warning("No SQLCIPHER_KEY_FILE or .env found; key updated in memory only")


def _format_size(size: int) -> str:
    """Format bytes to human readable."""
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024:
            return f"{size:.1f} {unit}" if unit != "B" else f"{size} B"
        size /= 1024
    return f"{size:.1f} TB"
