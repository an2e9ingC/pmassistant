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


def init_db():
    from backend.models.local import LocalUser  # noqa: F401
    from backend.models.zentao import (  # noqa: F401
        CachedProject,
        CachedExecution,
        CachedTask,
        CachedUser,
        CachedProduct,
        ProductProjectLink,
    )

    Base.metadata.create_all(bind=engine)

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
