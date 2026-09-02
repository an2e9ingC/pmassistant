import json as _json
import os as _os
import logging
import uuid as _uuid
import re as _re
from datetime import datetime as _datetime
from urllib.parse import quote as _urlquote

from sqlalchemy import create_engine, event, func as _sql_func
from sqlalchemy.orm import Session, sessionmaker, DeclarativeBase

from backend.config import settings, BEIJING_OFFSET, BEIJING_TZ, beijing_now, to_iso_str

logger = logging.getLogger(__name__)

# Backward-compatible alias — all call sites use to_local_str, now backed by to_iso_str (ISO 8601 UTC)
to_local_str = to_iso_str


# ── SQLCipher detection ──

_HAS_SQLCIPHER = False
try:
    import pysqlcipher3.dbapi2  # noqa: F401
    _HAS_SQLCIPHER = True
except ImportError:
    pass


def _is_sqlcipher_enabled() -> bool:
    """Check whether SQLCipher encryption is configured and available."""
    return bool(settings.SQLCIPHER_KEY) and _HAS_SQLCIPHER


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

# ── Engine creation ──

if _is_sqlcipher_enabled():
    # Use pysqlcipher3 driver for encrypted SQLite
    _db_url = f"sqlite+pysqlcipher:///{_db_path}?cipher=aes-256-cbc&kdf_iter=256000"
    logger.info("SQLCipher encryption enabled for database")
else:
    _db_url = f"sqlite:///{_db_path}"
    if settings.SQLCIPHER_KEY and not _HAS_SQLCIPHER:
        logger.warning(
            "SQLCIPHER_KEY is configured but pysqlcipher3 is not installed. "
            "Database will be UNENCRYPTED. Install with: pip install pysqlcipher3"
        )

_connect_args = {"check_same_thread": False}

if _is_sqlcipher_enabled():
    _connect_args["key"] = settings.SQLCIPHER_KEY

engine = create_engine(_db_url, connect_args=_connect_args, echo=False)

# ── PRAGMA key event (fallback for drivers that don't support connect_args key) ──

