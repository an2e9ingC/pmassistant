"""Upload attachment statistics (admin only)."""
import os
import logging
from pathlib import Path

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func as sfunc

from backend.database import get_db, _db_path
from backend.middleware.auth import require_admin

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/uploads", tags=["uploads-manage"])

# ── Helpers ──

_UPLOAD_ROOT = Path(_db_path).parent / "uploads"


def _format_size(size_bytes: int) -> str:
    """Human-readable file size."""
    if size_bytes < 1024:
        return f"{size_bytes} B"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    elif size_bytes < 1024 * 1024 * 1024:
        return f"{size_bytes / (1024 * 1024):.1f} MB"
    else:
        return f"{size_bytes / (1024 * 1024 * 1024):.2f} GB"


def _scan_dir_size(path: Path) -> int:
    """Recursively sum file sizes in a directory. Returns 0 if dir doesn't exist."""
    if not path.exists() or not path.is_dir():
        return 0
    total = 0
    for root, dirs, files in os.walk(path):
        for f in files:
            fp = Path(root) / f
            try:
                total += fp.stat().st_size
            except OSError:
                pass
    return total


def _scan_dir_files(path: Path) -> set:
    """Return set of filenames in a flat directory."""
    if not path.exists() or not path.is_dir():
        return set()
    return set(f.name for f in path.iterdir() if f.is_file())


# ── Endpoint ──

