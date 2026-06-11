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


def _migrate_product_hierarchy():
    """Migrate flat product lines to 3-level tree structure.

    1. Add parent_id and sort_order to pma_product_lines
    2. Add product_id to product_doc_templates
    3. For each existing ProductDocTemplate, find or create a ProductLine
       root node and set product_id FK.
    """
    import sqlite3
    from datetime import datetime

    sqlite_conn = sqlite3.connect(_db_path)
    cursor = sqlite_conn.cursor()

    try:
        # Step 0: Remove UNIQUE(name) constraint on pma_product_lines (if still present).
        # The new hierarchy allows same name under different parents.
        cursor.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='pma_product_lines'")
        ddl = cursor.fetchone()[0]
        if 'UNIQUE' in ddl and 'name' in ddl:
            # Recreate table without UNIQUE constraint
            cursor.execute("PRAGMA table_info(`pma_product_lines`)")
            cols = [(row[1], row[2]) for row in cursor.fetchall()]

            # Build column definitions: preserve NOT NULL, PRIMARY KEY, DEFAULT
            col_defs_parts = []
            for name, ctype in cols:
                if name == 'id':
                    col_defs_parts.append(f'"{name}" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT')
                elif name == 'parent_id':
                    col_defs_parts.append(f'"{name}" INTEGER REFERENCES pma_product_lines(id)')
                elif 'NOT NULL' in ctype.upper():
                    col_defs_parts.append(f'"{name}" {ctype}')
                else:
                    col_defs_parts.append(f'"{name}" {ctype}')

            col_defs = ', '.join(col_defs_parts)
            col_names_list = ', '.join(f'"{c[0]}"' for c in cols)

            cursor.execute('ALTER TABLE `pma_product_lines` RENAME TO `_pl_old`')
            cursor.execute(f'CREATE TABLE `pma_product_lines` ({col_defs})')
            cursor.execute(f'INSERT INTO `pma_product_lines` ({col_names_list}) SELECT {col_names_list} FROM `_pl_old`')
            cursor.execute('DROP TABLE `_pl_old`')
            sqlite_conn.commit()
            logger.info("Removed UNIQUE(name) constraint from pma_product_lines")

        # Check if product_id column exists
        cursor.execute("PRAGMA table_info(`product_doc_templates`)")
        col_names = {row[1] for row in cursor.fetchall()}
        if "product_id" not in col_names:
            return  # _migrate_sqlite will add columns on next startup, then this runs again

        # Check if migration already done
        cursor.execute("SELECT COUNT(*) FROM `product_doc_templates` WHERE `product_id` IS NOT NULL")
        already_migrated = cursor.fetchone()[0] > 0
        if already_migrated:
            return

        # Migrate: for each product_doc_template with a product_line value,
        # find or create a ProductLine root node, then set product_id
        cursor.execute("SELECT `id`, `product_line` FROM `product_doc_templates` WHERE `product_line` IS NOT NULL AND `product_line` != ''")
        templates = cursor.fetchall()

        for tpl_id, product_line_name in templates:
            # Find existing ProductLine with this name
            cursor.execute(
                "SELECT `id` FROM `pma_product_lines` WHERE `name` = ? ORDER BY `id` LIMIT 1",
                (product_line_name,),
            )
            row = cursor.fetchone()
            if row:
                pl_id = row[0]
            else:
                # Create new root ProductLine
                now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                cursor.execute(
                    "INSERT INTO `pma_product_lines` (`name`, `parent_id`, `sort_order`, `created_at`) VALUES (?, NULL, ?, ?)",
                    (product_line_name, 0, now),
                )
                pl_id = cursor.lastrowid

            # Set product_id FK
            cursor.execute(
                "UPDATE `product_doc_templates` SET `product_id` = ? WHERE `id` = ?",
                (pl_id, tpl_id),
            )

        # Also ensure all existing ProductLine rows have sort_order=0 (not NULL)
        cursor.execute("UPDATE `pma_product_lines` SET `sort_order` = 0 WHERE `sort_order` IS NULL")

        sqlite_conn.commit()
        logger.info("Product hierarchy migration completed successfully")

    except Exception as e:
        logger.warning(f"Product hierarchy migration: {e}")
    finally:
        sqlite_conn.close()