if _is_sqlcipher_enabled():
    @event.listens_for(engine, "connect")
    def _set_sqlcipher_key(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute(f"PRAGMA key = \"{settings.SQLCIPHER_KEY}\"")
        cursor.close()


# ── Custom SQLite scalar: numeric tail of a project code (for code-column sorting) ──
# 'PE0456'→456、'LSJ0538'→538 —— 兼容任意长度的字母前缀(PE/SW/PT/LSJ…)，避免像
# SUBSTR(code, 3) 那样写死两位前缀而把 LSJ 整体算成 0。纯字母/空编号返回 NULL(排最后)。

def _project_code_num(code):
    if not code:
        return None
    m = _re.search(r"(\d+)$", str(code))
    return int(m.group(1)) if m else None


@event.listens_for(engine, "connect")
def _register_sqlite_functions(dbapi_connection, connection_record):
    dbapi_connection.create_function("pma_code_num", 1, _project_code_num)


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
                    default_clause = ""
                    if col.server_default is not None:
                        default_val = str(col.server_default.arg) if hasattr(col.server_default, 'arg') else str(col.server_default)
                        default_clause = f" DEFAULT '{default_val}'"
                    sql = f"ALTER TABLE `{table_name}` ADD COLUMN `{col_name}` {col_type}{default_clause}{nullable}"
                    cursor.execute(sql)
        sqlite_conn.commit()
        sqlite_conn.close()
    except Exception as e:
        logger.warning(f"Migration warning: {e}")


def _migrate_board_status_rename():
    """板卡状态「硬件上电测试」重命名为「硬件上电」，同步存量板卡与时间线事件数据。

    幂等：仅更新仍为旧状态名的行。经 SQLAlchemy engine 执行，兼容 SQLCipher 加密库。
    """
    from sqlalchemy import text
    try:
        with engine.connect() as conn:
            conn.execute(text(
                "UPDATE `delivery_boards` SET `status` = '硬件上电' WHERE `status` = '硬件上电测试'"))
            conn.execute(text(
                "UPDATE `delivery_board_events` SET `from_status` = '硬件上电' WHERE `from_status` = '硬件上电测试'"))
            conn.execute(text(
                "UPDATE `delivery_board_events` SET `to_status` = '硬件上电' WHERE `to_status` = '硬件上电测试'"))
            conn.commit()
    except Exception as e:
        logger.warning(f"Migration warning (board status rename): {e}")


def _migrate_password_hash_nullable():
    """Make local_users.password_hash nullable for GitLab OAuth users.

    SQLite does not support ALTER COLUMN DROP NOT NULL, so we recreate the table.
    """
    import sqlite3

    sqlite_conn = sqlite3.connect(_db_path)
    cursor = sqlite_conn.cursor()

    try:
        # Check if password_hash is NOT NULL
        cursor.execute("PRAGMA table_info(`local_users`)")
        cols = {row[1]: row for row in cursor.fetchall()}
        pw_col = cols.get("password_hash")
        if pw_col is None:
            return  # Column doesn't exist yet — will be created correctly by SQLAlchemy
        if not pw_col[3]:  # notnull flag is 0 = nullable, 1 = NOT NULL
            return  # Already nullable

        logger.info("Migrating local_users.password_hash to allow NULL...")

        # Get the CREATE TABLE SQL
        cursor.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='local_users'")
        create_sql = cursor.fetchone()[0]

        # Build column list from PRAGMA
        col_defs = []
        col_names = []
        for row in cursor.execute("PRAGMA table_info(`local_users`)").fetchall():
            cid, name, ctype, notnull, default_val, pk = row
            col_names.append(name)
            parts = [f"`{name}`", ctype]
            if pk:
                parts.append("PRIMARY KEY")
            if name == "password_hash":
                # Make nullable: omit NOT NULL
                pass
            elif notnull:
                parts.append("NOT NULL")
            if default_val is not None:
                parts.append(f"DEFAULT {default_val}")
            col_defs.append(" ".join(parts))

        new_table_sql = f"CREATE TABLE `local_users_new` ({', '.join(col_defs)})"

        # Execute migration in a transaction
        cursor.execute("PRAGMA foreign_keys=OFF")
        cursor.execute(new_table_sql)
        col_list = ", ".join(f"`{c}`" for c in col_names)
        cursor.execute(f"INSERT INTO `local_users_new` ({col_list}) SELECT {col_list} FROM `local_users`")
        cursor.execute("DROP TABLE `local_users`")
        cursor.execute("ALTER TABLE `local_users_new` RENAME TO `local_users`")

        # Recreate indexes
        cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS `ix_local_users_username` ON `local_users` (`username`)")
        cursor.execute("CREATE INDEX IF NOT EXISTS `ix_local_users_gitlab_user_id` ON `local_users` (`gitlab_user_id`)")
        # Backfill NULL auth_source for existing users
        cursor.execute("UPDATE `local_users` SET `auth_source` = 'local' WHERE `auth_source` IS NULL")

        sqlite_conn.commit()
        logger.info("local_users.password_hash is now nullable")
    except Exception as e:
        sqlite_conn.rollback()
        logger.warning(f"password_hash migration warning: {e}")
    finally:
        sqlite_conn.close()


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
                now = beijing_now().strftime("%Y-%m-%d %H:%M:%S")
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


def _migrate_project_doc_template_id():
    """Add and backfill template_id column on project_documents.

    Steps:
    1. _migrate_sqlite() auto-adds the column from the model. This function backfills.
    2. For each project_document, find matching document_template by:
       - Matching project_type (look up from zenta_projects)
       - Matching stage_type
       - Matching doc_name
    3. If exactly one match, set template_id.
    4. Log results.
    """
    import sqlite3

    sqlite_conn = sqlite3.connect(_db_path)
    cursor = sqlite_conn.cursor()

    try:
        # Check if column exists
        cursor.execute("PRAGMA table_info(`project_documents`)")
        cols = {row[1] for row in cursor.fetchall()}
        if "template_id" not in cols:
            return  # _migrate_sqlite will add it next restart; backfill on next run

        # Check if already backfilled
        cursor.execute("SELECT COUNT(*) FROM `project_documents` WHERE `template_id` IS NOT NULL")
        already = cursor.fetchone()[0]
        if already > 0:
            return  # Already done

        # Backfill: match by project_type + stage_type + doc_name
        cursor.execute("""
            UPDATE project_documents
            SET template_id = (
                SELECT dt.id FROM document_templates dt
                JOIN zenta_projects zp ON zp.id = project_documents.project_id
                WHERE dt.doc_name = project_documents.doc_name
                  AND dt.stage_type = project_documents.stage_type
                  AND dt.project_type = COALESCE(zp.project_type, 'RD')
                LIMIT 1
            )
            WHERE template_id IS NULL
        """)
        matched = cursor.rowcount

        # Count remaining NULLs
        cursor.execute("SELECT COUNT(*) FROM `project_documents` WHERE `template_id` IS NULL")
        remaining = cursor.fetchone()[0]

        sqlite_conn.commit()
        logger.info(
            f"ProjectDocument template_id backfill: {matched} matched, "
            f"{remaining} remaining (NULL)"
        )
    except Exception as e:
        logger.warning(f"ProjectDocument template_id migration error: {e}")
    finally:
        sqlite_conn.close()
        sqlite_conn.close()


def _migrate_to_sqlcipher():
    """Convert an existing unencrypted SQLite DB to SQLCipher-encrypted.

    Strategy:
    1. Use sqlcipher CLI (if available): sqlcipher old.db "ATTACH ...; SELECT sqlcipher_export(...)"
    2. Fallback: use Python sqlite3 + pysqlcipher3 to copy data page by page
    """
    if not _is_sqlcipher_enabled():
        return

    import sqlite3 as _stdlib_sqlite3

    # Check if DB is already encrypted (try opening with standard sqlite3)
    try:
        test_conn = _stdlib_sqlite3.connect(f"file:{_db_path}?mode=ro", uri=True)
        test_conn.execute("SELECT count(*) FROM sqlite_master")
        test_conn.close()
        # DB is readable with standard sqlite3 → it's unencrypted, needs migration
    except Exception:
        # DB is already encrypted or doesn't exist yet
        return

    # Try sqlcipher CLI first
    import subprocess as _sp
    import shutil as _shutil

    encrypted_path = _db_path + ".encrypted"
    sqlcipher_bin = _shutil.which("sqlcipher")

    if sqlcipher_bin:
        try:
            # Use sqlcipher CLI to create encrypted copy
            # sqlcipher old.db "PRAGMA key='...'; ATTACH 'encrypted.db' AS enc KEY '...'; SELECT sqlcipher_export('enc'); DETACH enc;"
            _sp.run(
                [sqlcipher_bin, _db_path],
                input=f"PRAGMA key=\"{settings.SQLCIPHER_KEY}\";\n"
                      f"ATTACH DATABASE '{encrypted_path}' AS enc KEY \"{settings.SQLCIPHER_KEY}\";\n"
                      f"SELECT sqlcipher_export('enc');\n"
                      f"DETACH DATABASE enc;\n"
                      f".quit\n",
                text=True, capture_output=True, timeout=120,
            )
            if _os.path.exists(encrypted_path) and _os.path.getsize(encrypted_path) > 0:
                _os.replace(encrypted_path, _db_path)
                logger.info("SQLCipher migration completed via sqlcipher CLI")
                return
        except Exception as e:
            logger.warning(f"sqlcipher CLI migration failed: {e}")

    # Fallback: use Python's pysqlcipher3 to migrate
    if _HAS_SQLCIPHER:
        import pysqlcipher3.dbapi2 as _sqlcipher
        try:
            # Read from unencrypted, write to encrypted
            src = _stdlib_sqlite3.connect(_db_path)
            dst = _sqlcipher.connect(encrypted_path)
            dst.execute(f"PRAGMA key = \"{settings.SQLCIPHER_KEY}\"")

            # Copy schema
            for row in src.execute("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name"):
                dst.execute(row[0])

            # Copy data
            tables = [r[0] for r in src.execute("SELECT name FROM sqlite_master WHERE type='table'")]
            for table in tables:
                rows = list(src.execute(f"SELECT * FROM \"{table}\""))
                if not rows:
                    continue
                cols = [d[0] for d in src.execute(f"PRAGMA table_info(\"{table}\")")]
                placeholders = ",".join(["?" for _ in cols])
                cols_q = ",".join(f'"{c}"' for c in cols)
                dst.executemany(f"INSERT INTO {cols_q} VALUES ({placeholders})", rows)

            dst.commit()
            src.close()
            dst.close()

            if _os.path.exists(encrypted_path) and _os.path.getsize(encrypted_path) > 0:
                backup = _db_path + ".pre-sqlcipher.bak"
                _os.rename(_db_path, backup)
                _os.rename(encrypted_path, _db_path)
                logger.info(f"SQLCipher migration completed via pysqlcipher3 (backup: {backup})")
                return
        except Exception as e:
            logger.warning(f"pysqlcipher3 migration failed: {e}")
            if _os.path.exists(encrypted_path):
                _os.remove(encrypted_path)

    logger.warning(
        "SQLCIPHER_KEY is configured but automatic migration failed. "
        "Install sqlcipher CLI (apt install sqlcipher) and run manually: "
        f"sqlcipher {_db_path} \"PRAGMA key='...'; SELECT sqlcipher_export('main');\""
    )


def _migrate_task_is_deleted():
    """Separate is_diverged (sync-guard) from is_deleted (soft-delete).

    is_diverged = sync guard only: the task was edited away from its template and
                 the template sync must NOT overwrite it. The task stays visible and
                 is_diverged must NEVER imply soft-delete.
    is_deleted  = user soft-delete: hides the task from lists (set by delete_task).

    This migration ONLY cleans up legacy broken is_diverged flags left by old
    template-deletion code. It NEVER derives is_deleted from is_diverged.
    """
    import sqlite3
    try:
        conn = sqlite3.connect(_db_path)
        cursor = conn.cursor()
        cursor.execute("PRAGMA table_info(pma_tasks)")
        cols = {row[1] for row in cursor.fetchall()}
        # is_deleted column is added by _migrate_sqlite; nothing to fix here if is_diverged missing.
        if "is_diverged" not in cols:
            conn.close()
            return

        # Legacy broken flags: is_diverged=1 but template no longer exists / task has no template.
        # Set by old code that conflated "removed from template" with divergence.
        # Clear them so the task is treated as a normal (manual) task again; do NOT touch is_deleted.
        cursor.execute("""
            UPDATE pma_tasks SET is_diverged = 0
            WHERE is_diverged = 1
              AND (template_id IS NULL
                   OR template_id NOT IN (SELECT id FROM task_templates))
        """)
        cleared = cursor.rowcount

        conn.commit()
        conn.close()
        if cleared:
            logger.info(f"_migrate_task_is_deleted: cleared legacy is_diverged on {cleared} tasks")
    except Exception as e:
        logger.warning(f"_migrate_task_is_deleted: {e}")


def _rebuild_table_dropping_execution_id(cursor, table_name):
    """Rebuild `table_name` without the `execution_id` column (and its FK/index).

    SQLite 3.31 < 3.35 has no `ALTER TABLE DROP COLUMN`, so we recreate the table
    from its own CREATE TABLE DDL, surgically stripping the execution_id column
    and its FOREIGN KEY clause, then copy data back and restore surviving indexes.
    Returns True if a rebuild happened, False if execution_id was already absent.
    """
    import re

    cursor.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (table_name,)
    )
    row = cursor.fetchone()
    if not row or "execution_id" not in row[0]:
        return False
    create_sql = row[0]

    # 1. Drop the execution_id column definition (handles optional NOT NULL + backticks)
    new_sql = re.sub(r"`?execution_id`?\s+INTEGER(\s+NOT\s+NULL)?,", "", create_sql)
    # 2. Drop the FOREIGN KEY clause referencing zenta_executions
    new_sql = re.sub(
        r"\n\s*FOREIGN KEY\s*\(\s*`?execution_id`?\s*\)\s*REFERENCES\s+`?zenta_executions`?\s*\(\s*id\s*\),?",
        "",
        new_sql,
    )
    # 2b. If execution_id's FK was the last constraint (no trailing comma), the
    #     preceding constraint line now ends with a dangling comma before ")".
    new_sql = re.sub(r",\s*\n\s*\)", "\n)", new_sql)
    # 3. Point the CREATE at the temporary table name
    for quote in ("", "`", '"'):
        new_sql = new_sql.replace(
            f"CREATE TABLE {quote}{table_name}{quote}",
            f"CREATE TABLE {quote}{table_name}_new{quote}",
        )

    # Column list for data copy (all columns except execution_id)
    cursor.execute(f"PRAGMA table_info(`{table_name}`)")
    col_names = [r[1] for r in cursor.fetchall() if r[1] != "execution_id"]
    col_list = ", ".join(f"`{c}`" for c in col_names)

    # Capture surviving indexes (skip any referencing execution_id)
    cursor.execute(
        "SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL",
        (table_name,),
    )
    keep_indexes = [s for (s,) in cursor.fetchall() if "execution_id" not in s]

    # Clean up any orphan temp table left by an earlier interrupted run.
    cursor.execute(f"DROP TABLE IF EXISTS `{table_name}_new`")
    cursor.execute(new_sql)
    cursor.execute(
        f"INSERT INTO `{table_name}_new` ({col_list}) SELECT {col_list} FROM `{table_name}`"
    )
    cursor.execute(f"DROP TABLE `{table_name}`")
    cursor.execute(f"ALTER TABLE `{table_name}_new` RENAME TO `{table_name}`")
    for idx_sql in keep_indexes:
        cursor.execute(idx_sql)
    return True


