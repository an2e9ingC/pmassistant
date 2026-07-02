import logging
import traceback
from datetime import datetime

from backend.config import beijing_now
from backend.database import SessionLocal
from backend.models.log_entry import LogEntry


class DatabaseLogHandler(logging.Handler):
    """Custom logging handler that writes log records to the SQLite log_entries table."""

    def emit(self, record: logging.LogRecord):
        try:
            db = SessionLocal()
            try:
                entry = LogEntry(
                    timestamp=datetime.utcfromtimestamp(record.created),
                    level=record.levelname,
                    logger=record.name,
                    message=self.format(record),
                    module=getattr(record, "module", None) or record.name,
                )
                db.add(entry)
                db.commit()
            except Exception:
                db.rollback()
            finally:
                db.close()
        except Exception:
            # Don't let logging failures crash the app
            traceback.print_exc()
