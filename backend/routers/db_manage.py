"""Database management — export/import/backup/rekey (admin only)."""

import hashlib
import os
import shutil
import time
import glob
import logging
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, UploadFile, File
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.config import settings
from backend.database import get_db, _db_path, _is_sqlcipher_enabled, _HAS_SQLCIPHER
from backend.middleware.auth import require_admin, get_current_user
from backend.models.local import LocalUser, PmaSetting
from backend.routers.logs import log_audit

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/db", tags=["db-manage"])

BACKUP_DIR = Path(_db_path).parent / "backups"

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
    retention_count: int = 5       # max backups to keep


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


@router.get("/backup-config", response_model=dict)
def get_backup_config(_=Depends(require_admin), db: Session = Depends(get_db)):
    """Get auto-backup configuration."""
    interval = PmaSetting.get(db, "db_backup_interval", "0")
    retention = PmaSetting.get(db, "db_backup_retention", "5")
    return {
        "code": 0,
        "data": {
            "interval_minutes": int(interval),
            "retention_count": int(retention),
        },
        "message": "ok",
    }


@router.put("/backup-config", response_model=dict)
def update_backup_config(payload: BackupConfig, _=Depends(require_admin), db: Session = Depends(get_db)):
    """Update auto-backup configuration."""
    PmaSetting.set(db, "db_backup_interval", str(max(0, payload.interval_minutes)))
    PmaSetting.set(db, "db_backup_retention", str(max(1, payload.retention_count)))
    return {"code": 0, "message": "备份配置已更新"}


# ── Export ──

@router.get("/export", response_class=FileResponse)
def export_database(_=Depends(require_admin), cu=Depends(get_current_user), db: Session = Depends(get_db)):
    """Download current database file."""
    t = datetime.now().strftime("%Y%m%d-%H%M%S")
    filename = f"pma-backup-{t}.db"
    log_audit(db, cu, "db_export", f"file={filename}")
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

    # Create backup of current database
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    t = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_path = BACKUP_DIR / f"pma-backup-{t}-before-import.db"
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

    log_audit(db, cu, "db_import", f"file={file.filename} backup={backup_path.name}")
    return {
        "code": 0,
        "data": {"backup": backup_path.name},
        "message": f"数据库已导入成功。旧数据库已备份为 {backup_path.name}。请刷新页面以加载新数据。",
    }


# ── Backups ──

@router.get("/backups", response_model=dict)
def list_backups(_=Depends(require_admin)):
    """List existing backup files."""
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    files = sorted(BACKUP_DIR.glob("pma-backup-*.db"), key=lambda p: p.stat().st_mtime, reverse=True)
    items = []
    for f in files:
        st = f.stat()
        items.append({
            "name": f.name,
            "size": st.st_size,
            "size_display": _format_size(st.st_size),
            "created_at": datetime.fromtimestamp(st.st_mtime).strftime("%Y-%m-%d %H:%M:%S"),
        })
    return {"code": 0, "data": items, "message": "ok"}


@router.delete("/backups/{name}", response_model=dict)
def delete_backup(name: str, _=Depends(require_admin), cu=Depends(get_current_user), db: Session = Depends(get_db)):
    """Delete a specific backup file."""
    # Prevent path traversal
    safe_name = os.path.basename(name)
    if not safe_name.startswith("pma-backup-") or not safe_name.endswith(".db"):
        return {"code": 1, "message": "无效的备份文件名"}
    file_path = BACKUP_DIR / safe_name
    if not file_path.exists():
        return {"code": 1, "message": "备份文件不存在"}
    file_path.unlink()
    log_audit(db, cu, "db_delete_backup", f"file={safe_name}")
    return {"code": 0, "message": f"已删除 {safe_name}"}


@router.post("/backups/{name}/restore", response_model=dict)
def restore_backup(
    name: str,
    _=Depends(require_admin),
    cu=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Restore the current database from a backup file."""
    safe_name = os.path.basename(name)
    if not safe_name.startswith("pma-backup-") or not safe_name.endswith(".db"):
        return {"code": 1, "message": "无效的备份文件名"}
    backup_path = BACKUP_DIR / safe_name
    if not backup_path.exists():
        return {"code": 1, "message": "备份文件不存在"}

    # Verify backup file is a valid SQLite database
    import sqlite3
    try:
        test_conn = sqlite3.connect(str(backup_path))
        test_conn.execute("PRAGMA integrity_check")
        test_conn.close()
    except Exception as e:
        return {"code": 1, "message": f"备份文件校验失败: {e}"}

    # Log BEFORE replacing the database file (after which connections are invalid)
    log_audit(db, cu, "db_restore_backup", f"from={safe_name}", "管理", "high")

    # Create a backup of current database before restoring
    t = datetime.now().strftime("%Y%m%d-%H%M%S")
    pre_restore_path = BACKUP_DIR / f"pma-backup-{t}-before-restore.db"
    try:
        shutil.copy2(_db_path, pre_restore_path)
    except Exception as e:
        return {"code": 1, "message": f"备份当前数据库失败: {e}"}

    # Close all DB connections before replacing the file
    from backend.database import engine
    engine.dispose()

    # Restore from backup
    try:
        shutil.copy2(str(backup_path), _db_path)
        os.chmod(_db_path, 0o666)
    except Exception as e:
        # Try to restore from the pre-restore backup
        if pre_restore_path.exists():
            shutil.copy2(str(pre_restore_path), _db_path)
        return {"code": 1, "message": f"恢复失败，已回滚: {e}"}

    return {
        "code": 0,
        "data": {"pre_restore_backup": pre_restore_path.name},
        "message": f"已从备份 {safe_name} 恢复数据库。恢复前的数据库已备份为 {pre_restore_path.name}。请刷新页面以加载恢复后的数据。",
    }


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
            finally:
                db.close()

            interval = int(interval_str) if interval_str else 0
            retention = int(retention_str) if retention_str else 5

            if interval <= 0:
                _last_backup_time = time.time()
                continue

            if time.time() - _last_backup_time >= interval * 60:
                _last_backup_time = time.time()
                _do_backup(retention)
        except Exception as e:
            logger.error(f"Auto-backup check failed: {e}")


def _do_backup(retention: int):
    """Perform a database backup and clean up old ones."""
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    t = datetime.now().strftime("%Y%m%d-%H%M%S")
    dest = BACKUP_DIR / f"pma-backup-{t}.db"
    shutil.copy2(_db_path, dest)
    logger.info(f"Auto-backup created: {dest.name}")

    # Rotate: keep only the most recent N backups
    files = sorted(BACKUP_DIR.glob("pma-backup-*.db"), key=lambda p: p.stat().st_mtime, reverse=True)
    for old in files[retention:]:
        old.unlink()
        logger.info(f"Auto-backup removed (retention={retention}): {old.name}")


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

        log_audit(db, cu, "db_rekey", "数据库加密密码已更换", "管理", "high")
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