def _migrate_drop_execution():
    """Remove the Zentao execution/task cache layer.

    1. DROP the (empty) zenta_executions / zenta_tasks cache tables.
    2. Drop the now-obsolete execution_id column from pma_tasks and
       project_documents via table rebuild.
    """
    import sqlite3

    # isolation_level=None → autocommit mode, so we control the transaction
    # explicitly. This makes the DDL (CREATE/DROP/RENAME) atomic: a failure in
    # the second table rebuild won't leave a half-migrated schema behind.
    sqlite_conn = sqlite3.connect(_db_path, isolation_level=None)
    cursor = sqlite_conn.cursor()

    try:
        cursor.execute("PRAGMA foreign_keys=OFF")
        cursor.execute("BEGIN")

        # Drop empty cache tables (dependency order: tasks references executions)
        cursor.execute("DROP TABLE IF EXISTS `zenta_tasks`")
        cursor.execute("DROP TABLE IF EXISTS `zenta_executions`")

        # Drop execution_id from local tables
        rebuilt_tasks = _rebuild_table_dropping_execution_id(cursor, "pma_tasks")
        rebuilt_docs = _rebuild_table_dropping_execution_id(cursor, "project_documents")

        cursor.execute("COMMIT")
        if rebuilt_tasks or rebuilt_docs:
            logger.info(
                "_migrate_drop_execution: dropped zenta_executions/zenta_tasks, "
                f"removed execution_id from pma_tasks={rebuilt_tasks}, project_documents={rebuilt_docs}"
            )
    except Exception as e:
        cursor.execute("ROLLBACK")
        logger.warning(f"_migrate_drop_execution warning: {e}")
    finally:
        sqlite_conn.close()


