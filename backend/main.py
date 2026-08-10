import logging
import os as _os
import time
from contextlib import asynccontextmanager
from logging.handlers import RotatingFileHandler

from fastapi import FastAPI, Depends, HTTPException, Request, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response, JSONResponse
from fastapi.exceptions import RequestValidationError
from sqlalchemy.orm import Session

from backend.config import settings, SERVER_START_TIME
from backend.database import init_db
from backend.routers import auth, config, dashboard, projects, sync, products, delivery, reports, logs, topology, admin_users, maintenance, customers, document_template, product_doc_template, pma_tag, standards, gitlab, db_manage, product_management, notifications, documents, tasks, worklogs, bugs, wecom, uploads_manage, users

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
logging.getLogger("backend.services.doc_scanner").setLevel(logging.INFO)
logger = logging.getLogger(__name__)

# Startup source self-check results — read by /api/health endpoint.
# Status: "pending" (not yet checked) | "ok" | "disabled" | "unconfigured" | "failed"
startup_source_status = {
    "zentao": {"status": "pending", "detail": "", "checked_at": None},
    "gitlab": {"status": "pending", "detail": "", "checked_at": None},
    "svn":    {"status": "pending", "detail": "", "checked_at": None},
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting PMA backend...")
    _env_path = _os.path.abspath(".env")
    _db_path = _os.path.abspath(getattr(_db_module, "_db_path", "data/pma-8800.db"))
    _cfg_path = _os.path.abspath(f"data/source_config-{_port}.json") if _port else _os.path.abspath("data/source_config-8800.json")
    _env_exists = _os.path.isfile(_env_path)
    _cfg_exists = _os.path.isfile(_cfg_path)
    _db_exists = _os.path.isfile(_db_path)
    logger.info(f"配置文件: {_env_path}" + (" (存在)" if _env_exists else " (缺失)"))
    logger.info(f"数据源配置: {_cfg_path}" + (" (存在)" if _cfg_exists else " (未创建)"))
    logger.info(f"数据库:   {_db_path}" + (" (存在)" if _db_exists else " (新建)"))
    init_db()
    logger.info("Database initialized")
    from backend.database import _log_db_change_if_replaced
    _log_db_change_if_replaced()

    # ── Startup connection self-test: enabled sources must pass ──
    import json, urllib.request, urllib.error, time as _time
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
            startup_source_status[key] = {"status": "disabled", "detail": "", "checked_at": _time.time()}
            continue
        if not url:
            logger.warning(f"[启动自检] {label}: 未配置地址，跳过")
            startup_source_status[key] = {"status": "unconfigured", "detail": "未配置地址", "checked_at": _time.time()}
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
            startup_source_status[key] = {"status": "ok", "detail": f"HTTP {resp.status}", "checked_at": _time.time()}
        except urllib.error.HTTPError as e:
            logger.warning(f"[启动自检] {label}: HTTP {e.code} — {e.reason}，服务将降级运行")
            startup_source_status[key] = {"status": "failed", "detail": f"HTTP {e.code} — {e.reason}", "checked_at": _time.time()}
        except Exception as e:
            logger.warning(f"[启动自检] {label}: 连接失败 — {e}，服务将降级运行")
            startup_source_status[key] = {"status": "failed", "detail": str(e), "checked_at": _time.time()}

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

    # ── Prominent startup banner ──
    _start_time_str = time.strftime("%Y-%m-%d %H:%M:%S")
    _banner = "PMA system started, current time: " + _start_time_str
    _sep = "-" * len(_banner)
    logger.info(_sep)
    logger.info(_banner)
    logger.info(_sep)

    # Record startup in audit log
    from backend.database import SessionLocal
    from backend.routers.logs import log_audit
    from backend.audit_categories import AUDIT_CAT_SYSTEM
    _db = SessionLocal()
    try:
        log_audit(_db, None, "system_startup", "PMA system started", AUDIT_CAT_SYSTEM, "low")
    except Exception as _e:
        logger.warning(f"Failed to write startup audit log: {_e}")
    finally:
        _db.close()

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


@app.middleware("http")
async def _add_no_cache_headers(request: Request, call_next):
    """Prevent browser caching: API data + HTML pages must always be fresh."""
    response: Response = await call_next(request)
    path = request.url.path
    # Disable all browser caching — always fetch fresh content
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    if "etag" in response.headers:
        del response.headers["etag"]
    return response


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request, exc):
    logger.warning(f"[ValidationError] {request.method} {request.url.path}: {exc.errors()}")
    return JSONResponse(status_code=422, content={"code": 1, "message": str(exc.errors())})