@router.get("/stats")
def get_upload_stats(_=Depends(require_admin), db: Session = Depends(get_db)):
    """Return upload file statistics: total, by_type, by_product, by_project."""

    # ── note_images — filesystem only (no DB record) ──
    note_images_dir = _UPLOAD_ROOT / "note_images"
    note_images_count = 0
    note_images_size = 0
    note_images_names = set()
    if note_images_dir.exists() and note_images_dir.is_dir():
        for f in note_images_dir.iterdir():
            if f.is_file():
                note_images_names.add(f.name)
                try:
                    note_images_size += f.stat().st_size
                except OSError:
                    pass
                note_images_count += 1

    # ── block_diagrams — DB records + filesystem size ──
    from backend.models.local import ProductBlockDiagram
    block_diagrams_dir = _UPLOAD_ROOT / "block_diagrams"
    bd_records = db.query(ProductBlockDiagram).all()
    bd_db_names = set()
    bd_count = len(bd_records)
    bd_size = 0
    for bd in bd_records:
        fp = _UPLOAD_ROOT / bd.file_path if not bd.file_path.startswith("uploads/") else Path(_db_path).parent / bd.file_path
        bd_db_names.add(bd.file_path.split("/")[-1] if "/" in bd.file_path else bd.file_path)
        try:
            if fp.exists():
                bd_size += fp.stat().st_size
        except OSError:
            pass

    # ── bug_attachments — DB with file_size ──
    from backend.models.bug import BugAttachment
    bug_att_count = db.query(sfunc.count(BugAttachment.id)).scalar() or 0
    bug_att_size = db.query(sfunc.coalesce(sfunc.sum(BugAttachment.file_size), 0)).scalar() or 0

    # Verify bug attachment files exist
    bug_dir = _UPLOAD_ROOT / "bugs"
    bug_files_on_disk = set()
    bug_disk_size = 0
    if bug_dir.exists():
        for root, dirs, files in os.walk(bug_dir):
            for f in files:
                bug_files_on_disk.add(f)
                try:
                    bug_disk_size += (Path(root) / f).stat().st_size
                except OSError:
                    pass

    # ── orphan detection — files on disk not tracked in DB ──
    all_db_names = set()
    all_db_names.update(note_images_names)  # all note_images are "tracked" (intentional)
    all_db_names.update(bd_db_names)
    # Bug attachments from DB
    bug_att_records = db.query(BugAttachment).all()
    for ba in bug_att_records:
        all_db_names.add(ba.filename)

    # Find files in uploads that aren't recognized
    orphan_count = 0
    orphan_size = 0
    for root, dirs, files in os.walk(_UPLOAD_ROOT):
        for f in files:
            if f not in all_db_names:
                orphan_count += 1
                try:
                    orphan_size += (Path(root) / f).stat().st_size
                except OSError:
                    pass

    total_count = note_images_count + bd_count + bug_att_count + orphan_count
    total_size = note_images_size + bd_size + bug_att_size + orphan_size

    # ── by_type ──
    types = [
        {"type": "bug_attachments", "label": "Bug 附件", "count": bug_att_count, "size_bytes": bug_att_size},
        {"type": "block_diagrams", "label": "产品框图", "count": bd_count, "size_bytes": bd_size},
        {"type": "note_images", "label": "笔记图片", "count": note_images_count, "size_bytes": note_images_size},
        {"type": "orphan_files", "label": "未关联文件", "count": orphan_count, "size_bytes": orphan_size},
    ]
    for t in types:
        t["percent"] = round(t["size_bytes"] / total_size * 100, 1) if total_size > 0 else 0
        t["size_display"] = _format_size(t["size_bytes"])

    # ── by_product ──
    from backend.models.zentao import PmaProduct
    from backend.models.bug import PmaBug

    # Bug attachments by product
    bug_by_product = (
        db.query(
            PmaBug.product_id,
            PmaProduct.name,
            sfunc.count(BugAttachment.id).label("cnt"),
            sfunc.coalesce(sfunc.sum(BugAttachment.file_size), 0).label("sz"),
        )
        .join(BugAttachment, BugAttachment.bug_id == PmaBug.id)
        .join(PmaProduct, PmaProduct.id == PmaBug.product_id)
        .group_by(PmaBug.product_id, PmaProduct.name)
        .all()
    )

    # Block diagrams by product
    bd_by_product = (
        db.query(
            ProductBlockDiagram.product_id,
            PmaProduct.name,
            sfunc.count(ProductBlockDiagram.id).label("cnt"),
        )
        .join(PmaProduct, PmaProduct.id == ProductBlockDiagram.product_id)
        .group_by(ProductBlockDiagram.product_id, PmaProduct.name)
        .all()
    )

    # Merge product stats
    product_map = {}
    for row in bug_by_product:
        pid, pname, cnt, sz = row
        product_map[pid] = {"product_id": pid, "product_name": pname or f"产品#{pid}", "count": cnt or 0, "size_bytes": sz or 0}
    for row in bd_by_product:
        pid, pname, cnt = row
        if pid in product_map:
            product_map[pid]["count"] += cnt or 0
        else:
            product_map[pid] = {"product_id": pid, "product_name": pname or f"产品#{pid}", "count": cnt or 0, "size_bytes": 0}
            # Recalculate block diagram sizes for this product
            bd_size_for_prod = 0
            for bd in bd_records:
                if bd.product_id == pid:
                    fp = _UPLOAD_ROOT / bd.file_path if not bd.file_path.startswith("uploads/") else Path(_db_path).parent / bd.file_path
                    try:
                        if fp.exists():
                            bd_size_for_prod += fp.stat().st_size
                    except OSError:
                        pass
            product_map[pid]["size_bytes"] += bd_size_for_prod

    by_product = sorted(product_map.values(), key=lambda x: x["size_bytes"], reverse=True)
    for p in by_product:
        p["percent"] = round(p["size_bytes"] / total_size * 100, 1) if total_size > 0 else 0
        p["size_display"] = _format_size(p["size_bytes"])

    # ── by_project ──
    from backend.models.zentao import CachedProject

    bug_by_project = (
        db.query(
            PmaBug.project_id,
            CachedProject.name,
            sfunc.count(BugAttachment.id).label("cnt"),
            sfunc.coalesce(sfunc.sum(BugAttachment.file_size), 0).label("sz"),
        )
        .join(BugAttachment, BugAttachment.bug_id == PmaBug.id)
        .outerjoin(CachedProject, CachedProject.id == PmaBug.project_id)
        .filter(PmaBug.project_id.isnot(None))
        .group_by(PmaBug.project_id, CachedProject.name)
        .all()
    )

    by_project = []
    for row in bug_by_project:
        pid, pname, cnt, sz = row
        by_project.append({
            "project_id": pid,
            "project_name": pname or f"项目#{pid}",
            "count": cnt or 0,
            "size_bytes": sz or 0,
        })
    by_project.sort(key=lambda x: x["size_bytes"], reverse=True)
    for p in by_project:
        p["percent"] = round(p["size_bytes"] / total_size * 100, 1) if total_size > 0 else 0
        p["size_display"] = _format_size(p["size_bytes"])

    return {
        "code": 0,
        "data": {
            "total": {
                "count": total_count,
                "size_bytes": total_size,
                "size_display": _format_size(total_size),
            },
            "by_type": types,
            "by_product": by_product,
            "by_project": by_project,
        },
        "message": "ok",
    }
