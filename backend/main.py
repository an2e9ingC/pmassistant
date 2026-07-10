import logging
import os as _os
import time
from contextlib import asynccontextmanager
from logging.handlers import RotatingFileHandler

from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from backend.config import settings, SERVER_START_TIME
from backend.database import init_db
from backend.routers import auth, config, dashboard, projects, sync, products, delivery, reports, logs, topology, admin_users, maintenance, customers, document_template, product_doc_template, pma_tag, standards, gitlab, db_manage, product_management, notifications, documents, tasks, worklogs, bugs

# File log handler — use same directory as database
import backend.database as _db_module
_log_dir = _os.path.dirname(getattr(_db_module, "_db_path", "data/pma-8800.db"))

# Shutdown notice file path (written by server.sh before stop, cleared on start)
_SHUTDOWN_NOTICE_FILE = _os.path.join(_os.path.dirname(getattr(_db_module, "_db_path", "data/pma.db")), ".shutdown-notice-" + _os.environ.get("PMA_PORT", "8000") + ".json")
_port = _os.environ.get("PMA_PORT", "")
_log_suffix = f"-{_port}" if _port else ""
_log_file = _os.path.join(_log_dir, f"pma{_log_suffix}.log")
_os.makedirs(_log_dir, exist_ok=True)
_file_handler = RotatingFileHandler(
    _log_file, maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8"
)
_file_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
_file_handler.setLevel(logging.DEBUG)

logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    handlers=[logging.StreamHandler(), _file_handler],
)
# Suppress noisy third-party / internal loggers
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("backend.services.doc_scanner").setLevel(logging.ERROR)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting PMA backend...")
    init_db()
    logger.info("Database initialized")

    # ── Startup connection self-test: enabled sources must pass ──
    import json, urllib.request, urllib.error, sys
    from backend.routers.config import _load_config

    cfg = _load_config()
    sources = {
        "zentao": ("禅道", cfg.get("zentao", {}).get("base_url", ""), None),
        "gitlab": ("GitLab", cfg.get("gitlab", {}).get("base_url", ""), cfg.get("gitlab", {}).get("token", "")),
        "svn":    ("SVN",    cfg.get("svn", {}).get("base_url", ""),    None),
    }
    for key, (label, url, token) in sources.items():
        enabled = cfg.get(key, {}).get("enabled", True)
        if not enabled:
            logger.info(f"[启动自检] {label}: 已禁用，跳过")
            continue
        if not url:
            logger.warning(f"[启动自检] {label}: 未配置地址，跳过")
            continue
        try:
            if key == "gitlab":
                test_url = url.rstrip("/") + "/version"
                req = urllib.request.Request(test_url, headers={"PRIVATE-TOKEN": token})
            elif key == "svn":
                data = b'<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><prop><resourcetype/></prop></propfind>'
                req = urllib.request.Request(url, data=data, method="PROPFIND",
                                              headers={"Depth": "0", "Content-Type": "application/xml"})
                username = cfg.get("svn", {}).get("username", "")
                password = cfg.get("svn", {}).get("password", "")
                if username and password:
                    import base64
                    req.add_header("Authorization", f"Basic {base64.b64encode(f'{username}:{password}'.encode()).decode()}")
            else:  # zentao
                req = urllib.request.Request(url, method="GET")
            resp = urllib.request.urlopen(req, timeout=10)
            logger.info(f"[启动自检] {label}: OK (HTTP {resp.status})")
        except urllib.error.HTTPError as e:
            logger.critical(f"[启动自检] {label}: HTTP {e.code} — {e.reason}，启动失败")
            sys.exit(1)
        except Exception as e:
            logger.critical(f"[启动自检] {label}: 连接失败 — {e}，启动失败")
            sys.exit(1)

    # Start background auto-sync task
    import asyncio
    from backend.services.sync_service import SyncService, _auto_sync_notify
    async def auto_sync_loop():
        last_sync = 0  # sync immediately on first start
        while True:
            await asyncio.sleep(30)  # check every 30s
            interval = int(getattr(settings, "SYNC_INTERVAL_MINUTES", 30) or 30)
            if interval <= 0:
                last_sync = time.time()  # reset timer when disabled
                continue
            if time.time() - last_sync >= interval * 60:
                last_sync = time.time()
                try:
                    logger.info(f"Auto-sync triggered (interval={interval}min)")
                    svc = SyncService()
                    await svc.full_sync()
                    _auto_sync_notify["completed"] = True
                    _auto_sync_notify["time"] = time.strftime("%H:%M:%S")
                    next_time = time.strftime("%H:%M:%S", time.localtime(time.time() + interval * 60))
                    logger.info(f"Auto-sync completed, next sync in {interval} minutes (at {next_time})")
                except Exception as e:
                    next_time = time.strftime("%H:%M:%S", time.localtime(time.time() + interval * 60))
                    logger.error(f"Auto-sync failed: {e}, next retry in {interval} minutes (at {next_time})")

    _auto_sync_task = asyncio.create_task(auto_sync_loop())

    # Start background auto-backup task
    from backend.routers.db_manage import auto_backup_loop
    _auto_backup_task = asyncio.create_task(auto_backup_loop())

    yield
    _auto_sync_task.cancel()
    _auto_backup_task.cancel()
    logger.info("Shutting down PMA backend...")