def _clear_gitlab_tokens():
    """Clear all GitLab OAuth access tokens on server restart.
    Forces users to re-authenticate via GitLab after a restart.
    Also clears refresh tokens (stale without access token context).
    """
    import sqlite3
    try:
        conn = sqlite3.connect(_db_path)
        count = conn.execute(
            "UPDATE local_users SET gitlab_access_token = NULL, gitlab_refresh_token = NULL, gitlab_token_expires_at = NULL "
            "WHERE gitlab_access_token IS NOT NULL OR gitlab_refresh_token IS NOT NULL"
        ).rowcount
        conn.commit()
        conn.close()
        if count > 0:
            logger.info(f"Cleared GitLab tokens for {count} user(s) — re-auth required")
    except Exception as e:
        logger.warning(f"Failed to clear GitLab tokens: {e}")


def clean_orphan_favorites(db: Session):
    """Remove invalid project/product/task/bug IDs from all users' favorites after data deletion."""
    import json as _json
    try:
        from backend.models.local import LocalUser
        from backend.models.zentao import CachedProject, PmaProduct
        from backend.models.task import Task
        from backend.models.bug import PmaBug
        valid_proj = set(r[0] for r in db.query(CachedProject.id).all())
        valid_prod = set(r[0] for r in db.query(PmaProduct.id).all())
        valid_tasks = set(r[0] for r in db.query(Task.id).all())
        valid_bugs = set(r[0] for r in db.query(PmaBug.id).all())
        users = db.query(LocalUser).all()
        fixed = 0
        for u in users:
            try:
                favs = _json.loads(u.favorites) if u.favorites else {"products": [], "projects": [], "tasks": [], "bugs": []}
            except (_json.JSONDecodeError, TypeError):
                favs = {"products": [], "projects": [], "tasks": [], "bugs": []}
            if isinstance(favs, list):
                favs = {"products": [], "projects": favs}
            # Ensure new keys
            favs.setdefault("tasks", [])
            favs.setdefault("bugs", [])
            proj_ids = favs.get("projects", [])
            prod_ids = favs.get("products", [])
            task_ids = favs.get("tasks", [])
            bug_ids = favs.get("bugs", [])
            new_proj = [p for p in proj_ids if p in valid_proj]
            new_prod = [p for p in prod_ids if p in valid_prod]
            new_tasks = [t for t in task_ids if t in valid_tasks]
            new_bugs = [b for b in bug_ids if b in valid_bugs]
            if len(new_proj) != len(proj_ids) or len(new_prod) != len(prod_ids) or len(new_tasks) != len(task_ids) or len(new_bugs) != len(bug_ids):
                favs["projects"] = new_proj
                favs["products"] = new_prod
                favs["tasks"] = new_tasks
                favs["bugs"] = new_bugs
                u.favorites = _json.dumps(favs)
                fixed += 1
        if fixed:
            db.commit()
            import logging as _log
            _log.getLogger(__name__).info(f"Cleaned orphan favorites for {fixed} user(s)")
    except Exception:
        pass  # best-effort, don't block the main operation


