import logging
import os as _os
import time
from contextlib import asynccontextmanager
from logging.handlers import RotatingFileHandler

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from backend.config import settings
from backend.database import init_db
from backend.routers import auth, config, dashboard, projects, sync, products, delivery, reports, logs, topology, admin_users

# File log handler — use same directory as database
import backend.database as _db_module
_log_dir = _os.path.dirname(getattr(_db_module, "_db_path", "data/pma.db"))
_log_file = _os.path.join(_log_dir, "pma.log")
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
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting PMA backend...")
    init_db()
    from backend.services.log_handler import DatabaseLogHandler
    _db_handler = DatabaseLogHandler()
    _db_handler.setFormatter(logging.Formatter("%(message)s"))
    _db_handler.setLevel(logging.DEBUG)
    logging.getLogger().addHandler(_db_handler)
    logger.info("Database initialized + DB log handler attached")

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
    yield
    _auto_sync_task.cancel()
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
app.include_router(sync.router)
app.include_router(products.router)
app.include_router(delivery.router)
app.include_router(reports.router)
app.include_router(logs.router)
app.include_router(topology.router)
app.include_router(config.router)
app.include_router(admin_users.router)

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