app = FastAPI(
    title=settings.PROJECT_NAME,
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    logger.error(f"Unhandled error on {request.method} {request.url.path}: {exc}", exc_info=True)
    from fastapi.responses import JSONResponse
    return JSONResponse(status_code=500, content={"code": 1, "message": str(exc)})

# API routes
app.include_router(auth.router)
app.include_router(dashboard.router)
app.include_router(projects.router)
app.include_router(projects.user_router)
app.include_router(sync.router)
app.include_router(products.router)
app.include_router(delivery.router)
app.include_router(reports.router)
app.include_router(logs.router)
app.include_router(topology.router)
app.include_router(config.router)
app.include_router(admin_users.router)
app.include_router(maintenance.router)
app.include_router(customers.router)
app.include_router(document_template.router)
app.include_router(product_doc_template.router)
app.include_router(pma_tag.router)
app.include_router(standards.router)
app.include_router(gitlab.router)
app.include_router(db_manage.router)
app.include_router(product_management.router)
app.include_router(notifications.router)
app.include_router(documents.router)
app.include_router(tasks.router)
app.include_router(worklogs.router)
app.include_router(worklogs.comment_router)
app.include_router(bugs.router)

# ── Attachment serving (standalone, not prefixed) ──
from fastapi.responses import StreamingResponse
from backend.services import bug_service as _bs
from backend.database import get_db as _gdb
from backend.middleware.auth import get_current_user as _gcu

@app.get("/api/attachments/{attachment_id}")
def serve_attachment(attachment_id: int, db: Session = Depends(_gdb)):
    result = _bs.get_attachment_path(attachment_id, db)
    if not result: raise HTTPException(status_code=404, detail="Attachment not found")
    path, mime, fname = result
    return StreamingResponse(open(path, "rb"), media_type=mime,
                             headers={"Content-Disposition": f"inline; filename={fname}"})

# Static files (frontend)
app.mount("/css", StaticFiles(directory="frontend/css"), name="css")
app.mount("/js", StaticFiles(directory="frontend/js"), name="js")
app.mount("/logo", StaticFiles(directory="frontend/logo"), name="logo")


@app.get("/favicon.svg")
async def serve_favicon():
    return FileResponse("frontend/favicon.svg")


@app.get("/")
async def serve_index():
    return FileResponse("frontend/index.html")


@app.get("/login")
async def serve_login():
    return FileResponse("frontend/login.html")


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/api/server-status")
async def server_status():
    """Return server status including shutdown notice and start time for frontend polling."""
    import json as _json
    from fastapi.responses import JSONResponse
    notice = None
    try:
        if _os.path.exists(_SHUTDOWN_NOTICE_FILE):
            with open(_SHUTDOWN_NOTICE_FILE, "r") as f:
                notice = _json.load(f)
    except Exception:
        pass
    return JSONResponse(
        content={
            "status": "shutting-down" if notice else "running",
            "notice": notice,
            "server_start_time": SERVER_START_TIME,
        },
        headers={"Cache-Control": "no-store, no-cache, must-revalidate"},
    )