def init_db():
    from backend.models.local import LocalUser, Role, UserRole, ProductBlockDiagram, ProductNote, ProjectNote, PmaSetting, AuditLog, ProjectActivity, ProductActivity  # noqa: F401
    from backend.models.bug import CachedBug, PmaBug, BugWorkLog, BugAnalysis, BugAttachment, BugTransfer  # noqa: F401
    from backend.models.delivery import DeliveryRecord, DeliveryMaterialCode, DeliveryBoard, DeliveryBoardEvent  # noqa: F401
    from backend.models.document import DocumentTemplate, ProjectDocument, ProductDocTemplate, ProductLine, PmaTag, ProductDocument, ProductNamingOption, BugTemplate  # noqa: F401
    from backend.models.standard import ProcessStandard  # noqa: F401
    from backend.models.task import Task, WorkLog, TaskComment  # noqa: F401
    from backend.models.action import EntityAction, EntityActionChange  # noqa: F401
    from backend.models.project_stage import ProjectStage  # noqa: F401
    from backend.models.zentao import (  # noqa: F401
        CachedProject,
        CachedUser,
        PmaProduct,
        ProductProjectLink,
        PmaCustomer,
        CustomerProjectLink,
        CustomerProductLink,
        CachedRelease,
        ProductNodeLink,
    )

    logger.info(f"Database path: {_db_path}")
    Base.metadata.create_all(bind=engine)
    _migrate_sqlite()
    _migrate_drop_execution()   # remove Zentao execution/task cache layer + execution_id columns
    _migrate_password_hash_nullable()
    _migrate_product_hierarchy()
    _migrate_project_doc_template_id()  # backfill template_id on project_documents
    _migrate_task_is_deleted()  # Split is_diverged semantics: add is_deleted, fix existing data
    _migrate_board_status_rename()  # 板卡状态「硬件上电测试」→「硬件上电」
    _migrate_to_sqlcipher()  # Convert unencrypted DB to SQLCipher if key configured
    _clear_gitlab_tokens()   # Force re-auth on server restart
    _ensure_db_instance_id()  # Ensure instance UUID for DB fingerprint detection

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
            ("admin", "管理员", "admin,sync,project_edit,product_link,customer_link,doc_template,stage_mapping,manpower_view,board_manage", "系统完整管理权限（不可修改）"),
            ("ceo", "CEO", "manpower_view", "查看所有项目数据"),
            ("cto", "CTO", "manpower_view", "查看所有项目数据"),
            ("pm", "项目经理", "sync,project_edit,product_link,customer_link,doc_template,stage_mapping,task_edit,manpower_view,board_manage", "项目管理+同步+产客关系维护+文档模板+阶段映射+任务+板卡管理"),
            ("hr", "人力", "manpower_view", "人力报表+工时统计查看"),
            ("sales", "销售及售前", "board_manage", "查看售前+分配项目+板卡管理"),
            ("hw_dev", "硬件开发", "board_manage", "查看分配项目+板卡管理"),
            ("structure", "结构设计及装配", "board_manage", "查看分配项目+板卡管理"),
            ("hw_test", "硬件测试", "board_manage", "查看分配项目+板卡管理"),
            ("bsp_dev", "BSP开发", "board_manage", "查看分配项目+板卡管理"),
            ("sw_dev", "业务软件开发", "board_manage", "查看分配项目+板卡管理"),
            ("test_delivery", "测试交付", "project_edit,doc_template,board_manage", "查看分配项目+交付管理+文档模板+板卡管理"),
            ("procurement", "采购", "board_manage", "查看分配项目+板卡管理"),
            ("quality", "质检", "board_manage", "查看分配项目+板卡管理"),
            ("warehouse", "库房管理", "board_manage", "查看分配项目+板卡管理"),
        ]
        for key, label, perms, desc in default_roles:
            if not db.query(Role).filter(Role.key == key).first():
                db.add(Role(key=key, label=label, permissions=perms, description=desc))
        db.commit()

        # Ensure manpower_view is in admin/ceo/cto/pm existing roles
        manpower_roles = ["admin", "ceo", "cto", "pm"]
        for rk in manpower_roles:
            role = db.query(Role).filter(Role.key == rk).first()
            if role:
                perms = set(role.permissions.split(",")) if role.permissions else set()
                if "manpower_view" not in perms:
                    perms.add("manpower_view")
                    role.permissions = ",".join(sorted(perms))
        db.commit()

        # Ensure board_manage is in existing roles (板卡管理)
        board_roles = ["admin", "pm", "test_delivery", "warehouse", "quality",
                       "hw_dev", "sw_dev", "bsp_dev", "hw_test", "structure",
                       "procurement", "sales"]
        for rk in board_roles:
            role = db.query(Role).filter(Role.key == rk).first()
            if role:
                perms = set(role.permissions.split(",")) if role.permissions else set()
                if "board_manage" not in perms:
                    perms.add("board_manage")
                    role.permissions = ",".join(sorted(perms))
        db.commit()

        if db.query(LocalUser).count() == 0:
            import bcrypt as _bcrypt
            admin = LocalUser(
                username="admin",
                password_hash=_bcrypt.hashpw(b"admin123", _bcrypt.gensalt(rounds=12)).decode(),
                role="admin",
                zentao_account=None,
                is_active=True,
                must_change_password=True,
            )
            db.add(admin)
            db.commit()
            logger.info("Default admin user created")

        # Flag existing local admin to force password change if still using default admin123
        try:
            admin_user = db.query(LocalUser).filter(
                LocalUser.username == "admin", LocalUser.auth_source == "local"
            ).first()
            if admin_user and admin_user.password_hash and not admin_user.must_change_password:
                import bcrypt as _bcrypt_check
                try:
                    if _bcrypt_check.checkpw(b"admin123", admin_user.password_hash.encode()):
                        admin_user.must_change_password = True
                        db.commit()
                        logger.info("Flagged existing admin (default password) for forced change")
                except Exception:
                    pass
        except Exception as e:
            logger.warning(f"must_change_password backfill warning: {e}")

        # Ensure system user (id=99999) exists for template task creation
        from backend.models.local import get_system_user_id
        get_system_user_id(db)

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


