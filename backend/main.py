import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from backend.config import settings
from backend.database import init_db
from backend.routers import auth, dashboard, projects, sync

logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting PMA backend...")
    init_db()
    logger.info("Database initialized")
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

# Static files (frontend)
app.mount("/css", StaticFiles(directory="frontend/css"), name="css")
app.mount("/js", StaticFiles(directory="frontend/js"), name="js")


@app.get("/")
async def serve_index():
    return FileResponse("frontend/index.html")


@app.get("/login")
async def serve_login():
    return FileResponse("frontend/login.html")


@app.get("/api/health")
async def health():
    return {"status": "ok"}
