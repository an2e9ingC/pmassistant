import logging
import os as _os
from contextlib import asynccontextmanager
from logging.handlers import RotatingFileHandler

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from backend.config import settings
from backend.database import init_db
from backend.routers import auth, config, dashboard, projects, sync, products, delivery, reports, logs, customers

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
    # Add database log handler after tables are created
    from backend.services.log_handler import DatabaseLogHandler
    _db_handler = DatabaseLogHandler()
    _db_handler.setFormatter(logging.Formatter("%(message)s"))
    _db_handler.setLevel(logging.DEBUG)
    logging.getLogger().addHandler(_db_handler)
    logger.info("Database initialized + DB log handler attached")
    yield
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

# API routes
app.include_router(auth.router)
app.include_router(dashboard.router)
app.include_router(projects.router)
app.include_router(sync.router)
app.include_router(products.router)
app.include_router(delivery.router)
app.include_router(reports.router)
app.include_router(logs.router)
app.include_router(customers.router)
app.include_router(config.router)

# Static files (frontend)
app.mount("/css", StaticFiles(directory="frontend/css"), name="css")
app.mount("/js", StaticFiles(directory="frontend/js"), name="js")


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
