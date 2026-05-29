from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

from backend.config import settings

engine = create_engine(
    settings.DATABASE_URL,
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
    """Add missing columns to existing SQLite tables (SQLite doesn't support ALTER ADD COLUMN IF NOT EXISTS)."""
    import sqlite3
    from sqlalchemy import inspect
    try:
        conn = engine.connect()
        # Map table name -> expected columns from model
        inspector = inspect(engine)
        table_names = inspector.get_table_names()
        conn.close()

        # Use raw sqlite3 for PRAGMA (avoids SQLAlchemy reflection overhead)
        sqlite_conn = sqlite3.connect(settings.DATABASE_URL.replace("sqlite:///", ""))
        cursor = sqlite_conn.cursor()

        for table_name in table_names:
            cursor.execute(f"PRAGMA table_info(`{table_name}`)")
            existing_cols = {row[1] for row in cursor.fetchall()}
            # Get expected columns from SQLAlchemy table metadata
            if table_name in Base.metadata.tables:
                expected_cols = {c.name for c in Base.metadata.tables[table_name].columns}
                missing = expected_cols - existing_cols
                for col_name in missing:
                    col = Base.metadata.tables[table_name].columns[col_name]
                    col_type = str(col.type).upper()
                    nullable = "" if col.nullable else " NOT NULL"
                    default = ""
                    if col.default:
                        # Skip auto-generated defaults like func.now()
                        pass
                    sql = f"ALTER TABLE `{table_name}` ADD COLUMN `{col_name}` {col_type}{nullable}"
                    cursor.execute(sql)
        sqlite_conn.commit()
        sqlite_conn.close()
    except Exception:
        pass  # Migration is best-effort; create_all handles new tables


def init_db():
    from backend.models.local import LocalUser  # noqa: F401
    from backend.models.bug import CachedBug  # noqa: F401
    from backend.models.delivery import DeliveryRecord  # noqa: F401
    from backend.models.zentao import (  # noqa: F401
        CachedProject,
        CachedExecution,
        CachedTask,
        CachedUser,
        CachedProduct,
        ProductProjectLink,
    )

    Base.metadata.create_all(bind=engine)
    _migrate_sqlite()

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
    finally:
        db.close()