def _ensure_db_instance_id():
    """Ensure a unique instance UUID is stored in pma_settings.

    Called during init_db() on every startup. If no UUID exists (first run
    or DB was replaced), generates a new one.
    """
    from backend.models.local import PmaSetting
    db = next(get_db())
    try:
        existing = db.query(PmaSetting).filter(PmaSetting.key == "db_instance_id").first()
        if not existing:
            inst_id = str(_uuid.uuid4())
            db.add(PmaSetting(key="db_instance_id", value=inst_id))
            db.commit()
            logger.info(f"DB instance ID initialized: {inst_id}")
    finally:
        db.close()


def _check_db_fingerprint():
    """Detect if the database file has been replaced since last startup.

    Uses dual fingerprint:
      - inode (detects file replacement via mv/rm+cp)
      - UUID stored in pma_settings (detects in-place overwrite via cp)

    Returns a dict with 'replaced'=True if the DB was replaced, None otherwise.
    """
    sidecar = _os.path.join(_os.path.dirname(_db_path), ".db-fingerprint")

    # Read previous fingerprint
    prev = {}
    if _os.path.exists(sidecar):
        try:
            with open(sidecar) as f:
                prev = _json.load(f)
        except Exception:
            pass

    # Current file stats
    try:
        st = _os.stat(_db_path)
        cur_inode = st.st_ino
    except OSError:
        return None  # DB not accessible yet

    # Query UUID from DB
    cur_uuid = None
    try:
        from backend.models.local import PmaSetting
        db = next(get_db())
        row = db.query(PmaSetting).filter(PmaSetting.key == "db_instance_id").first()
        if row:
            cur_uuid = row.value
        db.close()
    except Exception:
        pass

    # First run: no previous fingerprint, store baseline
    if not prev:
        _write_db_fingerprint(sidecar, cur_inode, cur_uuid)
        return None

    replaced = False
    reason = ""

    # Check 1: inode changed → file was replaced via mv/rm+cp
    if prev.get("inode") != cur_inode:
        replaced = True
        reason = f"inode changed ({prev.get('inode')} → {cur_inode})"
    # Check 2: UUID mismatch → file was replaced via cp (in-place overwrite)
    elif prev.get("uuid") != cur_uuid:
        replaced = True
        reason = f"db uuid mismatch ({prev.get('uuid')} → {cur_uuid})"

    if replaced:
        logger.warning(f"Database file replaced: {reason}")
        return {"replaced": True, "reason": reason, "cur_inode": cur_inode, "cur_uuid": cur_uuid}

    # Normal restart: update fingerprint
    _write_db_fingerprint(sidecar, cur_inode, cur_uuid)
    return None


def _write_db_fingerprint(sidecar, inode, db_uuid):
    """Write fingerprint sidecar file."""
    try:
        with open(sidecar, "w") as f:
            _json.dump({"inode": inode, "uuid": db_uuid}, f)
    except Exception:
        pass


def _log_db_change_if_replaced():
    """Check fingerprint and log audit entry if DB was replaced.

    Called from main.py startup event after init_db().
    """
    result = _check_db_fingerprint()
    if not result or not result.get("replaced"):
        return

    try:
        from backend.routers.logs import log_audit
        from backend.audit_categories import AUDIT_CAT_SYSTEM
        from backend.models.local import LocalUser
        db = next(get_db())
        # Find an admin user to attribute the log entry
        admin_user = db.query(LocalUser).filter(LocalUser.role == "admin").first()
        if admin_user:
            log_audit(db, admin_user, "db_file_replaced",
                      f"数据库文件已被替换（{result.get('reason', '')}）",
                      AUDIT_CAT_SYSTEM, "high")
        db.close()
    except Exception as e:
        logger.warning(f"Failed to log DB replacement: {e}")
