import os as _os
import logging

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

from backend.config import settings

logger = logging.getLogger(__name__)


def _resolve_db_path() -> str:
    """Resolve the SQLite DB path to an absolute path, creating parent dir if needed."""
    raw = settings.DATABASE_URL
    if raw.startswith("sqlite:///"):
        path = raw[len("sqlite:///"):]
        # Resolve relative paths against the backend package directory
        if not _os.path.isabs(path):
            # Use the directory of this file (backend/) as the base
            base_dir = _os.path.dirname(_os.path.abspath(__file__))
            # Go up one level to project root
            project_root = _os.path.dirname(base_dir)
            path = _os.path.normpath(_os.path.join(project_root, path))
        # Ensure parent directory exists with write permission
        parent = _os.path.dirname(path)
        _os.makedirs(parent, exist_ok=True)
        _os.chmod(parent, 0o777)
        return path
    return raw


_db_path = _resolve_db_path()
_db_url = f"sqlite:///{_db_path}" if not _db_path.startswith("sqlite:///") else _db_path

engine = create_engine(
    _db_url if _db_url.startswith("sqlite:///") else settings.DATABASE_URL,
    connect_args={"check_same_thread": False} if "sqlite" in settings.DATABASE_URL else {},
    echo=False,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _migrate_sqlite():
    """Add missing columns to existing SQLite tables."""
    import sqlite3
    from sqlalchemy import inspect
    try:
        conn = engine.connect()
        inspector = inspect(engine)
        table_names = inspector.get_table_names()
        conn.close()

        sqlite_conn = sqlite3.connect(_db_path)
        cursor = sqlite_conn.cursor()

        for table_name in table_names:
            cursor.execute(f"PRAGMA table_info(`{table_name}`)")
            existing_cols = {row[1] for row in cursor.fetchall()}
            if table_name in Base.metadata.tables:
                expected_cols = {c.name for c in Base.metadata.tables[table_name].columns}
                missing = expected_cols - existing_cols
                for col_name in missing:
                    col = Base.metadata.tables[table_name].columns[col_name]
                    col_type = str(col.type).upper()
                    nullable = "" if col.nullable else " NOT NULL"
                    sql = f"ALTER TABLE `{table_name}` ADD COLUMN `{col_name}` {col_type}{nullable}"
                    cursor.execute(sql)
        sqlite_conn.commit()
        sqlite_conn.close()
    except Exception:
        pass


def init_db():
    from backend.models.local import LocalUser  # noqa: F401
    from backend.models.bug import CachedBug  # noqa: F401
    from backend.models.delivery import DeliveryRecord  # noqa: F401
    from backend.models.log_entry import LogEntry  # noqa: F401
    from backend.models.zentao import (  # noqa: F401
        CachedProject,
        CachedExecution,
        CachedTask,
        CachedUser,
        CachedProduct,
        ProductProjectLink,
    )

    logger.info(f"Database path: {_db_path}")
    Base.metadata.create_all(bind=engine)
    _migrate_sqlite()

    # Ensure SQLite DB file is writable
    if _os.path.exists(_db_path):
        _os.chmod(_db_path, 0o666)
        logger.debug(f"DB file permissions: {oct(_os.stat(_db_path).st_mode)[-3:]}")

    # Seed default admin if no users exist
    db = SessionLocal()
    try:
        from backend.models.local import LocalUser
        from passlib.context import CryptContext

        if db.query(LocalUser).count() == 0:
            pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
            admin = LocalUser(
                username="admin",
                password_hash=pwd_context.hash("admin123"),
                display_name="管理员",
                role="admin",
                zentao_account=None,
                is_active=True,
            )
            db.add(admin)
            db.commit()
            logger.info("Default admin user created")
    finally:
        db.close()