@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    logger.error(f"Unhandled error on {request.method} {request.url.path}: {exc}", exc_info=True)
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
app.include_router(users.router)
app.include_router(maintenance.router)
app.include_router(customers.router)
app.include_router(document_template.router)
app.include_router(document_template.task_router)
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
app.include_router(wecom.router)
app.include_router(bugs.router)
app.include_router(uploads_manage.router)

# ── Attachment serving (standalone, not prefixed) ──
from fastapi.responses import StreamingResponse
from backend.services import bug_service as _bs
from backend.database import get_db as _gdb
from backend.middleware.auth import get_current_user as _gcu

@app.get("/api/attachments/{attachment_id}")
def serve_attachment(attachment_id: int, request: Request, db: Session = Depends(_gdb)):
    result = _bs.get_attachment_path(attachment_id, db)
    if not result:
        logger.warning(f"Attachment #{attachment_id} not found — 附件丢失")
        # For image requests, return a placeholder SVG showing "附件丢失" (avoid console 404 + give clear visual hint)
        accept = request.headers.get("accept", "")
        if "image/" in accept:
            _placeholder_svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="50"><rect width="100%" height="100%" fill="#f5f5f5" stroke="#ddd" stroke-width="1" rx="6"/><text x="50%" y="50%" text-anchor="middle" dy=".3em" font-family="sans-serif" font-size="13" fill="#999">附件丢失</text></svg>'
            return Response(content=_placeholder_svg, media_type="image/svg+xml")
        raise HTTPException(status_code=404, detail="Attachment not found")
    path, mime, fname = result
    from urllib.parse import quote
    encoded_fname = quote(fname, safe='')
    return StreamingResponse(open(path, "rb"), media_type=mime,
                             headers={"Content-Disposition": f"inline; filename*=UTF-8''{encoded_fname}"})

# ── Note image upload ──
import uuid as _uuid
_NOTE_IMG_DIR = _os.path.join("data", "uploads", "note_images")
_os.makedirs(_NOTE_IMG_DIR, exist_ok=True)

@app.post("/api/note-images")
async def upload_note_image(file: UploadFile = File(...), user=Depends(_gcu)):
    import imghdr
    data = await file.read()
    # Validate it's an image
    fmt = imghdr.what(None, h=data)
    if fmt not in ("png", "jpeg", "gif", "webp", "bmp"):
        raise HTTPException(status_code=400, detail="仅支持 PNG/JPEG/GIF/WebP/BMP 图片")
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="图片不能超过 5MB")
    ext = {"jpeg": "jpg"}.get(fmt, fmt)
    fname = f"{_uuid.uuid4().hex}.{ext}"
    with open(_os.path.join(_NOTE_IMG_DIR, fname), "wb") as f:
        f.write(data)
    return {"code": 0, "data": {"url": f"/api/note-images/{fname}"}, "message": "ok"}

app.mount("/api/note-images", StaticFiles(directory=_NOTE_IMG_DIR), name="note-images")

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
    any_failed = any(
        s["status"] == "failed"
        for s in startup_source_status.values()
    )
    return {
        "status": "degraded" if any_failed else "ok",
        "sources": startup_source_status,
    }


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