def init_db():
    from backend.models.local import LocalUser, Role, UserRole, ProjectNote, PmaSetting, AuditLog, ProjectActivity  # noqa: F401
    from backend.models.bug import CachedBug  # noqa: F401
    from backend.models.delivery import DeliveryRecord  # noqa: F401
    from backend.models.document import DocumentTemplate, ProjectDocument, ProductDocTemplate, ProductLine, PmaTag  # noqa: F401
    from backend.models.standard import ProcessStandard  # noqa: F401
    from backend.models.log_entry import LogEntry  # noqa: F401
    from backend.models.zentao import (  # noqa: F401
        CachedProject,
        CachedExecution,
        CachedTask,
        CachedUser,
        CachedProduct,
        ProductProjectLink,
        CachedCustomer,
        CustomerProjectLink,
        CustomerProductLink,
        CachedRelease,
    )

    logger.info(f"Database path: {_db_path}")
    Base.metadata.create_all(bind=engine)
    _migrate_sqlite()
    _migrate_product_hierarchy()

    # Seed document templates on first startup
    from backend.services.document_service import seed_document_templates
    db = SessionLocal()
    try:
        count = seed_document_templates(db)
        if count:
            logger.info(f"Seeded {count} document templates")
    finally:
        db.close()

    # Ensure SQLite DB file is writable
    if _os.path.exists(_db_path):
        _os.chmod(_db_path, 0o666)
        logger.debug(f"DB file permissions: {oct(_os.stat(_db_path).st_mode)[-3:]}")

    # Seed default roles + admin if no users exist
    db = SessionLocal()
    try:
        from backend.models.local import LocalUser, Role, UserRole

        # Seed default roles if not exist
        default_roles = [
            ("public", "普通用户", "", "默认角色组，所有登录用户自动拥有（基础访问权限）"),
            ("admin", "管理员", "admin,sync,project_edit,product_link,customer_link,doc_template,stage_mapping", "系统完整管理权限（不可修改）"),
            ("ceo", "CEO", "", "查看所有项目数据"),
            ("cto", "CTO", "", "查看所有项目数据"),
            ("pm", "项目经理", "sync,project_edit,product_link,customer_link,doc_template,stage_mapping", "项目管理+同步+产客关系维护+文档模板+阶段映射"),
            ("sales", "销售及售前", "", "查看售前+分配项目"),
            ("hw_dev", "硬件开发", "", "查看分配项目"),
            ("structure", "结构设计及装配", "", "查看分配项目"),
            ("hw_test", "硬件测试", "", "查看分配项目"),
            ("bsp_dev", "BSP开发", "", "查看分配项目"),
            ("sw_dev", "业务软件开发", "", "查看分配项目"),
            ("test_delivery", "测试交付", "project_edit,doc_template", "查看分配项目+交付管理+文档模板"),
            ("procurement", "采购", "", "查看分配项目"),
            ("quality", "质检", "", "查看分配项目"),
            ("warehouse", "库房管理", "", "查看分配项目"),
        ]
        for key, label, perms, desc in default_roles:
            if not db.query(Role).filter(Role.key == key).first():
                db.add(Role(key=key, label=label, permissions=perms, description=desc))
        db.commit()

        if db.query(LocalUser).count() == 0:
            import bcrypt as _bcrypt
            admin = LocalUser(
                username="admin",
                password_hash=_bcrypt.hashpw(b"admin123", _bcrypt.gensalt(rounds=12)).decode(),
                role="admin",
                zentao_account=None,
                is_active=True,
            )
            db.add(admin)
            db.commit()
            logger.info("Default admin user created")

        # Ensure all users have role assignments: map role→Role
        admin_role = db.query(Role).filter(Role.key == "admin").first()
        for u in db.query(LocalUser).all():
            existing_ur = db.query(UserRole).filter(UserRole.user_id == u.id).first()
            if not existing_ur:
                role = db.query(Role).filter(Role.key == u.role).first()
                if role:
                    db.add(UserRole(user_id=u.id, role_id=role.id))
        db.commit()
        logger.info("User role assignments synced")
    finally:
        db.close()
