"""Database management — export/import/backup (admin only)."""

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

from backend.database import get_db, _db_path
from backend.middleware.auth import require_admin, get_current_user
from backend.models.local import LocalUser, PmaSetting
from backend.routers.logs import log_audit

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/db", tags=["db-manage"])

BACKUP_DIR = Path(_db_path).parent / "backups"

# ── Backup Config ──

class BackupConfig(BaseModel):
    interval_minutes: int = 0      # 0 = disabled
    retention_count: int = 5       # max backups to keep


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


def _format_size(size: int) -> str:
    """Format bytes to human readable."""
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024:
            return f"{size:.1f} {unit}" if unit != "B" else f"{size} B"
        size /= 1024
    return f"{size:.1f} TB"
